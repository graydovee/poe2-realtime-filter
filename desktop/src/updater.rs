use std::{
    ffi::OsString,
    fs::{self, OpenOptions},
    io::Write,
    os::windows::io::AsRawHandle,
    path::{Path, PathBuf},
    process::Command,
};

use serde::Deserialize;
use windows_sys::Win32::{
    Foundation::{CloseHandle, GetLastError, ERROR_INVALID_PARAMETER, HANDLE, WAIT_OBJECT_0},
    Storage::FileSystem::SYNCHRONIZE,
    System::Threading::{
        CreateEventW, OpenEventW, OpenProcess, SetEvent, WaitForMultipleObjects,
        WaitForSingleObject, EVENT_MODIFY_STATE,
    },
};

use crate::{
    platform,
    sync::{self, Result},
};

const RELEASES: &str = "https://git.graydove.cn/graydove/poe2-filter/releases";
const LATEST: &str = "https://git.graydove.cn/api/v1/repos/graydove/poe2-filter/releases/latest";
const MAX_EXE_SIZE: usize = 32 * 1024 * 1024;
pub const APPLY_FLAG: &str = "--apply-client-update";
pub const READY_FLAG: &str = "--client-update-ready";

#[derive(Deserialize)]
struct ReleaseInfo {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
}

#[derive(Clone)]
pub struct Release {
    pub tag: String,
    filename: String,
}

fn stable_version(version: &str) -> Option<[u64; 3]> {
    let mut parts = version.split('.');
    let mut numbers = [0; 3];
    for number in &mut numbers {
        let part = parts.next()?;
        if !part.bytes().all(|b| b.is_ascii_digit()) || (part.len() > 1 && part.starts_with('0')) {
            return None;
        }
        *number = part.parse().ok()?;
    }
    parts.next().is_none().then_some(numbers)
}

fn select_release(info: ReleaseInfo, current: [u64; 3]) -> Result<Option<Release>> {
    if info.draft || info.prerelease {
        return Ok(None);
    }
    let Some(version) = info.tag_name.strip_prefix('v').and_then(stable_version) else {
        return Ok(None);
    };
    if version <= current {
        return Ok(None);
    }
    let filename = format!("poe2-filter-windows-amd64-{}.exe", info.tag_name);
    let checksum = format!("{filename}.sha256");
    if !info.assets.iter().any(|asset| asset.name == filename)
        || !info.assets.iter().any(|asset| asset.name == checksum)
    {
        return Err("新版的 Windows 安装文件仍未发布，请稍后重试".into());
    }
    Ok(Some(Release {
        tag: info.tag_name,
        filename,
    }))
}

pub fn check() -> Result<Option<Release>> {
    let current = stable_version(env!("CARGO_PKG_VERSION")).ok_or("无法识别当前版本")?;
    let response = platform::get_public(LATEST, 256 * 1024)?;
    if response.status == 404 {
        return Ok(None);
    }
    if response.status != 200 {
        return Err(format!("检查客户端更新失败 (HTTP {})", response.status));
    }
    let info = serde_json::from_slice(&response.bytes).map_err(|_| "无法读取客户端发布信息")?;
    select_release(info, current)
}

pub struct Staged {
    pub tag: String,
    target: PathBuf,
    nonce: String,
    checksum: String,
    handed_off: bool,
}

fn sibling(target: &Path, nonce: &str, suffix: &str) -> PathBuf {
    target.with_file_name(format!(".poe2-filter-update-{nonce}.{suffix}"))
}

fn valid_checksum(checksum: &str) -> bool {
    checksum.len() == 64 && checksum.bytes().all(|b| b.is_ascii_hexdigit())
}

fn verify(bytes: &[u8], checksum: &str) -> Result<()> {
    if !valid_checksum(checksum)
        || !bytes.starts_with(b"MZ")
        || !sync::hash(bytes).eq_ignore_ascii_case(checksum)
    {
        return Err("客户端安装文件校验失败".into());
    }
    Ok(())
}

pub fn download(release: &Release) -> Result<Staged> {
    let url = format!("{RELEASES}/download/{}/{}", release.tag, release.filename);
    let checksum = platform::get_public(&format!("{url}.sha256"), 4096)?;
    if checksum.status != 200 {
        return Err(format!("获取校验文件失败 (HTTP {})", checksum.status));
    }
    let checksum = std::str::from_utf8(&checksum.bytes)
        .ok()
        .and_then(|text| text.split_whitespace().next())
        .filter(|hash| valid_checksum(hash))
        .ok_or("校验文件无效")?
        .to_ascii_lowercase();
    let executable = platform::get_public(&url, MAX_EXE_SIZE)?;
    if executable.status != 200 {
        return Err(format!("下载客户端失败 (HTTP {})", executable.status));
    }
    verify(&executable.bytes, &checksum)?;

    let target = std::env::current_exe().map_err(|e| e.to_string())?;
    let nonce = platform::random_uuid()?;
    let path = sibling(&target, &nonce, "exe");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| format!("无法在客户端目录准备更新：{e}"))?;
    let staged = Staged {
        target,
        nonce,
        checksum,
        tag: release.tag.clone(),
        handed_off: false,
    };
    let saved = file
        .write_all(&executable.bytes)
        .and_then(|_| file.sync_all());
    drop(file);
    saved.map_err(|e| format!("无法写入客户端更新：{e}"))?;
    Ok(staged)
}

impl Drop for Staged {
    fn drop(&mut self) {
        if !self.handed_off {
            let _ = fs::remove_file(sibling(&self.target, &self.nonce, "exe"));
        }
    }
}

impl Staged {
    pub fn restart(&mut self, state_root: &Path) -> Result<()> {
        let helpers = state_root.join("update-helpers");
        fs::create_dir_all(&helpers).map_err(|e| e.to_string())?;
        let path = helpers.join(format!("{}.exe", self.nonce));
        fs::copy(&self.target, &path).map_err(|e| format!("无法准备更新助手：{e}"))?;
        let child = Command::new(&path)
            .arg(APPLY_FLAG)
            .arg(std::process::id().to_string())
            .arg(&self.target)
            .arg(&self.nonce)
            .arg(&self.checksum)
            .spawn();
        if let Err(error) = child {
            let _ = fs::remove_file(path);
            return Err(format!("无法启动更新助手：{error}"));
        }
        self.handed_off = true;
        Ok(())
    }
}

pub fn clean_helpers(root: &Path) {
    if let Ok(files) = fs::read_dir(root.join("update-helpers")) {
        for file in files.flatten() {
            if file
                .path()
                .file_stem()
                .and_then(|name| name.to_str())
                .is_some_and(sync::valid_uuid)
                && file
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "exe")
            {
                let _ = fs::remove_file(file.path());
            }
        }
    }
}

fn wait_for_exit(pid: u32) -> Result<()> {
    unsafe {
        let process = OpenProcess(SYNCHRONIZE, 0, pid);
        if process.is_null() {
            // The parent may have already shut down before Windows scheduled the helper.
            if GetLastError() == ERROR_INVALID_PARAMETER {
                return Ok(());
            }
            return Err(platform::err("无法等待旧客户端退出"));
        }
        let wait = WaitForSingleObject(process, 30_000);
        CloseHandle(process);
        if wait == WAIT_OBJECT_0 {
            Ok(())
        } else {
            Err("旧客户端未能及时退出".into())
        }
    }
}

fn ready_event_name(nonce: &str) -> Vec<u16> {
    platform::wide(&format!("Local\\poe2-filter-update-{nonce}"))
}

pub fn signal_ready(nonce: &str) {
    if !sync::valid_uuid(nonce) {
        return;
    }
    unsafe {
        let event = OpenEventW(EVENT_MODIFY_STATE, 0, ready_event_name(nonce).as_ptr());
        if !event.is_null() {
            SetEvent(event);
            CloseHandle(event);
        }
    }
}

fn launch_updated(exe: &Path, nonce: &str) -> Result<()> {
    let event = unsafe { CreateEventW(std::ptr::null(), 1, 0, ready_event_name(nonce).as_ptr()) };
    if event.is_null() {
        return Err(platform::err("无法初始化新版启动验证"));
    }
    let result = (|| {
        let mut child = Command::new(exe)
            .arg(READY_FLAG)
            .arg(nonce)
            .spawn()
            .map_err(|e| format!("无法启动新版客户端：{e}"))?;
        let handles = [event, child.as_raw_handle() as HANDLE];
        if unsafe { WaitForMultipleObjects(handles.len() as u32, handles.as_ptr(), 0, 30_000) }
            == WAIT_OBJECT_0
        {
            return Ok(());
        }
        let _ = child.kill();
        child
            .wait()
            .map_err(|e| format!("无法等待新版客户端退出：{e}"))?;
        Err("新版客户端未完成启动，正在恢复旧版".into())
    })();
    unsafe {
        CloseHandle(event);
    }
    result
}

fn replace_and_launch(
    target: &Path,
    staged: &Path,
    backup: &Path,
    launch: impl FnOnce(&Path) -> Result<()>,
) -> Result<()> {
    fs::copy(target, backup).map_err(|e| format!("无法备份旧客户端：{e}"))?;
    if let Err(error) = platform::replace(staged, target) {
        let _ = fs::remove_file(backup);
        return Err(error);
    }
    if let Err(error) = launch(target) {
        platform::replace(backup, target).map_err(|restore| {
            format!(
                "{error}。恢复失败（{restore}），旧版备份位于 {}",
                backup.display()
            )
        })?;
        return Err(error);
    }
    let _ = fs::remove_file(backup);
    Ok(())
}

pub fn apply(args: &[OsString]) -> Result<()> {
    let [pid, target, nonce, checksum] = args else {
        return Err("更新参数无效".into());
    };
    let pid = pid
        .to_str()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|&pid| pid != 0)
        .ok_or("更新进程无效")?;
    let target = Path::new(target);
    if !target.is_absolute() || target.file_name().is_none() {
        return Err("客户端路径无效".into());
    }
    let nonce = nonce
        .to_str()
        .filter(|nonce| sync::valid_uuid(nonce))
        .ok_or("更新标识无效")?;
    let checksum = checksum
        .to_str()
        .filter(|checksum| valid_checksum(checksum))
        .ok_or("校验值无效")?;
    let staged = sibling(target, nonce, "exe");
    let backup = sibling(target, nonce, "bak");
    wait_for_exit(pid)?;
    let result = (|| {
        let metadata = fs::metadata(&staged).map_err(|e| e.to_string())?;
        if metadata.len() > MAX_EXE_SIZE as u64 {
            return Err("更新文件超过大小限制".into());
        }
        verify(&fs::read(&staged).map_err(|e| e.to_string())?, checksum)?;
        replace_and_launch(target, &staged, &backup, |exe| launch_updated(exe, nonce))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&staged);
        // A surviving backup indicates the recovery path could not replace the target.
        if !backup.exists() {
            let _ = Command::new(target).spawn();
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_complete_newer_stable_releases_are_offered() {
        let info = |tag: &str, prerelease| ReleaseInfo {
            tag_name: tag.into(),
            draft: false,
            prerelease,
            assets: [".exe", ".exe.sha256"]
                .map(|ext| Asset {
                    name: format!("poe2-filter-windows-amd64-{tag}{ext}"),
                })
                .into(),
        };
        assert!(select_release(info("v0.4.10", false), [0, 4, 9])
            .unwrap()
            .is_some());
        assert!(select_release(info("v0.4.1", false), [0, 4, 1])
            .unwrap()
            .is_none());
        assert!(select_release(info("v0.4.1", false), [0, 4, 2])
            .unwrap()
            .is_none());
        assert!(select_release(info("v0.5.0-rc.1", true), [0, 4, 1])
            .unwrap()
            .is_none());
        let mut missing = info("v0.5.0", false);
        missing.assets.pop();
        assert!(select_release(missing, [0, 4, 1]).is_err());
        assert!(verify(b"MZvalid", &sync::hash(b"MZvalid")).is_ok());
        assert!(verify(b"MZchanged", &sync::hash(b"MZvalid")).is_err());
    }

    #[test]
    fn replacing_executable_rolls_back_on_launch_failure() {
        let directory = std::env::temp_dir().join(platform::random_uuid().unwrap());
        fs::create_dir(&directory).unwrap();
        let target = directory.join("old.exe");
        let staged = directory.join("staged.exe");
        let backup = directory.join("old.bak");
        fs::write(&target, b"old").unwrap();
        fs::write(&staged, b"new").unwrap();
        let result = replace_and_launch(&target, &staged, &backup, |exe| {
            assert_eq!(fs::read(exe).unwrap(), b"new");
            Err("launch failed".into())
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old");
        assert!(!backup.exists());
        fs::write(&staged, b"new").unwrap();
        replace_and_launch(&target, &staged, &backup, |_| Ok(())).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert!(!backup.exists());
        fs::remove_dir_all(directory).unwrap();
    }
}

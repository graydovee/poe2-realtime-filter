use crate::platform;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use url::Url;
pub type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Entry {
    pub id: String,
    pub origin: String,
    pub protected_key: String,
    pub directory: PathBuf,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub league: String,
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub revoked: bool,
    #[serde(default)]
    pub current: Option<String>,
    #[serde(default)]
    pub filter_filename: Option<String>,
    #[serde(default)]
    pub previous: Option<String>,
    #[serde(default)]
    pub status: String,
}
#[derive(Clone,Serialize,Deserialize)]
pub struct Settings{pub interval_minutes:u32,pub autostart:bool,pub entries:Vec<Entry>}
impl Default for Settings{fn default()->Self{Self{interval_minutes:30,autostart:false,entries:vec![]}}}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Manifest{pub protocol_version:u32,pub profile_id:String,pub name:String,pub league:String,pub config_version:u64,pub revision:String,pub market_captured_at:String,pub generated_at:String,pub files:Vec<File>,#[serde(default)]pub stale:bool,#[serde(default)]pub error:Option<String>}
#[derive(Clone,Serialize,Deserialize)]
pub struct File{pub id:String,pub path:String,pub kind:String,pub size:u64,pub sha256:String}
pub fn hash(bytes:&[u8])->String{hex::encode(Sha256::digest(bytes))}
pub fn state_root()->PathBuf{std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("poe2-filter")}
pub fn read_settings(root:&Path)->Result<Settings>{let file=root.join("settings.json");if !file.exists(){return Ok(Settings::default());}serde_json::from_slice(&fs::read(file).map_err(|e|e.to_string())?).map_err(|_|"配置文件损坏，请从备份恢复".into())}
pub fn save_settings(root:&Path,state:&Settings)->Result<()>{fs::create_dir_all(root).map_err(|e|e.to_string())?;let target=root.join("settings.json");let temporary=root.join("settings.tmp");fs::write(&temporary,serde_json::to_vec_pretty(state).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;platform::replace(&temporary,&target)}
pub fn parse_link(link:&str,directory:PathBuf)->Result<Entry>{let url=Url::parse(link.trim()).map_err(|_|"请输入网站复制的完整订阅链接".to_string())?;if url.scheme()!="https"||!url.username().is_empty()||url.password().is_some()||url.query().is_some(){return Err("订阅链接必须是 HTTPS 地址".into());}
 let segments:Vec<_>=url.path().trim_matches('/').split('/').collect();if segments.len()!=2||segments[0]!="sync"||!valid_id(segments[1]){return Err("不是有效订阅链接".into());}
 let key=url.fragment().and_then(|f|f.strip_prefix("key=")).ok_or("链接缺少密钥")?;if key.len()<32||key.len()>256||!key.chars().all(|c|c.is_ascii_alphanumeric()||c=='-'||c=='_'){return Err("无效订阅密钥".into());}
 Ok(Entry{id:segments[1].into(),origin:url.origin().ascii_serialization(),protected_key:platform::protect(key)?,directory,name:"等待同步".into(),..Entry::default()})
}
fn valid_id(s:&str)->bool{!s.is_empty()&&s.len()<=100&&s.chars().all(|c|c.is_ascii_alphanumeric()||c=='-')}
fn valid_revision(s:&str)->bool{s.len()==32&&s.chars().all(|c|c.is_ascii_hexdigit())}
pub fn validate(m:&Manifest,id:&str)->Result<()>{if m.protocol_version!=1||m.profile_id!=id||!valid_revision(&m.revision)||m.files.is_empty()||m.files.len()>100{return Err("订阅协议或版本不匹配".into());}
 let mut filter=0;let mut total=0u64;let mut paths=std::collections::HashSet::new();let mut ids=std::collections::HashSet::new();
 for f in &m.files{if !valid_id(&f.id)||!paths.insert(f.path.to_lowercase())||!ids.insert(f.id.clone())||f.sha256.len()!=64||!f.sha256.chars().all(|c|c.is_ascii_hexdigit()){return Err("文件清单无效".into());}
 if f.path.contains(['\\',':'])||f.path.starts_with('/')||f.path.split('/').any(|p|p.is_empty()||p=="."||p==".."||p.ends_with('.')||p.ends_with(' ')){return Err("拒绝越界路径".into());}
 if f.kind=="filter"{filter+=1;if f.path!=format!("poe2-filter-{id}.filter"){return Err("过滤器文件名不匹配".into());}}
 else if f.kind=="sound"{let prefix=format!("poe2-filter-assets/{id}/{}/",m.revision);if !f.path.starts_with(&prefix)||!['m','w','o'].iter().any(|_|[".mp3",".wav",".ogg"].iter().any(|e|f.path.to_lowercase().ends_with(e))){return Err("音效路径无效".into());}}
 else{return Err("不支持的文件类型".into());}total=total.checked_add(f.size).ok_or("文件过大")?;if f.size>8*1024*1024||total>40*1024*1024{return Err("下载包过大".into());}}
 if filter!=1{return Err("过滤器数量无效".into());}Ok(())
}
fn clean_parent(target:&Path)->Result<()>{use std::os::windows::fs::MetadataExt;let mut parent=target.parent();while let Some(p)=parent{if let Ok(m)=fs::symlink_metadata(p){if m.file_attributes()&0x400!=0{return Err("目标目录包含重解析点，请选择实际目录".into());}}parent=p.parent();}Ok(())}
fn checked_file(path:&Path,file:&File)->Result<Vec<u8>>{let bytes=fs::read(path).map_err(|e|e.to_string())?;if bytes.len() as u64!=file.size||hash(&bytes)!=file.sha256{return Err("文件完整性校验失败".into());}Ok(bytes)}
fn cache(root:&Path,id:&str,rev:&str)->PathBuf{root.join("cache").join(id).join(rev)}

// Keep the manifest's download paths stable. Only the local filter is named
// after the profile, because the game displays its filename in the picker.
fn windows_basename(name: &str) -> bool {
    if name.is_empty()
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return false;
    }
    let device = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end()
        .to_ascii_uppercase();
    let port = device
        .strip_prefix("COM")
        .or_else(|| device.strip_prefix("LPT"));
    !matches!(
        device.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) && !port.is_some_and(|n| {
        matches!(
            n,
            "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "\u{b9}" | "\u{b2}" | "\u{b3}"
        )
    })
}

fn filter_stem(name: &str) -> String {
    let mut stem = String::new();
    let mut length = 0;
    for c in name.trim().chars() {
        let c = if c.is_control() || "<>:\"/\\|?*".contains(c) {
            '_'
        } else {
            c
        };
        length += c.len_utf16();
        if length > 120 {
            break;
        }
        stem.push(c);
    }
    let stem = stem.trim_matches(['.', ' ']);
    if stem.is_empty() {
        "未命名方案".to_owned()
    } else if !windows_basename(stem) {
        format!("_{stem}")
    } else {
        stem.to_owned()
    }
}

pub fn filter_path(entry: &Entry) -> Result<Option<PathBuf>> {
    if !entry.directory.is_absolute() {
        return Err("过滤器目录必须是绝对路径".into());
    }
    let filename = match &entry.filter_filename {
        Some(name) if name.ends_with(".filter") && windows_basename(name) => name.clone(),
        Some(_) => return Err("记录的过滤器文件名无效".into()),
        None if entry.current.is_none() => return Ok(None),
        None if valid_id(&entry.id) => format!("poe2-filter-{}.filter", entry.id),
        None => return Err("方案 ID 无效".into()),
    };
    Ok(Some(entry.directory.join(filename)))
}

fn metadata(path: &Path) -> Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(meta) => Ok(Some(meta)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn regular_file(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    meta.is_file() && meta.file_attributes() & 0x400 == 0
}

fn filter_file(manifest: &Manifest) -> &File {
    // Both cached and remote manifests are validated before use.
    manifest
        .files
        .iter()
        .find(|file| file.kind == "filter")
        .unwrap()
}

fn cached_manifest(root: &Path, id: &str, revision: &str) -> Result<Manifest> {
    if !valid_id(id) || !valid_revision(revision) {
        return Err("缓存版本无效".into());
    }
    let bytes = fs::read(cache(root, id, revision).join("manifest.json"))
        .map_err(|e| format!("无法读取缓存清单：{e}"))?;
    let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    validate(&manifest, id)?;
    if manifest.revision != revision {
        return Err("缓存版本不匹配".into());
    }
    Ok(manifest)
}

fn matches_filter(path: &Path, meta: &fs::Metadata, expected: &File) -> Result<bool> {
    if !regular_file(meta) || meta.len() != expected.size {
        return Ok(false);
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(hash(&bytes) == expected.sha256)
}

fn still_managed(root: &Path, entry: &Entry, path: &Path, meta: &fs::Metadata) -> Result<bool> {
    let Some(revision) = &entry.current else {
        return Ok(false);
    };
    let manifest = cached_manifest(root, &entry.id, revision)?;
    matches_filter(path, meta, filter_file(&manifest))
}

pub fn delete_filter(root: &Path, entry: &Entry, others: &[Entry]) -> Result<()> {
    let Some(path) = filter_path(entry)? else {
        return Ok(());
    };
    clean_parent(&path)?;
    let Some(meta) = metadata(&path)? else {
        return Ok(());
    };
    if reserved(&path, entry, others) || !still_managed(root, entry, &path, &meta)? {
        return Err("无法确认文件属于此方案，文件已保留。可选择仅移除方案。".into());
    }
    fs::remove_file(&path).map_err(|e| format!("无法删除 {}：{e}", path.display()))
}

fn reserved(path: &Path, entry: &Entry, others: &[Entry]) -> bool {
    let basename = path.file_name().unwrap().to_string_lossy().to_lowercase();
    others
        .iter()
        .filter(|other| other.id != entry.id || other.origin != entry.origin)
        .filter_map(|other| filter_path(other).ok().flatten())
        .any(|other| {
            if other.file_name().unwrap().to_string_lossy().to_lowercase() != basename {
                return false;
            }
            let (dir, other_dir) = (path.parent().unwrap(), other.parent().unwrap());
            dir.to_string_lossy().to_lowercase() == other_dir.to_string_lossy().to_lowercase()
                || same_existing_path(dir, other_dir)
        })
}

fn same_existing_path(a: &Path, b: &Path) -> bool {
    fs::canonicalize(a)
        .ok()
        .zip(fs::canonicalize(b).ok())
        .is_some_and(|(a, b)| a == b)
}

fn available_filter_path(
    entry: &Entry,
    name: &str,
    owned: Option<&Path>,
    others: &[Entry],
) -> Result<PathBuf> {
    let stem = filter_stem(name);
    for number in 1..=1000 {
        let basename = if number == 1 {
            format!("{stem}.filter")
        } else {
            format!("{stem} ({number}).filter")
        };
        let target = entry.directory.join(basename);
        if reserved(&target, entry, others) {
            continue;
        }
        if metadata(&target)?.is_none()
            || owned.is_some_and(|path| {
                path == target
                    || (path.to_string_lossy().to_lowercase()
                        == target.to_string_lossy().to_lowercase()
                        && same_existing_path(path, &target))
            })
        {
            return Ok(target);
        }
    }
    Err("同名过滤器过多，无法分配文件名".into())
}

fn write_installation(target: &Path, bytes: &[u8], replace: bool) -> Result<()> {
    use std::{
        io::Write,
        sync::atomic::{AtomicUsize, Ordering},
    };
    static NEXT_TEMP: AtomicUsize = AtomicUsize::new(0);
    let temporary = target.with_file_name(format!(
        ".poe2-filter-{}-{}.tmp",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    let written = file.write_all(bytes);
    drop(file);
    let result = written
        .map_err(|e| e.to_string())
        .and_then(|()| platform::move_file(&temporary, target, replace));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn install(
    root: &Path,
    entry: &mut Entry,
    manifest: &Manifest,
    name: &str,
    others: &[Entry],
) -> Result<()> {
    let old_path = filter_path(entry)?;
    let mut owned = None;
    let mut same_bytes = false;
    let filter = filter_file(manifest);
    if let Some(path) = &old_path {
        clean_parent(path)?;
        if let Some(meta) = metadata(path)? {
            same_bytes = matches_filter(path, &meta, filter)?;
            // An unchanged revision can also be verified using the remote
            // manifest when the local cache has been lost.
            let current_matches =
                entry.current.as_deref() == Some(&manifest.revision) && same_bytes;
            if !reserved(path, entry, others)
                && (current_matches || still_managed(root, entry, path, &meta).unwrap_or(false))
            {
                owned = Some(path.as_path());
            }
        }
    }
    let target = match owned {
        Some(path) if entry.name == name && entry.filter_filename.is_some() => path.to_owned(),
        _ => available_filter_path(entry, name, owned, others)?,
    };
    clean_parent(&target)?;
    fs::create_dir_all(&entry.directory).map_err(|e| e.to_string())?;
    let dir = cache(root, &entry.id, &manifest.revision);
    let bytes = checked_file(&dir.join(&filter.id), filter)?;
    for sound in manifest.files.iter().filter(|file| file.kind == "sound") {
        let path = entry.directory.join(&sound.path);
        clean_parent(&path)?;
        if let Some(meta) = metadata(&path)? {
            if !regular_file(&meta) {
                return Err("目标音效文件是链接或目录，停止更新".into());
            }
            if matches_filter(&path, &meta, sound)? {
                continue;
            }
        }
        fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        write_installation(&path, &checked_file(&dir.join(&sound.id), sound)?, true)?;
    }
    let filename = target.file_name().unwrap().to_string_lossy().into_owned();
    if let Some(old) = owned {
        // Move the known file atomically. If replacing its contents then
        // fails, it still contains the previous revision at the new path.
        if old != target {
            platform::move_file(old, &target, false)?;
            entry.filter_filename = Some(filename.clone());
        }
        if !same_bytes {
            write_installation(&target, &bytes, true)?;
        }
    } else {
        write_installation(&target, &bytes, false)?;
    }
    entry.filter_filename = Some(filename);
    Ok(())
}

pub fn update(root: &Path, entry: &mut Entry, others: &[Entry]) -> Result<bool> {
    let key = platform::unprotect(&entry.protected_key)?;
    // A rename can leave the content revision (the server's ETag) unchanged.
    let response = platform::get(
        &format!("{}/api/sync/{}/manifest", entry.origin, entry.id),
        &key,
        None,
        1024 * 1024,
    )?;
    if [401, 403, 404, 410].contains(&response.status) {
        entry.revoked = true;
        entry.status = "订阅已停用、删除或密钥失效，现有文件已保留".into();
        return Err(entry.status.clone());
    }
    if response.status != 200 {
        return Err(format!("服务器暂不可用：HTTP {}", response.status));
    }
    let manifest: Manifest =
        serde_json::from_slice(&response.bytes).map_err(|_| "无法读取订阅清单")?;
    validate(&manifest, &entry.id)?;
    if manifest.stale {
        return Err(format!(
            "服务器保留旧版本：{}",
            manifest.error.unwrap_or_default()
        ));
    }
    let files_url = format!(
        "{}/api/sync/{}/revisions/{}/files",
        entry.origin, entry.id, manifest.revision
    );
    apply_update(root, entry, &manifest, others, |file| {
        let response = platform::get(
            &format!("{files_url}/{}", file.id),
            &key,
            None,
            8 * 1024 * 1024,
        )?;
        if response.status != 200 {
            return Err(format!("下载失败：HTTP {}", response.status));
        }
        Ok(response.bytes)
    })
}

fn apply_update(
    root: &Path,
    entry: &mut Entry,
    manifest: &Manifest,
    others: &[Entry],
    mut download: impl FnMut(&File) -> Result<Vec<u8>>,
) -> Result<bool> {
    let revision_changed = entry.current.as_deref() != Some(&manifest.revision);
    if !revision_changed && entry.name == manifest.name && entry.filter_filename.is_some() {
        if let Some(path) = filter_path(entry)? {
            clean_parent(&path)?;
            if let Some(meta) = metadata(&path)? {
                if !reserved(&path, entry, others)
                    && matches_filter(&path, &meta, filter_file(manifest))?
                    && cached_manifest(root, &entry.id, &manifest.revision).is_ok()
                {
                    entry.league.clone_from(&manifest.league);
                    entry.revoked = false;
                    entry.status = "已是最新版本".into();
                    return Ok(false);
                }
            }
        }
    }
    let dir = cache(root, &entry.id, &manifest.revision);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for file in &manifest.files {
        let target = dir.join(&file.id);
        if checked_file(&target, file).is_ok() {
            continue;
        }
        let bytes = download(file)?;
        if bytes.len() as u64 != file.size || hash(&bytes) != file.sha256 {
            return Err("下载中断或文件校验失败，现有过滤器已保留".into());
        }
        fs::write(&target, bytes).map_err(|e| e.to_string())?;
    }
    write_installation(
        &dir.join("manifest.json"),
        &serde_json::to_vec(manifest).map_err(|e| e.to_string())?,
        true,
    )?;
    install(root, entry, manifest, &manifest.name, others)?;
    if revision_changed {
        entry.previous = entry.current.replace(manifest.revision.clone());
    }
    entry.name.clone_from(&manifest.name);
    entry.league.clone_from(&manifest.league);
    entry.revoked = false;
    entry.status = format!(
        "已更新 · {} · 请在游戏中选择或重新加载过滤器",
        manifest.generated_at
    );
    Ok(true)
}

pub fn rollback(root: &Path, entry: &mut Entry, others: &[Entry]) -> Result<()> {
    let previous = entry.previous.clone().ok_or("没有可回滚版本")?;
    let manifest = cached_manifest(root, &entry.id, &previous)?;
    let name = if entry.current.is_some() {
        entry.name.clone()
    } else {
        manifest.name.clone()
    };
    install(root, entry, &manifest, &name, others)?;
    entry.previous = entry.current.replace(previous);
    entry.name = name;
    entry.paused = true;
    entry.status = "已回滚并暂停同步，请在游戏内重新加载".into();
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn links() {
        assert!(parse_link("http://example.com/sync/abc#key=aaa", PathBuf::new()).is_err());
        assert!(parse_link("https://example.com/sync/../../bad#key=aaa", PathBuf::new()).is_err());
    }
    #[test]
    fn paths() {
        let mut m = Manifest {
            protocol_version: 1,
            profile_id: "abc".into(),
            name: "测试".into(),
            league: "Standard".into(),
            config_version: 1,
            revision: "a".repeat(32),
            market_captured_at: "".into(),
            generated_at: "".into(),
            stale: false,
            error: None,
            files: vec![File {
                id: "filter".into(),
                path: "poe2-filter-abc.filter".into(),
                kind: "filter".into(),
                size: 1,
                sha256: "a".repeat(64),
            }],
        };
        assert!(validate(&m, "abc").is_ok());
        m.files[0].path = "../x.filter".into();
        assert!(validate(&m, "abc").is_err());
    }
    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(test: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("poe2-filter-{}-{test}", std::process::id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn entry(&self, id: &str) -> Entry {
            Entry {
                id: id.to_owned(),
                directory: self.0.join("game"),
                ..Entry::default()
            }
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            if let (Ok(path), Ok(temp)) =
                (self.0.canonicalize(), std::env::temp_dir().canonicalize())
            {
                if path.parent() == Some(&temp) {
                    let _ = fs::remove_dir_all(path);
                }
            }
        }
    }

    fn game_manifest(id: &str, name: &str, revision: char, bytes: &[u8]) -> Manifest {
        Manifest {
            protocol_version: 1,
            profile_id: id.into(),
            name: name.into(),
            league: "Standard".into(),
            config_version: 1,
            revision: revision.to_string().repeat(32),
            market_captured_at: String::new(),
            generated_at: String::new(),
            files: vec![File {
                id: "filter".into(),
                path: format!("poe2-filter-{id}.filter"),
                kind: "filter".into(),
                size: bytes.len() as u64,
                sha256: hash(bytes),
            }],
            stale: false,
            error: None,
        }
    }

    #[test]
    fn same_revision_migrates_legacy_path_and_follows_saved_name() {
        let temp = TestDirectory::new("rename");
        let bytes = b"Show";
        let mut entry = temp.entry("abc");
        let mut manifest = game_manifest("abc", "终极打宝", 'a', bytes);
        entry.current = Some(manifest.revision.clone());
        entry.previous = Some("b".repeat(32));
        entry.name.clone_from(&manifest.name);
        fs::create_dir(&entry.directory).unwrap();
        let legacy = entry.directory.join("poe2-filter-abc.filter");
        fs::write(&legacy, bytes).unwrap();

        assert!(apply_update(&temp.0, &mut entry, &manifest, &[], |_| Ok(bytes.to_vec())).unwrap());
        assert_eq!(entry.filter_filename.as_deref(), Some("终极打宝.filter"));
        assert!(!legacy.exists());
        let first_name = filter_path(&entry).unwrap().unwrap();
        assert_eq!(fs::read(&first_name).unwrap(), bytes);

        manifest.name = "日常刷图".into();
        assert!(
            apply_update(&temp.0, &mut entry, &manifest, &[], |_| panic!(
                "already cached"
            ))
            .unwrap()
        );
        assert_eq!(entry.name, manifest.name);
        assert_eq!(entry.current.as_ref(), Some(&manifest.revision));
        assert_eq!(entry.previous, Some("b".repeat(32)));
        assert!(!first_name.exists());
        let renamed = filter_path(&entry).unwrap().unwrap();
        assert_eq!(renamed.file_name().unwrap(), "日常刷图.filter");
        assert_eq!(fs::read(&renamed).unwrap(), bytes);
        assert!(
            !apply_update(&temp.0, &mut entry, &manifest, &[], |_| panic!(
                "already cached"
            ))
            .unwrap()
        );

        for name in ["Farm", "farm"] {
            manifest.name = name.into();
            assert!(
                apply_update(&temp.0, &mut entry, &manifest, &[], |_| panic!(
                    "already cached"
                ))
                .unwrap()
            );
            let filename = format!("{name}.filter");
            assert_eq!(entry.filter_filename.as_deref(), Some(filename.as_str()));
            assert!(fs::read_dir(&entry.directory)
                .unwrap()
                .any(|file| file.unwrap().file_name() == filename.as_str()));
        }
    }

    #[test]
    fn rename_avoids_unmanaged_filters_and_rollback_keeps_the_saved_name() {
        let temp = TestDirectory::new("collision");
        let mut entry = temp.entry("abc");
        let previous = game_manifest("abc", "旧名称", 'a', b"Show");
        apply_update(
            &temp.0,
            &mut entry,
            &previous,
            &[],
            |_| Ok(b"Show".to_vec()),
        )
        .unwrap();
        let old_path = filter_path(&entry).unwrap().unwrap();
        let unowned = entry.directory.join("FARM.filter");
        fs::write(&unowned, b"manual filter").unwrap();
        let manifest = game_manifest("abc", "farm", 'b', b"Hide");
        assert!(apply_update(&temp.0, &mut entry, &manifest, &[], |_| Ok(
            b"wrong".to_vec()
        ))
        .is_err());
        assert_eq!(fs::read(&old_path).unwrap(), b"Show");
        apply_update(
            &temp.0,
            &mut entry,
            &manifest,
            &[],
            |_| Ok(b"Hide".to_vec()),
        )
        .unwrap();
        let new_path = entry.directory.join("farm (2).filter");
        assert_eq!(filter_path(&entry).unwrap().unwrap(), new_path);
        assert!(!old_path.exists());
        assert_eq!(fs::read(&unowned).unwrap(), b"manual filter");
        rollback(&temp.0, &mut entry, &[]).unwrap();
        assert_eq!(entry.name, "farm");
        assert_eq!(filter_path(&entry).unwrap().unwrap(), new_path);
        assert_eq!(fs::read(&new_path).unwrap(), b"Show");
    }

    #[test]
    fn removal_deletes_only_verified_filter_and_accepts_missing_file() {
        let temp = TestDirectory::new("delete");
        let mut entry = temp.entry("abc");
        let manifest = game_manifest("abc", "终极打宝", 'a', b"Show");
        apply_update(
            &temp.0,
            &mut entry,
            &manifest,
            &[],
            |_| Ok(b"Show".to_vec()),
        )
        .unwrap();
        let managed = filter_path(&entry).unwrap().unwrap();
        let legacy = entry.directory.join("poe2-filter-abc.filter");
        let unrelated = entry.directory.join("Other.filter");
        fs::write(&unrelated, b"Show").unwrap();
        let other = Entry {
            id: "other".into(),
            ..entry.clone()
        };
        assert!(delete_filter(&temp.0, &entry, &[other]).is_err());
        fs::write(&managed, b"local edits").unwrap();
        assert!(delete_filter(&temp.0, &entry, &[]).is_err());
        fs::write(&managed, b"Show").unwrap();
        fs::write(&legacy, b"Show").unwrap();
        delete_filter(&temp.0, &entry, &[]).unwrap();
        delete_filter(&temp.0, &entry, &[]).unwrap();
        assert!(!managed.exists());
        assert!(legacy.exists());
        assert!(unrelated.exists());

        entry.filter_filename = Some("../Other.filter".into());
        assert!(delete_filter(&temp.0, &entry, &[]).is_err());
        entry.filter_filename = None;
        delete_filter(&temp.0, &entry, &[]).unwrap();
        assert!(!legacy.exists());
        assert!(unrelated.exists());
    }

    #[test]
    fn windows_filter_name_preserves_unicode_and_avoids_devices() {
        assert_eq!(filter_stem("  终极打宝  "), "终极打宝");
        assert_eq!(filter_stem("./..\\foo:bar?"), "_.._foo_bar_");
        assert_eq!(filter_stem("NUL.extra"), "_NUL.extra");
        assert_eq!(filter_stem("COM¹"), "_COM¹");
        assert_eq!(filter_stem("..."), "未命名方案");
        assert_eq!(filter_stem(&"🏹".repeat(100)).encode_utf16().count(), 120);
    }

    #[test]
    fn dpapi() {
        let value = "secret-test-123456789";
        let encrypted = platform::protect(value).unwrap();
        assert_ne!(value, encrypted);
        assert_eq!(platform::unprotect(&encrypted).unwrap(), value);
    }
}

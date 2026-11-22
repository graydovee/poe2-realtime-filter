use crate::{
    engine::{self, Result},
    market,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::LazyLock,
};
use uuid::Uuid;

const SHARE_PREFIX: &str = "POE2F1.";
const SHARE_MAX: usize = 1024 * 1024;
const AUDIO_MAX: usize = 8 * 1024 * 1024;
const AUDIO_TOTAL_MAX: usize = 32 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub directory: PathBuf,
    name: String,
    sha256: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scheme {
    pub id: String,
    pub name: String,
    pub profile: Value,
    pub auto_refresh: bool,
    pub installed: Option<Installed>,
    pub status: String,
    #[serde(default)]
    sounds: BTreeMap<String, String>,
}

impl Scheme {
    pub fn league(&self) -> &str {
        self.profile["league"].as_str().unwrap_or("Standard")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub interval_minutes: u32,
    pub paused: bool,
    #[serde(default)]
    pub filter_directory: Option<PathBuf>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Library {
    pub settings: Settings,
    pub schemes: Vec<Scheme>,
}

impl Default for Library {
    fn default() -> Self {
        Self {
            settings: Settings {
                interval_minutes: 30,
                paused: false,
                filter_directory: None,
            },
            schemes: vec![],
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Share {
    name: String,
    profile: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edit {
    pub id: Option<String>,
    pub name: String,
    pub profile: Value,
    pub sounds: BTreeMap<String, String>,
}

pub struct Store {
    root: PathBuf,
    templates: PathBuf,
    pub default_game: PathBuf,
}

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn write_file(path: &Path, data: &[u8], replace: bool) -> Result<()> {
    let parent = path.parent().ok_or("无效文件路径")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(data)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    let result = if replace {
        file.persist(path)
    } else {
        file.persist_noclobber(path)
    };
    result
        .map(|_| ())
        .map_err(|e| format!("{}: {}", path.display(), e.error))
}

pub fn filter_zip(name: &str, filter: &str, sounds: BTreeMap<String, Vec<u8>>) -> Result<Vec<u8>> {
    let name = scheme_name(name)?;
    let mut archive = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    archive
        .start_file(format!("{name}.filter"), options)
        .map_err(|e| e.to_string())?;
    archive
        .write_all(filter.as_bytes())
        .map_err(|e| e.to_string())?;
    for (name, bytes) in sounds {
        archive
            .start_file(name, options)
            .map_err(|e| e.to_string())?;
        archive.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    Ok(archive.finish().map_err(|e| e.to_string())?.into_inner())
}

/// Check permissions with the same kind of temporary file used for atomic writes.
pub fn writable_directory(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() || !path.is_dir() {
        return Err(format!("请选择已存在的绝对目录: {}", path.display()));
    }
    let path = fs::canonicalize(path).map_err(|e| format!("{}: {e}", path.display()))?;
    tempfile::NamedTempFile::new_in(&path)
        .map_err(|e| format!("目录不可写 {}: {e}", path.display()))?;
    Ok(path)
}

pub fn display_directory(path: &Path) -> String {
    let text = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(network) = text.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{network}");
        }
        if let Some(local) = text.strip_prefix(r"\\?\") {
            if local.as_bytes().get(1) == Some(&b':') {
                return local.to_owned();
            }
        }
    }
    text.into_owned()
}

fn valid_windows_name(name: &str) -> bool {
    !name.is_empty()
        && !name.ends_with('.')
        && !name.ends_with(' ')
        && !name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        && !matches!(
            name.split('.')
                .next()
                .unwrap_or_default()
                .trim_end()
                .to_ascii_uppercase()
                .as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM0"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT0"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
                | "COM¹"
                | "COM²"
                | "COM³"
                | "LPT¹"
                | "LPT²"
                | "LPT³"
        )
}

fn scheme_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.encode_utf16().count() > 80 || !valid_windows_name(name) {
        return Err("方案名需要 1–80 个字符，且能用作 Windows 文件名".into());
    }
    Ok(name.to_owned())
}

fn valid_audio(name: &str) -> bool {
    valid_windows_name(name)
        && name.len() <= 150
        && name.rsplit_once('.').is_some_and(|(stem, ext)| {
            !stem.is_empty() && matches!(ext.to_ascii_lowercase().as_str(), "ogg" | "wav" | "mp3")
        })
}

fn audio_pattern() -> &'static Regex {
    static RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?m)^(\s*CustomAlertSound(?:Optional)?\s+")([^"\r\n]+)(")"#).unwrap()
    });
    &RE
}

fn sound_names(profile: &Value) -> BTreeSet<String> {
    profile["rules"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|rule| {
            let sound = &rule["effects"]["sound"];
            (sound["type"] == "custom")
                .then(|| sound["fileName"].as_str())
                .flatten()
                .map(str::to_owned)
        })
        .collect()
}

fn paths_same(left: &str, right: &str) -> bool {
    left.to_lowercase() == right.to_lowercase()
}

impl Store {
    pub fn new(root: PathBuf, templates: PathBuf, game: PathBuf) -> Self {
        Self {
            root,
            templates,
            default_game: game,
        }
    }

    pub fn load(&self) -> Result<Library> {
        match fs::read(self.root.join("library.json")) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|e| format!("本地方案无法读取: {e}"))
            }
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(Library::default()),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn persist(&self, library: &Library) -> Result<()> {
        market::write_json(&self.root.join("library.json"), library)
    }

    pub fn add(
        &self,
        library: &mut Library,
        raw_name: &str,
        profile: Value,
        sounds: BTreeMap<String, String>,
    ) -> Result<String> {
        let name = scheme_name(raw_name)?;
        let profile: Value = engine::call("validate", profile)?;
        let id = Uuid::new_v4().to_string();
        let mut scheme = Scheme {
            id: id.clone(),
            name,
            profile,
            auto_refresh: true,
            installed: None,
            status: String::new(),
            sounds: BTreeMap::new(),
        };
        self.store_sounds(&mut scheme, sounds)?;
        self.check_unique(library, &scheme.name, None)?;
        library.schemes.push(scheme);
        self.persist(library)?;
        Ok(id)
    }

    pub fn duplicate(&self, library: &mut Library, id: &str) -> Result<String> {
        let mut scheme = Self::get(library, id)?.clone();
        let base: String = scheme.name.chars().take(30).collect();
        let mut number = 1;
        loop {
            let candidate = format!(
                "{} 副本{}",
                base,
                if number == 1 {
                    String::new()
                } else {
                    format!(" {number}")
                }
            );
            if self.check_unique(library, &candidate, None).is_ok() {
                scheme.name = candidate;
                break;
            }
            number += 1;
        }
        scheme.id = Uuid::new_v4().to_string();
        scheme.installed = None;
        scheme.status.clear();
        let id = scheme.id.clone();
        library.schemes.push(scheme);
        self.persist(library)?;
        Ok(id)
    }

    pub fn get<'a>(library: &'a Library, id: &str) -> Result<&'a Scheme> {
        library
            .schemes
            .iter()
            .find(|item| item.id == id)
            .ok_or_else(|| "方案不存在".into())
    }

    pub fn get_mut<'a>(library: &'a mut Library, id: &str) -> Result<&'a mut Scheme> {
        library
            .schemes
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| "方案不存在".into())
    }

    fn check_unique(&self, library: &Library, name: &str, id: Option<&str>) -> Result<()> {
        if library
            .schemes
            .iter()
            .any(|scheme| Some(scheme.id.as_str()) != id && paths_same(&scheme.name, name))
        {
            return Err("已有同名方案，请选择其他名称".into());
        }
        Ok(())
    }

    pub fn save(&self, library: &mut Library, edit: Edit) -> Result<String> {
        let Some(id) = edit.id else {
            return self.add(library, &edit.name, edit.profile, edit.sounds);
        };
        let scheme = Self::get_mut(library, &id)?;
        scheme.profile = engine::call("validate", edit.profile)?;
        self.store_sounds(scheme, edit.sounds)?;
        self.persist(library)?;
        Ok(id)
    }

    pub fn rename(&self, library: &mut Library, id: &str, raw_name: &str) -> Result<()> {
        let name = scheme_name(raw_name)?;
        self.check_unique(library, &name, Some(id))?;
        let scheme = Self::get_mut(library, id)?;
        if name == scheme.name {
            return Ok(());
        }
        let old = scheme.clone();
        let mut renamed = None;
        if let Some(installed) = &mut scheme.installed {
            if Self::read_owned(installed)?.is_some() {
                let next = format!("{name}.filter");
                let from = Self::filter_path(&installed.directory, &installed.name)?;
                let to = Self::filter_path(&installed.directory, &next)?;
                move_file(&from, &to)?;
                renamed = Some((from, to));
                installed.name = next;
            } else {
                scheme.installed = None;
                scheme.status = "原过滤器已不存在，请重新安装".into();
            }
        }
        scheme.name = name;
        if let Err(error) = self.persist(library) {
            *Self::get_mut(library, id)? = old;
            if let Some((from, to)) = renamed {
                move_file(&to, &from)
                    .map_err(|rollback| format!("{error}，恢复旧文件名失败: {rollback}"))?;
            }
            return Err(error);
        }
        Ok(())
    }

    fn remove_installed(installed: Option<&Installed>) -> Result<Option<(PathBuf, Vec<u8>)>> {
        let Some(installed) = installed else {
            return Ok(None);
        };
        let Some(bytes) = Self::read_owned(installed)? else {
            return Ok(None);
        };
        let path = Self::filter_path(&installed.directory, &installed.name)?;
        fs::remove_file(&path).map_err(|error| format!("{}: {error}", path.display()))?;
        Ok(Some((path, bytes)))
    }

    fn persist_removal(
        &self,
        library: &Library,
        removed: Option<(PathBuf, Vec<u8>)>,
    ) -> Result<()> {
        if let Err(error) = self.persist(library) {
            if let Some((path, bytes)) = removed {
                write_file(&path, &bytes, false)
                    .map_err(|rollback| format!("{error}，恢复过滤器失败: {rollback}"))?;
            }
            return Err(error);
        }
        Ok(())
    }

    pub fn uninstall(&self, library: &mut Library, id: &str) -> Result<()> {
        let scheme = Self::get_mut(library, id)?;
        let removed = Self::remove_installed(scheme.installed.as_ref())?;
        scheme.installed = None;
        scheme.status = "过滤器已卸载".into();
        self.persist_removal(library, removed)
    }

    pub fn remove(&self, library: &mut Library, id: &str, remove_file: bool) -> Result<()> {
        let scheme = Self::get(library, id)?;
        let removed = if remove_file {
            Self::remove_installed(scheme.installed.as_ref())?
        } else {
            None
        };
        library.schemes.retain(|scheme| scheme.id != id);
        self.persist_removal(library, removed)
    }

    pub fn share(scheme: &Scheme) -> Result<String> {
        let bytes = serde_json::to_vec(&Share {
            name: scheme.name.clone(),
            profile: scheme.profile.clone(),
        })
        .map_err(|e| e.to_string())?;
        if bytes.len() > SHARE_MAX {
            return Err("方案过大，无法生成分享码".into());
        }
        Ok(format!("{SHARE_PREFIX}{}", URL_SAFE_NO_PAD.encode(bytes)))
    }

    pub fn import(
        &self,
        library: &mut Library,
        code: &str,
        name_override: Option<String>,
    ) -> Result<String> {
        let encoded = code
            .trim()
            .strip_prefix(SHARE_PREFIX)
            .ok_or("不支持的分享码版本")?;
        if encoded.len() > SHARE_MAX * 4 / 3 + 4 {
            return Err("分享码过大".into());
        }
        let bytes = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| "分享码不是有效的 Base64URL")?;
        if bytes.len() > SHARE_MAX {
            return Err("分享码过大".into());
        }
        let share: Share = serde_json::from_slice(&bytes).map_err(|_| "分享码内容无效")?;
        self.add(
            library,
            name_override.as_deref().unwrap_or(&share.name),
            share.profile,
            BTreeMap::new(),
        )
    }

    pub fn missing(&self, scheme: &Scheme) -> Vec<String> {
        sound_names(&scheme.profile)
            .into_iter()
            .filter(|name| self.audio(Some(scheme), name, true).is_err())
            .collect()
    }

    fn store_sounds(&self, scheme: &mut Scheme, sounds: BTreeMap<String, String>) -> Result<()> {
        let names = sound_names(&scheme.profile);
        scheme.sounds.retain(|name, _| names.contains(name));
        let mut total = 0;
        for (name, encoded) in sounds {
            if !valid_audio(&name)
                || !names.contains(&name)
                || encoded.len() > AUDIO_MAX * 4 / 3 + 4
            {
                return Err(format!("音效无效或超过 8 MB: {name}"));
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|_| "音效编码无效")?;
            total += bytes.len();
            if bytes.is_empty() || bytes.len() > AUDIO_MAX || total > AUDIO_TOTAL_MAX {
                return Err("单个音效最多 8 MB，合计最多 32 MB".into());
            }
            let hash = digest(&bytes);
            let path = self.root.join("sounds").join(&hash);
            if !path.exists() {
                write_file(&path, &bytes, false)?;
            }
            scheme.sounds.insert(name, hash);
        }
        Ok(())
    }

    pub fn audio(&self, scheme: Option<&Scheme>, name: &str, custom: bool) -> Result<Vec<u8>> {
        if !valid_audio(name) {
            return Err("无效音效文件名".into());
        }
        let bytes = if custom {
            let hash = scheme
                .and_then(|item| item.sounds.get(name))
                .ok_or_else(|| format!("缺少自定义音效「{name}」"))?;
            if hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
                return Err("无效音效记录".into());
            }
            let bytes = fs::read(self.root.join("sounds").join(hash))
                .map_err(|_| format!("缺少自定义音效「{name}」"))?;
            if digest(&bytes) != *hash {
                return Err("自定义音效校验失败".into());
            }
            bytes
        } else {
            fs::read(self.templates.join("(STYLE) CUSTOMSOUNDS").join(name))
                .map_err(|_| format!("缺少 NeverSink 音效「{name}」"))?
        };
        if bytes.is_empty() || bytes.len() > AUDIO_MAX {
            return Err("音效文件大小无效".into());
        }
        Ok(bytes)
    }

    pub fn generate(&self, profile: Value, market: Option<Value>) -> Result<Value> {
        let file: String = engine::call("baseline", &profile)?;
        let baseline = fs::read_to_string(self.templates.join(file))
            .map_err(|e| format!("无法读取 NeverSink 基础过滤器: {e}"))?;
        engine::call(
            "generate",
            json!({ "profile": profile, "baseline": baseline, "market": market }),
        )
    }

    pub fn bundle(
        &self,
        scheme: &Scheme,
        result: &Value,
    ) -> Result<(String, BTreeMap<String, Vec<u8>>)> {
        if result["safetyReport"]["passed"] != true {
            return Err("规则未通过安全检查，请先查看预览报告".into());
        }
        let text = result["filterFile"].as_str().ok_or("过滤器正文缺失")?;
        let mut names = BTreeMap::new();
        let mut assets = BTreeMap::new();
        let custom_names = sound_names(&scheme.profile);
        for capture in audio_pattern().captures_iter(text) {
            let name = &capture[2];
            if names.contains_key(name) {
                continue;
            }
            let content = self.audio(Some(scheme), name, custom_names.contains(name))?;
            let ext = name.rsplit_once('.').unwrap().1.to_ascii_lowercase();
            let target = format!("poe2rf-{}.{ext}", digest(&content));
            assets.insert(target.clone(), content);
            names.insert(name.to_owned(), target);
        }
        let text = audio_pattern()
            .replace_all(text, |c: &regex::Captures| {
                format!("{}{}{}", &c[1], names.get(&c[2]).unwrap(), &c[3])
            })
            .into_owned();
        Ok((text, assets))
    }

    pub fn prepare_filter(
        &self,
        scheme: &Scheme,
        market: Option<Value>,
    ) -> Result<(String, BTreeMap<String, Vec<u8>>)> {
        let result = self.generate(scheme.profile.clone(), market)?;
        if engine::call::<bool>("requiresMarket", &scheme.profile)?
            && result["market"]["rates"].is_null()
        {
            return Err("等待当前赛季的有效行情".into());
        }
        self.bundle(scheme, &result)
    }

    fn filter_path(directory: &Path, name: &str) -> Result<PathBuf> {
        if !directory.is_absolute() || !valid_windows_name(name) || !name.ends_with(".filter") {
            return Err("无效过滤器路径".into());
        }
        Ok(directory.join(name))
    }

    fn read_owned(installed: &Installed) -> Result<Option<Vec<u8>>> {
        let path = Self::filter_path(&installed.directory, &installed.name)?;
        match fs::symlink_metadata(&path) {
            Ok(metadata) if !metadata.is_file() => {
                return Err(format!(
                    "过滤器路径不是常规文件，已保留: {}",
                    path.display()
                ));
            }
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("{}: {e}", path.display())),
            Ok(_) => {}
        }
        match fs::read(&path) {
            Ok(bytes) if digest(&bytes) == installed.sha256 => Ok(Some(bytes)),
            Ok(_) => Err("游戏目录中的过滤器已被外部修改，已保留该文件".into()),
            Err(e) => Err(format!("{}: {e}", path.display())),
        }
    }

    pub fn install(
        &self,
        scheme: &mut Scheme,
        market: Option<Value>,
        custom_directory: Option<&Path>,
    ) -> Result<()> {
        let (filter, assets) = self.prepare_filter(scheme, market)?;
        let directory = if let Some(installed) = &scheme.installed {
            installed.directory.clone()
        } else {
            let target = custom_directory.unwrap_or(&self.default_game);
            if custom_directory.is_none() {
                fs::create_dir_all(target).map_err(|e| format!("{}: {e}", target.display()))?;
            }
            writable_directory(target)?
        };
        if !directory.is_dir() {
            return Err(format!("过滤器目录不存在: {}", directory.display()));
        }
        let name = format!("{}.filter", scheme.name);
        let output = Self::filter_path(&directory, &name)?;
        let previous = match &scheme.installed {
            Some(installed) => Self::read_owned(installed)?,
            None => None,
        };
        if previous.is_none() && output.exists() {
            return Err("游戏目录已有同名过滤器，请改用其他方案名".into());
        }
        for (name, bytes) in assets {
            let path = directory.join(name);
            match fs::read(&path) {
                Ok(existing) if existing == bytes => {}
                Ok(_) => return Err(format!("游戏目录音效文件冲突: {}", path.display())),
                Err(e) if e.kind() == ErrorKind::NotFound => write_file(&path, &bytes, false)?,
                Err(e) => return Err(e.to_string()),
            }
        }
        let unchanged = previous.as_deref() == Some(filter.as_bytes());
        if !unchanged {
            write_file(&output, filter.as_bytes(), previous.is_some())?;
        }
        scheme.installed = Some(Installed {
            directory,
            name,
            sha256: digest(filter.as_bytes()),
        });
        scheme.status = if unchanged {
            "过滤器内容无变化"
        } else {
            "过滤器已写入游戏目录"
        }
        .into();
        Ok(())
    }
}

#[cfg(windows)]
fn move_file(from: &Path, to: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
    let wide = |path: &Path| {
        path.as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>()
    };
    let from = wide(from);
    let to = wide(to);
    // A same-directory move without REPLACE_EXISTING never overwrites another filter.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 {
        return Err(format!(
            "无法更改过滤器文件名: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn move_file(from: &Path, to: &Path) -> Result<()> {
    fs::hard_link(from, to).map_err(|error| error.to_string())?;
    if let Err(error) = fs::remove_file(from) {
        let _ = fs::remove_file(to);
        return Err(error.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile() -> Value {
        json!({"schemaVersion":2,"locale":"cn","league":"Standard","strictness":2,"style":"default","rules":[],"skippedItemIds":[]})
    }

    fn fixture(temp: &Path) -> Store {
        Store::new(
            temp.join("local"),
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../vendor/neversink"),
            temp.join("game"),
        )
    }

    #[test]
    fn offline_install_restart_rename_delete_and_share() {
        let temp = tempfile::tempdir().unwrap();
        let store = fixture(temp.path());
        let mut library = store.load().unwrap();
        let id = store
            .add(&mut library, "终极打宝", profile(), BTreeMap::new())
            .unwrap();
        let scheme = Store::get_mut(&mut library, &id).unwrap();
        store.install(scheme, None, None).unwrap();
        let installed = store.default_game.join("终极打宝.filter");
        assert!(installed.is_file());
        let modified = fs::metadata(&installed).unwrap().modified().unwrap();
        store.install(scheme, None, None).unwrap();
        assert_eq!(
            fs::metadata(&installed).unwrap().modified().unwrap(),
            modified
        );
        let code = Store::share(scheme).unwrap();
        store.persist(&library).unwrap();
        let mut library = fixture(temp.path()).load().unwrap();
        assert_eq!(Store::get(&library, &id).unwrap().name, "终极打宝");
        let copy = store
            .import(&mut library, &code, Some("离线副本".into()))
            .unwrap();
        assert_ne!(id, copy);
        assert_eq!(
            Store::get(&library, &copy).unwrap().profile,
            Store::get(&library, &id).unwrap().profile
        );
        assert!(store.import(&mut library, "POE2F2.AAAAA", None).is_err());
        assert!(store.import(&mut library, "POE2F1.$$$", None).is_err());
        let renamed = store.default_game.join("新名字.filter");
        fs::write(&renamed, "User filter").unwrap();
        assert!(store.rename(&mut library, &id, "新名字").is_err());
        assert!(installed.is_file());
        assert_eq!(fs::read_to_string(&renamed).unwrap(), "User filter");
        fs::remove_file(&renamed).unwrap();
        store.rename(&mut library, &id, "新名字").unwrap();
        assert!(!installed.exists());
        assert!(renamed.exists());
        store.remove(&mut library, &id, false).unwrap();
        assert!(renamed.exists());
        store
            .install(Store::get_mut(&mut library, &copy).unwrap(), None, None)
            .unwrap();
        store.remove(&mut library, &copy, true).unwrap();
        assert!(!store.default_game.join("离线副本.filter").exists());
    }

    #[test]
    fn directory_changes_only_affect_new_installs_and_uninstall_keeps_scheme() {
        let temp = tempfile::tempdir().unwrap();
        let store = fixture(temp.path());
        let mut library = store.load().unwrap();
        let id = store
            .add(&mut library, "原目录", profile(), BTreeMap::new())
            .unwrap();
        let original = store.default_game.join("原目录.filter");
        store
            .install(Store::get_mut(&mut library, &id).unwrap(), None, None)
            .unwrap();
        let installed_bytes = fs::read(&original).unwrap();
        let new_directory = temp.path().join("其他文件夹");
        assert!(writable_directory(&new_directory).is_err());
        assert!(writable_directory(&original).is_err());
        fs::create_dir(&new_directory).unwrap();
        library.settings.filter_directory = Some(writable_directory(&new_directory).unwrap());
        store.persist(&library).unwrap();
        let mut library = fixture(temp.path()).load().unwrap();
        let new_location = library.settings.filter_directory.clone().unwrap();
        store
            .install(
                Store::get_mut(&mut library, &id).unwrap(),
                None,
                Some(&new_location),
            )
            .unwrap();
        assert!(original.is_file());
        assert!(!new_directory.join("原目录.filter").exists());

        // Editing even a stale draft that supplies a different name never changes a game file.
        let edit = Edit {
            id: Some(id.clone()),
            name: "草稿旧名称".into(),
            profile: profile(),
            sounds: BTreeMap::new(),
        };
        store.save(&mut library, edit).unwrap();
        assert_eq!(Store::get(&library, &id).unwrap().name, "原目录");
        assert_eq!(fs::read(&original).unwrap(), installed_bytes);

        fs::write(&original, b"edited outside the app").unwrap();
        assert!(store
            .rename(&mut library, &id, "不能改名")
            .unwrap_err()
            .contains("外部修改"));
        assert!(store
            .uninstall(&mut library, &id)
            .unwrap_err()
            .contains("外部修改"));
        assert_eq!(fs::read(&original).unwrap(), b"edited outside the app");
        assert!(Store::get(&library, &id).unwrap().installed.is_some());
        fs::write(&original, installed_bytes).unwrap();
        store.rename(&mut library, &id, "新名称").unwrap();
        let renamed = store.default_game.join("新名称.filter");
        assert!(renamed.is_file());
        assert!(!original.exists());
        store.uninstall(&mut library, &id).unwrap();
        assert!(!renamed.exists());
        assert!(Store::get(&library, &id).unwrap().installed.is_none());
        let scheme = Store::get_mut(&mut library, &id).unwrap();
        store.install(scheme, None, Some(&new_location)).unwrap();
        let relocated = new_directory.join("新名称.filter");
        assert!(relocated.is_file());
        fs::remove_file(&relocated).unwrap();
        store.uninstall(&mut library, &id).unwrap();
        let reloaded = store.load().unwrap();
        assert!(Store::get(&reloaded, &id).unwrap().installed.is_none());
        assert_eq!(reloaded.settings.filter_directory, Some(new_location));
    }

    #[test]
    fn downloadable_zip_contains_the_filter_and_its_custom_audio() {
        use std::io::Read;

        let temp = tempfile::tempdir().unwrap();
        let store = fixture(temp.path());
        let mut library = store.load().unwrap();
        let mut input = profile();
        input["rules"] = json!([{"id":"sound","name":"音效","enabled":true,"hidden":false,"target":{"itemIds":["divine-orb"]},"effects":{"sound":{"type":"custom","fileName":"trade.ogg"}}}]);
        let contents = b"archive fixture";
        let uploaded = BTreeMap::from([(
            "trade.ogg".into(),
            base64::engine::general_purpose::STANDARD.encode(contents),
        )]);
        let id = store.add(&mut library, "安装包", input, uploaded).unwrap();
        let scheme = Store::get(&library, &id).unwrap();
        let (text, sounds) = store.prepare_filter(scheme, None).unwrap();
        let asset_name = format!("poe2rf-{}.ogg", digest(contents));
        assert!(text.contains(&asset_name));
        let zip = filter_zip(&scheme.name, &text, sounds).unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip)).unwrap();
        let mut output = String::new();
        archive
            .by_name("安装包.filter")
            .unwrap()
            .read_to_string(&mut output)
            .unwrap();
        assert_eq!(output, text);
        let mut output = Vec::new();
        archive
            .by_name(&asset_name)
            .unwrap()
            .read_to_end(&mut output)
            .unwrap();
        assert_eq!(output, contents);
        assert!(!store.default_game.exists());
    }

    #[test]
    fn offline_price_rules_and_missing_audio_preserve_filter() {
        let temp = tempfile::tempdir().unwrap();
        let store = fixture(temp.path());
        let mut library = store.load().unwrap();
        let id = store
            .add(&mut library, "基本", profile(), BTreeMap::new())
            .unwrap();
        let scheme = Store::get_mut(&mut library, &id).unwrap();
        store.install(scheme, None, None).unwrap();
        let path = store.default_game.join("基本.filter");
        let expected = fs::read(&path).unwrap();
        scheme.profile["rules"] = json!([{"id":"price","name":"价格","enabled":true,"hidden":false,"target":{"itemIds":[],"range":{"min":{"amount":1,"currency":"exalted"}}},"effects":{}}]);
        assert!(store
            .install(scheme, None, None)
            .unwrap_err()
            .contains("等待"));
        assert_eq!(fs::read(&path).unwrap(), expected);
        scheme.profile["rules"] = json!([{"id":"sound","name":"音效","enabled":true,"hidden":false,"target":{"itemIds":["divine-orb"]},"effects":{"sound":{"type":"custom","fileName":"trade.ogg"}}}]);
        let uploaded = BTreeMap::from([(
            "trade.ogg".into(),
            base64::engine::general_purpose::STANDARD.encode(b"fake audio for test"),
        )]);
        store.store_sounds(scheme, uploaded).unwrap();
        let code = Store::share(scheme).unwrap();
        let id_copy = store
            .import(&mut library, &code, Some("导入".into()))
            .unwrap();
        let copy = Store::get_mut(&mut library, &id_copy).unwrap();
        assert_eq!(store.missing(copy), vec!["trade.ogg"]);
        assert!(store
            .install(copy, None, None)
            .unwrap_err()
            .contains("缺少自定义音效"));
        assert_eq!(fs::read(&path).unwrap(), expected);
    }
}

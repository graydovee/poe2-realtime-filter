use crate::{
    base_filter::{self, BaseFilter, Baseline},
    engine::{self, Result},
    market,
    share_code::{self, Share},
};
use base64::Engine;
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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Server {
    #[default]
    International,
    Tencent,
}

impl Server {
    pub const ALL: [Self; 2] = [Self::International, Self::Tencent];

    pub fn from_profile(profile: &Value) -> Self {
        if profile["server"] == "tencent" {
            Self::Tencent
        } else {
            Self::International
        }
    }
}

impl Scheme {
    pub fn server(&self) -> Server {
        Server::from_profile(&self.profile)
    }

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
    #[serde(default)]
    pub tencent_settings: RefreshSettings,
    #[serde(default)]
    pub server: Server,
    pub schemes: Vec<Scheme>,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshSettings {
    pub interval_minutes: u32,
    pub paused: bool,
}

impl Default for RefreshSettings {
    fn default() -> Self {
        Self {
            interval_minutes: 120,
            paused: false,
        }
    }
}

impl Library {
    pub fn refresh(&self, server: Server) -> RefreshSettings {
        match server {
            Server::Tencent => self.tencent_settings,
            Server::International => RefreshSettings {
                interval_minutes: self.settings.interval_minutes,
                paused: self.settings.paused,
            },
        }
    }

    pub fn set_refresh(&mut self, server: Server, settings: RefreshSettings) {
        match server {
            Server::Tencent => self.tencent_settings = settings,
            Server::International => {
                self.settings.interval_minutes = settings.interval_minutes;
                self.settings.paused = settings.paused;
            }
        }
    }
}

impl Default for Library {
    fn default() -> Self {
        Self {
            settings: Settings {
                interval_minutes: RefreshSettings::default().interval_minutes,
                paused: false,
                filter_directory: None,
            },
            tencent_settings: RefreshSettings::default(),
            server: Server::default(),
            schemes: vec![],
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edit {
    pub id: Option<String>,
    pub name: String,
    pub profile: Value,
    pub sounds: BTreeMap<String, String>,
    pub base_filter_changed: Option<bool>,
}

pub struct Store {
    root: PathBuf,
    downloads: base_filter::SourceDownloads,
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

pub(crate) fn valid_windows_name(name: &str) -> bool {
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
        Regex::new(
            r##"^([ \t]*)(CustomAlertSound(?:Optional)?)[ \t]+(?:"([^"\r\n]*)"|([^\s"#]+))(.*)$"##,
        )
        .unwrap()
    });
    &RE
}

fn expand_filter(
    path: &Path,
    text: &str,
    cache_root: Option<&Path>,
    parents: &mut Vec<PathBuf>,
    expanded: &mut String,
) -> Result<()> {
    static IMPORT: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r##"^Import[ \t]+"([^"\r\n]+)"(?:[ \t]+(Optional))?[ \t]*(?:#.*)?$"##).unwrap()
    });
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("无法读取过滤器「{}」：{error}", path.display()))?;
    if parents.len() >= 12 || parents.contains(&canonical) {
        return Err(format!(
            "过滤器依赖嵌套过深或循环引用「{}」",
            display_directory(&canonical)
        ));
    }
    let nested = !parents.is_empty();
    parents.push(canonical.clone());
    let directory = canonical.parent().ok_or("无法确定过滤器所在目录")?;
    for line in text.split_inclusive('\n') {
        if line.split_whitespace().next() == Some("Import") {
            let captures = IMPORT
                .captures(line.trim())
                .ok_or_else(|| format!("无法解析过滤器依赖「{}」", line.trim()))?;
            let reference = &captures[1];
            let imported = match directory.join(reference).canonicalize() {
                Ok(path) => path,
                Err(error) if error.kind() == ErrorKind::NotFound && captures.get(2).is_some() => {
                    continue
                }
                Err(error) => {
                    return Err(format!(
                        "无法读取「{}」引用的过滤器「{reference}」：{error}",
                        display_directory(path)
                    ))
                }
            };
            if cache_root.is_some_and(|root| !imported.starts_with(root)) {
                return Err(format!("过滤器依赖「{reference}」超出基础过滤器目录"));
            }
            let content = base_filter::read_filter(&imported)?;
            expand_filter(&imported, &content, cache_root, parents, expanded)?;
            if !expanded.ends_with('\n') {
                expanded.push('\n');
            }
        } else if nested {
            let trimmed = line.trim_end_matches(['\r', '\n']);
            let reference = audio_pattern()
                .captures(trimmed)
                .and_then(|captures| captures.get(3).or_else(|| captures.get(4)));
            if let Some(reference) = reference {
                let paths: Vec<_> = reference
                    .as_str()
                    .split(';')
                    .map(|name| {
                        let sound = Path::new(name);
                        let relative = directory.join(sound);
                        if !sound.is_absolute()
                            && base_filter::audio_name(sound)
                            && relative.is_file()
                        {
                            display_directory(&relative)
                        } else {
                            name.to_owned()
                        }
                    })
                    .collect();
                let paths = paths.join(";");
                if paths != reference.as_str() {
                    expanded.push_str(&line[..reference.start()]);
                    if !line[..reference.start()].ends_with('"') {
                        expanded.push('"');
                    }
                    expanded.push_str(&paths);
                    if !line[reference.end()..].starts_with('"') {
                        expanded.push('"');
                    }
                    expanded.push_str(&line[reference.end()..]);
                } else {
                    expanded.push_str(line);
                }
            } else {
                expanded.push_str(line);
            }
        } else {
            expanded.push_str(line);
        }
        if expanded.len() > 16 * 1024 * 1024 {
            return Err("基础过滤器及其依赖合计超过 16 MB".into());
        }
    }
    parents.pop();
    Ok(())
}

const BASE_SOUND_PREFIX: &str = "@poe2rf-baseline/";
const CUSTOM_SOUND_PREFIX: &str = "@poe2rf-custom/";

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
    pub fn new(root: PathBuf, game: PathBuf) -> Self {
        Self {
            root,
            downloads: base_filter::SourceDownloads::default(),
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
        self.check_unique(library, scheme.server(), &scheme.name, None)?;
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
            if self
                .check_unique(library, scheme.server(), &candidate, None)
                .is_ok()
            {
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

    fn check_unique(
        &self,
        library: &Library,
        server: Server,
        name: &str,
        id: Option<&str>,
    ) -> Result<()> {
        if library.schemes.iter().any(|scheme| {
            scheme.server() == server
                && Some(scheme.id.as_str()) != id
                && paths_same(&scheme.name, name)
        }) {
            return Err("已有同名方案，请选择其他名称".into());
        }
        Ok(())
    }

    pub fn save(&self, library: &mut Library, edit: Edit) -> Result<String> {
        let Some(id) = edit.id else {
            return self.add(library, &edit.name, edit.profile, edit.sounds);
        };
        let scheme = Self::get_mut(library, &id)?;
        let mut profile = edit.profile;
        if let Some(fields) = profile.as_object_mut() {
            fields.insert("server".into(), json!(scheme.server()));
        }
        if edit.base_filter_changed == Some(false) {
            if let (Some(draft), Some(current)) =
                (profile.as_object_mut(), scheme.profile.as_object())
            {
                // A tray update may have replaced the base while the draft was open.
                for field in ["baseFilter", "baseFilterHint"] {
                    if let Some(value) = current.get(field) {
                        draft.insert(field.into(), value.clone());
                    } else {
                        draft.remove(field);
                    }
                }
            }
        }
        let profile: Value = engine::call("validate", profile)?;
        if scheme.profile["baseFilter"] != profile["baseFilter"]
            || scheme.profile["baseFilterHint"] != profile["baseFilterHint"]
        {
            scheme.status.clear();
        }
        scheme.profile = profile;
        self.store_sounds(scheme, edit.sounds)?;
        self.persist(library)?;
        Ok(id)
    }

    pub fn rename(&self, library: &mut Library, id: &str, raw_name: &str) -> Result<()> {
        let name = scheme_name(raw_name)?;
        let scheme = Self::get(library, id)?;
        self.check_unique(library, scheme.server(), &name, Some(id))?;
        if scheme.installed.is_some() {
            self.check_install_target(library, scheme, &name)?;
        }
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
                if !paths_same(&installed.name, &next) && to.exists() {
                    return Err("游戏目录已有同名过滤器，请改用其他方案名".into());
                }
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
        scheme.status.clear();
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
        let mut profile = scheme.profile.clone();
        if let Some(fields) = profile.as_object_mut() {
            if let Some(base) = fields.remove("baseFilter") {
                if let Some(name) = base["name"].as_str() {
                    fields.insert("baseFilterHint".into(), json!(name));
                }
            }
        }
        profile["server"] = json!(scheme.server());
        share_code::encode(&Share {
            name: scheme.name.clone(),
            profile,
        })
    }

    pub fn import(
        &self,
        library: &mut Library,
        code: &str,
        name_override: Option<String>,
    ) -> Result<String> {
        let share = share_code::decode(code)?;
        self.import_decoded(library, share, name_override)
    }

    pub fn import_decoded(
        &self,
        library: &mut Library,
        mut share: Share,
        name_override: Option<String>,
    ) -> Result<String> {
        // A share code may describe a baseline but never authorize reading a local path.
        if let Some(fields) = share.profile.as_object_mut() {
            fields.remove("baseFilter");
            if let Some(name) = fields.get("baseFilterHint").and_then(Value::as_str) {
                let name = name.to_lowercase();
                // An unavailable directory leaves the reference available for manual selection.
                let mut matching = base_filter::scan(&self.base_directory(library))
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|base| base.name().to_lowercase() == name);
                if let (Some(base), None) = (matching.next(), matching.next()) {
                    fields.insert("baseFilter".into(), json!(base));
                    fields.remove("baseFilterHint");
                }
            }
        }
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
            .filter(|name| self.audio(Some(scheme), name).is_err())
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

    pub fn audio(&self, scheme: Option<&Scheme>, name: &str) -> Result<Vec<u8>> {
        if !valid_audio(name) {
            return Err("无效音效文件名".into());
        }
        let hash = scheme
            .and_then(|item| item.sounds.get(name))
            .ok_or_else(|| format!("缺少自定义音效「{name}」"))?;
        if hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("无效音效记录".into());
        }
        let bytes = base_filter::read_limited(&self.root.join("sounds").join(hash), AUDIO_MAX)
            .map_err(|error| format!("无法读取自定义音效「{name}」：{error}"))?;
        if bytes.is_empty() || digest(&bytes) != *hash {
            return Err(format!("自定义音效「{name}」校验失败"));
        }
        Ok(bytes)
    }

    pub fn base_directory(&self, library: &Library) -> PathBuf {
        library
            .settings
            .filter_directory
            .clone()
            .unwrap_or_else(|| self.default_game.clone())
    }

    pub fn source_cache(&self, source: &str) -> Result<Vec<BaseFilter>> {
        base_filter::cached_source(&self.root, source)
    }

    pub fn source_download(
        &self,
        source: &str,
        versions: &BTreeSet<String>,
    ) -> Result<Vec<BaseFilter>> {
        self.downloads.download(&self.root, source, versions)
    }

    pub fn download_offers(
        &self,
        names: &[String],
    ) -> Result<BTreeMap<String, Vec<base_filter::DownloadOffer>>> {
        self.downloads.offers(&self.root, names)
    }

    pub fn downloaded_base(scheme: &Scheme) -> Option<BaseFilter> {
        let base = serde_json::from_value(scheme.profile["baseFilter"].clone()).ok()?;
        matches!(base, BaseFilter::Downloaded { .. }).then_some(base)
    }

    pub fn set_downloaded_base(
        &self,
        scheme: &mut Scheme,
        base: &BaseFilter,
        install: bool,
        market: Option<Value>,
    ) -> Result<()> {
        let BaseFilter::Downloaded { version, .. } = base else {
            return Err("下载的基础过滤器来源无效".into());
        };
        let mut updated = scheme.clone();
        let profile = updated.profile.as_object_mut().ok_or("方案格式无效")?;
        profile.insert("baseFilter".into(), json!(base));
        profile.remove("baseFilterHint");
        if install {
            self.install(&mut updated, market, None)?;
        } else {
            let baseline = self.load_baseline(base)?;
            self.prepare_sounds(&baseline.text, Some(&baseline), Some(&updated))?;
        }
        updated.status = if install {
            format!("基础过滤器已更新至 {version} · {}", updated.status)
        } else {
            format!("基础过滤器已就绪 · {version}")
        };
        *scheme = updated;
        Ok(())
    }

    fn baseline(&self, profile: &Value) -> Result<Option<Baseline>> {
        if profile["baseFilter"].is_null() {
            if let Some(name) = profile["baseFilterHint"].as_str() {
                return Err(format!(
                    "未能匹配基础过滤器「{name}」，请在编辑页选择或清除基础过滤器"
                ));
            }
            return Ok(None);
        }
        let base: BaseFilter = serde_json::from_value(profile["baseFilter"].clone())
            .map_err(|_| "基础过滤器来源无效，请重新选择")?;
        self.load_baseline(&base).map(Some)
    }

    fn load_baseline(&self, base: &BaseFilter) -> Result<Baseline> {
        let mut baseline = base.load(&self.root)?;
        let mut expanded = String::new();
        expand_filter(
            &baseline.path,
            &baseline.text,
            baseline.cache_root.as_deref(),
            &mut Vec::new(),
            &mut expanded,
        )?;
        baseline.text = expanded;
        Ok(baseline)
    }

    // Imported rules can refer to absolute paths after expansion. Persist relative
    // names in presets and only resolve names which the current base actually uses.
    fn base_sound_references(baseline: &Baseline) -> BTreeMap<String, Option<String>> {
        let parent = baseline
            .path
            .parent()
            .and_then(|path| path.canonicalize().ok());
        let directory = parent.as_deref().map(display_directory);
        let mut references = BTreeMap::new();
        for line in baseline.text.lines() {
            let Some(captures) = audio_pattern().captures(line) else {
                continue;
            };
            let sounds = captures
                .get(3)
                .or_else(|| captures.get(4))
                .unwrap()
                .as_str();
            for raw in sounds.split(';') {
                let path = Path::new(raw);
                if !base_filter::audio_name(path) {
                    continue;
                }
                let relative = if path.is_absolute() {
                    directory
                        .as_ref()
                        .and_then(|dir| path.strip_prefix(dir).ok())
                } else {
                    Some(path)
                };
                let portable = relative
                    .filter(|path| {
                        path.components()
                            .all(|part| matches!(part, std::path::Component::Normal(_)))
                    })
                    .or_else(|| path.file_name().map(Path::new));
                let Some(name) = portable.and_then(Path::to_str) else {
                    continue;
                };
                let name = name.replace('\\', "/");
                references
                    .entry(name)
                    .and_modify(|source: &mut Option<String>| {
                        if source.as_deref() != Some(raw) {
                            *source = None;
                        }
                    })
                    .or_insert_with(|| Some(raw.to_owned()));
            }
        }
        references
    }

    fn resolve_base_sound<'a>(
        references: &'a BTreeMap<String, Option<String>>,
        name: &str,
    ) -> Result<&'a str> {
        match references.get(name) {
            Some(Some(source)) => Ok(source),
            Some(None) => Err(format!("基础过滤器中有多个同名音效「{name}」")),
            None => Err(format!("当前基础过滤器缺少音效「{name}」")),
        }
    }

    pub fn base_styles(&self, base: BaseFilter) -> Result<Value> {
        let baseline = self.load_baseline(&base)?;
        let audio: BTreeMap<_, _> = Self::base_sound_references(&baseline)
            .into_iter()
            .filter_map(|(name, raw)| Some((raw?, name)))
            .collect();
        engine::call(
            "baseStyles",
            json!({ "text": baseline.text, "audio": audio }),
        )
    }

    pub fn base_audio(&self, baseline: &Baseline, name: &str, game: &Path) -> Result<Vec<u8>> {
        let reference = Path::new(name);
        if !base_filter::audio_name(reference) || name.starts_with("@poe2rf-custom/") {
            return Err(format!("基础过滤器引用了无效音效「{name}」"));
        }
        let parent = baseline.path.parent().ok_or("无法确定基础过滤器目录")?;
        let mut candidates = vec![parent.join(reference)];
        if !reference.is_absolute() {
            if let Some(root) = &baseline.game_root {
                candidates.push(root.join(reference));
            } else if baseline.cache_root.is_none() {
                candidates.push(game.join(reference));
            }
        }
        for path in candidates {
            let absolute = match path.canonicalize() {
                Ok(path) => path,
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(error) => return Err(format!("无法读取基础过滤器音效「{name}」：{error}")),
            };
            if baseline
                .cache_root
                .as_ref()
                .is_some_and(|root| !absolute.starts_with(root))
            {
                return Err(format!("音效「{name}」超出基础过滤器目录"));
            }
            let bytes = base_filter::read_limited(&absolute, AUDIO_MAX)
                .map_err(|error| format!("无法读取基础过滤器音效「{name}」：{error}"))?;
            if bytes.is_empty() {
                return Err(format!("基础过滤器音效「{name}」为空"));
            }
            return Ok(bytes);
        }
        Err(format!(
            "缺少基础过滤器「{}」引用的音效「{name}」",
            baseline.name
        ))
    }

    pub fn preview_base_audio(&self, base: BaseFilter, name: &str) -> Result<Vec<u8>> {
        let baseline = self.load_baseline(&base)?;
        let references;
        let name = if let Some(name) = name.strip_prefix(BASE_SOUND_PREFIX) {
            references = Self::base_sound_references(&baseline);
            Self::resolve_base_sound(&references, name)?
        } else {
            name
        };
        self.base_audio(&baseline, name, &self.base_directory(&self.load()?))
    }

    fn generate(
        &self,
        profile: &Value,
        baseline: Option<&Baseline>,
        market: Option<Value>,
    ) -> Result<Value> {
        engine::call(
            "generate",
            json!({
                "profile": profile,
                "baseline": baseline.map(|base| &base.text),
                "baselineName": baseline.map(|base| &base.name),
                "market": market,
            }),
        )
    }

    pub fn preview(&self, profile: Value, market: Option<Value>) -> Result<Value> {
        let baseline = self.baseline(&profile)?;
        let mut result = self.generate(&profile, baseline.as_ref(), market)?;
        let text = result["filterFile"].as_str().ok_or("过滤器正文缺失")?;
        let (text, _) = self.prepare_sounds(text, baseline.as_ref(), None)?;
        result["filterFile"] = json!(text);
        Ok(result)
    }

    fn prepare_sounds(
        &self,
        text: &str,
        baseline: Option<&Baseline>,
        scheme: Option<&Scheme>,
    ) -> Result<(String, BTreeMap<String, Vec<u8>>)> {
        let base_text = baseline.map_or("", |base| base.text.as_str());
        let overlay = text
            .strip_suffix(base_text)
            .ok_or("生成结果缺少基础过滤器正文")?;
        let game = match scheme.and_then(|scheme| scheme.installed.as_ref()) {
            Some(installed) => installed.directory.clone(),
            None => self.base_directory(&self.load()?),
        };
        let mut names = BTreeMap::<(&str, bool, bool, bool), Option<String>>::new();
        let mut references = None;
        let mut assets = BTreeMap::new();
        let mut total = 0;
        let mut output = String::with_capacity(text.len());
        for (part, is_overlay) in [(overlay, true), (base_text, false)] {
            for line in part.split_inclusive('\n') {
                let trimmed = line.trim_end_matches(['\r', '\n']);
                let end = &line[trimmed.len()..];
                let command = trimmed.split_whitespace().next();
                if !matches!(
                    command,
                    Some("CustomAlertSound" | "CustomAlertSoundOptional")
                ) {
                    output.push_str(line);
                    continue;
                }
                let captures = audio_pattern()
                    .captures(trimmed)
                    .ok_or_else(|| format!("无法读取基础过滤器音效指令「{trimmed}」"))?;
                let name = captures
                    .get(3)
                    .or_else(|| captures.get(4))
                    .unwrap()
                    .as_str();
                if name.eq_ignore_ascii_case("None") {
                    output.push_str(line);
                    continue;
                }
                let optional = &captures[2] == "CustomAlertSoundOptional";
                let mut targets = Vec::new();
                for name in name.split(';') {
                    let custom = is_overlay && name.starts_with(CUSTOM_SOUND_PREFIX);
                    let name = if custom {
                        &name[CUSTOM_SOUND_PREFIX.len()..]
                    } else {
                        name
                    };
                    let key = (
                        name,
                        custom,
                        optional,
                        is_overlay && name.starts_with(BASE_SOUND_PREFIX),
                    );
                    if !names.contains_key(&key) {
                        let target = if custom && scheme.is_none() {
                            Some(name.to_owned()) // Draft uploads are checked when saving and installing.
                        } else {
                            match if custom {
                                self.audio(scheme, name)
                            } else {
                                baseline
                                    .ok_or_else(|| {
                                        let file =
                                            name.strip_prefix(BASE_SOUND_PREFIX).unwrap_or(name);
                                        format!(
                                            "请选择基础过滤器，或在规则中替换基础过滤器音效「{file}」"
                                        )
                                    })
                                    .and_then(|base| {
                                        let reference = if let Some(portable) = name
                                            .strip_prefix(BASE_SOUND_PREFIX)
                                            .filter(|_| is_overlay)
                                        {
                                            let map = references.get_or_insert_with(|| {
                                                Self::base_sound_references(base)
                                            });
                                            Self::resolve_base_sound(map, portable)?
                                        } else {
                                            name
                                        };
                                        self.base_audio(base, reference, &game).map_err(|error| {
                                            if reference != name {
                                                format!(
                                                    "无法打包音效「{}」：{error}",
                                                    name.trim_start_matches(BASE_SOUND_PREFIX)
                                                )
                                            } else {
                                                error
                                            }
                                        })
                                    })
                            } {
                                Ok(bytes) => {
                                    let extension = Path::new(name)
                                        .extension()
                                        .ok_or("无效音效文件名")?
                                        .to_string_lossy()
                                        .to_ascii_lowercase();
                                    let target = format!("poe2rf-{}.{extension}", digest(&bytes));
                                    if !assets.contains_key(&target) {
                                        total += bytes.len();
                                        if total > AUDIO_TOTAL_MAX {
                                            return Err("过滤器所需音效合计超过 32 MB".into());
                                        }
                                        assets.insert(target.clone(), bytes);
                                    }
                                    Some(target)
                                }
                                Err(_) if optional => None,
                                Err(error) => return Err(error),
                            }
                        };
                        names.insert(key, target);
                    }
                    if let Some(target) = &names[&key] {
                        targets.push(target.clone());
                    }
                }
                if !targets.is_empty() {
                    output.push_str(&format!(
                        "{}{} \"{}\"{}{}",
                        &captures[1],
                        &captures[2],
                        targets.join(";"),
                        &captures[5],
                        end
                    ));
                }
            }
        }
        Ok((output, assets))
    }

    pub fn prepare_filter(
        &self,
        scheme: &Scheme,
        market: Option<Value>,
    ) -> Result<(String, BTreeMap<String, Vec<u8>>)> {
        let baseline = self.baseline(&scheme.profile)?;
        let result = self.generate(&scheme.profile, baseline.as_ref(), market)?;
        if let Some(reason) = result["marketIssue"].as_str() {
            return Err(reason.into());
        }
        if result["safetyReport"]["passed"] != true {
            return Err("规则未通过安全检查，请先查看预览报告".into());
        }
        let text = result["filterFile"].as_str().ok_or("过滤器正文缺失")?;
        self.prepare_sounds(text, baseline.as_ref(), Some(scheme))
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

    pub fn check_install_target(
        &self,
        library: &Library,
        scheme: &Scheme,
        name: &str,
    ) -> Result<()> {
        let directory = scheme
            .installed
            .as_ref()
            .map(|item| item.directory.clone())
            .unwrap_or_else(|| self.base_directory(library));
        let normalize = |path: &Path| path.canonicalize().unwrap_or_else(|_| path.to_owned());
        let directory = normalize(&directory);
        let filename = format!("{name}.filter");
        if library
            .schemes
            .iter()
            .filter(|other| other.id != scheme.id)
            .any(|other| {
                other.installed.as_ref().is_some_and(|installed| {
                    paths_same(&installed.name, &filename)
                        && paths_same(
                            &display_directory(&normalize(&installed.directory)),
                            &display_directory(&directory),
                        )
                })
            })
        {
            return Err("游戏目录已有同名过滤器，请改用其他方案名".into());
        }
        Ok(())
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
        scheme.status.clear();
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

    fn profile(store: &Store) -> Value {
        let source = store.root.join("fixture.filter");
        fs::create_dir_all(&store.root).unwrap();
        fs::write(&source, "Show\n\tSetFontSize 31\n").unwrap();
        let base = BaseFilter::from_file(&source).unwrap();
        json!({"schemaVersion":2,"locale":"cn","league":"Standard","baseFilter":base,"rules":[],"skippedItemIds":[]})
    }

    fn fixture(temp: &Path) -> Store {
        Store::new(temp.join("local"), temp.join("game"))
    }

    #[test]
    fn legacy_library_and_cross_server_file_ownership() {
        let temp = tempfile::tempdir().unwrap();
        let store = fixture(temp.path());
        let mut library: Library = serde_json::from_value(json!({
            "settings":{"intervalMinutes":37,"paused":true,"filterDirectory":null},
            "schemes":[]
        }))
        .unwrap();
        assert_eq!(library.server, Server::International);
        assert_eq!(library.refresh(Server::International).interval_minutes, 37);
        assert_eq!(library.refresh(Server::Tencent).interval_minutes, 120);
        assert!(!library.refresh(Server::Tencent).paused);
        let static_profile =
            json!({"schemaVersion":2,"league":"Standard","rules":[],"skippedItemIds":[]});
        let international = store
            .add(
                &mut library,
                "Shared",
                static_profile.clone(),
                BTreeMap::new(),
            )
            .unwrap();
        let mut tencent = static_profile;
        tencent["server"] = json!("tencent");
        tencent["league"] = json!("0.5.5");
        let same_name = store
            .add(&mut library, "Shared", tencent.clone(), BTreeMap::new())
            .unwrap();
        assert!(store
            .add(&mut library, "Shared", tencent, BTreeMap::new())
            .is_err());
        assert_eq!(
            Store::get(&library, &international).unwrap().server(),
            Server::International
        );
        assert_eq!(
            Store::get(&library, &same_name).unwrap().server(),
            Server::Tencent
        );
        store
            .install(
                Store::get_mut(&mut library, &international).unwrap(),
                None,
                None,
            )
            .unwrap();
        let path = store.default_game.join("Shared.filter");
        let bytes = fs::read(&path).unwrap();
        let other = Store::get(&library, &same_name).unwrap();
        assert!(store
            .check_install_target(&library, other, &other.name)
            .is_err());
        assert!(store
            .install(
                Store::get_mut(&mut library, &same_name).unwrap(),
                None,
                None
            )
            .is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        store.rename(&mut library, &same_name, "Tencent").unwrap();
        store
            .install(
                Store::get_mut(&mut library, &same_name).unwrap(),
                None,
                None,
            )
            .unwrap();
        assert!(store.rename(&mut library, &same_name, "Shared").is_err());
        store.uninstall(&mut library, &same_name).unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert!(Store::get(&library, &international)
            .unwrap()
            .status
            .is_empty());
    }

    #[test]
    fn offline_install_restart_rename_delete_and_share() {
        let temp = tempfile::tempdir().unwrap();
        let store = fixture(temp.path());
        let mut library = store.load().unwrap();
        let id = store
            .add(&mut library, "终极打宝", profile(&store), BTreeMap::new())
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
        let mut expected = Store::get(&library, &id).unwrap().profile.clone();
        expected.as_object_mut().unwrap().remove("baseFilter");
        expected["baseFilterHint"] = json!("fixture.filter");
        expected["server"] = json!("international");
        assert_eq!(Store::get(&library, &copy).unwrap().profile, expected);
        let library_path = store.root.join("library.json");
        let saved = fs::read(&library_path).unwrap();
        let count = library.schemes.len();
        let (head, payload) = code.rsplit_once('.').unwrap();
        let mut payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(payload)
            .unwrap();
        payload[0] ^= 1;
        let broken = format!(
            "{head}.{}",
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload)
        );
        assert!(store.import(&mut library, &broken, None).is_err());
        assert_eq!(library.schemes.len(), count);
        assert_eq!(fs::read(&library_path).unwrap(), saved);
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
        Store::get_mut(&mut library, &copy).unwrap().profile["baseFilter"] =
            profile(&store)["baseFilter"].clone();
        store
            .install(Store::get_mut(&mut library, &copy).unwrap(), None, None)
            .unwrap();
        store.remove(&mut library, &copy, true).unwrap();
        assert!(!store.default_game.join("离线副本.filter").exists());
    }

    #[test]
    fn import_matches_only_unique_names_inside_the_game_directory() {
        let temp = tempfile::tempdir().unwrap();
        let store = fixture(temp.path());
        let game = temp.path().join("custom-game");
        let online = game.join("OnlineFilters");
        let wegame = game.join("WeGameFilters").join("author");
        fs::create_dir_all(&online).unwrap();
        fs::create_dir_all(&wegame).unwrap();
        fs::write(game.join("Reference.FILTER"), "Show\n\tSetFontSize 32\n").unwrap();
        fs::write(
            online.join("ABC123"),
            "\u{feff}#Online Item Filter\r\n#name:Subscribed Example\r\nShow\r\n",
        )
        .unwrap();
        fs::write(online.join("bad-cache"), "#name:Looks Valid\nShow\n").unwrap();
        fs::write(
            wegame.join("作者.filter"),
            "Show\n\tCustomAlertSound \"WeGameFilters/author/notice.ogg\" 250\n",
        )
        .unwrap();
        fs::write(wegame.join("notice.ogg"), b"test asset").unwrap();
        fs::write(
            wegame.join("Reference.filter"),
            "# poe2-filter generated overlay\nShow\n",
        )
        .unwrap();
        let mut library = store.load().unwrap();
        library.settings.filter_directory = Some(game.clone());
        let share = |name: &str, hint: Option<&str>| {
            let mut profile = json!({
                "schemaVersion": 2, "league": "Standard", "locale": "cn",
                "rules": [], "skippedItemIds": [],
                "baseFilter": {"kind":"local", "path": "DO NOT USE", "name":"spoofed"}
            });
            if let Some(hint) = hint {
                profile["baseFilterHint"] = json!(hint);
            }
            share_code::encode(&Share {
                name: name.into(),
                profile,
            })
            .unwrap()
        };
        for (name, hint, kind, source) in [
            ("本地", "reference.filter", "local", Value::Null),
            (
                "国际服",
                "SUBSCRIBED EXAMPLE",
                "subscribed",
                json!("online"),
            ),
            ("WeGame", "作者.filter", "subscribed", json!("wegame")),
        ] {
            let id = store
                .import(&mut library, &share(name, Some(hint)), None)
                .unwrap();
            let scheme = Store::get(&library, &id).unwrap();
            assert_eq!(scheme.profile["baseFilter"]["kind"], kind);
            assert_eq!(scheme.profile["baseFilter"]["source"], source);
            assert!(scheme.profile["baseFilterHint"].is_null());
            let (_, sounds) = store.prepare_filter(scheme, None).unwrap();
            assert_eq!(sounds.len(), usize::from(name == "WeGame"));
            let shared = share_code::decode(&Store::share(scheme).unwrap()).unwrap();
            assert!(shared.profile["baseFilter"].is_null());
            assert_eq!(
                shared.profile["baseFilterHint"],
                scheme.profile["baseFilter"]["name"]
            );
        }
        fs::write(wegame.join("reference.filter"), "Show\n").unwrap();
        for (name, hint) in [
            ("重名", "reference.filter"),
            ("坏缓存", "Looks Valid"),
            ("缺失", "unavailable.filter"),
            ("路径", "../Reference.FILTER"),
        ] {
            let id = store
                .import(&mut library, &share(name, Some(hint)), None)
                .unwrap();
            let scheme = Store::get(&library, &id).unwrap();
            assert!(scheme.profile["baseFilter"].is_null());
            assert_eq!(scheme.profile["baseFilterHint"], hint);
            assert!(store
                .preview(scheme.profile.clone(), None)
                .unwrap_err()
                .contains(hint));
        }
        let id = store
            .import(&mut library, &share("独立", None), None)
            .unwrap();
        let scheme = Store::get(&library, &id).unwrap();
        assert!(scheme.profile["baseFilter"].is_null());
        assert!(store
            .prepare_filter(scheme, None)
            .unwrap()
            .0
            .ends_with("\nShow\n"));
    }

    #[test]
    fn downloaded_base_upgrade_keeps_installed_version_until_resources_validate() {
        let temp = tempfile::tempdir().unwrap();
        let store = fixture(temp.path());
        let entry = "Strict.filter";
        let source = "neversink";
        let base = |version: &str| BaseFilter::Downloaded {
            source: source.into(),
            version: version.into(),
            entry: entry.into(),
            name: entry.into(),
        };
        let cache = store.root.join("base-filters").join(source);
        for (version, text) in [
            ("0.1.0", "Show\n SetFontSize 33\n"),
            (
                "0.2.0",
                "Show\n SetFontSize 42\n CustomAlertSound \"ping.ogg\" 250\n",
            ),
        ] {
            fs::create_dir_all(cache.join(version)).unwrap();
            fs::write(cache.join(version).join(entry), text).unwrap();
        }
        let mut library = store.load().unwrap();
        let mut initial = profile(&store);
        initial["baseFilter"] = json!(base("0.1.0"));
        let id = store
            .add(&mut library, "下载版", initial.clone(), BTreeMap::new())
            .unwrap();
        let scheme = Store::get_mut(&mut library, &id).unwrap();
        store.install(scheme, None, None).unwrap();
        let installed = store.default_game.join("下载版.filter");
        let previous = fs::read(&installed).unwrap();
        assert!(store
            .set_downloaded_base(scheme, &base("0.2.0"), true, None)
            .unwrap_err()
            .contains("ping.ogg"));
        assert_eq!(fs::read(&installed).unwrap(), previous);
        assert_eq!(scheme.profile["baseFilter"]["version"], "0.1.0");

        fs::write(cache.join("0.2.0").join("ping.ogg"), b"fake audio").unwrap();
        store
            .set_downloaded_base(scheme, &base("0.2.0"), true, None)
            .unwrap();
        assert_eq!(scheme.profile["baseFilter"]["version"], "0.2.0");
        let text = fs::read_to_string(&installed).unwrap();
        assert!(text.contains("SetFontSize 42"));
        assert!(text.contains("CustomAlertSound \"poe2rf-"));
        store
            .save(
                &mut library,
                Edit {
                    id: Some(id.clone()),
                    name: "下载版".into(),
                    profile: initial,
                    sounds: BTreeMap::new(),
                    base_filter_changed: Some(false),
                },
            )
            .unwrap();
        assert_eq!(
            Store::get(&library, &id).unwrap().profile["baseFilter"]["version"],
            "0.2.0"
        );
    }

    #[test]
    fn stack_ranges_share_and_generate_identical_filter_across_file_operations() {
        use std::io::Read;

        let temp = tempfile::tempdir().unwrap();
        let store = fixture(temp.path());
        let mut library = store.load().unwrap();
        let mut draft = profile(&store);
        draft.as_object_mut().unwrap().remove("baseFilter");
        draft["rules"] = json!([
            {"id": "small", "name": "小堆叠", "enabled": true, "hidden": true,
             "target": {"itemIds": ["gold", "exalted-orb"], "dropConditions": {
                 "stackSize": {"enabled": true, "bounds": [{"op": "<", "value": 5}]}
             }}, "effects": {}},
            {"id": "large", "name": "大堆叠", "enabled": true, "hidden": false,
             "target": {"itemIds": ["gold", "exalted-orb"], "dropConditions": {
                 "stackSize": {"enabled": true, "bounds": [{"op": ">=", "value": 5}]}
             }}, "effects": {"beam": "Yellow"}},
            {"id": "priced", "name": "混沌石数量与价格", "enabled": true, "hidden": false,
             "target": {"itemIds": ["chaos-orb"], "range": {
                 "min": {"amount": 6, "currency": "exalted"}
             }, "dropConditions": {
                 "stackSize": {"enabled": true, "bounds": [{"op": ">=", "value": 12}]}
             }}, "effects": {}}
        ]);
        let mut market = json!({
            "server": "international", "league": "Standard", "source": "fixture",
            "capturedAt": "2026-03-01T00:00:00Z", "expiresAt": "2099-01-01T00:00:00Z",
            "rates": {"divineToExalted": 100, "divineToChaos": 10},
            "prices": {"chaos-orb": {"amount": 8, "currency": "exalted"}}
        });
        let preview = store.preview(draft.clone(), Some(market.clone())).unwrap();
        let id = store
            .add(&mut library, "堆叠方案", draft, BTreeMap::new())
            .unwrap();
        let scheme = Store::get_mut(&mut library, &id).unwrap();
        assert_eq!(scheme.profile["schemaVersion"], 3);
        let (text, assets) = store.prepare_filter(scheme, Some(market.clone())).unwrap();
        assert_eq!(preview["filterFile"], text);
        assert!(text.contains("BaseType == \"Exalted Orb\"\n\tStackSize >= 5"));
        assert!(text.contains("BaseType == \"Chaos Orb\"\n\tStackSize >= 12"));
        let zip = filter_zip(&scheme.name, &text, assets).unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip)).unwrap();
        let mut zipped = String::new();
        archive
            .by_name("堆叠方案.filter")
            .unwrap()
            .read_to_string(&mut zipped)
            .unwrap();
        assert_eq!(zipped, text);
        let code = Store::share(scheme).unwrap();
        assert_eq!(
            share_code::decode(&code).unwrap().profile["rules"],
            scheme.profile["rules"]
        );
        store.install(scheme, Some(market.clone()), None).unwrap();
        let installed = store.default_game.join("堆叠方案.filter");
        assert_eq!(fs::read_to_string(&installed).unwrap(), text);
        let written = fs::metadata(&installed).unwrap().modified().unwrap();
        market["capturedAt"] = json!("2026-03-01T02:00:00Z");
        store.install(scheme, Some(market.clone()), None).unwrap();
        assert_eq!(fs::read_to_string(&installed).unwrap(), text);
        assert_eq!(
            fs::metadata(&installed).unwrap().modified().unwrap(),
            written
        );
        assert!(store.install(scheme, None, None).is_err());
        assert_eq!(fs::read_to_string(&installed).unwrap(), text);
        scheme.profile["rules"][0]["target"]["itemIds"] = json!(["base:omen-crest-shield"]);
        assert!(store.install(scheme, Some(market), None).is_err());
        assert_eq!(fs::read_to_string(&installed).unwrap(), text);
        let import_dir = tempfile::tempdir().unwrap();
        let receiving_store = fixture(import_dir.path());
        let mut receiving_library = receiving_store.load().unwrap();
        let imported = receiving_store
            .import(&mut receiving_library, &code, None)
            .unwrap();
        assert_eq!(
            Store::get(&receiving_library, &imported).unwrap().profile["schemaVersion"],
            3
        );
    }

    #[test]
    fn standalone_install_refresh_and_zip_apply_rules_and_check_assets() {
        let temp = tempfile::tempdir().unwrap();
        let store = fixture(temp.path());
        let mut library = store.load().unwrap();
        let mut draft = profile(&store);
        draft.as_object_mut().unwrap().remove("baseFilter");
        draft["rules"] = json!([{
            "id": "standalone", "name": "显示", "enabled": true, "hidden": false,
            "target": {"itemIds": ["divine-orb"]},
            "effects": {"font": {"fontSize": 38}, "sound": {"type": "custom", "fileName": "ping.ogg"}}
        }]);
        draft["skippedItemIds"] = json!(["divine-orb"]);
        let preview = store.preview(draft.clone(), None).unwrap();
        assert!(preview["filterFile"]
            .as_str()
            .unwrap()
            .contains("SetFontSize 38"));
        assert!(preview["filterFile"]
            .as_str()
            .unwrap()
            .ends_with("\nShow\n"));
        assert_eq!(preview["baselineFile"], "");
        let sounds = BTreeMap::from([(
            "ping.ogg".into(),
            base64::engine::general_purpose::STANDARD.encode(b"fixture audio"),
        )]);
        let id = store.add(&mut library, "独立方案", draft, sounds).unwrap();
        let scheme = Store::get_mut(&mut library, &id).unwrap();
        let (text, assets) = store.prepare_filter(scheme, None).unwrap();
        assert!(text.contains("SetFontSize 38"));
        assert_eq!(assets.len(), 1);
        let bundle = filter_zip(&scheme.name, &text, assets).unwrap();
        assert_eq!(
            zip::ZipArchive::new(std::io::Cursor::new(bundle))
                .unwrap()
                .len(),
            2
        );
        store.install(scheme, None, None).unwrap();
        let installed = store.default_game.join("独立方案.filter");
        assert_eq!(fs::read_to_string(&installed).unwrap(), text);
        scheme.profile["rules"][0]["effects"]["font"]["fontSize"] = json!(40);
        store.install(scheme, None, None).unwrap();
        let refreshed = fs::read_to_string(&installed).unwrap();
        assert!(refreshed.contains("SetFontSize 40"));
        scheme.profile["rules"][0]["effects"]["sound"]["type"] = json!("neversink");
        assert!(store
            .install(scheme, None, None)
            .unwrap_err()
            .contains("替换基础过滤器音效「ping.ogg」"));
        assert_eq!(fs::read_to_string(&installed).unwrap(), refreshed);
        assert_eq!(scheme.profile["skippedItemIds"], json!(["divine-orb"]));
        scheme.profile["baseFilter"] = profile(&store)["baseFilter"].clone();
        let (with_base, _) = store.prepare_filter(scheme, None).unwrap();
        assert!(!with_base.contains("SetFontSize 40"));
        assert!(with_base.contains("SetFontSize 31"));
    }

    #[test]
    fn directory_changes_only_affect_new_installs_and_uninstall_keeps_scheme() {
        let temp = tempfile::tempdir().unwrap();
        let store = fixture(temp.path());
        let mut library = store.load().unwrap();
        let id = store
            .add(&mut library, "原目录", profile(&store), BTreeMap::new())
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
            base_filter_changed: None,
            id: Some(id.clone()),
            name: "草稿旧名称".into(),
            profile: profile(&store),
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
        let mut input = profile(&store);
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
            .add(&mut library, "基本", profile(&store), BTreeMap::new())
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
            .contains("未能匹配基础过滤器"));
        copy.profile["baseFilter"] = profile(&store)["baseFilter"].clone();
        assert!(store
            .install(copy, None, None)
            .unwrap_err()
            .contains("缺少自定义音效"));
        assert_eq!(fs::read(&path).unwrap(), expected);
    }

    #[test]
    fn live_baseline_refresh_bundles_audio_and_preserves_files_on_dependency_errors() {
        let temp = tempfile::tempdir().unwrap();
        let store = fixture(temp.path());
        let mut library = store.load().unwrap();
        let input = profile(&store);
        let source = store.root.join("fixture.filter");
        let music = store.root.join("a b.ogg");
        let rule = "Show\n\tCustomAlertSound \"a b.ogg\" 200\n\tCustomAlertSoundOptional missing.wav 100\n";
        fs::write(&source, rule).unwrap();
        fs::write(&music, b"filter sound").unwrap();
        let id = store
            .add(&mut library, "本地依赖测试", input, BTreeMap::new())
            .unwrap();
        let scheme = Store::get_mut(&mut library, &id).unwrap();
        store.install(scheme, None, None).unwrap();
        let installed = store.default_game.join("本地依赖测试.filter");
        let original = fs::read_to_string(&installed).unwrap();
        assert!(original.contains(&format!("poe2rf-{}.ogg", digest(b"filter sound"))));
        assert!(!original.contains("missing.wav"));
        assert!(base_filter::scan(&store.default_game).unwrap().is_empty());
        assert!(BaseFilter::from_file(&installed)
            .unwrap_err()
            .contains("不能将"));
        fs::write(&source, format!("{rule}\tSetFontSize 40\n")).unwrap();
        store.install(scheme, None, None).unwrap();
        let refreshed = fs::read_to_string(&installed).unwrap();
        assert!(refreshed.contains("SetFontSize 40"));
        fs::remove_file(music).unwrap();
        assert!(store
            .prepare_filter(scheme, None)
            .unwrap_err()
            .contains("a b.ogg"));
        assert!(store
            .install(scheme, None, None)
            .unwrap_err()
            .contains("a b.ogg"));
        assert_eq!(fs::read_to_string(&installed).unwrap(), refreshed);
        fs::remove_file(source).unwrap();
        assert!(store
            .install(scheme, None, None)
            .unwrap_err()
            .contains("重新选择"));
        assert_eq!(fs::read_to_string(&installed).unwrap(), refreshed);
    }

    #[test]
    fn price_tier_install_requires_anchors_but_allows_missing_item_quotes() {
        let temp = tempfile::tempdir().unwrap();
        let store = fixture(temp.path());
        let mut library = store.load().unwrap();
        let mut rules: Value =
            serde_json::from_str(include_str!("../../data/default-rules.json")).unwrap();
        for rule in rules["rules"].as_array_mut().unwrap() {
            rule["target"]["itemIds"] = json!([
                "exalted-orb",
                "chaos-orb",
                "orb-of-annulment",
                "divine-orb",
                "gnawed-jawbone"
            ]);
            rule["followBaseline"] = json!(true);
            rule["effects"] = json!({});
        }
        let input = json!({"schemaVersion":2, "league":"Standard", "rules":rules["rules"], "skippedItemIds":[]});
        let mut prices = serde_json::Map::new();
        for (id, amount) in [
            ("exalted-orb", 1),
            ("chaos-orb", 10),
            ("orb-of-annulment", 100),
            ("divine-orb", 1000),
        ] {
            prices.insert(
                id.into(),
                json!({"itemId":id, "amount":amount, "currency":"exalted"}),
            );
        }
        let mut market = json!({"league":"Standard", "capturedAt":"2026-01-01T00:00:00Z", "expiresAt":"2099-01-01T00:00:00Z", "rates":{"divineToExalted":1000,"divineToChaos":100}, "prices":prices});
        let id = store
            .add(&mut library, "Price tier QA", input, BTreeMap::new())
            .unwrap();
        let scheme = Store::get_mut(&mut library, &id).unwrap();
        store.install(scheme, Some(market.clone()), None).unwrap();
        let file = store.default_game.join("Price tier QA.filter");
        let before = fs::read_to_string(&file).unwrap();
        assert_eq!(before.matches("Show # poe2-filter rule:").count(), 4);
        assert!(!before.contains("Gnawed Jawbone"));
        // 单件物品缺报价只是不被命中：混沌石按汇率仍能换算，剥离石价格档的下限照样可用。
        let mut no_chaos = market.clone();
        no_chaos["prices"].as_object_mut().unwrap().remove("chaos-orb");
        store.install(scheme, Some(no_chaos), None).unwrap();
        let after = fs::read_to_string(&file).unwrap();
        assert_eq!(after.matches("Show # poe2-filter rule:").count(), 3);
        assert!(!after.contains("Chaos Orb"));
        // 剥离石没有汇率，区间里用到它却没有报价时无法换算，拒绝安装。
        market["prices"]
            .as_object_mut()
            .unwrap()
            .remove("orb-of-annulment");
        assert!(store
            .install(scheme, Some(market), None)
            .unwrap_err()
            .contains("锚点"));
        assert_eq!(fs::read_to_string(file).unwrap(), after);
    }

    #[test]
    fn applied_base_preset_shares_portable_audio_and_preserves_installed_files() {
        let temp = tempfile::tempdir().unwrap();
        let store = fixture(temp.path());
        let mut library = store.load().unwrap();
        let mut input = profile(&store);
        let source = store.root.join("fixture.filter");
        let nested = store.root.join("sub");
        fs::create_dir(&nested).unwrap();
        fs::write(&source, "Import \"sub/child.filter\"\nShow\n").unwrap();
        fs::write(nested.join("child.filter"), "Show\n BaseType == \"Exalted Orb\"\n SetFontSize 43\n PlayAlertSoundPositional 2 50\n CustomAlertSoundOptional \"tone.ogg;second.ogg\" 85\nShow\n BaseType == \"Chaos Orb\"\n CustomAlertSound \"required.ogg\" 60\n").unwrap();
        fs::write(nested.join("tone.ogg"), b"nested audio").unwrap();
        fs::write(nested.join("second.ogg"), b"second audio").unwrap();
        fs::write(nested.join("required.ogg"), b"required audio").unwrap();
        let base: BaseFilter = serde_json::from_value(input["baseFilter"].clone()).unwrap();
        let inspection = store.base_styles(base.clone()).unwrap();
        let effects = inspection["styles"]["default-exalted"]["effects"].clone();
        assert_eq!(effects["sound"]["fileName"], "sub/tone.ogg;sub/second.ogg");
        assert_eq!(effects["sound"]["fallback"]["positional"], true);
        assert!(inspection["presets"]
            .as_array()
            .unwrap()
            .iter()
            .any(|preset| preset["sound"] == effects["sound"]));
        assert_eq!(
            store
                .preview_base_audio(base, "@poe2rf-baseline/sub/tone.ogg")
                .unwrap(),
            b"nested audio"
        );
        input["rules"] = json!([{
            "id":"default-exalted", "name":"Applied preset", "enabled": true,
            "hidden":false, "followBaseline":false, "effects": effects,
            "target": {"itemIds":["exalted-orb"]}
        }]);
        let id = store
            .add(&mut library, "Preset QA", input.clone(), BTreeMap::new())
            .unwrap();
        let scheme = Store::get_mut(&mut library, &id).unwrap();
        let share = share_code::decode(&Store::share(scheme).unwrap()).unwrap();
        assert!(share.profile["baseFilter"].is_null());
        assert_eq!(share.profile["rules"][0]["effects"], effects);
        assert_eq!(share.profile["baseFilterHint"], input["baseFilter"]["name"]);
        let preview = store.preview(input, None).unwrap();
        let (text, resources) = store.prepare_filter(scheme, None).unwrap();
        assert_eq!(preview["filterFile"], text);
        assert_eq!(resources.len(), 3);
        let archive = filter_zip(&scheme.name, &text, resources).unwrap();
        assert_eq!(
            zip::ZipArchive::new(std::io::Cursor::new(archive))
                .unwrap()
                .len(),
            4
        );
        assert!(text.contains("PlayAlertSoundPositional 2 50"));
        assert!(text.contains(&format!(
            "CustomAlertSoundOptional \"poe2rf-{}.ogg;poe2rf-{}.ogg\" 85",
            digest(b"nested audio"),
            digest(b"second audio")
        )));
        store.install(scheme, None, None).unwrap();
        let installed = store.default_game.join("Preset QA.filter");
        assert_eq!(fs::read_to_string(&installed).unwrap(), text);
        fs::remove_file(nested.join("required.ogg")).unwrap();
        assert!(store
            .install(scheme, None, None)
            .unwrap_err()
            .contains("required.ogg"));
        assert_eq!(fs::read_to_string(installed).unwrap(), text);
    }

    #[test]
    fn expands_local_filter_imports_in_order_with_relative_sounds() {
        let temp = tempfile::tempdir().unwrap();
        let store = fixture(temp.path());
        let input = profile(&store);
        let source = store.root.join("fixture.filter");
        let nested = store.root.join("sub");
        fs::create_dir(&nested).unwrap();
        fs::write(
            &source,
            "Import \"sub/child.filter\"\nImport \"missing.filter\" Optional\nShow\n",
        )
        .unwrap();
        fs::write(nested.join("child.filter"), "Show\n BaseType == \"Exalted Orb\"\n SetFontSize 44\n CustomAlertSound \"sound.ogg\" 200").unwrap();
        fs::write(nested.join("sound.ogg"), b"nested audio").unwrap();
        let output = store.preview(input.clone(), None).unwrap();
        assert!(output["filterFile"]
            .as_str()
            .unwrap()
            .contains(&format!("poe2rf-{}.ogg", digest(b"nested audio"))));
        assert!(!output["filterFile"].as_str().unwrap().contains("Import "));
        let base = serde_json::from_value(input["baseFilter"].clone()).unwrap();
        assert_eq!(
            store.base_styles(base).unwrap()["styles"]["default-exalted"]["effects"]["font"]
                ["fontSize"],
            44
        );
        fs::write(
            nested.join("child.filter"),
            "Import \"../fixture.filter\"\n",
        )
        .unwrap();
        assert!(store.preview(input, None).unwrap_err().contains("循环引用"));
    }
}

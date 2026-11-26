use crate::{
    engine::Result,
    store::{display_directory, valid_windows_name},
};
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{self, Cursor, Read},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

const SOURCE: &str = "neversink";
const DOWNLOAD_SOURCES: &[DownloadSource] = &[DownloadSource {
    id: SOURCE,
    label: "NeverSink",
    release: "https://api.github.com/repos/NeverSinkDev/NeverSink-Filter-for-PoE2/releases/latest",
    tree: "https://api.github.com/repos/NeverSinkDev/NeverSink-Filter-for-PoE2/git/trees/",
    zipball: "https://api.github.com/repos/NeverSinkDev/NeverSink-Filter-for-PoE2/zipball/",
    asset: "https://github.com/NeverSinkDev/NeverSink-Filter-for-PoE2/releases/download/",
}];
pub(crate) const MAX_FILTER: usize = 8 * 1024 * 1024;
const MAX_ARCHIVE: usize = 32 * 1024 * 1024;
const MAX_EXTRACTED: usize = 160 * 1024 * 1024;
/// The base filter registry, next to `library.json`.
const REGISTRY: &str = "base-filters.json";
/// Copies stored from scheme packages, below `base-filters/`.
pub(crate) const IMPORTED: &str = "imported";

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum BaseFilter {
    Local {
        path: PathBuf,
        name: String,
    },
    Subscribed {
        source: SubscriptionSource,
        directory: PathBuf,
        entry: PathBuf,
        name: String,
    },
    Downloaded {
        source: String,
        version: String,
        entry: String,
        name: String,
    },
    /// A copy in the data directory, identified by its entry in the base filter registry.
    Imported {
        id: String,
        entry: String,
        name: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SubscriptionSource {
    Online,
    WeGame,
}

/// Where a base filter came from. It rides along in scheme packages for matching and for
/// display; it never names a path on this machine.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum BaseOrigin {
    Local {},
    Subscribed { source: SubscriptionSource },
    Downloaded { source: String, version: String },
    Imported {},
}

impl SubscriptionSource {
    fn cache_directory(self) -> &'static str {
        match self {
            Self::Online => "OnlineFilters",
            Self::WeGame => "WeGameFilters",
        }
    }
}

pub struct Baseline {
    pub path: PathBuf,
    pub name: String,
    pub text: String,
    pub cache_root: Option<PathBuf>,
    pub game_root: Option<PathBuf>,
}

fn filter_name(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("filter"))
}

pub fn audio_name(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| matches!(ext.to_ascii_lowercase().as_str(), "mp3" | "ogg" | "wav"))
}

pub fn read_limited(path: &Path, limit: usize) -> io::Result<Vec<u8>> {
    if !fs::metadata(path)?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "路径不是普通文件",
        ));
    }
    read_bounded(fs::File::open(path)?, limit)
}

fn read_bounded(file: impl Read, limit: usize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "文件超过大小限制",
        ));
    }
    Ok(bytes)
}

pub(crate) fn read_filter(path: &Path) -> Result<String> {
    if !filter_name(path) {
        return Err("请选择 .filter 文件".into());
    }
    read_filter_text(path)
}

fn read_filter_text(path: &Path) -> Result<String> {
    let display = display_directory(path);
    let bytes = read_limited(path, MAX_FILTER).map_err(|error| {
        format!("无法读取基础过滤器「{display}」，请检查文件或重新选择。{error}")
    })?;
    filter_text(&bytes, &display)
}

/// Accepts filter text from a file or from a scheme package.
pub(crate) fn filter_text(bytes: &[u8], display: &str) -> Result<String> {
    let text = String::from_utf8(bytes.to_vec())
        .map_err(|_| format!("基础过滤器「{display}」不是 UTF-8 文本"))?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    if text.lines().any(|line| {
        let line = line.trim().to_ascii_lowercase();
        line.starts_with("# poe2-filter generated overlay")
            || line.starts_with("# poe2-realtime-filter generated")
            || line.starts_with("# poe2 realtime filter generated")
            || line.starts_with("show # poe2-filter rule:")
            || line.starts_with("hide # poe2-filter rule:")
    }) {
        return Err("不能将 PoE2 Realtime Filter 生成的文件用作基础过滤器".into());
    }
    if !text.lines().any(|line| {
        matches!(
            line.split_whitespace().next(),
            Some("Show" | "Hide" | "Minimal" | "Import")
        )
    }) {
        return Err(format!("基础过滤器「{display}」没有可识别的规则"));
    }
    Ok(text.to_owned())
}

pub(crate) fn safe_relative(path: &Path) -> bool {
    let mut components = path.components().peekable();
    components.peek().is_some()
        && components.all(|component| match component {
            Component::Normal(name) => name.to_str().is_some_and(valid_windows_name),
            _ => false,
        })
}

fn version_valid(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 80
        && version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._".contains(&byte))
        && valid_windows_name(version)
}

impl BaseFilter {
    pub fn from_file(path: &Path) -> Result<Self> {
        let path = path
            .canonicalize()
            .map_err(|error| format!("无法打开「{}」：{error}", path.display()))?;
        read_filter(&path)?;
        let name = file_name(&path)?;
        Ok(Self::Local {
            path: PathBuf::from(display_directory(&path)),
            name,
        })
    }

    pub(crate) fn name(&self) -> &str {
        match self {
            Self::Local { name, .. }
            | Self::Subscribed { name, .. }
            | Self::Downloaded { name, .. }
            | Self::Imported { name, .. } => name,
        }
    }

    pub fn load(&self, data_root: &Path) -> Result<Baseline> {
        let (path, cache_root) = match self {
            Self::Local { path, .. } if path.is_absolute() => (path.clone(), None),
            Self::Subscribed {
                source,
                directory,
                entry,
                ..
            } => {
                return load_subscription(*source, directory, entry);
            }
            Self::Downloaded {
                source,
                version,
                entry,
                ..
            } if DownloadSource::find(source).is_ok()
                && version_valid(version)
                && safe_relative(Path::new(entry)) =>
            {
                let root = data_root.join("base-filters").join(source).join(version);
                let resolved = root.join(entry).canonicalize().map_err(|error| {
                    format!("无法读取已下载的基础过滤器「{entry}」，请重新选择。{error}")
                })?;
                let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
                if !resolved.starts_with(&canonical_root) {
                    return Err("下载的基础过滤器路径无效".into());
                }
                (resolved, Some(canonical_root))
            }
            Self::Imported { id, entry, name }
                if valid_base_id(id) && safe_relative(Path::new(entry)) =>
            {
                return load_imported(data_root, id, entry, name);
            }
            _ => return Err("基础过滤器来源无效，请重新选择".into()),
        };
        Ok(Baseline {
            text: read_filter(&path)?,
            name: file_name(&path)?,
            path,
            cache_root,
            game_root: None,
        })
    }
}

fn load_imported(data_root: &Path, id: &str, entry: &str, name: &str) -> Result<Baseline> {
    let root = data_root.join("base-filters").join(IMPORTED).join(id);
    let missing = || format!("无法读取已导入的基础过滤器「{name}」，请重新选择");
    let canonical_root = root.canonicalize().map_err(|_| missing())?;
    let resolved = root.join(entry).canonicalize().map_err(|_| missing())?;
    if !resolved.starts_with(&canonical_root) {
        return Err("已导入的基础过滤器路径无效".into());
    }
    Ok(Baseline {
        text: read_filter_text(&resolved)?,
        name: name.to_owned(),
        path: resolved,
        cache_root: Some(canonical_root.clone()),
        // The copy's root also answers sound references that were relative to the game directory.
        game_root: Some(canonical_root),
    })
}

fn file_name(path: &Path) -> Result<String> {
    Ok(path
        .file_name()
        .and_then(|part| part.to_str())
        .ok_or("无法读取过滤器文件名")?
        .to_owned())
}

fn online_name(text: &str) -> Option<String> {
    let mut lines = text.lines();
    if lines.next()?.trim() != "#Online Item Filter" {
        return None;
    }
    let name = lines
        .take(20)
        .take_while(|line| line.trim_start().starts_with('#'))
        .find_map(|line| line.trim_start().strip_prefix("#name:"))?
        .trim();
    if name.is_empty() || name.encode_utf16().count() > 260 || name.chars().any(char::is_control) {
        return None;
    }
    Some(name.to_owned())
}

fn load_subscription(
    source: SubscriptionSource,
    directory: &Path,
    entry: &Path,
) -> Result<Baseline> {
    if !directory.is_absolute()
        || !safe_relative(entry)
        || !entry.starts_with(source.cache_directory())
    {
        return Err("订阅过滤器的位置无效，请重新选择".into());
    }
    let root = directory
        .canonicalize()
        .map_err(|error| format!("无法读取游戏过滤器目录：{error}"))?;
    let location = root.join(entry);
    let path = location.canonicalize().map_err(|error| {
        format!(
            "无法读取订阅过滤器「{}」，请重新选择。{error}",
            display_directory(&location)
        )
    })?;
    if !path.starts_with(root.join(source.cache_directory())) {
        return Err("订阅过滤器超出游戏缓存目录".into());
    }
    let (text, name) = match source {
        SubscriptionSource::Online => {
            let text = read_filter_text(&path)?;
            let name = online_name(&text).ok_or("国际服订阅过滤器缺少名称，请在游戏中重新加载")?;
            (text, name)
        }
        SubscriptionSource::WeGame => (read_filter(&path)?, file_name(&path)?),
    };
    Ok(Baseline {
        path,
        name,
        text,
        cache_root: Some(root.clone()),
        game_root: Some(root),
    })
}

fn scan_subscriptions(root: &Path, source: SubscriptionSource, options: &mut Vec<BaseFilter>) {
    let cache = root.join(source.cache_directory());
    if !cache.canonicalize().is_ok_and(|resolved| resolved == cache) {
        return;
    }
    let mut pending = vec![(cache.clone(), 0)];
    while let Some((directory, depth)) = pending.pop() {
        let Ok(files) = fs::read_dir(&directory) else {
            continue;
        };
        for file in files.flatten() {
            let Ok(file_type) = file.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let path = file.path();
            if file_type.is_dir() && matches!(source, SubscriptionSource::WeGame) && depth < 12 {
                if path
                    .canonicalize()
                    .is_ok_and(|resolved| resolved == path && resolved.starts_with(&cache))
                {
                    pending.push((path, depth + 1));
                }
            } else if file_type.is_file()
                && (matches!(source, SubscriptionSource::Online) || filter_name(&path))
            {
                let Ok(entry) = path.strip_prefix(root) else {
                    continue;
                };
                if let Ok(baseline) = load_subscription(source, root, entry) {
                    options.push(BaseFilter::Subscribed {
                        source,
                        directory: PathBuf::from(display_directory(root)),
                        entry: entry.to_owned(),
                        name: baseline.name,
                    });
                }
            }
        }
    }
}

pub fn scan(directory: &Path) -> Result<Vec<BaseFilter>> {
    let root = match directory.canonicalize() {
        Ok(root) => root,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => {
            return Err(format!(
                "无法读取「{}」：{error}",
                display_directory(directory)
            ));
        }
    };
    let files = fs::read_dir(&root)
        .map_err(|error| format!("无法读取「{}」：{error}", display_directory(directory)))?;
    let mut options: Vec<_> = files
        .flatten()
        .filter_map(|file| {
            let path = file.path();
            if !filter_name(&path) || !path.canonicalize().ok()?.starts_with(&root) {
                return None;
            }
            BaseFilter::from_file(&path).ok()
        })
        .collect();
    scan_subscriptions(&root, SubscriptionSource::Online, &mut options);
    scan_subscriptions(&root, SubscriptionSource::WeGame, &mut options);
    options.sort_by_cached_key(|base| {
        let location = match base {
            BaseFilter::Local { path, .. } => path.as_path(),
            BaseFilter::Subscribed { entry, .. } => entry.as_path(),
            BaseFilter::Downloaded { entry, .. } => Path::new(entry),
            BaseFilter::Imported { entry, .. } => Path::new(entry),
        };
        (base.name().to_lowercase(), location.to_owned())
    });
    Ok(options)
}

pub fn new_base_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

pub(crate) fn valid_base_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub fn origin_of(base: &BaseFilter) -> BaseOrigin {
    match base {
        BaseFilter::Local { .. } => BaseOrigin::Local {},
        BaseFilter::Subscribed { source, .. } => BaseOrigin::Subscribed { source: *source },
        BaseFilter::Downloaded {
            source, version, ..
        } => BaseOrigin::Downloaded {
            source: source.clone(),
            version: version.clone(),
        },
        BaseFilter::Imported { .. } => BaseOrigin::Imported {},
    }
}

/// A filter the picker lists. Copies stored from scheme packages also tell when they arrived.
#[derive(Serialize)]
pub struct ScannedFilter {
    #[serde(flatten)]
    pub base: BaseFilter,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registered_at: Option<u64>,
}

/// A short source description for messages. Never a path.
pub fn source_label(base: &BaseFilter) -> String {
    match base {
        BaseFilter::Local { .. } => "本地文件".into(),
        BaseFilter::Subscribed { source, .. } => match source {
            SubscriptionSource::Online => "国际服订阅",
            SubscriptionSource::WeGame => "WeGame 订阅",
        }
        .into(),
        BaseFilter::Downloaded {
            source, version, ..
        } => format!(
            "{} · {version}",
            DownloadSource::find(source)
                .map(|known| known.label)
                .unwrap_or(source.as_str())
        ),
        BaseFilter::Imported { .. } => "方案包导入的副本".into(),
    }
}

/// The same subscription entry, or the same file of a download source. The download version
/// and the game directory may differ.
fn same_entry(left: &BaseFilter, right: &BaseFilter) -> bool {
    let equal = |left: &str, right: &str| left.to_lowercase() == right.to_lowercase();
    match (left, right) {
        (
            BaseFilter::Subscribed {
                source: left_source,
                entry: left_entry,
                ..
            },
            BaseFilter::Subscribed {
                source: right_source,
                entry: right_entry,
                ..
            },
        ) => {
            left_source == right_source
                && equal(
                    &left_entry.to_string_lossy(),
                    &right_entry.to_string_lossy(),
                )
        }
        (
            BaseFilter::Downloaded {
                source: left_source,
                entry: left_entry,
                ..
            },
            BaseFilter::Downloaded {
                source: right_source,
                entry: right_entry,
                ..
            },
        ) => equal(left_source, right_source) && equal(left_entry, right_entry),
        _ => false,
    }
}

/// One base filter this installation knows by ID. `base` says how this machine provides it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseRecord {
    pub id: String,
    /// The name it was shared under. Every list shows this one.
    pub name: String,
    pub base: BaseFilter,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<BaseOrigin>,
    /// File set digest of an imported copy. It only tells whether the content changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// Unix seconds.
    #[serde(default)]
    pub registered_at: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Registry {
    #[serde(default)]
    pub filters: Vec<BaseRecord>,
}

impl BaseRecord {
    /// A record with a new identity.
    pub fn new(base: &BaseFilter) -> Self {
        Self {
            id: new_base_id(),
            name: base.name().to_owned(),
            base: base.clone(),
            origin: Some(origin_of(base)),
            content: None,
            registered_at: unix_now(),
        }
    }
}

impl Registry {
    /// Registers `base` under a new identity.
    pub fn register(&mut self, base: &BaseFilter) -> &mut BaseRecord {
        self.filters.push(BaseRecord::new(base));
        self.filters.last_mut().unwrap()
    }

    pub fn load(data_root: &Path) -> Result<Self> {
        match fs::read(data_root.join(REGISTRY)) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|error| format!("基础过滤器表无法读取: {error}")),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn save(&self, data_root: &Path) -> Result<()> {
        crate::market::write_json(&data_root.join(REGISTRY), self)
    }

    pub fn get(&self, id: &str) -> Option<&BaseRecord> {
        self.filters.iter().find(|record| record.id == id)
    }

    /// Replaces the record with the same ID.
    pub fn insert(&mut self, record: BaseRecord) {
        self.filters.retain(|current| current.id != record.id);
        self.filters.push(record);
    }

    /// The record for `base`, registered on first use. Downloads that the tray upgraded and
    /// subscriptions behind a moved game directory keep their identity.
    pub fn record_for(&mut self, base: &BaseFilter) -> &mut BaseRecord {
        let position = match base {
            BaseFilter::Imported { id, .. } => {
                self.filters.iter().position(|record| record.id == *id)
            }
            _ => self
                .filters
                .iter()
                .position(|record| record.base == *base)
                .or_else(|| {
                    self.filters
                        .iter()
                        .position(|record| same_entry(&record.base, base))
                }),
        };
        match position {
            Some(position) => {
                self.filters[position].base = base.clone();
                &mut self.filters[position]
            }
            None => self.register(base),
        }
    }

    /// Copies stored from scheme packages, each with the time it was registered.
    pub fn stored(&self, data_root: &Path) -> Vec<(&BaseFilter, u64)> {
        self.filters
            .iter()
            .filter_map(|record| match &record.base {
                base @ BaseFilter::Imported { id, .. }
                    if data_root
                        .join("base-filters")
                        .join(IMPORTED)
                        .join(id)
                        .is_dir() =>
                {
                    Some((base, record.registered_at))
                }
                _ => None,
            })
            .collect()
    }

    pub fn imported(&self, data_root: &Path) -> Vec<BaseFilter> {
        self.stored(data_root)
            .into_iter()
            .map(|(base, _)| base.clone())
            .collect()
    }
}

pub(crate) fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

/// Every cached download. Within a source the newest version comes first.
pub(crate) fn all_cached(data_root: &Path) -> Vec<BaseFilter> {
    DOWNLOAD_SOURCES
        .iter()
        .flat_map(|source| cached_source(data_root, source.id).unwrap_or_default())
        .collect()
}

struct DownloadSource {
    id: &'static str,
    label: &'static str,
    release: &'static str,
    tree: &'static str,
    zipball: &'static str,
    asset: &'static str,
}

impl DownloadSource {
    fn find(id: &str) -> Result<&'static Self> {
        DOWNLOAD_SOURCES
            .iter()
            .find(|source| source.id == id)
            .ok_or_else(|| "不支持的过滤器来源".into())
    }
}

#[derive(Default)]
pub struct SourceDownloads(Mutex<BTreeMap<&'static str, ReleaseCache>>);

#[derive(Default)]
struct ReleaseCache {
    latest: Option<Release>,
    etag: Option<reqwest::header::HeaderValue>,
    checked: Option<Instant>,
    catalog: Option<Vec<String>>,
}

#[derive(Serialize)]
pub struct DownloadOffer {
    pub source: &'static str,
    pub label: &'static str,
}

#[derive(Deserialize)]
struct Tree {
    truncated: bool,
    tree: Vec<TreeEntry>,
}

#[derive(Deserialize)]
struct TreeEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    zipball_url: String,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

fn source_client() -> Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(45))
        .user_agent("PoE2-Realtime-Filter")
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            let allowed = matches!(
                url.host_str(),
                Some(
                    "api.github.com"
                        | "github.com"
                        | "codeload.github.com"
                        | "release-assets.githubusercontent.com"
                        | "objects.githubusercontent.com"
                )
            );
            if url.scheme() == "https" && allowed && attempt.previous().len() < 6 {
                attempt.follow()
            } else {
                attempt.error("过滤器下载重定向无效")
            }
        }))
        .build()
        .map_err(|error| error.to_string())
}

fn get(client: &Client, url: &str) -> Result<Response> {
    client
        .get(url)
        .send()
        .and_then(Response::error_for_status)
        .map_err(|error| format!("无法从 GitHub 下载过滤器：{error}"))
}

impl ReleaseCache {
    fn latest(&mut self, client: &Client, source: &DownloadSource) -> Result<&Release> {
        // Opening multiple schemes in succession shares a release check with the tray task.
        if !self
            .checked
            .is_some_and(|time| time.elapsed() < Duration::from_secs(60))
        {
            let mut request = client.get(source.release);
            if let Some(etag) = &self.etag {
                request = request.header(reqwest::header::IF_NONE_MATCH, etag);
            }
            let response = request
                .send()
                .and_then(Response::error_for_status)
                .map_err(|error| format!("无法检查 {} 发布：{error}", source.label))?;
            if response.status() != reqwest::StatusCode::NOT_MODIFIED {
                let etag = response.headers().get(reqwest::header::ETAG).cloned();
                let release: Release = read_metadata(response)?;
                if !version_valid(&release.tag_name) {
                    return Err("来源返回了无效的过滤器版本".into());
                }
                if self.latest.as_ref().map(|old| &old.tag_name) != Some(&release.tag_name) {
                    self.catalog = None;
                }
                self.latest = Some(release);
                self.etag = etag;
            }
            self.checked = Some(Instant::now());
        }
        self.latest
            .as_ref()
            .ok_or_else(|| "缺少过滤器发布信息".into())
    }

    fn entries(
        &mut self,
        data_root: &Path,
        client: &Client,
        source: &DownloadSource,
    ) -> Result<Vec<String>> {
        let version = self.latest(client, source)?.tag_name.clone();
        let cached = cached_entries(data_root, source.id, &version)?;
        if !cached.is_empty() {
            return Ok(cached
                .into_iter()
                .filter_map(|base| match base {
                    BaseFilter::Downloaded { entry, .. } => Some(entry),
                    _ => None,
                })
                .collect());
        }
        if self.catalog.is_none() {
            let tree: Tree = read_metadata(get(
                client,
                &format!("{}{}?recursive=1", source.tree, version),
            )?)?;
            if tree.truncated {
                return Err("过滤器来源返回的列表不完整".into());
            }
            self.catalog = Some(
                tree.tree
                    .into_iter()
                    .filter_map(|entry| {
                        let path = Path::new(&entry.path);
                        (entry.kind == "blob" && safe_relative(path) && filter_name(path))
                            .then_some(entry.path)
                    })
                    .collect(),
            );
        }
        Ok(self.catalog.clone().unwrap_or_default())
    }
}

fn read_metadata<T: serde::de::DeserializeOwned>(response: Response) -> Result<T> {
    let bytes = read_bounded(response, 1024 * 1024)
        .map_err(|error| format!("读取过滤器来源信息失败：{error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("读取过滤器来源信息失败：{error}"))
}

fn unique<T>(mut matches: impl Iterator<Item = T>) -> Option<T> {
    let first = matches.next()?;
    matches.next().is_none().then_some(first)
}

pub fn matching_download(
    filters: &[BaseFilter],
    name: &str,
    preferred_entry: Option<&str>,
) -> Option<BaseFilter> {
    if let Some(entry) = preferred_entry {
        let exact = unique(filters.iter().filter(|base| {
            matches!(base, BaseFilter::Downloaded { entry: candidate, .. } if candidate.to_lowercase() == entry.to_lowercase())
        }));
        if exact.is_some() {
            return exact.cloned();
        }
    }
    let name = name.to_lowercase();
    unique(
        filters
            .iter()
            .filter(|base| base.name().to_lowercase() == name),
    )
    .cloned()
}

impl SourceDownloads {
    pub fn offers(
        &self,
        data_root: &Path,
        names: &[String],
    ) -> Result<BTreeMap<String, Vec<DownloadOffer>>> {
        let mut offers = BTreeMap::<String, Vec<DownloadOffer>>::new();
        if names.is_empty() {
            return Ok(offers);
        }
        let client = source_client()?;
        let mut releases = self.0.lock().map_err(|error| error.to_string())?;
        for source in DOWNLOAD_SOURCES {
            let entries = releases
                .entry(source.id)
                .or_default()
                .entries(data_root, &client, source)?;
            for name in names {
                let target = name.to_lowercase();
                if unique(entries.iter().filter(|entry| {
                    Path::new(entry)
                        .file_name()
                        .and_then(|value| value.to_str())
                        .is_some_and(|value| value.to_lowercase() == target)
                }))
                .is_some()
                {
                    offers.entry(name.clone()).or_default().push(DownloadOffer {
                        source: source.id,
                        label: source.label,
                    });
                }
            }
        }
        Ok(offers)
    }

    pub fn download(
        &self,
        data_root: &Path,
        id: &str,
        current_versions: &BTreeSet<String>,
    ) -> Result<Vec<BaseFilter>> {
        let source = DownloadSource::find(id)?;
        let client = source_client()?;
        let mut releases = self.0.lock().map_err(|error| error.to_string())?;
        let release = releases
            .entry(source.id)
            .or_default()
            .latest(&client, source)?;
        if current_versions.len() == 1 && current_versions.contains(&release.tag_name) {
            return Ok(vec![]);
        }
        download_release(data_root, &client, source, release)
    }
}

pub fn cached_source(data_root: &Path, source: &str) -> Result<Vec<BaseFilter>> {
    DownloadSource::find(source)?;
    let directory = data_root.join("base-filters").join(source);
    let Ok(versions) = fs::read_dir(directory) else {
        return Ok(vec![]);
    };
    let mut versions: Vec<_> = versions
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|version| version_valid(version))
        .collect();
    versions.sort_by(|left, right| right.cmp(left));
    let mut filters = Vec::new();
    for version in versions {
        filters.extend(cached_entries(data_root, source, &version)?);
    }
    Ok(filters)
}

fn download_release(
    data_root: &Path,
    client: &Client,
    source: &DownloadSource,
    release: &Release,
) -> Result<Vec<BaseFilter>> {
    let cached = cached_entries(data_root, source.id, &release.tag_name)?;
    if !cached.is_empty() {
        return Ok(cached);
    }
    let asset = release.assets.iter().find(|asset| {
        asset.name.to_ascii_lowercase().ends_with(".zip")
            && asset.browser_download_url.starts_with(source.asset)
    });
    let url = match asset {
        Some(asset) => &asset.browser_download_url,
        None if release.zipball_url.starts_with(source.zipball) => &release.zipball_url,
        _ => return Err("GitHub 发布缺少有效的过滤器压缩包".into()),
    };
    let bytes = read_bounded(get(client, url)?, MAX_ARCHIVE)
        .map_err(|error| format!("读取过滤器压缩包失败：{error}"))?;
    cache_archive(
        data_root,
        source.id,
        &release.tag_name,
        &bytes,
        asset.is_none(),
    )
}

fn cached_entries(data_root: &Path, source: &str, version: &str) -> Result<Vec<BaseFilter>> {
    let root = data_root.join("base-filters").join(source).join(version);
    let manifest = root.join("entries.json");
    let entries: Vec<String> = match fs::read(&manifest) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("过滤器下载缓存无效：{error}"))?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(format!("无法读取下载缓存：{error}")),
    };
    Ok(entries
        .into_iter()
        .filter_map(|entry| {
            let path = Path::new(&entry);
            if !safe_relative(path) || !root.join(path).is_file() {
                return None;
            }
            let name = path.file_name()?.to_str()?.to_owned();
            Some(BaseFilter::Downloaded {
                source: source.into(),
                version: version.into(),
                entry,
                name,
            })
        })
        .collect())
}

fn cache_archive(
    data_root: &Path,
    source: &str,
    version: &str,
    bytes: &[u8],
    strip_top: bool,
) -> Result<Vec<BaseFilter>> {
    let root = data_root.join("base-filters").join(source);
    fs::create_dir_all(&root)
        .map_err(|error| format!("无法创建下载目录「{}」：{error}", root.display()))?;
    let staging = tempfile::tempdir_in(&root).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("无法读取过滤器压缩包：{error}"))?;
    let mut entries = Vec::new();
    let mut total = 0;
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|error| error.to_string())?;
        if file.is_symlink() || file.is_dir() {
            continue;
        }
        let Some(path) = file.enclosed_name() else {
            return Err("压缩包包含不安全的文件路径".into());
        };
        let path = if strip_top {
            path.components().skip(1).collect::<PathBuf>()
        } else {
            path
        };
        if !filter_name(&path) && !audio_name(&path) {
            continue;
        }
        if !safe_relative(&path) {
            return Err(format!("压缩包包含无效路径「{}」", path.display()));
        }
        let data = read_bounded(file, MAX_FILTER.min(MAX_EXTRACTED - total))
            .map_err(|error| format!("无法解压「{}」：{error}", path.display()))?;
        total += data.len();
        let output = staging.path().join(&path);
        fs::create_dir_all(output.parent().unwrap()).map_err(|error| error.to_string())?;
        let mut dest = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&output)
            .map_err(|error| error.to_string())?;
        use std::io::Write;
        dest.write_all(&data).map_err(|error| error.to_string())?;
        if filter_name(&path) && read_filter(&output).is_ok() {
            entries.push(path.to_string_lossy().replace('\\', "/"));
        }
    }
    if entries.is_empty() {
        return Err("压缩包内找不到可用的过滤器".into());
    }
    entries.sort_by_cached_key(|entry| (entry.contains('/'), entry.to_lowercase()));
    fs::write(
        staging.path().join("entries.json"),
        serde_json::to_vec(&entries).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let installed = root.join(version);
    if installed.exists() {
        let existing = cached_entries(data_root, source, version)?;
        if !existing.is_empty() {
            return Ok(existing);
        }
        // Keep any incomplete directory available for diagnosis and make room for a fresh copy.
        fs::rename(
            &installed,
            root.join(format!(".incomplete-{}", uuid::Uuid::new_v4())),
        )
        .map_err(|error| error.to_string())?;
    }
    fs::rename(staging.path(), &installed).map_err(|error| error.to_string())?;
    cached_entries(data_root, source, version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn release_checks_reuse_the_etag_and_catalog_on_304() {
        use std::{
            io::{BufRead, BufReader},
            net::TcpListener,
        };

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let source = DownloadSource {
            release: &*Box::leak(url.into_boxed_str()),
            ..DOWNLOAD_SOURCES[0]
        };
        let server = std::thread::spawn(move || {
            for conditional in [false, true] {
                let (mut stream, _) = listener.accept().unwrap();
                let headers: Vec<_> = BufReader::new(&stream)
                    .lines()
                    .map_while(io::Result::ok)
                    .take_while(|line| !line.is_empty())
                    .collect();
                assert_eq!(
                    headers
                        .iter()
                        .any(|line| line.eq_ignore_ascii_case("if-none-match: \"fixture\"")),
                    conditional
                );
                if conditional {
                    write!(
                        stream,
                        "HTTP/1.1 304 Not Modified\r\nConnection: close\r\n\r\n"
                    )
                    .unwrap();
                } else {
                    let body = r#"{"tag_name":"0.1.0","zipball_url":"","assets":[]}"#;
                    write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nETag: \"fixture\"\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                }
            }
        });
        let client = source_client().unwrap();
        let mut cache = ReleaseCache::default();
        assert_eq!(cache.latest(&client, &source).unwrap().tag_name, "0.1.0");
        cache.catalog = Some(vec!["Strict.filter".into()]);
        cache.checked = None;
        assert_eq!(cache.latest(&client, &source).unwrap().tag_name, "0.1.0");
        assert_eq!(cache.catalog.unwrap(), ["Strict.filter"]);
        server.join().unwrap();
    }

    #[test]
    fn matching_download_preserves_style_and_rejects_ambiguous_names() {
        let base = |entry: &str| BaseFilter::Downloaded {
            source: SOURCE.into(),
            version: "0.1.0".into(),
            entry: entry.into(),
            name: "Strict.filter".into(),
        };
        let filters = [base("A/Strict.filter"), base("B/Strict.filter")];
        assert!(matching_download(&filters, "strict.filter", None).is_none());
        assert!(
            matches!(matching_download(&filters, "strict.filter", Some("b/strict.filter")), Some(BaseFilter::Downloaded { entry, .. }) if entry == "B/Strict.filter")
        );
        assert!(
            matching_download(&filters[..1], "strict.filter", Some("moved/Strict.filter"))
                .is_some()
        );
    }

    #[test]
    fn scans_supported_filters_and_excludes_generated_files() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(
            directory.path().join("reference.FILTER"),
            "\u{feff}Show\n BaseType == \"Exalted Orb\"\n",
        )
        .unwrap();
        fs::write(
            directory.path().join("renamed.filter"),
            "\u{feff}# poe2-filter generated overlay\nShow\n",
        )
        .unwrap();
        fs::write(directory.path().join("not-filter.txt"), "Show\n").unwrap();
        let files = scan(directory.path()).unwrap();
        assert!(
            matches!(files.as_slice(), [BaseFilter::Local { name, .. }] if name == "reference.FILTER")
        );
    }

    #[test]
    fn cached_version_loads_offline_with_sound_and_layout() {
        let directory = tempfile::tempdir().unwrap();
        let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (path, bytes) in [
            (
                "root/filter style/Strict.filter",
                b"Show\n CustomAlertSound \"trade.mp3\"\n".as_slice(),
            ),
            ("root/filter style/trade.mp3", b"sound".as_slice()),
        ] {
            archive.start_file(path, options).unwrap();
            archive.write_all(bytes).unwrap();
        }
        let bytes = archive.finish().unwrap().into_inner();
        let filters = cache_archive(directory.path(), SOURCE, "0.1.0", &bytes, true).unwrap();
        let loaded = filters[0].load(directory.path()).unwrap();
        assert!(loaded.text.contains("trade.mp3"));
        assert_eq!(
            fs::read(loaded.path.parent().unwrap().join("trade.mp3")).unwrap(),
            b"sound"
        );
        assert_eq!(cached_source(directory.path(), SOURCE).unwrap().len(), 1);
    }

    #[test]
    #[ignore = "downloads an official GitHub release for local verification"]
    fn downloads_real_neversink_release() {
        let directory = tempfile::tempdir().unwrap();
        let downloads = SourceDownloads::default();
        let names = [
            "NeverSink's filter 2 - 3-STRICT.filter".to_owned(),
            "missing.filter".into(),
        ];
        let offers = downloads.offers(directory.path(), &names).unwrap();
        assert_eq!(offers[&names[0]][0].source, SOURCE);
        assert!(!offers.contains_key(&names[1]));
        assert!(!directory.path().join("base-filters").exists());
        let filters = downloads
            .download(directory.path(), SOURCE, &BTreeSet::new())
            .unwrap();
        let selected = matching_download(&filters, &names[0], None).unwrap();
        let BaseFilter::Downloaded { version, .. } = selected else {
            unreachable!()
        };
        assert!(downloads
            .download(directory.path(), SOURCE, &BTreeSet::from([version]))
            .unwrap()
            .is_empty());
        assert!(filters.len() >= 7);
        let custom = filters.iter().find(|base| matches!(base, BaseFilter::Downloaded { name, .. } if name.contains("2-SEMI-STRICT") && name.contains("customsounds"))).unwrap();
        let loaded = custom.load(directory.path()).unwrap();
        assert_eq!(
            cached_source(directory.path(), SOURCE).unwrap().len(),
            filters.len()
        );
        let store =
            crate::store::Store::new(directory.path().to_owned(), directory.path().join("game"));
        let profile = serde_json::json!({"schemaVersion":2,"locale":"cn","league":"Standard","baseFilter":custom,"rules":[],"skippedItemIds":[]});
        let result = store.preview(profile, None).unwrap();
        assert!(result["filterFile"].as_str().unwrap().contains("poe2rf-"));
        let inspection = store.base_styles(custom.clone()).unwrap();
        let styles = &inspection["styles"];
        assert!(
            styles
                .as_object()
                .unwrap()
                .values()
                .all(|style| style["warning"].is_null()),
            "{}",
            loaded.name
        );
        println!(
            "{} filters and sounds, including {}",
            filters.len(),
            loaded.name
        );
    }
}

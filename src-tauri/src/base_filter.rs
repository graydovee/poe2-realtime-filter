use crate::{
    engine::Result,
    store::{display_directory, valid_windows_name},
};
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Cursor, Read},
    path::{Component, Path, PathBuf},
    time::Duration,
};

const SOURCE: &str = "neversink";
const RELEASE: &str =
    "https://api.github.com/repos/NeverSinkDev/NeverSink-Filter-for-PoE2/releases/latest";
const ZIP_PREFIX: &str =
    "https://api.github.com/repos/NeverSinkDev/NeverSink-Filter-for-PoE2/zipball/";
const MAX_FILTER: usize = 8 * 1024 * 1024;
const MAX_ARCHIVE: usize = 32 * 1024 * 1024;
const MAX_EXTRACTED: usize = 160 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum BaseFilter {
    Local {
        path: PathBuf,
        name: String,
    },
    Downloaded {
        source: String,
        version: String,
        entry: String,
        name: String,
    },
}

pub struct Baseline {
    pub path: PathBuf,
    pub name: String,
    pub text: String,
    pub cache_root: Option<PathBuf>,
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
    let display = display_directory(path);
    if !filter_name(path) {
        return Err("请选择 .filter 文件".into());
    }
    let bytes = read_limited(path, MAX_FILTER).map_err(|error| {
        format!("无法读取基础过滤器「{display}」，请检查文件或重新选择。{error}")
    })?;
    let text =
        String::from_utf8(bytes).map_err(|_| format!("基础过滤器「{display}」不是 UTF-8 文本"))?;
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

fn safe_relative(path: &Path) -> bool {
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
        let name = path
            .file_name()
            .and_then(|part| part.to_str())
            .ok_or("无法读取过滤器文件名")?
            .to_owned();
        Ok(Self::Local {
            path: PathBuf::from(display_directory(&path)),
            name,
        })
    }

    pub fn load(&self, data_root: &Path) -> Result<Baseline> {
        let (path, cache_root) = match self {
            Self::Local { path, .. } if path.is_absolute() => (path.clone(), None),
            Self::Downloaded {
                source,
                version,
                entry,
                ..
            } if source == SOURCE && version_valid(version) && safe_relative(Path::new(entry)) => {
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
            _ => return Err("基础过滤器来源无效，请重新选择".into()),
        };
        let text = read_filter(&path)?;
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("无法读取基础过滤器文件名")?
            .to_owned();
        Ok(Baseline {
            path,
            name,
            text,
            cache_root,
        })
    }
}

pub fn scan(directory: &Path) -> Result<Vec<BaseFilter>> {
    let files = match fs::read_dir(directory) {
        Ok(files) => files,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => {
            return Err(format!(
                "无法扫描「{}」：{error}",
                display_directory(directory)
            ))
        }
    };
    let mut paths: Vec<_> = files
        .filter_map(|entry| entry.ok().map(|file| file.path()))
        .filter(|path| filter_name(path))
        .collect();
    paths.sort_by_key(|path| {
        path.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase()
    });
    Ok(paths
        .iter()
        .filter_map(|path| BaseFilter::from_file(path).ok())
        .collect())
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

pub fn download(data_root: &Path, source: &str) -> Result<Vec<BaseFilter>> {
    match source {
        SOURCE => download_neversink(data_root),
        _ => Err("不支持的过滤器来源".into()),
    }
}

pub fn cached_source(data_root: &Path, source: &str) -> Result<Vec<BaseFilter>> {
    if source != SOURCE {
        return Err("不支持的过滤器来源".into());
    }
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

fn download_neversink(data_root: &Path) -> Result<Vec<BaseFilter>> {
    let client = source_client()?;
    let response = read_bounded(get(&client, RELEASE)?, 1024 * 1024)
        .map_err(|error| format!("读取发布信息失败：{error}"))?;
    let release: Release =
        serde_json::from_slice(&response).map_err(|error| format!("读取发布信息失败：{error}"))?;
    if !version_valid(&release.tag_name) {
        return Err("GitHub 返回了无效的过滤器版本".into());
    }
    let cached = cached_entries(data_root, SOURCE, &release.tag_name)?;
    if !cached.is_empty() {
        return Ok(cached);
    }
    let asset = release.assets.iter().find(|asset| {
        asset.name.to_ascii_lowercase().ends_with(".zip")
            && asset.browser_download_url.starts_with(
                "https://github.com/NeverSinkDev/NeverSink-Filter-for-PoE2/releases/download/",
            )
    });
    let url = match asset {
        Some(asset) => &asset.browser_download_url,
        None if release.zipball_url.starts_with(ZIP_PREFIX) => &release.zipball_url,
        _ => return Err("GitHub 发布缺少有效的过滤器压缩包".into()),
    };
    let bytes = read_bounded(get(&client, url)?, MAX_ARCHIVE)
        .map_err(|error| format!("读取过滤器压缩包失败：{error}"))?;
    cache_archive(
        data_root,
        SOURCE,
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
    fn scans_supported_filters_and_excludes_old_generated_markers() {
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
        let filters = download(directory.path(), SOURCE).unwrap();
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
        let styles = store.base_styles(custom.clone()).unwrap();
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

//! Scheme packages: a ZIP holding a JSON manifest, the base filters a set of schemes uses and
//! their custom sounds. Schemes keep their IDs and rule IDs, so a later package can update
//! what an earlier one imported. Files stream from disk; only the manifest is held.

use crate::{
    base_filter::{self, BaseOrigin, MAX_FILTER},
    engine::Result,
    store::{valid_audio, AUDIO_MAX},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{self, Read, Seek, Write},
    path::Path,
};

pub const FORMAT: u32 = 1;
const MANIFEST: &str = "manifest.json";
/// The only size limit. It stops a corrupted or hostile archive from filling the disk;
/// real packages stay far below it.
const MAX_TOTAL: u64 = 4 * 1024 * 1024 * 1024;
const TOO_LARGE: &str = "方案包解压后过大";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub format: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    #[serde(default)]
    pub bases: Vec<PackageBase>,
    #[serde(default)]
    pub schemes: Vec<PackageScheme>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageBase {
    pub id: String,
    pub name: String,
    pub origin: BaseOrigin,
    /// The filter file the schemes use, relative to the base's directory.
    pub entry: String,
    pub files: Vec<PackageFile>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageFile {
    pub path: String,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageScheme {
    pub id: String,
    pub name: String,
    /// The ID of an entry in `bases`. Absent when the scheme carries no filter content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    /// Rule sound file name -> content hash.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub sounds: BTreeMap<String, String>,
    /// The validated profile, with `baseFilter` replaced by `baseFilterHint`.
    pub profile: Value,
}

/// Identity of a base filter's content: every file with its hash, in path order.
pub fn files_digest<'a>(files: impl Iterator<Item = (&'a str, &'a str)>) -> String {
    let mut hash = Sha256::new();
    for (path, sha256) in files {
        hash.update(sha256.as_bytes());
        hash.update(b"  ");
        hash.update(path.as_bytes());
        hash.update(b"\n");
    }
    format!("{:x}", hash.finalize())
}

impl PackageBase {
    pub fn digest(&self) -> String {
        files_digest(
            self.files
                .iter()
                .map(|file| (file.path.as_str(), file.sha256.as_str())),
        )
    }

    pub fn entry_hash(&self) -> Option<&str> {
        self.files
            .iter()
            .find(|file| file.path == self.entry)
            .map(|file| file.sha256.as_str())
    }

    /// The name of the archive entry holding `path` of this base filter.
    fn entry_name(&self, path: &str) -> String {
        format!("bases/{}/{}", self.id, path)
    }
}

/// A path inside the package: relative, `/`-separated and usable below the data directory.
pub(crate) fn package_path(path: &str) -> bool {
    !path.is_empty() && !path.contains('\\') && base_filter::safe_relative(Path::new(path))
}

/// The same path written with `/`, when it can live inside a package.
pub(crate) fn relative_path(path: &Path) -> Option<String> {
    let text = path.to_str()?.replace('\\', "/");
    package_path(&text).then_some(text)
}

fn valid_sha256(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_name(name: &str, max: usize) -> bool {
    !name.is_empty() && name.encode_utf16().count() <= max && !name.chars().any(char::is_control)
}

/// Reads the manifest. A newer format asks for an upgrade; anything else malformed is invalid.
pub fn parse_manifest(bytes: &[u8]) -> Result<Manifest> {
    #[derive(Deserialize)]
    struct Version {
        format: u32,
    }
    let version: Version = serde_json::from_slice(bytes).map_err(|_| "方案包清单无效")?;
    if version.format != FORMAT {
        return Err(format!(
            "方案包格式版本 {} 需要更新的客户端",
            version.format
        ));
    }
    let manifest: Manifest =
        serde_json::from_slice(bytes).map_err(|error| format!("方案包清单无效：{error}"))?;
    validate(&manifest)?;
    Ok(manifest)
}

fn validate(manifest: &Manifest) -> Result<()> {
    if manifest
        .title
        .as_ref()
        .is_some_and(|title| !valid_name(title, 80))
    {
        return Err("方案包名称无效".into());
    }
    if manifest.schemes.is_empty() {
        return Err("方案包里没有方案".into());
    }
    let invalid_base = "方案包里的基础过滤器信息无效";
    let mut bases = BTreeSet::new();
    for base in &manifest.bases {
        if !base_filter::valid_base_id(&base.id) || !bases.insert(base.id.as_str()) {
            return Err("方案包里的基础过滤器 ID 无效或重复".into());
        }
        if !valid_name(&base.name, 260) || base.files.is_empty() || !package_path(&base.entry) {
            return Err(invalid_base.into());
        }
        let mut paths = BTreeSet::new();
        for file in &base.files {
            if !package_path(&file.path)
                || !paths.insert(file.path.as_str())
                || !valid_sha256(&file.sha256)
            {
                return Err(invalid_base.into());
            }
        }
        if !paths.contains(base.entry.as_str()) {
            return Err(invalid_base.into());
        }
    }
    let mut servers = BTreeSet::new();
    let mut ids = BTreeSet::new();
    for scheme in &manifest.schemes {
        if uuid::Uuid::parse_str(&scheme.id).is_err() || !ids.insert(scheme.id.as_str()) {
            return Err("方案包里的方案 ID 无效或重复".into());
        }
        crate::store::scheme_name(&scheme.name)?;
        if scheme
            .base
            .as_ref()
            .is_some_and(|id| !bases.contains(id.as_str()))
        {
            return Err("方案包里的方案引用了不存在的基础过滤器".into());
        }
        for (name, hash) in &scheme.sounds {
            if !valid_audio(name) || !valid_sha256(hash) {
                return Err(format!("方案包里的音效「{name}」无效"));
            }
        }
        if scheme.profile["rules"].as_array().is_none() {
            return Err("方案包里的方案缺少规则列表".into());
        }
        let server = scheme
            .profile
            .get("server")
            .and_then(Value::as_str)
            .filter(|server| matches!(*server, "international" | "tencent"))
            .ok_or("方案包里的方案缺少有效的游戏服务器")?;
        servers.insert(server);
    }
    if servers.len() > 1 {
        return Err("方案包里的方案不属于同一个服务器".into());
    }
    Ok(())
}

/// Reads one archive entry through SHA-256, refusing more than `left` bytes.
struct Checked<'a> {
    entry: zip::read::ZipFile<'a, File>,
    hash: Sha256,
    left: u64,
}

impl Read for Checked<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let read = self.entry.read(buf)?;
        if read as u64 > self.left {
            return Err(io::Error::new(io::ErrorKind::FileTooLarge, TOO_LARGE));
        }
        self.left -= read as u64;
        self.hash.update(&buf[..read]);
        Ok(read)
    }
}

struct Archive {
    zip: zip::ZipArchive<File>,
    /// Archive entry name -> index.
    entries: BTreeMap<String, usize>,
    /// Bytes decompressed so far, against `MAX_TOTAL`.
    total: u64,
}

impl Archive {
    fn open(file: File) -> Result<Self> {
        let mut zip = zip::ZipArchive::new(file).map_err(|_| "这个文件不是方案包")?;
        let mut entries = BTreeMap::new();
        for index in 0..zip.len() {
            let entry = zip.by_index(index).map_err(|_| "这个文件不是方案包")?;
            if entry.is_symlink() {
                return Err("方案包里有不安全的文件".into());
            }
            if entry.is_dir() {
                continue;
            }
            if entries.insert(entry.name().to_owned(), index).is_some() {
                return Err("方案包里有重复的文件".into());
            }
        }
        Ok(Self {
            zip,
            entries,
            total: 0,
        })
    }

    /// Streams an entry into `output` and returns its content hash and length.
    fn stream(&mut self, name: &str, limit: u64, output: &mut impl Write) -> Result<(String, u64)> {
        let index = self
            .entries
            .get(name)
            .copied()
            .ok_or_else(|| format!("方案包缺少文件「{name}」"))?;
        let entry = self
            .zip
            .by_index(index)
            .map_err(|error| format!("无法读取方案包里的「{name}」：{error}"))?;
        let mut checked = Checked {
            entry,
            hash: Sha256::new(),
            left: limit.min(MAX_TOTAL.saturating_sub(self.total)),
        };
        let copied = io::copy(&mut checked, output).map_err(|error| {
            if error.kind() == io::ErrorKind::FileTooLarge {
                TOO_LARGE.to_owned()
            } else {
                format!("无法解压「{name}」：{error}")
            }
        })?;
        self.total += copied;
        Ok((format!("{:x}", checked.hash.finalize()), copied))
    }
}

/// An open package. Entry contents stream from the file on demand.
pub struct Package {
    pub manifest: Manifest,
    files: Archive,
}

fn mismatch(name: &str) -> String {
    format!("方案包里的「{name}」校验失败")
}

/// The filter files of a base filter pass `MAX_FILTER`; its sounds and the scheme sounds
/// pass `AUDIO_MAX`, the same limits as those files on disk.
fn entry_limit(path: &str) -> u64 {
    if base_filter::audio_name(Path::new(path)) {
        AUDIO_MAX as u64
    } else {
        MAX_FILTER as u64
    }
}

impl Package {
    pub fn open(path: &Path) -> Result<Self> {
        let file = File::open(path).map_err(|_| "无法打开方案包文件")?;
        let mut files = Archive::open(file)?;
        if !files.entries.contains_key(MANIFEST) {
            return Err("这个压缩包不是方案包".into());
        }
        let mut bytes = Vec::new();
        files.stream(MANIFEST, MAX_TOTAL, &mut bytes)?;
        let manifest = parse_manifest(&bytes)?;
        let expected: BTreeSet<String> = expected_names(&manifest).collect();
        if !files.entries.keys().eq(expected.iter()) {
            return Err("方案包里的文件与清单不一致".into());
        }
        Ok(Self { manifest, files })
    }

    /// Checks every listed file: present, matching its hash and usable as what it claims to be.
    pub fn verify(&mut self) -> Result<()> {
        self.new_pass();
        for base in &self.manifest.bases {
            for file in &base.files {
                let name = base.entry_name(&file.path);
                let mut bytes = Vec::new();
                let (hash, length) =
                    self.files
                        .stream(&name, entry_limit(&file.path), &mut bytes)?;
                if hash != file.sha256 {
                    return Err(mismatch(&name));
                }
                if base_filter::audio_name(Path::new(&file.path)) {
                    if length == 0 {
                        return Err(mismatch(&name));
                    }
                } else {
                    base_filter::filter_text(&bytes, &base.name)?;
                }
            }
        }
        for index in 0..self.manifest.schemes.len() {
            self.sounds(index)?;
        }
        Ok(())
    }

    /// The bytes of a scheme's custom sounds, by the file name the rules use.
    pub fn sounds(&mut self, index: usize) -> Result<BTreeMap<String, Vec<u8>>> {
        let scheme = &self.manifest.schemes[index];
        scheme
            .sounds
            .iter()
            .map(|(name, hash)| {
                let mut bytes = Vec::new();
                let entry = format!("sounds/{hash}");
                let (actual, length) = self.files.stream(&entry, AUDIO_MAX as u64, &mut bytes)?;
                if actual != *hash || length == 0 {
                    return Err(mismatch(&entry));
                }
                Ok((name.clone(), bytes))
            })
            .collect()
    }

    /// Starts counting decompressed bytes again. Each pass over the package gets the whole budget.
    pub fn new_pass(&mut self) {
        self.files.total = 0;
    }

    pub fn server(&self) -> crate::store::Server {
        crate::store::Server::from_profile(&self.manifest.schemes[0].profile)
    }

    /// Writes the files of a base filter below `directory`, each checked against its hash.
    pub fn extract(&mut self, index: usize, directory: &Path) -> Result<()> {
        let base = &self.manifest.bases[index];
        for file in &base.files {
            let path = directory.join(&file.path);
            let parent = path.parent().ok_or("无效路径")?;
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            let mut output = File::create(&path)
                .map_err(|error| format!("无法写入已导入的基础过滤器：{error}"))?;
            let (hash, _) = self.files.stream(
                &base.entry_name(&file.path),
                entry_limit(&file.path),
                &mut output,
            )?;
            if hash != file.sha256 {
                return Err(mismatch(&file.path));
            }
        }
        Ok(())
    }
}

fn expected_names(manifest: &Manifest) -> impl Iterator<Item = String> + '_ {
    std::iter::once(MANIFEST.to_owned())
        .chain(manifest.bases.iter().flat_map(|base| {
            base.files
                .iter()
                .map(move |file| base.entry_name(&file.path))
        }))
        .chain(
            manifest
                .schemes
                .iter()
                .flat_map(|scheme| scheme.sounds.values().map(|hash| format!("sounds/{hash}"))),
        )
}

pub fn start_entry<W: Write + Seek>(archive: &mut zip::ZipWriter<W>, name: &str) -> Result<()> {
    archive
        .start_file(
            name,
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )
        .map_err(|error| format!("无法写入方案包：{error}"))
}

pub fn write_entry<W: Write + Seek>(
    archive: &mut zip::ZipWriter<W>,
    name: &str,
    bytes: &[u8],
) -> Result<()> {
    start_entry(archive, name)?;
    archive
        .write_all(bytes)
        .map_err(|error| format!("无法写入方案包：{error}"))
}

/// Writes `source` into a new archive entry and returns its content hash.
pub fn copy_entry<W: Write + Seek>(
    archive: &mut zip::ZipWriter<W>,
    name: &str,
    source: &mut impl Read,
) -> Result<String> {
    start_entry(archive, name)?;
    let mut hashing = Hashing {
        archive,
        hash: Sha256::new(),
    };
    io::copy(source, &mut hashing).map_err(|error| format!("无法写入方案包「{name}」：{error}"))?;
    Ok(format!("{:x}", hashing.hash.finalize()))
}

struct Hashing<'a, W: Write + Seek> {
    archive: &'a mut zip::ZipWriter<W>,
    hash: Sha256,
}

impl<W: Write + Seek> Write for Hashing<'_, W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let written = self.archive.write(buf)?;
        self.hash.update(&buf[..written]);
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.archive.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Cursor;

    const BASE: &str = "0123456789abcdef0123456789abcdef";
    const FILTER: &str = "bases/0123456789abcdef0123456789abcdef/Example.filter";

    fn sha(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn sound() -> String {
        format!("sounds/{}", sha(b"sound"))
    }

    fn base(bytes: &[u8]) -> PackageBase {
        PackageBase {
            id: BASE.into(),
            name: "Example.filter".into(),
            origin: BaseOrigin::Local {},
            entry: "Example.filter".into(),
            files: vec![PackageFile {
                path: "Example.filter".into(),
                sha256: sha(bytes),
            }],
        }
    }

    fn scheme(id: &str, base: Option<&str>, sounds: BTreeMap<String, String>) -> PackageScheme {
        PackageScheme {
            id: id.into(),
            name: "方案".into(),
            base: base.map(str::to_owned),
            sounds,
            profile: json!({"server":"international","schemaVersion":3,"league":"Standard",
                "originalLeague":"Standard","rules":[{"id":"abcd1234","name":"R","enabled":true,"hidden":false,
                "target":{"itemIds":[]},"effects":{}}],"skippedItemIds":[]}),
        }
    }

    fn manifest() -> Manifest {
        Manifest {
            format: FORMAT,
            title: None,
            app_version: None,
            bases: vec![base(b"Show\n")],
            schemes: vec![scheme(
                "a88bba0b-a9f3-4b8e-bc92-2771304561d9",
                Some(BASE),
                BTreeMap::from([("trade.ogg".to_owned(), sha(b"sound"))]),
            )],
        }
    }

    type Entries = Vec<(String, Vec<u8>)>;

    fn entry(name: impl Into<String>, bytes: impl Into<Vec<u8>>) -> (String, Vec<u8>) {
        (name.into(), bytes.into())
    }

    fn sound_entry(bytes: &[u8]) -> (String, Vec<u8>) {
        entry(sound(), bytes)
    }

    fn manifest_entry(manifest: &Manifest) -> (String, Vec<u8>) {
        entry(MANIFEST, serde_json::to_vec_pretty(manifest).unwrap())
    }

    /// One ZIP holding every entry.
    fn archive(entries: &Entries) -> Vec<u8> {
        let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            write_entry(&mut archive, name, bytes).unwrap();
        }
        archive.finish().unwrap().into_inner()
    }

    /// The complete valid package.
    fn valid() -> Entries {
        vec![
            entry(FILTER, b"Show\n"),
            sound_entry(b"sound"),
            manifest_entry(&manifest()),
        ]
    }

    /// The valid package with another manifest.
    fn with_manifest(mut entries: Entries, manifest: &Manifest) -> Entries {
        let position = entries
            .iter()
            .position(|(name, _)| name == MANIFEST)
            .unwrap();
        entries[position] = manifest_entry(manifest);
        entries
    }

    fn open(bytes: &[u8]) -> Result<(Package, tempfile::TempDir)> {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("package.zip");
        fs::write(&path, bytes).unwrap();
        Ok((Package::open(&path)?, directory))
    }

    fn verified_bytes(bytes: &[u8]) -> Result<Manifest> {
        let (mut package, _directory) = open(bytes)?;
        package.verify()?;
        Ok(package.manifest)
    }

    fn verified(entries: &Entries) -> Result<Manifest> {
        verified_bytes(&archive(entries))
    }

    /// A stored ZIP written by hand. The archive writer refuses repeated names.
    fn stored(entries: &Entries) -> Vec<u8> {
        let u16s = |value: usize| u16::try_from(value).unwrap().to_le_bytes();
        let mut local = Vec::new();
        let mut directory = Vec::new();
        for (name, data) in entries {
            // Version made by, version needed, flags, method, time and date.
            let mut record = vec![20u8, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            record.extend_from_slice(&crc32fast::hash(data).to_le_bytes());
            for _ in 0..2 {
                record.extend_from_slice(&u32::try_from(data.len()).unwrap().to_le_bytes());
            }
            record.extend_from_slice(&u16s(name.len()));
            let offset = u32::try_from(local.len()).unwrap().to_le_bytes();
            local.extend_from_slice(b"PK\x03\x04");
            local.extend_from_slice(&record[2..]);
            local.extend_from_slice(&[0, 0]);
            local.extend_from_slice(name.as_bytes());
            local.extend_from_slice(data);
            directory.extend_from_slice(b"PK\x01\x02");
            directory.extend_from_slice(&record);
            directory.extend_from_slice(&[0; 12]);
            directory.extend_from_slice(&offset);
            directory.extend_from_slice(name.as_bytes());
        }
        let mut bytes = local;
        let start = u32::try_from(bytes.len()).unwrap().to_le_bytes();
        let size = u32::try_from(directory.len()).unwrap().to_le_bytes();
        let count = u16s(entries.len());
        bytes.extend_from_slice(&directory);
        bytes.extend_from_slice(b"PK\x05\x06");
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(&count);
        bytes.extend_from_slice(&count);
        bytes.extend_from_slice(&size);
        bytes.extend_from_slice(&start);
        bytes.extend_from_slice(&[0; 2]);
        bytes
    }

    #[test]
    fn manifest_round_trip_and_rejects_malformed_content() {
        let bytes = serde_json::to_vec_pretty(&manifest()).unwrap();
        assert_eq!(parse_manifest(&bytes).unwrap(), manifest());
        let mut newer = manifest();
        newer.format = 2;
        let error = parse_manifest(&serde_json::to_vec(&newer).unwrap()).unwrap_err();
        assert!(error.contains("需要更新的客户端"), "{error}");
        let mut unknown: Value = serde_json::from_slice(&bytes).unwrap();
        unknown["extra"] = json!(1);
        let error = parse_manifest(&serde_json::to_vec(&unknown).unwrap()).unwrap_err();
        assert!(error.contains("清单无效"), "{error}");
        for (pointer, value) in [
            ("/bases/0/id", json!("short")),
            ("/bases/0/entry", json!("../Example.filter")),
            ("/schemes/0/base", json!("missing")),
            ("/schemes/0/sounds", json!({"bad/name.ogg": sha(b"x")})),
            ("/schemes/0/profile/server", json!("unknown")),
        ] {
            let mut bad: Value = serde_json::from_slice(&bytes).unwrap();
            *bad.pointer_mut(pointer).unwrap() = value;
            assert!(
                parse_manifest(&serde_json::to_vec(&bad).unwrap()).is_err(),
                "{pointer}"
            );
        }
        let mut duplicate = manifest();
        duplicate.schemes.push(scheme(
            "a88bba0b-a9f3-4b8e-bc92-2771304561d9",
            None,
            BTreeMap::new(),
        ));
        let error = parse_manifest(&serde_json::to_vec(&duplicate).unwrap()).unwrap_err();
        assert!(error.contains("重复"), "{error}");
        let mut mixed = manifest();
        mixed.schemes.push(scheme(
            "0f0e0d0c-0b0a-4908-8706-050403020100",
            None,
            BTreeMap::new(),
        ));
        mixed.schemes[1].profile["server"] = json!("tencent");
        let error = parse_manifest(&serde_json::to_vec(&mixed).unwrap()).unwrap_err();
        assert!(error.contains("同一个服务器"), "{error}");
        let empty = Manifest {
            format: FORMAT,
            title: None,
            app_version: None,
            bases: vec![],
            schemes: vec![],
        };
        assert!(parse_manifest(&serde_json::to_vec(&empty).unwrap()).is_err());
    }

    #[test]
    fn package_streams_its_files_after_checking_them() {
        let (mut package, _directory) = open(&archive(&valid())).unwrap();
        package.verify().unwrap();
        assert_eq!(package.sounds(0).unwrap()["trade.ogg"], b"sound");
        let target = tempfile::tempdir().unwrap();
        package.extract(0, target.path()).unwrap();
        assert_eq!(
            fs::read_to_string(target.path().join("Example.filter")).unwrap(),
            "Show\n"
        );
    }

    #[test]
    fn package_rejects_tampered_or_unlisted_files() {
        const GENERATED: &[u8] = b"# poe2-filter generated overlay\nShow\n";
        let mut extra = valid();
        extra.push(entry("extra.txt", b"x"));
        let mut generated = with_manifest(
            valid(),
            &Manifest {
                bases: vec![base(GENERATED)],
                ..manifest()
            },
        );
        generated[0] = entry(FILTER, GENERATED);
        let cases: Vec<(&str, Entries, &str)> = vec![
            (
                "sound",
                vec![
                    entry(FILTER, b"Show\n"),
                    sound_entry(b"noised"),
                    manifest_entry(&manifest()),
                ],
                "校验失败",
            ),
            ("extra", extra, "不一致"),
            (
                "missing",
                vec![entry(FILTER, b"Show\n"), manifest_entry(&manifest())],
                "不一致",
            ),
            (
                "ready",
                vec![entry("Scheme.filter", b"Show\n")],
                "不是方案包",
            ),
            ("generated", generated, "生成的文件"),
            (
                "empty sound",
                vec![
                    entry(FILTER, b"Show\n"),
                    sound_entry(b""),
                    manifest_entry(&manifest()),
                ],
                "校验失败",
            ),
        ];
        for (name, entries, expected) in cases {
            let outcome = verified(&entries).unwrap_err();
            assert!(outcome.contains(expected), "{name}: {outcome}");
        }
        // A hand-written archive can repeat a name where the archive writer cannot. The
        // reader keeps the last entry, which then fails the manifest's hash.
        let duplicate = vec![
            entry(FILTER, b"Show\n"),
            entry(FILTER, b"Hide\n"),
            sound_entry(b"sound"),
            manifest_entry(&manifest()),
        ];
        assert_eq!(verified(&valid()).unwrap(), manifest());
        assert_eq!(verified_bytes(&stored(&valid())).unwrap(), manifest());
        let outcome = verified_bytes(&stored(&duplicate)).unwrap_err();
        assert!(outcome.contains("校验失败"), "{outcome}");
    }

    #[test]
    fn oversized_filter_is_refused_while_streaming() {
        let oversized = vec![0u8; MAX_FILTER + 1];
        let mut huge = manifest();
        huge.bases = vec![base(&oversized)];
        let entries = vec![
            entry(FILTER, oversized),
            sound_entry(b"sound"),
            manifest_entry(&huge),
        ];
        let error = verified(&entries).unwrap_err();
        assert!(error.contains("解压后过大"), "{error}");
    }

    #[test]
    fn digest_follows_the_files_in_path_order() {
        let mut extended = base(b"Show\n");
        extended.files.push(PackageFile {
            path: "sub/Imported.filter".into(),
            sha256: sha(b"Hide\n"),
        });
        assert_ne!(extended.digest(), base(b"Show\n").digest());
        let mut renamed = extended.clone();
        renamed.files[1].path = "sub/Other.filter".into();
        assert_ne!(extended.digest(), renamed.digest());
        assert_eq!(extended.digest(), extended.clone().digest());
    }

    #[test]
    fn copy_entry_hashes_what_it_writes() {
        let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let hash = copy_entry(&mut archive, "sounds/x", &mut &b"sound"[..]).unwrap();
        assert_eq!(hash, sha(b"sound"));
        let bytes = archive.finish().unwrap().into_inner();
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut written = String::new();
        archive
            .by_name("sounds/x")
            .unwrap()
            .read_to_string(&mut written)
            .unwrap();
        assert_eq!(written, "sound");
    }

    #[test]
    fn packages_have_no_count_limits() {
        let mut large = manifest();
        large.bases = (0..60u32)
            .map(|index| PackageBase {
                id: format!("{index:032x}"),
                ..base(b"Show\n")
            })
            .collect();
        let first = format!("{:032x}", 0u32);
        large.schemes = (0..60)
            .map(|_| {
                scheme(
                    &uuid::Uuid::new_v4().to_string(),
                    Some(&first),
                    BTreeMap::new(),
                )
            })
            .collect();
        let parsed = parse_manifest(&serde_json::to_vec(&large).unwrap()).unwrap();
        assert_eq!((parsed.bases.len(), parsed.schemes.len()), (60, 60));
    }
}

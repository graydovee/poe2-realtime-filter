//! Scheme package export and import. The format lives in `scheme_package`; base filter
//! identities live in the registry.

use super::*;
use crate::{
    base_filter::{self, BaseOrigin, BaseRecord, Registry, IMPORTED},
    scheme_package::{self, Manifest, Package, PackageBase, PackageFile, PackageScheme},
};
use serde::{Deserialize, Serialize};
use std::{fs::File, io::Seek};

/// A package ready to be written. File hashes are taken while the archive streams.
#[derive(Debug)]
pub struct PlannedPackage {
    title: Option<String>,
    bases: Vec<PlannedBase>,
    /// Content hash -> file below `sounds/`.
    sounds: BTreeMap<String, PathBuf>,
    schemes: Vec<PackageScheme>,
}

#[derive(Debug)]
struct PlannedBase {
    /// How this machine provides the filter. Schemes sharing it share the package entry.
    source: BaseFilter,
    id: String,
    name: String,
    origin: BaseOrigin,
    entry: String,
    /// Package path -> file on this machine.
    files: BTreeMap<String, PathBuf>,
}

impl PlannedPackage {
    /// The suggested file name of the archive.
    pub fn file_name(&self) -> String {
        match (&self.title, self.schemes.as_slice()) {
            (Some(title), _) => format!("{title} 方案包.zip"),
            (None, [only]) => format!("{} 方案包.zip", only.name),
            (None, _) => "方案包.zip".into(),
        }
    }
}

/// What importing a package would do to one scheme. Indices point into the manifest.
#[derive(Clone, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SchemeAction {
    New {
        index: usize,
        name: String,
        rules: usize,
        /// A free name to offer, when another scheme already uses this one.
        conflict: Option<String>,
    },
    Latest {
        index: usize,
        name: String,
    },
    /// Replaces the local scheme with the package's version. `blocked` when a different
    /// local scheme already uses the package's name.
    Update {
        index: usize,
        name: String,
        local_name: String,
        blocked: bool,
    },
    /// The same ID exists on the other server. Only skipping or a copy makes sense.
    Foreign {
        index: usize,
        name: String,
        local_name: String,
    },
}

fn scheme_index(action: &SchemeAction) -> usize {
    match action {
        SchemeAction::New { index, .. }
        | SchemeAction::Latest { index, .. }
        | SchemeAction::Update { index, .. }
        | SchemeAction::Foreign { index, .. } => *index,
    }
}

/// What importing a package would do to one base filter.
#[derive(Clone, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BaseAction {
    /// The registry already says how this machine provides the filter.
    Bound {
        index: usize,
        name: String,
        source: String,
        base: BaseFilter,
    },
    /// The stored copy already has this content.
    Current {
        index: usize,
        name: String,
    },
    /// The stored copy has other content.
    UpdateCopy {
        index: usize,
        name: String,
    },
    /// A local filter has the same content. Use it instead of storing a copy.
    Same {
        index: usize,
        name: String,
        source: String,
        base: BaseFilter,
    },
    /// A local filter shares the name but not the content.
    Choose {
        index: usize,
        name: String,
        source: String,
        base: BaseFilter,
    },
    Copy {
        index: usize,
        name: String,
    },
}

fn base_index(action: &BaseAction) -> usize {
    match action {
        BaseAction::Bound { index, .. }
        | BaseAction::Current { index, .. }
        | BaseAction::UpdateCopy { index, .. }
        | BaseAction::Same { index, .. }
        | BaseAction::Choose { index, .. }
        | BaseAction::Copy { index, .. } => *index,
    }
}

#[derive(Clone, Serialize)]
pub struct ImportPlan {
    pub server: Server,
    pub schemes: Vec<SchemeAction>,
    pub bases: Vec<BaseAction>,
    /// Custom sound files in the package.
    pub sounds: usize,
    /// Something needs a decision or a confirmation.
    pub review: bool,
    /// A scheme's league is missing from the server.
    pub needs_league: bool,
}

/// The user's answers in the import dialog. Indices point into the manifest.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageDecisions {
    #[serde(default)]
    pub league: Option<String>,
    /// New names, for new schemes and for copies.
    #[serde(default)]
    pub names: BTreeMap<usize, String>,
    #[serde(default)]
    pub scheme_skips: BTreeSet<usize>,
    #[serde(default)]
    pub scheme_copies: BTreeSet<usize>,
    /// Base filters whose local copy stays as it is.
    #[serde(default)]
    pub base_keeps: BTreeSet<usize>,
    /// Base filters to store from the package although a local one shares the name.
    #[serde(default)]
    pub base_copies: BTreeSet<usize>,
}

impl Store {
    /// Resolves the base filter identities, registering new ones. The caller saves `registry`.
    pub fn plan_package(
        &self,
        registry: &mut Registry,
        schemes: &[&Scheme],
        title: Option<String>,
    ) -> Result<PlannedPackage> {
        if schemes.is_empty() {
            return Err("请选择要打包的方案".into());
        }
        if schemes
            .iter()
            .any(|scheme| scheme.server() != schemes[0].server())
        {
            return Err("一个方案包里的方案需要属于同一个服务器".into());
        }
        let title = title
            .map(|title| title.trim().to_owned())
            .filter(|title| !title.is_empty());
        if let Some(title) = &title {
            scheme_name(title)?;
        }
        let library = self.load()?;
        let game = self.base_directory(&library);
        let mut bases = Vec::<PlannedBase>::new();
        let mut sounds = BTreeMap::new();
        let mut planned = Vec::with_capacity(schemes.len());
        for scheme in schemes {
            if uuid::Uuid::parse_str(&scheme.id).is_err() {
                return Err(format!("方案「{}」的 ID 无效，无法打包", scheme.name));
            }
            let descriptor: Option<BaseFilter> =
                serde_json::from_value(scheme.profile["baseFilter"].clone()).ok();
            let base = match &descriptor {
                None => None,
                Some(source) => {
                    let position = match bases.iter().position(|base| &base.source == source) {
                        Some(position) => position,
                        None => {
                            let (entry, files) = self.base_files(source, &game)?;
                            let record = registry.record_for(source);
                            let (mut id, name) = (record.id.clone(), record.name.clone());
                            if bases.iter().any(|base| base.id == id) {
                                // One identity at two versions: the later one gets its own.
                                let record = registry.register(source);
                                id = record.id.clone();
                            }
                            bases.push(PlannedBase {
                                source: source.clone(),
                                id,
                                name,
                                origin: base_filter::origin_of(source),
                                entry,
                                files,
                            });
                            bases.len() - 1
                        }
                    };
                    Some(bases[position].id.clone())
                }
            };
            let profile = Self::share_payload(scheme)?.profile;
            let mut entry_sounds = BTreeMap::new();
            for name in sound_names(&scheme.profile) {
                // Reading the sound also checks it against its recorded hash.
                self.audio(Some(scheme), &name).map_err(|_| {
                    format!(
                        "方案「{}」缺少自定义音效「{name}」，请先补齐或移除",
                        scheme.name
                    )
                })?;
                let hash = scheme.sounds[&name].clone();
                sounds
                    .entry(hash.clone())
                    .or_insert_with(|| self.root.join("sounds").join(&hash));
                entry_sounds.insert(name, hash);
            }
            planned.push(PackageScheme {
                id: scheme.id.clone(),
                name: scheme.name.clone(),
                base,
                sounds: entry_sounds,
                profile,
            });
        }
        Ok(PlannedPackage {
            title,
            bases,
            sounds,
            schemes: planned,
        })
    }

    /// Streams the package into `archive`. The caller finishes the archive.
    pub fn write_package<W: Write + Seek>(
        &self,
        planned: PlannedPackage,
        archive: &mut zip::ZipWriter<W>,
    ) -> Result<()> {
        let PlannedPackage {
            title,
            bases,
            sounds,
            schemes,
        } = planned;
        let mut entries = Vec::with_capacity(bases.len());
        for base in bases {
            let mut files = Vec::with_capacity(base.files.len());
            for (path, source) in &base.files {
                let mut file = File::open(source).map_err(|error| {
                    format!(
                        "无法读取基础过滤器「{}」的文件「{path}」：{error}",
                        base.name
                    )
                })?;
                let hash = scheme_package::copy_entry(
                    archive,
                    &format!("bases/{}/{}", base.id, path),
                    &mut file,
                )?;
                files.push(PackageFile {
                    path: path.clone(),
                    sha256: hash,
                });
            }
            entries.push(PackageBase {
                id: base.id,
                name: base.name,
                origin: base.origin,
                entry: base.entry,
                files,
            });
        }
        for (hash, source) in &sounds {
            let mut file = File::open(source).map_err(|_| "自定义音效文件已丢失，请重新上传")?;
            if scheme_package::copy_entry(archive, &format!("sounds/{hash}"), &mut file)? != *hash {
                return Err("自定义音效文件已损坏，请重新上传".into());
            }
        }
        let manifest = Manifest {
            format: scheme_package::FORMAT,
            title,
            app_version: Some(env!("CARGO_PKG_VERSION").into()),
            bases: entries,
            schemes,
        };
        scheme_package::write_entry(
            archive,
            "manifest.json",
            &serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?,
        )
    }

    /// Streams the package into a temporary file next to `path`, then moves it into place.
    pub fn write_package_file(
        &self,
        planned: PlannedPackage,
        path: &Path,
        replace: bool,
    ) -> Result<()> {
        let parent = path.parent().ok_or("无效文件路径")?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let mut file =
            tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
        let mut archive = zip::ZipWriter::new(&mut file);
        self.write_package(planned, &mut archive)?;
        archive.finish().map_err(|error| error.to_string())?;
        file.as_file()
            .sync_all()
            .map_err(|error| error.to_string())?;
        let result = if replace {
            file.persist(path)
        } else {
            file.persist_noclobber(path)
        };
        result
            .map(|_| ())
            .map_err(|error| format!("{}: {}", path.display(), error.error))
    }

    /// The entry file, imports and referenced sounds of a base filter, keyed by their path
    /// below the filter's root. The root is the version directory for downloads, the game
    /// directory for subscriptions and the entry's directory for local files.
    fn base_files(
        &self,
        base: &BaseFilter,
        game: &Path,
    ) -> Result<(String, BTreeMap<String, PathBuf>)> {
        let (baseline, imports) = self.load_baseline_parts(base)?;
        let root = fs::canonicalize(
            baseline
                .cache_root
                .as_deref()
                .or(baseline.path.parent())
                .ok_or("无法确定基础过滤器目录")?,
        )
        .map_err(|error| error.to_string())?;
        let outside = || {
            format!(
                "基础过滤器「{}」引用了所在目录之外的文件，无法打包",
                baseline.name
            )
        };
        let mut files = BTreeMap::new();
        // A local entry loses the verbatim prefix on its way into the library; the root keeps it.
        let entry = fs::canonicalize(&baseline.path)
            .ok()
            .and_then(|path| path.strip_prefix(&root).ok().map(Path::to_path_buf))
            .as_deref()
            .and_then(scheme_package::relative_path)
            .ok_or_else(outside)?;
        files.insert(entry.clone(), baseline.path.clone());
        for imported in imports {
            let path =
                scheme_package::relative_path(imported.strip_prefix(&root).map_err(|_| outside())?)
                    .ok_or_else(outside)?;
            files.insert(path, imported);
        }
        // Stored files keep their relative sound references, so read them where they are written.
        let filters: Vec<PathBuf> = files.values().cloned().collect();
        let entry_directory = baseline.path.parent().ok_or("无法确定基础过滤器目录")?;
        for filter in filters {
            let directory = filter.parent().ok_or("无法确定基础过滤器目录")?;
            let text = fs::read_to_string(&filter).map_err(|error| {
                format!("无法读取基础过滤器「{}」的文件：{error}", baseline.name)
            })?;
            for line in text.lines() {
                let Some(captures) = audio_pattern().captures(line.trim_end_matches(['\r', '\n']))
                else {
                    continue;
                };
                let optional = &captures[2] == "CustomAlertSoundOptional";
                let Some(reference) = captures.get(3).or_else(|| captures.get(4)) else {
                    continue;
                };
                for raw in reference.as_str().split(';') {
                    let reference = Path::new(raw);
                    if raw.eq_ignore_ascii_case("None") || !base_filter::audio_name(reference) {
                        continue;
                    }
                    if reference.is_absolute() {
                        return Err(format!(
                            "基础过滤器「{}」引用了本机绝对路径的音效，无法打包",
                            baseline.name
                        ));
                    }
                    // The same order `base_audio` tries: next to the file that names the sound,
                    // then next to the entry, then from the game directory.
                    let mut candidates = Vec::new();
                    if directory != entry_directory {
                        candidates.push(directory.join(reference));
                    }
                    candidates.push(entry_directory.join(reference));
                    if let Some(root) = &baseline.game_root {
                        candidates.push(root.join(reference));
                    } else if baseline.cache_root.is_none() {
                        candidates.push(game.join(reference));
                    }
                    let Some(source) = candidates
                        .into_iter()
                        .find(|candidate| candidate.is_file())
                        .and_then(|candidate| candidate.canonicalize().ok())
                    else {
                        if optional {
                            continue;
                        }
                        return Err(format!(
                            "缺少基础过滤器「{}」引用的音效「{raw}」",
                            baseline.name
                        ));
                    };
                    // A sound from the game directory keeps its written path: the copy's root
                    // answers it after the import.
                    let path = source
                        .strip_prefix(&root)
                        .ok()
                        .and_then(scheme_package::relative_path)
                        .or_else(|| scheme_package::relative_path(Path::new(raw)))
                        .ok_or_else(outside)?;
                    if files
                        .insert(path.clone(), source.clone())
                        .is_some_and(|previous| previous != source)
                    {
                        return Err(format!(
                            "基础过滤器「{}」的音效路径「{path}」冲突，无法打包",
                            baseline.name
                        ));
                    }
                }
            }
        }
        Ok((entry, files))
    }

    /// Reads and verifies a package. Pass it to `plan_import` once the server's leagues are known.
    pub fn open_package(&self, path: &Path) -> Result<Package> {
        let mut package = Package::open(path)?;
        package.verify()?;
        Ok(package)
    }

    /// What importing an opened package would do.
    pub fn plan_import(
        &self,
        package: &Package,
        library: &Library,
        registry: &Registry,
        leagues: &[String],
    ) -> Result<ImportPlan> {
        self.plan(&package.manifest, library, registry, leagues)
    }

    fn plan(
        &self,
        manifest: &Manifest,
        library: &Library,
        registry: &Registry,
        leagues: &[String],
    ) -> Result<ImportPlan> {
        let server = Server::from_profile(&manifest.schemes[0].profile);
        let game = self.base_directory(library);
        let mut local = base_filter::scan(&game).unwrap_or_default();
        local.extend(base_filter::all_cached(&self.root));
        local.extend(registry.imported(&self.root));
        // Entry file hashes of local filters, and base digests of local schemes.
        let mut known: Vec<(BaseFilter, Option<String>)> = Vec::new();
        let mut bases = Vec::with_capacity(manifest.bases.len());
        for (index, base) in manifest.bases.iter().enumerate() {
            let digest = base.digest();
            let stored = self.root.join("base-filters").join(IMPORTED).join(&base.id);
            // A record whose source or copy is gone counts as no record.
            let action = match registry.get(&base.id).map(|record| &record.base) {
                Some(BaseFilter::Imported { .. }) if stored.is_dir() => {
                    let name = registry.get(&base.id).unwrap().name.clone();
                    if registry.get(&base.id).unwrap().content.as_deref() == Some(digest.as_str()) {
                        BaseAction::Current { index, name }
                    } else {
                        BaseAction::UpdateCopy { index, name }
                    }
                }
                Some(source) if source.load(&self.root).is_ok() => BaseAction::Bound {
                    index,
                    name: registry.get(&base.id).unwrap().name.clone(),
                    source: base_filter::source_label(source),
                    base: source.clone(),
                },
                _ => self.match_base(index, base, &local, &mut known)?,
            };
            bases.push(action);
        }
        let digests: BTreeMap<&str, String> = manifest
            .bases
            .iter()
            .map(|base| (base.id.as_str(), base.digest()))
            .collect();
        let missing =
            |league: &str| !league.is_empty() && !leagues.iter().any(|known| known == league);
        let mut schemes = Vec::with_capacity(manifest.schemes.len());
        let mut taken: BTreeSet<String> = library
            .schemes
            .iter()
            .filter(|scheme| scheme.server() == server)
            .map(|scheme| scheme.name.to_lowercase())
            .collect();
        let mut needs_league = false;
        for (index, entry) in manifest.schemes.iter().enumerate() {
            let profile: Value = engine::call("validate", entry.profile.clone())?;
            let league = profile["league"].as_str().unwrap_or_default();
            let action = match library.schemes.iter().find(|scheme| scheme.id == entry.id) {
                None => {
                    let conflict = !taken.insert(entry.name.to_lowercase());
                    let suggestion = conflict.then(|| {
                        let name = self.free_name(library, server, &entry.name, &taken);
                        taken.insert(name.to_lowercase());
                        name
                    });
                    SchemeAction::New {
                        index,
                        name: entry.name.clone(),
                        rules: profile["rules"].as_array().map(Vec::len).unwrap_or(0),
                        conflict: suggestion,
                    }
                }
                Some(current) if current.server() != server => SchemeAction::Foreign {
                    index,
                    name: entry.name.clone(),
                    local_name: current.name.clone(),
                },
                Some(current) => {
                    // A scheme without filter content carries only a name, so there is nothing to compare.
                    let local = self.scheme_digest(current, &game)?;
                    let package = entry.base.as_ref().and_then(|id| digests.get(id.as_str()));
                    let same_base = entry.base.is_none() || local == package.cloned();
                    // The base filter is compared by content: locally it is a source, in the package a name.
                    let current_profile =
                        without_base(engine::call("validate", current.profile.clone())?);
                    if current.name == entry.name
                        && current_profile == without_base(profile.clone())
                        && current.sounds == entry.sounds
                        && same_base
                    {
                        SchemeAction::Latest {
                            index,
                            name: entry.name.clone(),
                        }
                    } else {
                        let blocked = self
                            .check_unique(library, server, &entry.name, Some(&entry.id))
                            .is_err();
                        needs_league |= missing(league);
                        SchemeAction::Update {
                            index,
                            name: entry.name.clone(),
                            local_name: current.name.clone(),
                            blocked,
                        }
                    }
                }
            };
            if matches!(
                action,
                SchemeAction::New { .. } | SchemeAction::Foreign { .. }
            ) {
                needs_league |= missing(league);
            }
            schemes.push(action);
        }
        let review = needs_league
            || schemes.iter().any(|action| match action {
                SchemeAction::New { conflict, .. } => conflict.is_some(),
                SchemeAction::Latest { .. } => false,
                SchemeAction::Update { .. } | SchemeAction::Foreign { .. } => true,
            })
            || bases.iter().any(|action| {
                matches!(
                    action,
                    BaseAction::UpdateCopy { .. } | BaseAction::Choose { .. }
                )
            });
        Ok(ImportPlan {
            server,
            schemes,
            bases,
            sounds: manifest
                .schemes
                .iter()
                .flat_map(|scheme| scheme.sounds.values())
                .collect::<BTreeSet<_>>()
                .len(),
            review,
            needs_league,
        })
    }

    /// How to provide a base filter the registry does not know: a local filter with the same
    /// content, one with the same name, or a new copy.
    fn match_base(
        &self,
        index: usize,
        base: &PackageBase,
        local: &[BaseFilter],
        known: &mut Vec<(BaseFilter, Option<String>)>,
    ) -> Result<BaseAction> {
        let rank = |base: &BaseFilter| match base {
            BaseFilter::Subscribed { .. } => 0,
            BaseFilter::Downloaded { .. } => 1,
            BaseFilter::Imported { .. } => 2,
            BaseFilter::Local { .. } => 3,
        };
        let entry_hash = base.entry_hash().unwrap_or_default();
        let mut same = Vec::new();
        for candidate in local {
            if self.entry_hash(candidate, known)?.as_deref() == Some(entry_hash) {
                same.push(candidate);
            }
        }
        if let Some(candidate) = same.into_iter().min_by_key(|candidate| rank(candidate)) {
            return Ok(BaseAction::Same {
                index,
                name: base.name.clone(),
                source: base_filter::source_label(candidate),
                base: candidate.clone(),
            });
        }
        // Download caches list the newest version first; any other source has to be unambiguous.
        let name = base.name.to_lowercase();
        let mut named: Vec<&BaseFilter> = local
            .iter()
            .filter(|candidate| {
                !matches!(candidate, BaseFilter::Local { .. })
                    && candidate.name().to_lowercase() == name
            })
            .collect();
        named.sort_by_key(|candidate| rank(candidate));
        let chosen = match named.first() {
            None => None,
            Some(first) if rank(first) == 1 => Some(*first),
            Some(first)
                if named
                    .iter()
                    .filter(|other| rank(other) == rank(first))
                    .count()
                    == 1 =>
            {
                Some(*first)
            }
            Some(_) => None,
        };
        Ok(match chosen {
            Some(candidate) => BaseAction::Choose {
                index,
                name: base.name.clone(),
                source: base_filter::source_label(candidate),
                base: candidate.clone(),
            },
            None => BaseAction::Copy {
                index,
                name: base.name.clone(),
            },
        })
    }

    /// The hash of a filter's entry file, or `None` when it cannot be read.
    fn entry_hash(
        &self,
        base: &BaseFilter,
        known: &mut Vec<(BaseFilter, Option<String>)>,
    ) -> Result<Option<String>> {
        if let Some((_, hash)) = known.iter().find(|(seen, _)| seen == base) {
            return Ok(hash.clone());
        }
        let hash = base
            .load(&self.root)
            .ok()
            .and_then(|baseline| {
                base_filter::read_limited(&baseline.path, base_filter::MAX_FILTER).ok()
            })
            .map(|bytes| digest(&bytes));
        known.push((base.clone(), hash.clone()));
        Ok(hash)
    }

    /// Content digest of the base filter a local scheme uses. `None` when it has none or
    /// its files cannot be read.
    fn scheme_digest(&self, scheme: &Scheme, game: &Path) -> Result<Option<String>> {
        let Ok(base) = serde_json::from_value::<BaseFilter>(scheme.profile["baseFilter"].clone())
        else {
            return Ok(None);
        };
        let Ok((_, files)) = self.base_files(&base, game) else {
            return Ok(None);
        };
        let hashes: Vec<(String, String)> = files
            .iter()
            .filter_map(|(path, source)| {
                let bytes = base_filter::read_limited(source, AUDIO_MAX).ok()?;
                Some((path.clone(), digest(&bytes)))
            })
            .collect();
        Ok((hashes.len() == files.len()).then(|| {
            scheme_package::files_digest(
                hashes
                    .iter()
                    .map(|(path, hash)| (path.as_str(), hash.as_str())),
            )
        }))
    }

    /// `name` itself when nothing on the server uses it yet.
    fn import_name(
        &self,
        library: &Library,
        server: Server,
        name: &str,
        taken: &BTreeSet<String>,
    ) -> String {
        let free = !taken.contains(&name.to_lowercase())
            && self.check_unique(library, server, name, None).is_ok();
        if free {
            name.to_owned()
        } else {
            self.free_name(library, server, name, taken)
        }
    }

    /// The first free name around `name`, in the form the duplicate action uses. `taken`
    /// holds names earlier schemes of the same package will occupy.
    fn free_name(
        &self,
        library: &Library,
        server: Server,
        name: &str,
        taken: &BTreeSet<String>,
    ) -> String {
        let base: String = name.chars().take(30).collect();
        let free = |candidate: &str| {
            !taken.contains(&candidate.to_lowercase())
                && self.check_unique(library, server, candidate, None).is_ok()
        };
        (1..)
            .map(|number| {
                if number == 1 {
                    format!("{base} 副本")
                } else {
                    format!("{base} 副本 {number}")
                }
            })
            .find(|candidate| free(candidate))
            .unwrap_or_else(|| format!("{base} 副本"))
    }

    /// Applies the decisions to an opened package, working the plan out again so that
    /// nothing rests on what the dialog was told. The caller writes `library` and `registry`.
    pub fn import_package(
        &self,
        library: &mut Library,
        registry: &mut Registry,
        package: &mut Package,
        decisions: &PackageDecisions,
        leagues: &[String],
    ) -> Result<Vec<String>> {
        if decisions
            .league
            .as_ref()
            .is_some_and(|league| !leagues.contains(league))
        {
            return Err("请选择目标服务器上的赛季".into());
        }
        package.new_pass();
        let plan = self.plan(&package.manifest, library, registry, leagues)?;
        self.apply_package(library, registry, package, &plan, decisions, leagues)
    }

    fn apply_package(
        &self,
        library: &mut Library,
        registry: &mut Registry,
        package: &mut Package,
        plan: &ImportPlan,
        decisions: &PackageDecisions,
        leagues: &[String],
    ) -> Result<Vec<String>> {
        // Bases first: schemes need to know how theirs are provided.
        let mut provided = Vec::with_capacity(plan.bases.len());
        for action in &plan.bases {
            let index = base_index(action);
            let base = &package.manifest.bases[index];
            let (id, name, entry, origin) = (
                base.id.clone(),
                base.name.clone(),
                base.entry.clone(),
                base.origin.clone(),
            );
            let digest = base.digest();
            let stored = || BaseFilter::Imported {
                id: id.clone(),
                entry: entry.clone(),
                name: name.clone(),
            };
            let record = |base: BaseFilter, content: Option<String>| BaseRecord {
                id: id.clone(),
                name: name.clone(),
                base,
                origin: Some(origin.clone()),
                content,
                registered_at: base_filter::unix_now(),
            };
            let base = match action {
                BaseAction::Bound { base, .. } => base.clone(),
                BaseAction::Current { .. } => registry
                    .get(&id)
                    .map(|record| record.base.clone())
                    .unwrap_or_else(&stored),
                BaseAction::UpdateCopy { .. } if decisions.base_keeps.contains(&index) => registry
                    .get(&id)
                    .map(|record| record.base.clone())
                    .unwrap_or_else(&stored),
                BaseAction::Same { base, .. } => {
                    registry.insert(record(base.clone(), None));
                    base.clone()
                }
                BaseAction::Choose { base, .. } if !decisions.base_copies.contains(&index) => {
                    registry.insert(record(base.clone(), None));
                    base.clone()
                }
                BaseAction::UpdateCopy { .. }
                | BaseAction::Choose { .. }
                | BaseAction::Copy { .. } => {
                    self.store_copy(&id, |directory| package.extract(index, directory))?;
                    registry.insert(record(stored(), Some(digest)));
                    stored()
                }
            };
            provided.push(base);
        }
        let league = decisions.league.as_deref();
        let mut ids = Vec::new();
        let mut taken: BTreeSet<String> = library
            .schemes
            .iter()
            .filter(|scheme| scheme.server() == plan.server)
            .map(|scheme| scheme.name.to_lowercase())
            .collect();
        for action in &plan.schemes {
            let index = scheme_index(action);
            if matches!(action, SchemeAction::Latest { .. }) {
                continue;
            }
            let copy = decisions.scheme_copies.contains(&index);
            match action {
                SchemeAction::Update { .. } | SchemeAction::Foreign { .. } if !copy => {
                    if matches!(action, SchemeAction::Update { blocked: false, .. })
                        && !decisions.scheme_skips.contains(&index)
                    {
                        self.apply_update(library, package, index, &provided, league, leagues)?;
                        ids.push(package.manifest.schemes[index].id.clone());
                    }
                    continue;
                }
                _ => {}
            }
            let (id, default, with_content) = {
                let entry = &package.manifest.schemes[index];
                let default = self.import_name(library, plan.server, &entry.name, &taken);
                match action {
                    SchemeAction::New { .. } => (entry.id.clone(), default, entry.base.is_some()),
                    _ => (
                        Uuid::new_v4().to_string(),
                        self.free_name(library, plan.server, &entry.name, &taken),
                        entry.base.is_some(),
                    ),
                }
            };
            let name = decisions.names.get(&index).unwrap_or(&default);
            let mut profile = package_profile(package, index, &provided, league, leagues)?;
            if !with_content {
                self.bind_hint(library, &mut profile);
            }
            let sounds = package.sounds(index)?;
            let scheme = self.prepare_scheme(library, id, name, profile, sounds)?;
            taken.insert(scheme.name.to_lowercase());
            ids.push(scheme.id.clone());
            library.schemes.push(scheme);
        }
        Ok(ids)
    }

    /// Replaces the content of a local scheme with the package's version. The ID, the
    /// automatic refresh setting and the installation stay.
    #[allow(clippy::too_many_arguments)]
    fn apply_update(
        &self,
        library: &mut Library,
        package: &mut Package,
        index: usize,
        provided: &[BaseFilter],
        league: Option<&str>,
        leagues: &[String],
    ) -> Result<()> {
        let (id, name, with_content) = {
            let entry = &package.manifest.schemes[index];
            (entry.id.clone(), entry.name.clone(), entry.base.is_some())
        };
        let mut profile = package_profile(package, index, provided, league, leagues)?;
        if !with_content {
            self.bind_hint(library, &mut profile);
        }
        let sounds = package.sounds(index)?;
        let mut updated = Store::get(library, &id)?.clone();
        updated.profile = profile;
        self.store_sound_bytes(&mut updated, sounds)?;
        self.check_unique(library, updated.server(), &name, Some(&id))?;
        // Renaming moves the installed filter too. It is the only step that may write early.
        self.rename(library, &id, &name)?;
        let scheme = Store::get_mut(library, &id)?;
        scheme.profile = updated.profile;
        scheme.sounds = updated.sounds;
        if scheme.installed.is_some() {
            scheme.status = "方案已更新，请重新生成".into();
        }
        Ok(())
    }

    /// Gives a scheme that carries only a base filter's name the one filter on this machine
    /// that has it, when there is exactly one.
    fn bind_hint(&self, library: &Library, profile: &mut Value) {
        let Some(hint) = profile["baseFilterHint"].as_str().map(str::to_owned) else {
            return;
        };
        if let Some(base) = self.resolve_hint(library, &hint) {
            profile["baseFilter"] = json!(base);
            if let Some(fields) = profile.as_object_mut() {
                fields.remove("baseFilterHint");
            }
        }
    }

    /// Replaces the stored copy `id` with what `extract` writes, in one step.
    fn store_copy(&self, id: &str, extract: impl FnOnce(&Path) -> Result<()>) -> Result<()> {
        let parent = self.root.join("base-filters");
        let copies = parent.join(IMPORTED);
        fs::create_dir_all(&copies).map_err(|error| error.to_string())?;
        let staging = tempfile::tempdir_in(&parent).map_err(|error| error.to_string())?;
        extract(staging.path())?;
        let target = copies.join(id);
        let previous = if target.exists() {
            let moved = parent.join(format!(".replaced-{}", Uuid::new_v4()));
            fs::rename(&target, &moved)
                .map_err(|error| format!("无法替换已导入的基础过滤器：{error}"))?;
            Some(moved)
        } else {
            None
        };
        if let Err(error) = fs::rename(staging.path(), &target) {
            if let Some(moved) = &previous {
                let _ = fs::rename(moved, &target);
            }
            return Err(format!("无法写入已导入的基础过滤器：{error}"));
        }
        if let Some(moved) = previous {
            let _ = fs::remove_dir_all(moved);
        }
        Ok(())
    }
}

/// The scheme settings without the base filter reference.
fn without_base(mut profile: Value) -> Value {
    if let Some(fields) = profile.as_object_mut() {
        fields.remove("baseFilter");
        fields.remove("baseFilterHint");
    }
    profile
}

/// The profile of a package scheme as it will be stored: validated, bound to the base filter
/// the import chose and moved to the chosen league when its own is missing.
fn package_profile(
    package: &Package,
    index: usize,
    provided: &[BaseFilter],
    league: Option<&str>,
    leagues: &[String],
) -> Result<Value> {
    let entry = &package.manifest.schemes[index];
    let mut profile: Value = engine::call("validate", entry.profile.clone())?;
    let current = profile["league"].as_str().unwrap_or_default();
    let moved = !current.is_empty() && !leagues.iter().any(|known| known == current);
    let Some(fields) = profile.as_object_mut() else {
        return Err("方案包里的方案格式无效".into());
    };
    // A package may name a base filter but never a path on this machine.
    fields.remove("baseFilter");
    if let Some(id) = &entry.base {
        let position = package
            .manifest
            .bases
            .iter()
            .position(|base| &base.id == id)
            .ok_or("方案包里的方案引用了不存在的基础过滤器")?;
        fields.insert("baseFilter".into(), json!(provided[position]));
        fields.remove("baseFilterHint");
    }
    if moved {
        fields.insert(
            "league".into(),
            json!(league.ok_or("请选择目标服务器上的赛季")?),
        );
    }
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base_filter::SubscriptionSource;
    use serde_json::json;

    const PING: &[u8] = b"fixture audio";

    fn leagues() -> Vec<String> {
        vec!["Standard".into()]
    }

    fn ping() -> BTreeMap<String, String> {
        BTreeMap::from([(
            "ping.ogg".into(),
            base64::engine::general_purpose::STANDARD.encode(PING),
        )])
    }

    fn profile(base: Option<&BaseFilter>, rules: Value) -> Value {
        let mut profile = json!({
            "schemaVersion": 3, "server": "international", "league": "Standard",
            "originalLeague": "Standard", "locale": "cn", "rules": rules, "skippedItemIds": []
        });
        if let Some(base) = base {
            profile["baseFilter"] = json!(base);
        }
        profile
    }

    fn rule(id: &str, font: u32) -> Value {
        json!({"id": id, "name": "显示", "enabled": true, "hidden": false,
            "target": {"itemIds": ["divine-orb"]}, "effects": {"font": {"fontSize": font}}})
    }

    fn sounding(id: &str, font: u32) -> Value {
        let mut rule = rule(id, font);
        rule["effects"]["sound"] = json!({"type": "custom", "fileName": "ping.ogg"});
        rule
    }

    /// One installation: its own data directory, game directory, library and registry.
    struct World {
        temp: tempfile::TempDir,
        store: Store,
        library: Library,
        registry: Registry,
        game: PathBuf,
    }

    impl World {
        fn new() -> Self {
            let temp = tempfile::tempdir().unwrap();
            let game = temp.path().join("game");
            let store = Store::new(temp.path().join("local"), game.clone());
            let mut library = store.load().unwrap();
            library.settings.filter_directory = Some(game.clone());
            Self {
                temp,
                store,
                library,
                registry: Registry::default(),
                game,
            }
        }

        /// Writes an international subscription the game would have cached.
        fn subscription(&self, body: &str) -> BaseFilter {
            let directory = self.game.join("OnlineFilters");
            fs::create_dir_all(&directory).unwrap();
            fs::write(
                directory.join("AbCd1234"),
                format!("#Online Item Filter\n#name:Subscribed Example\n{body}"),
            )
            .unwrap();
            base_filter::scan(&self.game)
                .unwrap()
                .into_iter()
                .find(|base| matches!(base, BaseFilter::Subscribed { .. }))
                .unwrap()
        }

        fn add(&mut self, name: &str, profile: Value, sounds: BTreeMap<String, String>) -> String {
            let id = self
                .store
                .add(&mut self.library, name, profile, sounds)
                .unwrap();
            self.store.persist(&self.library).unwrap();
            id
        }

        fn export(&mut self, names: &[&str], title: Option<&str>) -> PathBuf {
            let schemes: Vec<&Scheme> = names
                .iter()
                .map(|name| {
                    self.library
                        .schemes
                        .iter()
                        .find(|scheme| scheme.name == *name)
                        .unwrap()
                })
                .collect();
            let planned = self
                .store
                .plan_package(&mut self.registry, &schemes, title.map(str::to_owned))
                .unwrap();
            self.store.save_registry(&self.registry).unwrap();
            let path = self.temp.path().join(format!("{}.zip", names.join("-")));
            self.store.write_package_file(planned, &path, true).unwrap();
            path
        }

        fn plan(&self, path: &Path) -> ImportPlan {
            let package = self.store.open_package(path).unwrap();
            self.store
                .plan_import(&package, &self.library, &self.registry, &leagues())
                .unwrap()
        }

        fn apply(&mut self, path: &Path, decisions: PackageDecisions) -> Vec<String> {
            let mut package = self.store.open_package(path).unwrap();
            let ids = self
                .store
                .import_package(
                    &mut self.library,
                    &mut self.registry,
                    &mut package,
                    &decisions,
                    &leagues(),
                )
                .unwrap();
            self.store.save_registry(&self.registry).unwrap();
            self.store.persist(&self.library).unwrap();
            ids
        }

        fn scheme(&self, id: &str) -> &Scheme {
            Store::get(&self.library, id).unwrap()
        }

        fn named(&self, name: &str) -> Option<&Scheme> {
            self.library
                .schemes
                .iter()
                .find(|scheme| scheme.name == name)
        }

        fn copy_of(&self, id: &str) -> PathBuf {
            self.store
                .root
                .join("base-filters")
                .join(IMPORTED)
                .join(id)
                .join("OnlineFilters")
                .join("AbCd1234")
        }
    }

    fn manifest(path: &Path) -> Manifest {
        Package::open(path).unwrap().manifest
    }

    #[test]
    fn export_registers_filters_once_and_import_adopts_their_ids() {
        let mut sender = World::new();
        let subscribed = sender.subscription("Show\n\tSetFontSize 31\n");
        sender.add(
            "开荒",
            profile(Some(&subscribed), json!([rule("league-start", 36)])),
            BTreeMap::new(),
        );
        sender.add(
            "终局",
            profile(Some(&subscribed), json!([sounding("endgame", 40)])),
            ping(),
        );
        let path = sender.export(&["开荒", "终局"], Some("开荒到终局"));

        let package = manifest(&path);
        assert_eq!(package.title.as_deref(), Some("开荒到终局"));
        let [base] = package.bases.as_slice() else {
            panic!("one filter serves both schemes")
        };
        assert!(base_filter::valid_base_id(&base.id));
        assert_eq!(
            (base.name.as_str(), base.entry.as_str()),
            ("Subscribed Example", "OnlineFilters/AbCd1234")
        );
        assert!(matches!(
            base.origin,
            BaseOrigin::Subscribed {
                source: SubscriptionSource::Online
            }
        ));
        let shared = [Some(base.id.as_str()); 2];
        assert_eq!(
            package
                .schemes
                .iter()
                .map(|scheme| scheme.base.as_deref())
                .collect::<Vec<_>>(),
            shared
        );
        // Rule IDs survive, and the filter travels as a name plus the shared entry.
        assert_eq!(package.schemes[0].profile["rules"][0]["id"], "league-start");
        assert!(package.schemes[0].profile["baseFilter"].is_null());
        assert_eq!(
            package.schemes[0].profile["baseFilterHint"],
            "Subscribed Example"
        );
        assert_eq!(package.schemes[1].sounds["ping.ogg"], digest(PING));
        assert_eq!(sender.registry.filters.len(), 1);
        assert_eq!(sender.registry.filters[0].id, base.id);
        // A second export keeps the identity.
        let again = sender.export(&["开荒", "终局"], None);
        assert_eq!(manifest(&again).bases[0].id, base.id);

        let mut receiver = World::new();
        let plan = receiver.plan(&path);
        assert!(!plan.review);
        assert!(matches!(
            plan.schemes.as_slice(),
            [SchemeAction::New { .. }, SchemeAction::New { .. }]
        ));
        assert!(matches!(plan.bases.as_slice(), [BaseAction::Copy { .. }]));
        let ids = receiver.apply(&path, PackageDecisions::default());
        let imported = receiver.scheme(&ids[1]);
        assert_eq!(imported.name, "终局");
        assert_eq!(imported.profile["rules"][0]["id"], "endgame");
        assert_eq!(imported.profile["baseFilter"]["kind"], "imported");
        assert_eq!(imported.profile["baseFilter"]["id"], base.id);
        assert!(receiver.scheme(&ids[0]).profile["baseFilter"].is_object());
        let [record] = receiver.registry.filters.as_slice() else {
            panic!("the copy is registered")
        };
        assert_eq!(
            (record.id.as_str(), record.name.as_str()),
            (base.id.as_str(), "Subscribed Example")
        );
        assert_eq!(record.content.as_deref(), Some(base.digest().as_str()));
        assert!(receiver.copy_of(&base.id).is_file());
        assert!(receiver.store.missing(imported).is_empty());
        let (text, sounds) = receiver.store.prepare_filter(imported, None).unwrap();
        assert!(text.contains("SetFontSize 40"));
        assert_eq!(sounds.len(), 1);
        // The picker lists the copy under the name it was shared with.
        let listed: Vec<BaseFilter> = receiver
            .store
            .stored_filters()
            .unwrap()
            .into_iter()
            .map(|(base, _)| base)
            .collect();
        assert!(matches!(
            listed.as_slice(),
            [BaseFilter::Imported { name, .. }] if name == "Subscribed Example"
        ));

        // Importing the same package again changes nothing and asks nothing.
        let library = serde_json::to_vec(&receiver.library).unwrap();
        let registry = serde_json::to_vec(&receiver.registry).unwrap();
        let plan = receiver.plan(&path);
        assert!(!plan.review);
        assert!(plan
            .schemes
            .iter()
            .all(|action| matches!(action, SchemeAction::Latest { .. })));
        assert!(matches!(
            plan.bases.as_slice(),
            [BaseAction::Current { .. }]
        ));
        assert!(receiver
            .apply(&path, PackageDecisions::default())
            .is_empty());
        assert_eq!(serde_json::to_vec(&receiver.library).unwrap(), library);
        assert_eq!(serde_json::to_vec(&receiver.registry).unwrap(), registry);
    }

    /// An author with one published scheme, and the package of its first version.
    fn published() -> (World, PathBuf, String) {
        let mut sender = World::new();
        let subscribed = sender.subscription("Show\n\tSetFontSize 31\n");
        let id = sender.add(
            "终局",
            profile(Some(&subscribed), json!([rule("endgame", 40)])),
            BTreeMap::new(),
        );
        let path = sender.export(&["终局"], None);
        (sender, path, id)
    }

    /// The author renames the scheme, changes a rule and the subscription moves on.
    fn revised(sender: &mut World, id: &str) -> PathBuf {
        let subscribed = sender.subscription("Show\n\tSetFontSize 32\n");
        let scheme = Store::get_mut(&mut sender.library, id).unwrap();
        scheme.name = "终局打法".into();
        scheme.profile["baseFilter"] = json!(subscribed);
        scheme.profile["rules"][0]["effects"]["font"]["fontSize"] = json!(45);
        sender.export(&["终局打法"], None)
    }

    /// A receiver that imported the first version, installed it and switched automatic refresh off.
    fn subscriber(path: &Path) -> (World, String, PathBuf) {
        let mut receiver = World::new();
        let imported = receiver.apply(path, PackageDecisions::default())[0].clone();
        let scheme = Store::get_mut(&mut receiver.library, &imported).unwrap();
        scheme.auto_refresh = false;
        receiver.store.install(scheme, None, None).unwrap();
        receiver.store.persist(&receiver.library).unwrap();
        let installed = receiver.game.join("终局.filter");
        assert!(installed.is_file());
        (receiver, imported, installed)
    }

    #[test]
    fn an_updated_package_replaces_schemes_and_copies_by_id() {
        let (mut sender, first, id) = published();
        let (mut receiver, imported, installed) = subscriber(&first);
        assert_eq!(imported, id);
        let second = revised(&mut sender, &id);
        let identity = sender.registry.filters[0].id.clone();

        let plan = receiver.plan(&second);
        assert!(plan.review);
        let SchemeAction::Update {
            name,
            local_name,
            blocked,
            ..
        } = &plan.schemes[0]
        else {
            panic!("the same ID means an update")
        };
        assert_eq!(
            (name.as_str(), local_name.as_str(), *blocked),
            ("终局打法", "终局", false)
        );
        assert!(matches!(
            plan.bases.as_slice(),
            [BaseAction::UpdateCopy { .. }]
        ));

        let ids = receiver.apply(&second, PackageDecisions::default());
        assert_eq!(ids, [imported.clone()]);
        let scheme = receiver.scheme(&imported);
        assert_eq!(scheme.name, "终局打法");
        assert_eq!(
            scheme.profile["rules"][0]["effects"]["font"]["fontSize"],
            45
        );
        assert!(!scheme.auto_refresh);
        assert_eq!(scheme.status, "方案已更新，请重新生成");
        assert_eq!(
            scheme
                .installed
                .as_ref()
                .map(|installed| installed.name.as_str()),
            Some("终局打法.filter")
        );
        assert!(!installed.exists());
        assert!(receiver.game.join("终局打法.filter").is_file());
        let content = manifest(&second).bases[0].digest();
        assert_eq!(
            receiver.registry.filters[0].content.as_deref(),
            Some(content.as_str())
        );
        assert!(fs::read_to_string(receiver.copy_of(&identity))
            .unwrap()
            .contains("SetFontSize 32"));
    }

    #[test]
    fn update_decisions_skip_copy_or_keep_the_local_filter() {
        let (mut sender, first, id) = published();
        let second = revised(&mut sender, &id);
        let identity = sender.registry.filters[0].id.clone();
        let content = manifest(&second).bases[0].digest();

        // Skipping keeps the scheme as it is.
        let (mut receiver, imported, _) = subscriber(&first);
        let before = serde_json::to_vec(&receiver.scheme(&imported).profile).unwrap();
        let mut decisions = PackageDecisions::default();
        decisions.scheme_skips.insert(0);
        assert!(receiver.apply(&second, decisions).is_empty());
        assert_eq!(receiver.scheme(&imported).name, "终局");
        assert_eq!(
            serde_json::to_vec(&receiver.scheme(&imported).profile).unwrap(),
            before
        );
        assert_eq!(receiver.library.schemes.len(), 1);

        // A copy keeps the local scheme and adds the package's version next to it.
        let (mut receiver, imported, _) = subscriber(&first);
        let mut decisions = PackageDecisions::default();
        decisions.scheme_copies.insert(0);
        decisions.names.insert(0, "终局（作者新版）".into());
        let ids = receiver.apply(&second, decisions);
        assert_eq!(ids.len(), 1);
        assert_ne!(ids[0], imported);
        assert_eq!(receiver.scheme(&ids[0]).name, "终局（作者新版）");
        assert_eq!(receiver.scheme(&imported).name, "终局");
        assert_eq!(receiver.library.schemes.len(), 2);

        // Keeping the local copy leaves its files alone.
        let (mut receiver, _, _) = subscriber(&first);
        let mut decisions = PackageDecisions::default();
        decisions.base_keeps.insert(0);
        receiver.apply(&second, decisions);
        assert_ne!(
            receiver.registry.filters[0].content.as_deref(),
            Some(content.as_str())
        );
        assert!(fs::read_to_string(receiver.copy_of(&identity))
            .unwrap()
            .contains("SetFontSize 31"));
    }

    #[test]
    fn an_update_yields_to_an_existing_name_or_another_server() {
        let (mut sender, first, id) = published();
        let second = revised(&mut sender, &id);

        // Another local scheme already is called what the package renames this one to.
        let (mut receiver, imported, _) = subscriber(&first);
        let own = receiver.add("终局打法", profile(None, json!([])), BTreeMap::new());
        let plan = receiver.plan(&second);
        assert!(matches!(
            &plan.schemes[0],
            SchemeAction::Update { blocked: true, .. }
        ));
        assert!(receiver
            .apply(&second, PackageDecisions::default())
            .is_empty());
        assert_eq!(receiver.scheme(&imported).name, "终局");
        assert_eq!(receiver.named("终局打法").unwrap().id, own);
        let mut decisions = PackageDecisions::default();
        decisions.scheme_copies.insert(0);
        let copy = receiver.apply(&second, decisions)[0].clone();
        assert_eq!(receiver.scheme(&copy).name, "终局打法 副本");

        // The same ID on the other server is a different scheme to this receiver.
        let (mut receiver, imported, _) = subscriber(&first);
        Store::get_mut(&mut receiver.library, &imported)
            .unwrap()
            .profile["server"] = json!("tencent");
        receiver.store.persist(&receiver.library).unwrap();
        let plan = receiver.plan(&second);
        assert!(matches!(&plan.schemes[0], SchemeAction::Foreign { .. }));
        assert!(receiver
            .apply(&second, PackageDecisions::default())
            .is_empty());
        assert_eq!(receiver.scheme(&imported).name, "终局");
        let mut decisions = PackageDecisions::default();
        decisions.scheme_copies.insert(0);
        let copy = receiver.apply(&second, decisions)[0].clone();
        assert_eq!(receiver.scheme(&copy).name, "终局打法 副本");
        assert_eq!(receiver.scheme(&copy).server(), Server::International);
        assert_eq!(receiver.scheme(&imported).server(), Server::Tencent);
    }

    #[test]
    fn a_local_filter_with_the_same_content_is_used_without_a_copy() {
        let (_sender, first, _) = published();
        let mut receiver = World::new();
        let subscribed = receiver.subscription("Show\n\tSetFontSize 31\n");
        let plan = receiver.plan(&first);
        assert!(!plan.review);
        assert!(matches!(
            &plan.bases[0],
            BaseAction::Same { base, .. } if *base == subscribed
        ));
        let ids = receiver.apply(&first, PackageDecisions::default());
        assert_eq!(
            receiver.scheme(&ids[0]).profile["baseFilter"],
            json!(subscribed)
        );
        assert!(!receiver.copy_of(&manifest(&first).bases[0].id).exists());
        assert_eq!(receiver.registry.filters[0].base, subscribed);
    }

    #[test]
    fn a_same_named_local_filter_is_chosen_once() {
        let (mut sender, first, id) = published();
        let mut receiver = World::new();
        // The receiver's own subscription is at another version.
        let subscribed = receiver.subscription("Show\n\tSetFontSize 30\n");
        let plan = receiver.plan(&first);
        assert!(plan.review);
        assert!(matches!(
            &plan.bases[0],
            BaseAction::Choose { source, base, .. }
                if source == "国际服订阅" && *base == subscribed
        ));
        let imported = receiver.apply(&first, PackageDecisions::default())[0].clone();
        assert_eq!(
            receiver.scheme(&imported).profile["baseFilter"],
            json!(subscribed)
        );
        assert_eq!(receiver.registry.filters[0].base, subscribed);

        // The choice is remembered: the package's next version asks nothing.
        let second = revised(&mut sender, &id);
        let plan = receiver.plan(&second);
        // Only the scheme asks to be updated.
        assert!(matches!(&plan.bases[0], BaseAction::Bound { .. }));
        assert_eq!(
            receiver.apply(&second, PackageDecisions::default()),
            [imported.clone()]
        );
        assert_eq!(
            receiver.scheme(&imported).profile["baseFilter"],
            json!(subscribed)
        );

        // Once the subscription is gone, the package's copy takes over.
        fs::remove_file(receiver.game.join("OnlineFilters").join("AbCd1234")).unwrap();
        let plan = receiver.plan(&second);
        assert!(matches!(&plan.bases[0], BaseAction::Copy { .. }));
        receiver.apply(&second, PackageDecisions::default());
        assert_eq!(
            receiver.scheme(&imported).profile["baseFilter"]["kind"],
            "imported"
        );
        assert!(matches!(
            receiver.registry.filters[0].base,
            BaseFilter::Imported { .. }
        ));

        // Asking for the package's copy stores one beside the subscription.
        let mut receiver = World::new();
        receiver.subscription("Show\n\tSetFontSize 30\n");
        let mut decisions = PackageDecisions::default();
        decisions.base_copies.insert(0);
        let imported = receiver.apply(&first, decisions)[0].clone();
        assert_eq!(
            receiver.scheme(&imported).profile["baseFilter"]["kind"],
            "imported"
        );
        assert!(matches!(
            receiver.registry.filters[0].base,
            BaseFilter::Imported { .. }
        ));
    }

    #[test]
    fn a_new_scheme_with_a_taken_name_gets_a_free_one() {
        let (_sender, first, id) = published();
        let mut receiver = World::new();
        let own = receiver.add("终局", profile(None, json!([])), BTreeMap::new());
        let plan = receiver.plan(&first);
        assert!(matches!(
            &plan.schemes[0],
            SchemeAction::New { conflict: Some(suggestion), .. } if suggestion == "终局 副本"
        ));
        let imported = receiver.apply(&first, PackageDecisions::default())[0].clone();
        assert_eq!(imported, id);
        assert_eq!(receiver.scheme(&imported).name, "终局 副本");
        assert_ne!(own, imported);

        let mut receiver = World::new();
        receiver.add("终局", profile(None, json!([])), BTreeMap::new());
        let mut decisions = PackageDecisions::default();
        decisions.names.insert(0, "作者的终局".into());
        let imported = receiver.apply(&first, decisions)[0].clone();
        assert_eq!(receiver.scheme(&imported).name, "作者的终局");
    }

    #[test]
    fn a_league_that_no_longer_exists_has_to_be_replaced() {
        let mut sender = World::new();
        let mut outdated = profile(None, json!([]));
        outdated["league"] = json!("Settlers");
        sender.add("过期赛季", outdated, BTreeMap::new());
        let path = sender.export(&["过期赛季"], None);
        let mut receiver = World::new();
        let plan = receiver.plan(&path);
        assert!(plan.review && plan.needs_league);
        let mut package = receiver.store.open_package(&path).unwrap();
        let error = receiver
            .store
            .import_package(
                &mut receiver.library,
                &mut receiver.registry,
                &mut package,
                &PackageDecisions::default(),
                &leagues(),
            )
            .unwrap_err();
        assert!(error.contains("赛季"), "{error}");
        assert!(receiver.library.schemes.is_empty());
        let mut decisions = PackageDecisions::default();
        decisions.league = Some("Standard".into());
        let imported = receiver.apply(&path, decisions)[0].clone();
        assert_eq!(receiver.scheme(&imported).profile["league"], "Standard");
    }

    #[test]
    fn export_refuses_a_scheme_whose_sound_is_missing() {
        let mut sender = World::new();
        sender.add(
            "缺音效",
            profile(None, json!([sounding("ping", 40)])),
            ping(),
        );
        fs::remove_file(sender.store.root.join("sounds").join(digest(PING))).unwrap();
        let error = sender
            .store
            .plan_package(&mut sender.registry, &[&sender.library.schemes[0]], None)
            .unwrap_err();
        assert!(error.contains("缺少自定义音效"), "{error}");
    }

    #[test]
    fn local_filters_carry_their_imports_and_sounds() {
        let mut sender = World::new();
        let filters = sender.temp.path().join("filters");
        for directory in ["parts", "audio"] {
            fs::create_dir_all(filters.join(directory)).unwrap();
        }
        fs::write(
            filters.join("Custom.filter"),
            "Import \"parts/tiers.filter\"\nShow\n\tCustomAlertSound \"audio/trade.mp3\"\n",
        )
        .unwrap();
        fs::write(
            filters.join("parts/tiers.filter"),
            "Hide\n\tSetFontSize 20\n",
        )
        .unwrap();
        fs::write(filters.join("audio/trade.mp3"), b"trade sound").unwrap();
        let base = BaseFilter::from_file(&filters.join("Custom.filter")).unwrap();
        sender.add("自定义", profile(Some(&base), json!([])), BTreeMap::new());
        let path = sender.export(&["自定义"], None);
        let files = manifest(&path);
        let paths: Vec<&str> = files.bases[0]
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect();
        assert_eq!(
            paths,
            ["Custom.filter", "audio/trade.mp3", "parts/tiers.filter"]
        );

        let mut receiver = World::new();
        receiver.apply(&path, PackageDecisions::default());
        let scheme = &receiver.library.schemes[0];
        assert_eq!(scheme.profile["baseFilter"]["kind"], "imported");
        let (text, sounds) = receiver.store.prepare_filter(scheme, None).unwrap();
        assert!(text.contains("SetFontSize 20"));
        assert_eq!(sounds.len(), 1);
    }

    #[test]
    fn downloaded_filters_keep_their_identity_across_versions() {
        let mut sender = World::new();
        let cache = sender.store.root.join("base-filters").join("neversink");
        let download = |version: &str| {
            let root = cache.join(version);
            fs::create_dir_all(&root).unwrap();
            fs::write(root.join("Strict.filter"), format!("Show\n# {version}\n")).unwrap();
            fs::write(root.join("entries.json"), "[\"Strict.filter\"]").unwrap();
            BaseFilter::Downloaded {
                source: "neversink".into(),
                version: version.into(),
                entry: "Strict.filter".into(),
                name: "Strict.filter".into(),
            }
        };
        let id = sender.add(
            "下载",
            profile(Some(&download("0.1.0")), json!([])),
            BTreeMap::new(),
        );
        let path = sender.export(&["下载"], None);
        let identity = manifest(&path).bases[0].id.clone();
        assert!(matches!(
            manifest(&path).bases[0].origin,
            BaseOrigin::Downloaded { ref source, ref version } if source == "neversink" && version == "0.1.0"
        ));

        // The tray moved the scheme to a newer version of the same download.
        Store::get_mut(&mut sender.library, &id).unwrap().profile["baseFilter"] =
            json!(download("0.2.0"));
        let path = sender.export(&["下载"], None);
        assert_eq!(manifest(&path).bases[0].id, identity);
        assert_eq!(sender.registry.filters.len(), 1);

        // A receiver who already downloaded that version uses the download.
        let mut receiver = World::new();
        let cached_root = receiver
            .store
            .root
            .join("base-filters")
            .join("neversink")
            .join("0.2.0");
        fs::create_dir_all(&cached_root).unwrap();
        fs::write(cached_root.join("Strict.filter"), "Show\n# 0.2.0\n").unwrap();
        fs::write(cached_root.join("entries.json"), "[\"Strict.filter\"]").unwrap();
        let plan = receiver.plan(&path);
        assert!(!plan.review);
        assert!(matches!(
            &plan.bases[0],
            BaseAction::Same { source, .. } if source == "NeverSink · 0.2.0"
        ));
        receiver.apply(&path, PackageDecisions::default());
        assert_eq!(
            receiver.library.schemes[0].profile["baseFilter"]["kind"],
            "downloaded"
        );
    }

    #[test]
    #[ignore = "reads an installed library; set POE2_PACKAGE_TEST_LIBRARY to its library.json"]
    fn installed_scheme_exports_and_reimports_as_a_package() {
        let Ok(installed) = std::env::var("POE2_PACKAGE_TEST_LIBRARY") else {
            return;
        };
        let name = std::env::var("POE2_PACKAGE_TEST_SCHEME")
            .unwrap_or_else(|_| "终极打宝-自动更新物价".into());
        let temp = tempfile::tempdir().unwrap();
        let sender = Store::new(temp.path().join("sender"), temp.path().join("game"));
        // A copy of the library keeps the installation itself untouched.
        fs::create_dir_all(&sender.root).unwrap();
        fs::copy(&installed, sender.root.join("library.json")).unwrap();
        let library = sender.load().unwrap();
        let scheme = library
            .schemes
            .iter()
            .find(|scheme| scheme.name == name)
            .unwrap();
        let mut registry = sender.registry().unwrap();
        let started = std::time::Instant::now();
        let planned = sender
            .plan_package(&mut registry, std::slice::from_ref(&scheme), None)
            .unwrap();
        let path = temp.path().join("package.zip");
        sender.write_package_file(planned, &path, true).unwrap();
        let elapsed = started.elapsed();
        let package = Package::open(&path).unwrap();
        let files: Vec<_> = package
            .manifest
            .bases
            .iter()
            .map(|base| base.files.len())
            .collect();
        println!(
            "{name}: {} bytes, {elapsed:?}, filter files {files:?}",
            fs::metadata(&path).unwrap().len()
        );

        let receiver = Store::new(temp.path().join("receiver"), temp.path().join("game"));
        let mut received = receiver.load().unwrap();
        let mut registry = receiver.registry().unwrap();
        let leagues = ["Forbidden Rites".to_owned()];
        let plan = receiver
            .plan_import(&package, &received, &registry, &leagues)
            .unwrap();
        assert!(!plan.review);
        let mut package = Package::open(&path).unwrap();
        let ids = receiver
            .import_package(
                &mut received,
                &mut registry,
                &mut package,
                &PackageDecisions::default(),
                &leagues,
            )
            .unwrap();
        let imported = Store::get(&received, &ids[0]).unwrap();
        assert!(receiver.missing(imported).is_empty());
        assert_eq!(
            imported.profile["rules"].as_array().unwrap().len(),
            scheme.profile["rules"].as_array().unwrap().len()
        );
        let base = serde_json::from_value(imported.profile["baseFilter"].clone()).unwrap();
        let styles = receiver.base_styles(base).unwrap();
        assert!(!styles["styles"].as_object().unwrap().is_empty());
    }

    #[test]
    fn plans_and_decisions_match_the_dialogs_on_the_wire() {
        let (mut sender, first, id) = published();
        let (receiver, _, _) = subscriber(&first);
        let second = revised(&mut sender, &id);
        let wire = serde_json::to_value(receiver.plan(&second)).unwrap();
        assert_eq!(wire["schemes"][0]["state"], "update");
        assert_eq!(wire["schemes"][0]["localName"], "终局");
        assert_eq!(wire["schemes"][0]["blocked"], false);
        assert_eq!(wire["bases"][0]["state"], "updateCopy");
        assert_eq!(wire["server"], "international");

        let decisions: PackageDecisions = serde_json::from_value(json!({
            "league": "Standard",
            "names": {"1": "另起的名称"},
            "schemeSkips": [3],
            "schemeCopies": [5],
            "baseKeeps": [0],
            "baseCopies": [1]
        }))
        .unwrap();
        assert_eq!(decisions.league.as_deref(), Some("Standard"));
        assert_eq!(decisions.names[&1], "另起的名称");
        assert_eq!(decisions.scheme_skips.into_iter().collect::<Vec<_>>(), [3]);
        assert_eq!(decisions.scheme_copies.into_iter().collect::<Vec<_>>(), [5]);
        assert_eq!(decisions.base_keeps.into_iter().collect::<Vec<_>>(), [0]);
        assert_eq!(decisions.base_copies.into_iter().collect::<Vec<_>>(), [1]);
        // A key the dialogs never send is a programming error, not something to ignore.
        assert!(serde_json::from_value::<PackageDecisions>(json!({"schemeSkip": [0]})).is_err());
    }
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod autostart;
mod base_filter;
mod engine;
mod market;
mod scheme_package;
mod share_code;
mod store;

use base64::Engine as _;
use base_filter::{matching_download, BaseFilter, DownloadOffer};
use engine::Result;
use serde_json::{json, Value};
use std::{
    fs,
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{mpsc, Mutex},
    time::Duration,
};
use store::{
    display_directory, digest, writable_directory, write_file, Edit, PackageDecisions,
    RefreshSettings, Server, Store,
};
use tauri::{tray::TrayIconBuilder, Emitter, Manager, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::{Update, UpdaterExt};

struct Desktop {
    store: Store,
    markets: BTreeMap<Server, market::Market>,
    changes: Mutex<()>,
    refresh: BTreeMap<Server, Mutex<()>>,
    schedule: BTreeMap<Server, mpsc::Sender<()>>,
    update: Mutex<UpdateStatus>,
}

#[derive(Default)]
struct UpdateStatus {
    offer: Option<Update>,
    bytes: Option<Vec<u8>>,
    error: Option<String>,
    phase: &'static str,
    received_bytes: u64,
    total_bytes: Option<u64>,
}

impl UpdateStatus {
    fn begin_check(&mut self) -> bool {
        if !matches!(self.phase, "idle" | "current" | "available" | "error") {
            return false;
        }
        self.phase = "checking";
        self.error = None;
        true
    }

    fn view(&self) -> Value {
        json!({"phase": self.phase, "error": self.error, "receivedBytes": self.received_bytes, "totalBytes": self.total_bytes, "version": self.offer.as_ref().map(|u| &u.version)})
    }
}

impl Desktop {
    fn market(&self, server: Server) -> &market::Market {
        &self.markets[&server]
    }

    fn refresh_base_filters(&self, server: Server) -> Result<()> {
        let library = self.store.load()?;
        if library.refresh(server).paused {
            return Ok(());
        }
        let mut sources = BTreeMap::<String, BTreeSet<String>>::new();
        for scheme in library
            .schemes
            .iter()
            .filter(|scheme| scheme.server() == server)
        {
            if let Some(BaseFilter::Downloaded {
                source, version, ..
            }) = Store::downloaded_base(scheme)
            {
                sources.entry(source).or_default().insert(version);
            }
        }
        for (source, versions) in sources {
            // Check once per source, and release the network lock before editing the library.
            let outcome = self.store.source_download(&source, &versions, |_| {});
            if matches!(&outcome, Ok(filters) if filters.is_empty()) {
                continue;
            }
            let _guard = self.changes.lock().map_err(|error| error.to_string())?;
            let mut current = self.store.load()?;
            if current.refresh(server).paused {
                break;
            }
            let mut changed = false;
            for scheme in current
                .schemes
                .iter_mut()
                .filter(|scheme| scheme.server() == server)
            {
                let Some(BaseFilter::Downloaded {
                    source: selected,
                    version,
                    entry,
                    name,
                }) = Store::downloaded_base(scheme)
                else {
                    continue;
                };
                if selected != source || !versions.contains(&version) {
                    continue;
                }
                let result = match &outcome {
                    Ok(filters) => match matching_download(filters, &name, Some(&entry)) {
                        Some(BaseFilter::Downloaded {
                            version: ref latest,
                            ..
                        }) if *latest == version => continue,
                        Some(base) => {
                            let install = scheme.installed.is_some() && scheme.auto_refresh;
                            let snapshot = install
                                .then(|| self.market(server).snapshot(scheme.league()))
                                .flatten();
                            self.store
                                .set_downloaded_base(scheme, &base, install, snapshot)
                        }
                        None => Err(format!("新版中找不到「{name}」")),
                    },
                    Err(reason) => Err(reason.clone()),
                };
                if let Err(reason) = result {
                    let status = format!("基础过滤器更新失败，沿用当前版本 · {reason}");
                    if scheme.status == status {
                        continue;
                    }
                    scheme.status = status;
                }
                changed = true;
            }
            if changed {
                self.store.persist(&current)?;
            }
        }
        Ok(())
    }

    fn refresh_leagues(
        &self,
        server: Server,
        manual: bool,
        extra_league: Option<String>,
    ) -> Result<()> {
        let _running = self.refresh[&server].lock().map_err(|e| e.to_string())?;
        let library = self.store.load()?;
        let settings = library.refresh(server);
        if settings.paused && !manual {
            return Ok(());
        }
        let market = self.market(server);
        let catalog = market.catalog(true);
        let mut leagues: BTreeSet<_> = library
            .schemes
            .iter()
            .filter(|s| {
                s.server() == server
                    && s.installed.is_some()
                    && s.auto_refresh
                    && extra_league
                        .as_deref()
                        .is_none_or(|league| s.league() == league)
            })
            .map(|s| s.league().to_owned())
            .collect();
        if let Some(league) = extra_league {
            leagues.insert(league);
        }
        if leagues.is_empty() {
            let data = catalog.as_ref().map_err(Clone::clone)?;
            leagues.insert(
                data["defaultLeague"]
                    .as_str()
                    .filter(|id| !id.is_empty())
                    .ok_or("暂未获取到赛季")?
                    .to_owned(),
            );
        }
        let mut error = None;
        for league in leagues {
            let outcome = market.refresh(&league, settings.interval_minutes, &catalog);
            let _guard = self.changes.lock().map_err(|e| e.to_string())?;
            let mut current = self.store.load()?;
            let can_install = !current.refresh(server).paused || manual;
            let mut changed = false;
            for scheme in &mut current.schemes {
                if scheme.server() != server
                    || scheme.league() != league
                    || scheme.installed.is_none()
                    || !scheme.auto_refresh
                    || !can_install
                {
                    continue;
                }
                let previous_status = scheme.status.clone();
                let install = match &outcome {
                    Ok(snapshot) => self.store.install(scheme, Some(snapshot.clone()), None),
                    Err(reason)
                        if engine::call::<bool>("requiresMarket", &scheme.profile)
                            .unwrap_or(true) =>
                    {
                        Err(reason.clone())
                    }
                    Err(_) => self.store.install(scheme, None, None),
                };
                changed |= install.is_ok();
                if let Err(reason) = install {
                    scheme.status = format!("刷新失败，已保留过滤器 · {reason}");
                }
                changed |= scheme.status != previous_status;
            }
            if changed {
                self.store.persist(&current)?;
            }
            if let Err(reason) = outcome {
                error = Some(reason);
            }
        }
        match error {
            Some(reason) => Err(reason),
            None => Ok(()),
        }
    }
}

/// 物品图标只从这两个图床读取：PoE2 Wiki 的文件和 poe2db 的物品图片。
const ITEM_ICON_HOSTS: [&str; 2] = ["https://www.poe2wiki.net/images/", "https://cdn.poe2db.tw/image/"];
const ITEM_ICON_MAX_BYTES: usize = 2 * 1024 * 1024;

fn item_icon_mime(url: &str) -> &'static str {
    match url
        .split('?')
        .next()
        .unwrap_or_default()
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => "image/png",
    }
}

#[tauri::command]
async fn item_icon(app: tauri::AppHandle, url: String) -> Result<String> {
    on_worker(move || {
        if !ITEM_ICON_HOSTS.iter().any(|host| url.starts_with(host))
            || url.len() > 512
            || url.chars().any(char::is_control)
        {
            return Err("不允许的物品图标地址".to_owned());
        }

        let cache_root = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("item-icons");
        fs::create_dir_all(&cache_root).map_err(|error| error.to_string())?;
        let cache_path = cache_root.join(digest(url.as_bytes()));
        let bytes = match fs::read(&cache_path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let client = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(20))
                    .user_agent("PoE2 Realtime Filter")
                    .build()
                    .map_err(|error| error.to_string())?;
                let response = client
                    .get(&url)
                    .send()
                    .map_err(|error| error.to_string())?
                    .error_for_status()
                    .map_err(|error| error.to_string())?;
                let bytes = response.bytes().map_err(|error| error.to_string())?;
                if bytes.is_empty() || bytes.len() > ITEM_ICON_MAX_BYTES {
                    return Err("物品图标内容无效或过大".to_owned());
                }
                write_file(&cache_path, &bytes, true)?;
                bytes.to_vec()
            }
            Err(error) => return Err(error.to_string()),
        };

        if bytes.is_empty() || bytes.len() > ITEM_ICON_MAX_BYTES {
            let _ = fs::remove_file(&cache_path);
            return Err("本地物品图标缓存无效".to_owned());
        }

        Ok(format!(
            "data:{};base64,{}",
            item_icon_mime(&url),
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    })
    .await
}

#[tauri::command]
fn library(state: State<'_, Desktop>) -> Result<Value> {
    let library = state.store.load()?;
    let effective = library
        .settings
        .filter_directory
        .as_deref()
        .unwrap_or(&state.store.default_game);
    Ok(json!({
        "server": library.server,
        "settings": library.refresh(library.server),
        "schemes": library.schemes.iter().filter(|scheme| scheme.server() == library.server).collect::<Vec<_>>(),
        "filterDirectory": display_directory(effective),
        "customDirectory": library.settings.filter_directory.is_some(),
        // Null when the startup entry cannot be read; the switch then stays unavailable.
        "autostart": autostart::enabled().ok(),
    }))
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<()> {
    autostart::set(enabled)
}

#[tauri::command]
fn local_catalog(state: State<'_, Desktop>, server: Server) -> Result<Value> {
    state.market(server).catalog(false)
}

#[tauri::command]
fn select_server(state: State<'_, Desktop>, server: Server) -> Result<()> {
    let _guard = state.changes.lock().map_err(|e| e.to_string())?;
    let mut library = state.store.load()?;
    library.server = server;
    state.store.persist(&library)
}

#[tauri::command]
fn local_market(state: State<'_, Desktop>, server: Server, league: String) -> Option<Value> {
    state.market(server).snapshot(&league)
}

async fn on_worker<T: Send + 'static>(
    task: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn refresh_market(
    app: tauri::AppHandle,
    server: Server,
    league: Option<String>,
) -> Result<()> {
    if league.as_ref().is_some_and(|id| {
        id.trim().is_empty() || id.len() > 480 || id.chars().any(char::is_control)
    }) {
        return Err("无效赛季".into());
    }
    on_worker(move || {
        let outcome = app.state::<Desktop>().refresh_leagues(server, true, league);
        let _ = app.emit("local-refresh", outcome.as_ref().err());
        outcome
    })
    .await
}

#[tauri::command]
fn save_settings(
    state: State<'_, Desktop>,
    server: Server,
    interval_minutes: u32,
    paused: bool,
) -> Result<()> {
    if !(1..=1440).contains(&interval_minutes) {
        return Err("刷新间隔应在 1–1440 分钟之间".into());
    }
    let _guard = state.changes.lock().map_err(|e| e.to_string())?;
    let mut library = state.store.load()?;
    library.set_refresh(
        server,
        RefreshSettings {
            interval_minutes,
            paused,
        },
    );
    state.store.persist(&library)?;
    let _ = state.schedule[&server].send(());
    Ok(())
}

#[tauri::command]
async fn pick_filter_directory(app: tauri::AppHandle, current: String) -> Result<Option<String>> {
    on_worker(move || {
        let mut dialog = app.dialog().file().set_title("选择游戏过滤器目录");
        let path = PathBuf::from(current);
        if path.is_absolute() && path.is_dir() {
            dialog = dialog.set_directory(path);
        }
        dialog
            .blocking_pick_folder()
            .map(|picked| {
                picked
                    .into_path()
                    .map(|path| display_directory(&path))
                    .map_err(|e| e.to_string())
            })
            .transpose()
    })
    .await
}

#[tauri::command]
async fn save_filter_directory(app: tauri::AppHandle, directory: Option<String>) -> Result<()> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let directory = directory
            .as_deref()
            .map(|path| writable_directory(Path::new(path.trim())))
            .transpose()?;
        let _guard = state.changes.lock().map_err(|e| e.to_string())?;
        let mut library = state.store.load()?;
        library.settings.filter_directory = directory;
        state.store.persist(&library)
    })
    .await
}

#[tauri::command]
async fn scan_base_filters(app: tauri::AppHandle) -> Result<Vec<base_filter::ScannedFilter>> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let library = state.store.load()?;
        // Copies stored from scheme packages are listed next to the game directory's filters.
        let listed = |base, registered_at| base_filter::ScannedFilter {
            base,
            registered_at: (registered_at > 0).then_some(registered_at),
        };
        let mut options: Vec<_> = base_filter::scan(&state.store.base_directory(&library))?
            .into_iter()
            .map(|base| listed(base, 0))
            .collect();
        options.extend(
            state
                .store
                .stored_filters()?
                .into_iter()
                .map(|(base, registered_at)| listed(base, registered_at)),
        );
        options.sort_by_cached_key(|option| option.base.name().to_lowercase());
        Ok(options)
    })
    .await
}

#[tauri::command]
async fn pick_base_filter(app: tauri::AppHandle) -> Result<Option<BaseFilter>> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let directory = state.store.base_directory(&state.store.load()?);
        let mut dialog = app
            .dialog()
            .file()
            .set_title("选择基础过滤器")
            .add_filter("PoE2 过滤器", &["filter"]);
        if directory.is_dir() {
            dialog = dialog.set_directory(directory);
        }
        dialog
            .blocking_pick_file()
            .map(|file| {
                let path = file.into_path().map_err(|error| error.to_string())?;
                BaseFilter::from_file(&path)
            })
            .transpose()
    })
    .await
}

/// Sends a source download's progress to the interface as `base-download` events.
fn download_reporter(
    app: &tauri::AppHandle,
    source: &str,
) -> impl Fn(base_filter::DownloadProgress) + Send + Sync + 'static {
    let app = app.clone();
    let source = source.to_owned();
    move |progress| {
        let _ = app.emit(
            "base-download",
            json!({ "source": source, "progress": progress }),
        );
    }
}

#[tauri::command]
async fn source_filters(
    app: tauri::AppHandle,
    source: String,
    cached_only: bool,
) -> Result<Vec<BaseFilter>> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        if cached_only {
            state.store.source_cache(&source)
        } else {
            let report = download_reporter(&app, &source);
            state
                .store
                .source_download(&source, &BTreeSet::new(), report)
        }
    })
    .await
}

#[tauri::command]
fn base_download_cancel(state: State<'_, Desktop>) {
    state.store.cancel_source_download();
}

#[tauri::command]
async fn base_download_offers(
    app: tauri::AppHandle,
    names: Vec<String>,
) -> Result<BTreeMap<String, Vec<DownloadOffer>>> {
    on_worker(move || app.state::<Desktop>().store.download_offers(&names)).await
}

#[tauri::command]
async fn scheme_download_base(app: tauri::AppHandle, id: String, source: String) -> Result<()> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let before = state.store.load()?;
        let scheme = Store::get(&before, &id)?;
        let hint = scheme.profile["baseFilterHint"]
            .as_str()
            .filter(|_| scheme.profile["baseFilter"].is_null())
            .ok_or("方案无需下载基础过滤器")?;
        let report = download_reporter(&app, &source);
        let filters = state
            .store
            .source_download(&source, &BTreeSet::new(), report)?;
        let base = matching_download(&filters, hint, None)
            .ok_or_else(|| format!("下载列表中未找到唯一的同名过滤器「{hint}」"))?;
        let _guard = state.changes.lock().map_err(|error| error.to_string())?;
        let mut current = state.store.load()?;
        let scheme = Store::get_mut(&mut current, &id)?;
        if !scheme.profile["baseFilter"].is_null()
            || scheme.profile["baseFilterHint"].as_str() != Some(hint)
        {
            return Err("方案的基础过滤器已更改".into());
        }
        state
            .store
            .set_downloaded_base(scheme, &base, false, None)?;
        state.store.persist(&current)
    })
    .await
}

#[tauri::command]
async fn base_styles(app: tauri::AppHandle, base: BaseFilter) -> Result<Value> {
    on_worker(move || app.state::<Desktop>().store.base_styles(base)).await
}

#[tauri::command]
async fn base_rules(app: tauri::AppHandle, base: BaseFilter, profile: Value) -> Result<Value> {
    on_worker(move || {
        let overlays = profile["overlays"].clone();
        app.state::<Desktop>().store.base_rules(base, &overlays)
    })
    .await
}

#[tauri::command]
async fn preview(app: tauri::AppHandle, profile: Value) -> Result<Value> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let snapshot = profile["league"].as_str().and_then(|league| {
            state
                .market(Server::from_profile(&profile))
                .snapshot(league)
        });
        state.store.preview(profile, snapshot)
    })
    .await
}

#[tauri::command]
async fn scheme_save(app: tauri::AppHandle, edit: Edit) -> Result<String> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let _guard = state.changes.lock().map_err(|e| e.to_string())?;
        state.store.save(&mut state.store.load()?, edit)
    })
    .await
}

#[tauri::command]
fn scheme_copy(state: State<'_, Desktop>, id: String) -> Result<String> {
    let _guard = state.changes.lock().map_err(|e| e.to_string())?;
    state.store.duplicate(&mut state.store.load()?, &id)
}

#[tauri::command]
fn scheme_remove(state: State<'_, Desktop>, id: String, remove_file: bool) -> Result<()> {
    let _guard = state.changes.lock().map_err(|e| e.to_string())?;
    let mut library = state.store.load()?;
    Store::get(&library, &id)?;
    state.store.remove(&mut library, &id, remove_file)
}

#[tauri::command]
async fn scheme_update_info(
    app: tauri::AppHandle,
    id: String,
    name: String,
    description: String,
) -> Result<()> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let _guard = state.changes.lock().map_err(|e| e.to_string())?;
        state
            .store
            .set_info(&mut state.store.load()?, &id, &name, &description)
    })
    .await
}

#[tauri::command]
async fn scheme_uninstall(app: tauri::AppHandle, id: String) -> Result<()> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let _guard = state.changes.lock().map_err(|e| e.to_string())?;
        state.store.uninstall(&mut state.store.load()?, &id)
    })
    .await
}

#[tauri::command]
async fn scheme_share(app: tauri::AppHandle, id: String) -> Result<String> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        Store::share(Store::get(&state.store.load()?, &id)?)
    })
    .await
}

#[tauri::command]
async fn inspect_share(app: tauri::AppHandle, code: String, server: Server) -> Result<Value> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let share = share_code::decode(&code)?.share;
        let target = share.profile.get("server").map(|value| serde_json::from_value::<Server>(value.clone()))
            .transpose().map_err(|_| "分享码的游戏服务器无效")?.unwrap_or(server);
        Ok(json!({"server":target, "name":share.name, "description":share.description, "league": share.profile["league"], "hasServer": share.profile.get("server").is_some(), "catalog":state.market(target).catalog(false)?}))
    }).await
}

#[tauri::command]
async fn scheme_import(
    app: tauri::AppHandle,
    code: String,
    server: Server,
    league: Option<String>,
    name: Option<String>,
) -> Result<Value> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let mut decoded = share_code::decode(&code)?;
        let fields = decoded.share.profile.as_object_mut().ok_or("无效的方案内容")?;
        if let Some(target) = fields.get("server") {
            if target != &json!(server) {
                return Err("分享码与目标服务器不一致".into());
            }
        }
        if let Some(league) = league {
            let catalog = state.market(server).catalog(false)?;
            if !catalog["leagues"]
                .as_array()
                .is_some_and(|entries| entries.iter().any(|entry| entry["id"] == league))
            {
                return Err("请选择目标服务器上的赛季".into());
            }
            fields.insert("league".into(), json!(league));
        }
        fields.insert("server".into(), json!(server));
        let _guard = state.changes.lock().map_err(|e| e.to_string())?;
        let mut library = state.store.load()?;
        let id = state.store.import_decoded(&mut library, decoded, name)?;
        if library.server != server {
            library.server = server;
            state.store.persist(&library)?;
        }
        let missing = state.store.missing(Store::get(&library, &id)?);
        Ok(json!({ "id": id, "missing": missing }))
    })
    .await
}

#[tauri::command]
fn scheme_auto(state: State<'_, Desktop>, id: String, enabled: bool) -> Result<()> {
    let _guard = state.changes.lock().map_err(|e| e.to_string())?;
    let mut library = state.store.load()?;
    Store::get_mut(&mut library, &id)?.auto_refresh = enabled;
    state.store.persist(&library)
}

#[tauri::command]
async fn scheme_install(app: tauri::AppHandle, id: String) -> Result<()> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let _guard = state.changes.lock().map_err(|e| e.to_string())?;
        let mut library = state.store.load()?;
        let directory = library.settings.filter_directory.clone();
        let target = Store::get(&library, &id)?;
        state
            .store
            .check_install_target(&library, target, &target.name)?;
        let scheme = Store::get_mut(&mut library, &id)?;
        let snapshot = state.market(scheme.server()).snapshot(scheme.league());
        let result = state.store.install(scheme, snapshot, directory.as_deref());
        if let Err(reason) = &result {
            scheme.status = reason.to_owned();
        }
        state.store.persist(&library)?;
        result
    })
    .await
}

#[tauri::command]
fn local_sound(
    state: State<'_, Desktop>,
    id: Option<String>,
    name: String,
    base: Option<BaseFilter>,
) -> Result<String> {
    use base64::Engine;
    let library = state.store.load()?;
    let scheme = id
        .as_deref()
        .map(|id| Store::get(&library, id))
        .transpose()?;
    let data = if let Some(base) = base {
        state.store.preview_base_audio(base, &name)?
    } else {
        state.store.audio(scheme, &name)?
    };
    Ok(base64::engine::general_purpose::STANDARD.encode(data))
}

#[tauri::command]
async fn scheme_download(app: tauri::AppHandle, id: String) -> Result<bool> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let library = state.store.load()?;
        let scheme = Store::get(&library, &id)?;
        let snapshot = state.market(scheme.server()).snapshot(scheme.league());
        let (text, sounds) = state.store.prepare_filter(scheme, snapshot)?;
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name(format!("{}.zip", scheme.name))
            .add_filter("ZIP", &["zip"])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let (path, replace) = match path.extension() {
            Some(extension) if extension.eq_ignore_ascii_case("zip") => (path, true),
            None => (path.with_extension("zip"), false),
            _ => return Err("请选择 .zip 文件名".into()),
        };
        let bytes = store::filter_zip(&scheme.name, &text, sounds)?;
        store::write_file(&path, &bytes, replace)?;
        Ok(true)
    })
    .await
}

#[tauri::command]
async fn scheme_export_package(
    app: tauri::AppHandle,
    ids: Vec<String>,
    title: Option<String>,
) -> Result<bool> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let planned = {
            let _guard = state.changes.lock().map_err(|error| error.to_string())?;
            let library = state.store.load()?;
            let schemes = ids
                .iter()
                .map(|id| Store::get(&library, id))
                .collect::<Result<Vec<_>>>()?;
            let mut registry = state.store.registry()?;
            let planned = state
                .store
                .plan_package(&mut registry, &schemes, title)?;
            // Identities stay registered, so a cancelled export reuses them next time.
            state.store.save_registry(&registry)?;
            planned
        };
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name(planned.file_name())
            .add_filter("方案包", &["zip"])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|error| error.to_string())?;
        let (path, replace) = match path.extension() {
            Some(extension) if extension.eq_ignore_ascii_case("zip") => (path, true),
            None => (path.with_extension("zip"), false),
            _ => return Err("请选择 .zip 文件名".into()),
        };
        state.store.write_package_file(planned, &path, replace)?;
        Ok(true)
    })
    .await
}

fn leagues(catalog: &Value) -> Vec<String> {
    catalog["leagues"]
        .as_array()
        .map(|leagues| {
            leagues
                .iter()
                .filter_map(|league| league["id"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
async fn pick_scheme_package(app: tauri::AppHandle) -> Result<Option<Value>> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let Some(file) = app
            .dialog()
            .file()
            .set_title("选择方案包")
            .add_filter("方案包", &["zip"])
            .add_filter("所有文件", &["*"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|error| error.to_string())?;
        let package = state.store.open_package(&path)?;
        let server = package.server();
        let _guard = state.changes.lock().map_err(|error| error.to_string())?;
        let library = state.store.load()?;
        let registry = state.store.registry()?;
        let catalog = state.market(server).catalog(false)?;
        let plan = state
            .store
            .plan_import(&package, &library, &registry, &leagues(&catalog))?;
        Ok(Some(json!({
            "path": display_directory(&path),
            "title": package.manifest.title,
            "current": library.server,
            "plan": plan,
            "catalog": catalog,
        })))
    })
    .await
}

#[tauri::command]
async fn scheme_import_package(
    app: tauri::AppHandle,
    path: String,
    decisions: PackageDecisions,
) -> Result<Value> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let mut package = state.store.open_package(Path::new(&path))?;
        let server = package.server();
        let _guard = state.changes.lock().map_err(|error| error.to_string())?;
        let mut library = state.store.load()?;
        let mut registry = state.store.registry()?;
        let catalog = state.market(server).catalog(false)?;
        let ids = state.store.import_package(
            &mut library,
            &mut registry,
            &mut package,
            &decisions,
            &leagues(&catalog),
        )?;
        // The table first: an updated scheme may point at a copy only it records.
        state.store.save_registry(&registry)?;
        if library.server != server {
            library.server = server;
        }
        state.store.persist(&library)?;
        let _ = state.schedule[&server].send(());
        Ok(json!({ "ids": ids }))
    })
    .await
}

#[tauri::command]
fn update_status(state: State<'_, Desktop>) -> Result<Value> {
    Ok(state.update.lock().map_err(|e| e.to_string())?.view())
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<Value> {
    let state = app.state::<Desktop>();
    {
        let mut update = state.update.lock().map_err(|e| e.to_string())?;
        if !update.begin_check() {
            return Ok(update.view());
        }
        let _ = app.emit("app-update", update.view());
    }

    let result = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };
    let mut update = state.update.lock().map_err(|e| e.to_string())?;
    match result {
        Ok(offer) => {
            update.phase = if offer.is_some() {
                "available"
            } else {
                "current"
            };
            update.offer = offer;
        }
        Err(error) => {
            update.phase = if update.offer.is_some() {
                "available"
            } else {
                "error"
            };
            update.error = Some(format!("无法检查客户端更新 · {error}"));
        }
    }
    let status = update.view();
    let _ = app.emit("app-update", &status);
    Ok(status)
}

#[tauri::command]
async fn update_download(app: tauri::AppHandle) -> Result<Value> {
    let state = app.state::<Desktop>();
    let offer = {
        let mut update = state.update.lock().map_err(|e| e.to_string())?;
        if update.phase != "available" {
            return Err("没有可下载的更新".into());
        }
        let offer = update.offer.clone().ok_or("没有可下载的更新")?;
        update.phase = "downloading";
        update.error = None;
        update.received_bytes = 0;
        update.total_bytes = None;
        let _ = app.emit("app-update", update.view());
        offer
    };
    let mut last_emit = None;
    let result = offer
        .download(
            |chunk, total| {
                if let Ok(mut update) = state.update.lock() {
                    update.received_bytes = update.received_bytes.saturating_add(chunk as u64);
                    update.total_bytes = total;
                    let now = std::time::Instant::now();
                    if last_emit
                        .is_none_or(|last| now.duration_since(last) >= Duration::from_millis(120))
                    {
                        last_emit = Some(now);
                        let _ = app.emit("app-update", update.view());
                    }
                }
            },
            || {
                if let Ok(mut update) = state.update.lock() {
                    update.phase = "verifying";
                    let _ = app.emit("app-update", update.view());
                }
            },
        )
        .await;
    let mut update = state.update.lock().map_err(|e| e.to_string())?;
    match result {
        Ok(bytes) => {
            update.bytes = Some(bytes);
            update.phase = "ready";
        }
        Err(error) => {
            update.error = Some(format!("下载或签名校验失败 · {error}"));
            update.phase = "available";
        }
    }
    let _ = app.emit("app-update", update.view());
    Ok(update.view())
}

#[tauri::command]
async fn update_install(app: tauri::AppHandle) -> Result<Value> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let (offer, bytes) = {
            let mut update = state.update.lock().map_err(|e| e.to_string())?;
            let offer = update.offer.clone().ok_or("没有待安装的版本")?;
            let bytes = update.bytes.take().ok_or("请先下载并校验更新")?;
            update.phase = "installing";
            let _ = app.emit("app-update", update.view());
            (offer, bytes)
        };
        let mut update = state.update.lock().map_err(|e| e.to_string())?;
        if let Err(error) = offer.install(&bytes) {
            update.bytes = Some(bytes);
            update.phase = "ready";
            update.error = Some(format!("无法启动安装程序 · {error}"));
        }
        Ok(update.view())
    })
    .await
}

fn open_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn setup(app: &mut tauri::App) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let executable = std::env::current_exe()?;
    let root = executable
        .parent()
        .ok_or("无法确定客户端安装目录")?
        .join("data");
    let prepare_data_directory = || -> Result<()> {
        std::fs::create_dir_all(&root).map_err(|e| format!("{}: {e}", root.display()))?;
        writable_directory(&root)?;
        Ok(())
    };
    if let Err(reason) = prepare_data_directory() {
        app.dialog()
            .message(format!("无法写入安装目录的数据。\n{reason}"))
            .title("PoE2 Realtime Filter")
            .kind(tauri_plugin_dialog::MessageDialogKind::Error)
            .show(move |_| handle.exit(1));
        return Ok(());
    }
    let game = app
        .path()
        .document_dir()?
        .join("My Games")
        .join("Path of Exile 2");
    let mut schedule = BTreeMap::new();
    let mut signals = Vec::new();
    for server in Server::ALL {
        let (sender, receiver) = mpsc::channel();
        schedule.insert(server, sender);
        signals.push((server, receiver));
    }
    app.manage(Desktop {
        store: Store::new(root.clone(), game),
        markets: BTreeMap::from([
            (
                Server::International,
                market::Market::new(root.join("market"), Server::International)
                    .map_err(std::io::Error::other)?,
            ),
            (
                Server::Tencent,
                market::Market::new(root.join("market-tencent"), Server::Tencent)
                    .map_err(std::io::Error::other)?,
            ),
        ]),
        changes: Mutex::new(()),
        refresh: Server::ALL
            .into_iter()
            .map(|server| (server, Mutex::new(())))
            .collect(),
        schedule,
        update: Mutex::new(UpdateStatus {
            phase: "idle",
            ..Default::default()
        }),
    });
    let window = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or("主窗口配置不存在")?;
    // Launched by the startup entry: stay in the tray until the window is opened.
    let webview = tauri::WebviewWindowBuilder::from_config(app, window)?
        .visible(!autostart::requested())
        .data_directory(root.join("webview"))
        .build();
    if let Err(reason) = webview {
        app.dialog()
            .message(format!("无法启动客户端。\n{}\n{reason}", root.display()))
            .title("PoE2 Realtime Filter")
            .kind(tauri_plugin_dialog::MessageDialogKind::Error)
            .show(move |_| handle.exit(1));
        return Ok(());
    }
    let open = tauri::menu::MenuItem::with_id(app, "open", "打开过滤器编辑器", true, None::<&str>)?;
    let exit = tauri::menu::MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?;
    let tray_menu = tauri::menu::Menu::with_items(app, &[&open, &exit])?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("PoE2 Realtime Filter")
        .menu(&tray_menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => open_main(app),
            "exit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, tauri::tray::TrayIconEvent::DoubleClick { .. }) {
                open_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    for (server, signal) in signals {
        let handle = handle.clone();
        std::thread::spawn(move || loop {
            let state = handle.state::<Desktop>();
            let refresh = state.refresh_leagues(server, false, None);
            let base_refresh = state.refresh_base_filters(server);
            let outcome = refresh.and(base_refresh);
            let _ = handle.emit(
                "local-refresh",
                json!({ "server": server, "error": outcome.err() }),
            );
            let minutes = state
                .store
                .load()
                .map(|library| library.refresh(server).interval_minutes)
                .unwrap_or(120)
                .clamp(1, 1440);
            if matches!(
                signal.recv_timeout(Duration::from_secs(u64::from(minutes) * 60)),
                Err(mpsc::RecvTimeoutError::Disconnected)
            ) {
                break;
            }
        });
    }
    let update_app = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let _ = check_update(update_app).await;
    });
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            open_main(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(setup)
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            item_icon,
            library,
            local_catalog,
            select_server,
            local_market,
            refresh_market,
            save_settings,
            set_autostart,
            pick_filter_directory,
            save_filter_directory,
            scan_base_filters,
            pick_base_filter,
            source_filters,
            base_download_cancel,
            base_download_offers,
            scheme_download_base,
            base_styles,
            base_rules,
            preview,
            scheme_save,
            scheme_copy,
            scheme_remove,
            scheme_update_info,
            scheme_uninstall,
            scheme_share,
            inspect_share,
            scheme_import,
            scheme_auto,
            scheme_install,
            local_sound,
            scheme_download,
            scheme_export_package,
            pick_scheme_package,
            scheme_import_package,
            update_status,
            check_update,
            update_download,
            update_install
        ])
        .run(tauri::generate_context!())
        .expect("PoE2 Realtime Filter startup failed");
}

#[cfg(all(test, windows, debug_assertions))]
mod updater_tests {
    use super::*;
    use std::{
        cell::Cell,
        io::{BufRead, BufReader, Write},
        net::TcpListener,
    };

    #[test]
    fn update_check_can_retry_and_preserves_updates_in_progress() {
        let mut status = UpdateStatus {
            phase: "idle",
            ..Default::default()
        };
        assert!(status.begin_check());
        assert_eq!(status.phase, "checking");
        assert!(!status.begin_check());
        for phase in ["current", "error", "available"] {
            status.phase = phase;
            status.error = Some("failed".into());
            assert!(status.begin_check());
            assert!(status.error.is_none());
        }
        status.bytes = Some(vec![1]);
        for phase in ["downloading", "verifying", "ready", "installing"] {
            status.phase = phase;
            assert!(!status.begin_check());
            assert_eq!(status.phase, phase);
            assert_eq!(status.bytes.as_deref(), Some([1].as_slice()));
        }
    }

    #[test]
    fn updater_download_reports_progress_and_rejects_invalid_signature() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let fixture_url = format!("{address}/fixture");
        let manifest = json!({
            "version": "9.9.9",
            "url": fixture_url,
            "signature": "aW52YWxpZCBzaWduYXR1cmU="
        })
        .to_string();
        let server = std::thread::spawn(move || {
            let mut requests = [
                (manifest.len(), manifest.as_bytes()),
                (262_144, &[42; 65_536]),
            ]
            .into_iter()
            .enumerate();
            for (index, (length, body)) in &mut requests {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let headers = BufReader::new(&stream)
                    .lines()
                    .map_while(std::result::Result::ok)
                    .take_while(|line| !line.is_empty())
                    .count();
                assert!(headers > 0);
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n"
                )
                .unwrap();
                for _ in 0..if index == 0 { 1 } else { 4 } {
                    stream.write_all(body).unwrap();
                }
            }
        });
        let app = tauri::Builder::<tauri::Wry>::default()
            .any_thread()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(tauri::generate_context!())
            .unwrap();
        tauri::async_runtime::block_on(async {
            let offer = app
                .updater_builder()
                .endpoints(vec![format!("{address}/latest.json").parse().unwrap()])
                .unwrap()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap()
                .check()
                .await
                .unwrap()
                .unwrap();
            let received = Cell::new(0);
            let chunks = Cell::new(0);
            let complete = Cell::new(false);
            let result = offer
                .download(
                    |chunk, length| {
                        assert_eq!(length, Some(262_144));
                        received.set(received.get() + chunk);
                        chunks.set(chunks.get() + 1);
                    },
                    || complete.set(true),
                )
                .await;
            assert!(chunks.get() > 1);
            assert_eq!(received.get(), 262_144);
            assert!(complete.get());
            assert!(
                matches!(result, Err(tauri_plugin_updater::Error::Minisign(_))),
                "{:?}",
                result.err()
            );
        });
        server.join().unwrap();
    }
}

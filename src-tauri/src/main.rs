#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod market;
mod store;

use engine::Result;
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    io::Write,
    sync::{mpsc, Mutex},
    time::Duration,
};
use store::{Edit, Settings, Store};
use tauri::{tray::TrayIconBuilder, Emitter, Manager, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::{Update, UpdaterExt};

struct Desktop {
    store: Store,
    market: market::Market,
    changes: Mutex<()>,
    refresh: Mutex<()>,
    schedule: mpsc::Sender<()>,
    update: Mutex<UpdateStatus>,
}

#[derive(Default)]
struct UpdateStatus {
    offer: Option<Update>,
    bytes: Option<Vec<u8>>,
    error: Option<String>,
    phase: &'static str,
}

impl UpdateStatus {
    fn view(&self) -> Value {
        json!({"phase": self.phase, "error": self.error, "version": self.offer.as_ref().map(|u| &u.version)})
    }
}

impl Desktop {
    fn refresh_leagues(&self, extra_league: Option<String>) -> Result<()> {
        let _running = self.refresh.lock().map_err(|e| e.to_string())?;
        let library = self.store.load()?;
        let manual = extra_league.is_some();
        if library.settings.paused && !manual {
            return Ok(());
        }
        let catalog = self.market.catalog(true);
        let mut leagues: BTreeSet<_> = library
            .schemes
            .iter()
            .filter(|s| {
                s.installed.is_some()
                    && s.auto_refresh
                    && (!manual || Some(s.league()) == extra_league.as_deref())
            })
            .map(|s| s.league().to_owned())
            .collect();
        if let Some(league) = extra_league {
            leagues.insert(league);
        }
        if leagues.is_empty() {
            leagues.insert(
                catalog
                    .as_ref()
                    .ok()
                    .and_then(|data| data["defaultLeague"].as_str())
                    .unwrap_or("Standard")
                    .to_string(),
            );
        }
        let mut error = None;
        for league in leagues {
            let outcome = self
                .market
                .refresh(&league, library.settings.interval_minutes);
            let _guard = self.changes.lock().map_err(|e| e.to_string())?;
            let mut current = self.store.load()?;
            let can_install = !current.settings.paused || manual;
            let mut changed = false;
            for scheme in &mut current.schemes {
                if scheme.league() != league
                    || scheme.installed.is_none()
                    || !scheme.auto_refresh
                    || !can_install
                {
                    continue;
                }
                match &outcome {
                    Ok(snapshot) => {
                        if let Err(reason) = self.store.install(scheme, Some(snapshot.clone())) {
                            scheme.status = reason;
                        }
                    }
                    Err(reason) => scheme.status = format!("刷新失败，已保留过滤器 · {reason}"),
                }
                changed = true;
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

#[tauri::command]
fn library(state: State<'_, Desktop>) -> Result<store::Library> {
    state.store.load()
}

#[tauri::command]
fn local_catalog(state: State<'_, Desktop>) -> Result<Value> {
    state.market.catalog(false)
}

#[tauri::command]
fn local_market(state: State<'_, Desktop>, league: String) -> Option<Value> {
    state.market.snapshot(&league)
}

async fn on_worker<T: Send + 'static>(
    task: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn refresh_market(app: tauri::AppHandle, league: String) -> Result<()> {
    if league.trim().is_empty() || league.len() > 480 || league.chars().any(char::is_control) {
        return Err("无效赛季".into());
    }
    on_worker(move || {
        let outcome = app.state::<Desktop>().refresh_leagues(Some(league));
        let _ = app.emit("local-refresh", outcome.as_ref().err());
        outcome
    })
    .await
}

#[tauri::command]
fn save_settings(state: State<'_, Desktop>, settings: Settings) -> Result<()> {
    if !(1..=1440).contains(&settings.interval_minutes) {
        return Err("刷新间隔应在 1–1440 分钟之间".into());
    }
    let _guard = state.changes.lock().map_err(|e| e.to_string())?;
    let mut library = state.store.load()?;
    library.settings = settings;
    state.store.persist(&library)?;
    let _ = state.schedule.send(());
    Ok(())
}

#[tauri::command]
async fn preview(app: tauri::AppHandle, profile: Value) -> Result<Value> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let snapshot = profile["league"]
            .as_str()
            .and_then(|league| state.market.snapshot(league));
        state.store.generate(profile, snapshot)
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
fn scheme_share(state: State<'_, Desktop>, id: String) -> Result<String> {
    Store::share(Store::get(&state.store.load()?, &id)?)
}

#[tauri::command]
async fn scheme_import(app: tauri::AppHandle, code: String, name: Option<String>) -> Result<Value> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let _guard = state.changes.lock().map_err(|e| e.to_string())?;
        let mut library = state.store.load()?;
        let id = state.store.import(&mut library, &code, name)?;
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
        let scheme = Store::get_mut(&mut library, &id)?;
        let snapshot = state.market.snapshot(scheme.league());
        let result = state.store.install(scheme, snapshot);
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
    custom: bool,
) -> Result<String> {
    use base64::Engine;
    let library = state.store.load()?;
    let scheme = id
        .as_deref()
        .map(|id| Store::get(&library, id))
        .transpose()?;
    Ok(base64::engine::general_purpose::STANDARD.encode(state.store.audio(scheme, &name, custom)?))
}

#[tauri::command]
async fn export_filter(app: tauri::AppHandle, name: String, text: String) -> Result<()> {
    on_worker(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name(name)
            .add_filter("PoE2 Filter", &["filter"])
            .blocking_save_file()
        else {
            return Ok(());
        };
        store::write_file(
            &file.into_path().map_err(|e| e.to_string())?,
            text.as_bytes(),
            true,
        )
    })
    .await
}

#[tauri::command]
async fn export_bundle(app: tauri::AppHandle, id: String) -> Result<()> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let library = state.store.load()?;
        let scheme = Store::get(&library, &id)?;
        let snapshot = state.market.snapshot(scheme.league());
        let result = state.store.generate(scheme.profile.clone(), snapshot)?;
        let (text, sounds) = state.store.bundle(scheme, &result)?;
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name(format!("{}.zip", scheme.name))
            .add_filter("ZIP", &["zip"])
            .blocking_save_file()
        else {
            return Ok(());
        };
        let mut archive = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        archive
            .start_file(format!("{}.filter", scheme.name), options)
            .map_err(|e| e.to_string())?;
        archive
            .write_all(text.as_bytes())
            .map_err(|e| e.to_string())?;
        for (name, bytes) in sounds {
            archive
                .start_file(name, options)
                .map_err(|e| e.to_string())?;
            archive.write_all(&bytes).map_err(|e| e.to_string())?;
        }
        let bytes = archive.finish().map_err(|e| e.to_string())?.into_inner();
        store::write_file(&file.into_path().map_err(|e| e.to_string())?, &bytes, true)
    })
    .await
}

#[tauri::command]
fn update_status(state: State<'_, Desktop>) -> Result<Value> {
    Ok(state.update.lock().map_err(|e| e.to_string())?.view())
}

async fn check_update(app: tauri::AppHandle) {
    let result = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };
    let state = app.state::<Desktop>();
    if let Ok(mut update) = state.update.lock() {
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
                update.phase = "error";
                update.error = Some(format!("无法检查客户端更新 · {error}"));
            }
        }
        let _ = app.emit("app-update", update.view());
    };
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
        let _ = app.emit("app-update", update.view());
        offer
    };
    let result = offer.download(|_, _| {}, || {}).await;
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
    let root = app.path().app_local_data_dir()?;
    let game = app
        .path()
        .document_dir()?
        .join("My Games")
        .join("Path of Exile 2");
    let packaged = app.path().resource_dir()?.join("neversink");
    let templates = if cfg!(debug_assertions) && !packaged.is_dir() {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../vendor/neversink")
    } else {
        packaged
    };
    let (schedule, signal) = mpsc::channel();
    app.manage(Desktop {
        store: Store::new(root.clone(), templates, game),
        market: market::Market::new(root.join("market")).map_err(std::io::Error::other)?,
        changes: Mutex::new(()),
        refresh: Mutex::new(()),
        schedule,
        update: Mutex::new(UpdateStatus {
            phase: "checking",
            ..Default::default()
        }),
    });
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
    std::thread::spawn(move || loop {
        let state = handle.state::<Desktop>();
        let refresh = state.refresh_leagues(None);
        let _ = handle.emit("local-refresh", refresh.as_ref().err());
        let minutes = state
            .store
            .load()
            .map(|library| library.settings.interval_minutes)
            .unwrap_or(30)
            .clamp(1, 1440);
        if matches!(
            signal.recv_timeout(Duration::from_secs(u64::from(minutes) * 60)),
            Err(mpsc::RecvTimeoutError::Disconnected)
        ) {
            break;
        }
    });
    tauri::async_runtime::spawn(check_update(app.handle().clone()));
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
            library,
            local_catalog,
            local_market,
            refresh_market,
            save_settings,
            preview,
            scheme_save,
            scheme_copy,
            scheme_remove,
            scheme_share,
            scheme_import,
            scheme_auto,
            scheme_install,
            local_sound,
            export_filter,
            export_bundle,
            update_status,
            update_download,
            update_install
        ])
        .run(tauri::generate_context!())
        .expect("PoE2 Realtime Filter startup failed");
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod base_filter;
mod engine;
mod market;
mod store;

use base_filter::BaseFilter;
use engine::Result;
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::{mpsc, Mutex},
    time::Duration,
};
use store::{display_directory, writable_directory, Edit, Store};
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
    received_bytes: u64,
    total_bytes: Option<u64>,
}

impl UpdateStatus {
    fn view(&self) -> Value {
        json!({"phase": self.phase, "error": self.error, "receivedBytes": self.received_bytes, "totalBytes": self.total_bytes, "version": self.offer.as_ref().map(|u| &u.version)})
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
                        if let Err(reason) =
                            self.store.install(scheme, Some(snapshot.clone()), None)
                        {
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
fn library(state: State<'_, Desktop>) -> Result<Value> {
    let library = state.store.load()?;
    let effective = library
        .settings
        .filter_directory
        .as_deref()
        .unwrap_or(&state.store.default_game);
    Ok(json!({
        "settings": library.settings,
        "schemes": library.schemes,
        "filterDirectory": display_directory(effective),
    }))
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
fn save_settings(state: State<'_, Desktop>, interval_minutes: u32, paused: bool) -> Result<()> {
    if !(1..=1440).contains(&interval_minutes) {
        return Err("刷新间隔应在 1–1440 分钟之间".into());
    }
    let _guard = state.changes.lock().map_err(|e| e.to_string())?;
    let mut library = state.store.load()?;
    library.settings.interval_minutes = interval_minutes;
    library.settings.paused = paused;
    state.store.persist(&library)?;
    let _ = state.schedule.send(());
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
async fn scan_base_filters(app: tauri::AppHandle) -> Result<Vec<BaseFilter>> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let library = state.store.load()?;
        base_filter::scan(&state.store.base_directory(&library))
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
            state.store.source_download(&source)
        }
    })
    .await
}

#[tauri::command]
async fn base_styles(app: tauri::AppHandle, base: BaseFilter) -> Result<Value> {
    on_worker(move || app.state::<Desktop>().store.base_styles(base)).await
}

#[tauri::command]
async fn preview(app: tauri::AppHandle, profile: Value) -> Result<Value> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let snapshot = profile["league"]
            .as_str()
            .and_then(|league| state.market.snapshot(league));
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
async fn scheme_rename(app: tauri::AppHandle, id: String, name: String) -> Result<()> {
    on_worker(move || {
        let state = app.state::<Desktop>();
        let _guard = state.changes.lock().map_err(|e| e.to_string())?;
        state.store.rename(&mut state.store.load()?, &id, &name)
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
        let directory = library.settings.filter_directory.clone();
        let scheme = Store::get_mut(&mut library, &id)?;
        let snapshot = state.market.snapshot(scheme.league());
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
        let snapshot = state.market.snapshot(scheme.league());
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
    let (schedule, signal) = mpsc::channel();
    app.manage(Desktop {
        store: Store::new(root.clone(), game),
        market: market::Market::new(root.join("market")).map_err(std::io::Error::other)?,
        changes: Mutex::new(()),
        refresh: Mutex::new(()),
        schedule,
        update: Mutex::new(UpdateStatus {
            phase: "checking",
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
    let webview = tauri::WebviewWindowBuilder::from_config(app, window)?
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
            pick_filter_directory,
            save_filter_directory,
            scan_base_filters,
            pick_base_filter,
            source_filters,
            base_styles,
            preview,
            scheme_save,
            scheme_copy,
            scheme_remove,
            scheme_rename,
            scheme_uninstall,
            scheme_share,
            scheme_import,
            scheme_auto,
            scheme_install,
            local_sound,
            scheme_download,
            update_status,
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

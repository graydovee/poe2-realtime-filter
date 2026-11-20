//! egui view for the tray sync client.

use std::{
    path::PathBuf,
    sync::mpsc::{channel, Receiver, Sender},
    thread,
    time::{Duration, Instant},
};

use eframe::egui::{self, Align, Color32, Frame, Layout, RichText, Vec2};
use windows_sys::Win32::{
    Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS},
    System::Threading::CreateMutexW,
    UI::WindowsAndMessaging::{
        FindWindowW, MessageBoxW, SetForegroundWindow, ShowWindow, MB_ICONERROR, MB_OK, SW_RESTORE,
    },
};

use crate::{
    platform,
    sync::{self, Entry, Settings},
    theme,
    tray::{self, Tray, TrayCommand},
    widgets,
};

pub const WINDOW_TITLE: &str = "poe2-filter · 过滤器自动更新";

#[derive(Clone, Copy)]
enum Tone {
    Muted,
    Gold,
    Sage,
    Ember,
}

impl Tone {
    fn color(self) -> Color32 {
        match self {
            Tone::Muted => theme::INK_MUTED,
            Tone::Gold => theme::GOLD,
            Tone::Sage => theme::SAGE,
            Tone::Ember => theme::EMBER,
        }
    }
}

enum Message {
    Updated { entries: Vec<Entry>, changed: bool, failed: bool },
    Rolled { index: usize, outcome: Result<Entry, (Entry, String)> },
}

pub struct App {
    root: PathBuf,
    settings: Settings,
    link: String,
    directory: String,
    minutes: String,
    autostart: bool,
    selected: Option<usize>,
    busy: bool,
    failures: u32,
    next_attempt: Instant,
    notice: String,
    notice_tone: Tone,
    sender: Sender<Message>,
    receiver: Receiver<Message>,
    tray: Option<Tray>,
    quit: bool,
}

impl App {
    fn new(cc: &eframe::CreationContext<'_>, root: PathBuf, settings: Settings, tray: Option<Tray>) -> Self {
        theme::install(&cc.egui_ctx);
        theme::apply_dark_titlebar();
        // Keep the scheduler ticking even while the window is hidden in the tray.
        let ctx = cc.egui_ctx.clone();
        thread::spawn(move || loop {
            thread::sleep(Duration::from_secs(1));
            ctx.request_repaint();
        });
        let directory = platform::documents()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default();
        let minutes = settings.interval_minutes.to_string();
        let autostart = settings.autostart;
        let (sender, receiver) = channel();
        Self {
            root,
            settings,
            link: String::new(),
            directory,
            minutes,
            autostart,
            selected: None,
            busy: false,
            failures: 0,
            next_attempt: Instant::now(),
            notice: "启动后自动检查更新；关闭窗口将留在托盘。".to_owned(),
            notice_tone: Tone::Muted,
            sender,
            receiver,
            tray,
            quit: false,
        }
    }

    fn notice_set(&mut self, text: String, tone: Tone) {
        self.notice = text;
        self.notice_tone = tone;
    }

    fn persist(&mut self) {
        if let Err(error) = sync::save_settings(&self.root, &self.settings) {
            self.notice_set(error, Tone::Ember);
        }
    }

    fn schedule(&mut self, failed: bool) {
        self.failures = if failed { (self.failures + 1).min(6) } else { 0 };
        let wait = if failed {
            60 * (1u64 << self.failures.min(5))
        } else {
            self.settings.interval_minutes as u64 * 60
        };
        self.next_attempt = Instant::now() + Duration::from_secs(wait);
    }

    fn start_update(&mut self, indices: Option<Vec<usize>>) {
        if self.busy {
            return;
        }
        let entries: Vec<Entry> = match indices {
            Some(list) => list
                .iter()
                .filter_map(|index| self.settings.entries.get(*index).cloned())
                .collect(),
            None => self.settings.entries.clone(),
        };
        if entries.is_empty() {
            self.notice_set("还没有订阅方案，请先添加".to_owned(), Tone::Muted);
            return;
        }
        self.busy = true;
        self.notice_set("正在检查更新…".to_owned(), Tone::Gold);
        let root = self.root.clone();
        let sender = self.sender.clone();
        thread::spawn(move || {
            let mut list = entries;
            let mut changed = false;
            let mut failed = false;
            for entry in list.iter_mut() {
                if entry.paused || entry.revoked {
                    continue;
                }
                match sync::update(&root, entry) {
                    Ok(updated) => changed |= updated,
                    Err(message) => {
                        entry.status = message;
                        failed = true;
                    }
                }
            }
            let _ = sender.send(Message::Updated { entries: list, changed, failed });
        });
    }

    fn start_rollback(&mut self, index: usize) {
        if self.busy {
            return;
        }
        let Some(entry) = self.settings.entries.get(index).cloned() else {
            return;
        };
        self.busy = true;
        self.notice_set("正在回滚上一版…".to_owned(), Tone::Gold);
        let root = self.root.clone();
        let sender = self.sender.clone();
        thread::spawn(move || {
            let mut entry = entry;
            let outcome = match sync::rollback(&root, &mut entry) {
                Ok(()) => Ok(entry),
                Err(error) => Err((entry, error)),
            };
            let _ = sender.send(Message::Rolled { index, outcome });
        });
    }

    fn poll_worker(&mut self) {
        while let Ok(message) = self.receiver.try_recv() {
            match message {
                Message::Updated { entries, changed, failed } => {
                    for entry in entries {
                        if let Some(target) = self
                            .settings
                            .entries
                            .iter_mut()
                            .find(|target| target.id == entry.id && target.origin == entry.origin)
                        {
                            *target = entry;
                        }
                    }
                    self.busy = false;
                    self.schedule(failed);
                    self.persist();
                    if failed {
                        self.notice_set(
                            "部分更新失败，原有过滤器已保留。请选择条目查看详情。".to_owned(),
                            Tone::Ember,
                        );
                    } else if changed {
                        self.notice_set(
                            "更新完成。首次请在游戏内选择 poe2-filter 过滤器；更新后重新加载。".to_owned(),
                            Tone::Gold,
                        );
                    } else {
                        self.notice_set("检查完成，已是最新版本。".to_owned(), Tone::Muted);
                    }
                }
                Message::Rolled { index, outcome } => {
                    match outcome {
                        Ok(entry) => {
                            if index < self.settings.entries.len() {
                                self.settings.entries[index] = entry;
                            }
                            self.notice_set("已回滚并暂停同步；请在游戏内重新加载".to_owned(), Tone::Gold);
                        }
                        Err((entry, error)) => {
                            if index < self.settings.entries.len() {
                                self.settings.entries[index] = entry;
                            }
                            self.notice_set(error, Tone::Ember);
                        }
                    }
                    self.busy = false;
                    self.persist();
                }
            }
        }
    }

    fn poll_tray(&mut self, ctx: &egui::Context) {
        let commands = match &self.tray {
            Some(tray) => tray.poll(),
            None => Vec::new(),
        };
        for command in commands {
            match command {
                TrayCommand::Open => {
                    ctx.send_viewport_cmd(egui::ViewportCommand::Visible(true));
                    ctx.send_viewport_cmd(egui::ViewportCommand::Focus);
                }
                TrayCommand::UpdateAll => self.start_update(None),
                TrayCommand::ToggleAll => self.toggle_all(),
                TrayCommand::Quit => {
                    self.quit = true;
                    ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                }
            }
        }
    }

    fn add_entry(&mut self) {
        let directory = PathBuf::from(self.directory.trim());
        if !directory.is_absolute() {
            self.notice_set("请选择绝对目录".to_owned(), Tone::Ember);
            return;
        }
        match sync::parse_link(&self.link, directory) {
            Ok(entry) => {
                if self
                    .settings
                    .entries
                    .iter()
                    .any(|existing| existing.id == entry.id && existing.origin == entry.origin)
                {
                    self.notice_set("该方案已存在；重置密钥后请先移除旧条目再添加".to_owned(), Tone::Ember);
                    return;
                }
                self.settings.entries.push(entry);
                self.link.clear();
                self.persist();
                self.notice_set("已添加方案，正在同步…".to_owned(), Tone::Gold);
                self.start_update(None);
            }
            Err(error) => self.notice_set(error, Tone::Ember),
        }
    }

    fn save_settings(&mut self) {
        let minutes: u32 = self.minutes.trim().parse().unwrap_or(0);
        if !(5..=1440).contains(&minutes) {
            self.notice_set("检查间隔必须在 5–1440 分钟之间".to_owned(), Tone::Ember);
            return;
        }
        let directory = PathBuf::from(self.directory.trim());
        if !directory.is_absolute() {
            self.notice_set("目录必须是绝对路径".to_owned(), Tone::Ember);
            return;
        }
        if let Err(error) = platform::autostart(self.autostart) {
            self.notice_set(error, Tone::Ember);
            return;
        }
        if self.busy {
            self.notice_set("请等待同步结束后再修改设置".to_owned(), Tone::Ember);
            return;
        }
        self.settings.interval_minutes = minutes;
        self.settings.autostart = self.autostart;
        if let Some(index) = self.selected {
            if let Some(entry) = self.settings.entries.get_mut(index) {
                if entry.directory != directory {
                    entry.directory = directory;
                    entry.current = None;
                }
            }
        }
        self.next_attempt = Instant::now() + Duration::from_secs(minutes as u64 * 60);
        self.persist();
        self.notice_set("设置已保存".to_owned(), Tone::Sage);
    }

    fn toggle_pause(&mut self, index: usize) {
        if let Some(entry) = self.settings.entries.get_mut(index) {
            entry.paused = !entry.paused;
            let paused = entry.paused;
            self.persist();
            self.notice_set(if paused { "已暂停同步".to_owned() } else { "已恢复同步".to_owned() }, Tone::Muted);
        }
    }

    fn toggle_all(&mut self) {
        let paused = self.settings.entries.iter().any(|entry| !entry.paused);
        for entry in &mut self.settings.entries {
            entry.paused = paused;
        }
        let count = self.settings.entries.len();
        self.persist();
        self.notice_set(
            if paused { format!("已暂停全部 {count} 个方案") } else { format!("已恢复全部 {count} 个方案") },
            Tone::Muted,
        );
    }

    fn remove_entry(&mut self, index: usize) {
        if index >= self.settings.entries.len() {
            return;
        }
        self.settings.entries.remove(index);
        self.selected = None;
        self.persist();
        self.notice_set("已移除方案".to_owned(), Tone::Muted);
    }

    fn next_check_label(&self) -> String {
        if self.busy {
            return "正在同步…".to_owned();
        }
        if self.settings.entries.is_empty() {
            return "待添加方案".to_owned();
        }
        let seconds = self.next_attempt.saturating_duration_since(Instant::now()).as_secs();
        format!("下次检查 {:02}:{:02}", seconds / 60, seconds % 60)
    }

    fn header(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.add_space(18.0);
            ui.label(RichText::new("◈").font(theme::heading(22.0)).color(theme::GOLD));
            ui.vertical(|ui| {
                ui.spacing_mut().item_spacing.y = 0.0;
                ui.label(RichText::new("poe2-filter").font(theme::heading(15.0)).color(theme::INK));
                ui.label(RichText::new("PATH OF EXILE 2 · 自动更新").size(9.5).color(theme::INK_MUTED));
            });
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.add_space(18.0);
                widgets::pill(ui, &format!("{} 个方案", self.settings.entries.len()), theme::INK_MUTED);
                widgets::pill(ui, &self.next_check_label(), theme::GOLD);
                if self.busy {
                    widgets::spinner(ui);
                }
            });
        });
    }

    fn link_card(&mut self, ui: &mut egui::Ui) {
        widgets::card(ui, |ui| {
            widgets::section_title(ui, "01", "添加订阅", "从网站复制订阅链接，粘贴后立即同步。");
            widgets::field_label(ui, "方案订阅链接");
            ui.add(
                egui::TextEdit::singleline(&mut self.link)
                    .hint_text("https://…/sync/…")
                    .desired_width(f32::INFINITY),
            );
            ui.add_space(10.0);
            let width = ui.available_width();
            if widgets::primary_button(ui, "添加方案", !self.busy, width).clicked() {
                self.add_entry();
            }
        });
    }

    fn directory_card(&mut self, ui: &mut egui::Ui) {
        widgets::card(ui, |ui| {
            widgets::section_title(ui, "02", "过滤器目录", "游戏读取过滤器的目录，必须是绝对路径。");
            widgets::field_label(ui, "本地目录");
            ui.add(
                egui::TextEdit::singleline(&mut self.directory)
                    .desired_width(f32::INFINITY),
            );
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                if widgets::secondary_button(ui, "浏览…", true, 74.0).clicked() {
                    if let Some(path) = platform::pick_directory() {
                        self.directory = path.to_string_lossy().to_string();
                    }
                }
                if widgets::secondary_button(ui, "打开目录", true, 86.0).clicked() {
                    let path = PathBuf::from(self.directory.trim());
                    if path.is_absolute() {
                        platform::open_directory(&path);
                    } else {
                        self.notice_set("目录必须是绝对路径".to_owned(), Tone::Ember);
                    }
                }
            });
        });
    }

    fn schedule_card(&mut self, ui: &mut egui::Ui) {
        widgets::card(ui, |ui| {
            widgets::section_title(ui, "03", "定时与启动", "关闭窗口后仍会留在托盘继续检查。");
            ui.horizontal(|ui| {
                ui.vertical(|ui| {
                    widgets::field_label(ui, "检查间隔（分钟）");
                    ui.add(egui::TextEdit::singleline(&mut self.minutes).desired_width(72.0));
                });
                ui.add_space(10.0);
                ui.vertical(|ui| {
                    ui.add_space(15.0);
                    ui.checkbox(&mut self.autostart, "开机启动");
                });
            });
            ui.add_space(10.0);
            let width = ui.available_width();
            if widgets::secondary_button(ui, "保存设置 / 目录", true, width).clicked() {
                self.save_settings();
            }
        });
    }

    fn entries_card(&mut self, ui: &mut egui::Ui) {
        widgets::card(ui, |ui| {
            ui.horizontal(|ui| {
                ui.label(RichText::new("订阅方案").size(13.5).strong().color(theme::INK));
                ui.label(
                    RichText::new(format!("{} 个", self.settings.entries.len()))
                        .size(10.0)
                        .color(theme::INK_MUTED),
                );
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if widgets::secondary_button(ui, "全部暂停 / 恢复", !self.busy, 0.0).clicked() {
                        self.toggle_all();
                    }
                    if widgets::secondary_button(ui, "全部更新", !self.busy, 0.0).clicked() {
                        self.start_update(None);
                    }
                });
            });
            ui.add_space(8.0);
            if self.settings.entries.is_empty() {
                widgets::empty_state(ui, "◈", "还没有订阅方案", "先在左侧粘贴网站生成的订阅链接。");
                return;
            }
            let count = self.settings.entries.len();
            let content_height = count as f32 * 96.0 + 12.0;
            let height = content_height.min((ui.available_height() - 6.0).max(180.0));
            egui::ScrollArea::vertical()
                .auto_shrink([false, false])
                .max_height(height)
                .show(ui, |ui| {
                    for index in 0..count {
                        self.entry_row(ui, index);
                    }
                });
        });
    }

    fn entry_row(&mut self, ui: &mut egui::Ui, index: usize) {
        let selected = self.selected == Some(index);
        let entry = self.settings.entries[index].clone();
        let title = if entry.name.is_empty() { "未命名方案".to_owned() } else { entry.name.clone() };
        let clicked = widgets::sub_card(ui, index, selected, |ui| {
            ui.vertical(|ui| {
                ui.spacing_mut().item_spacing.y = 4.0;
                ui.horizontal(|ui| {
                    ui.label(RichText::new(&title).size(13.0).strong().color(theme::INK));
                    if !entry.league.is_empty() {
                        widgets::pill(ui, &entry.league, theme::GOLD);
                    }
                    if entry.revoked {
                        widgets::pill(ui, "链接失效", theme::EMBER);
                    } else if entry.paused {
                        widgets::pill(ui, "已暂停", theme::INK_MUTED);
                    }
                });
                ui.horizontal(|ui| {
                    widgets::dot(ui, entry_tone(&entry));
                    ui.label(RichText::new(entry_status(&entry)).size(10.5).color(theme::INK_MUTED));
                });
            });
        });
        if clicked.clicked() {
            self.selected = Some(index);
            self.directory = entry.directory.to_string_lossy().to_string();
            self.notice_set(format!("已选中：{title}"), Tone::Muted);
        }
        if selected {
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                if widgets::secondary_button(ui, "更新", !self.busy, 0.0).clicked() {
                    self.start_update(Some(vec![index]));
                }
                let pause_label = if entry.paused { "恢复" } else { "暂停" };
                if widgets::secondary_button(ui, pause_label, !self.busy, 0.0).clicked() {
                    self.toggle_pause(index);
                }
                if widgets::secondary_button(ui, "回滚上一版", !self.busy, 0.0).clicked() {
                    self.start_rollback(index);
                }
                if widgets::danger_button(ui, "移除", !self.busy).clicked() {
                    self.remove_entry(index);
                }
            });
        }
        ui.add_space(6.0);
    }

    fn status_bar(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.add_space(18.0);
            widgets::dot(ui, self.notice_tone.color());
            ui.label(RichText::new(&self.notice).size(10.5).color(self.notice_tone.color()));
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.add_space(18.0);
                ui.label(
                    RichText::new(format!(
                        "v{} · {}",
                        env!("CARGO_PKG_VERSION"),
                        if self.busy { "同步中" } else { "空闲" }
                    ))
                    .size(9.5)
                    .color(theme::INK_MUTED),
                );
            });
        });
    }
}

fn entry_status(entry: &Entry) -> String {
    if entry.status.is_empty() {
        if entry.revoked {
            return "订阅已停用或密钥失效".to_owned();
        }
        if entry.paused {
            return "已暂停同步".to_owned();
        }
        return "等待首次同步".to_owned();
    }
    entry.status.clone()
}

fn entry_tone(entry: &Entry) -> Color32 {
    if entry.revoked {
        return theme::EMBER;
    }
    if entry.paused {
        return theme::INK_MUTED;
    }
    if entry.status.contains("最新") {
        return theme::SAGE;
    }
    let failing = ["失败", "不可用", "无效", "停用", "超过", "不存在", "保留", "读取"]
        .iter()
        .any(|keyword| entry.status.contains(keyword));
    if failing {
        return theme::EMBER;
    }
    if entry.status.is_empty() {
        return theme::INK_MUTED;
    }
    theme::GOLD
}

impl eframe::App for App {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll_tray(ctx);
        self.poll_worker();
        if !self.busy && Instant::now() >= self.next_attempt {
            self.start_update(None);
        }
        if !self.quit && ctx.input(|input| input.viewport().close_requested()) {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            ctx.send_viewport_cmd(egui::ViewportCommand::Visible(false));
        }
        ctx.request_repaint_after(Duration::from_millis(500));
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        egui::CentralPanel::default()
            .frame(Frame::NONE.fill(theme::BG))
            .show(ui, |ui| {
                ui.add_space(14.0);
                self.header(ui);
                widgets::separator(ui, 10.0);
                let body_height = (ui.available_height() - 32.0).max(300.0);
                ui.horizontal_top(|ui| {
                    ui.add_space(18.0);
                    ui.allocate_ui_with_layout(
                        Vec2::new(318.0, body_height),
                        Layout::top_down(Align::Min),
                        |ui| {
                            ui.spacing_mut().item_spacing.y = 10.0;
                            self.link_card(ui);
                            self.directory_card(ui);
                            self.schedule_card(ui);
                        },
                    );
                    ui.add_space(14.0);
                    let width = (ui.available_width() - 18.0).max(300.0);
                    ui.allocate_ui_with_layout(
                        Vec2::new(width, body_height),
                        Layout::top_down(Align::Min),
                        |ui| {
                            self.entries_card(ui);
                        },
                    );
                });
                widgets::separator(ui, 6.0);
                self.status_bar(ui);
            });
    }
}

pub fn run(tray_only: bool) -> eframe::Result<()> {
    unsafe {
        let mutex = CreateMutexW(
            std::ptr::null(),
            0,
            platform::wide("Local\\poe2-filter-client").as_ptr(),
        );
        if GetLastError() == ERROR_ALREADY_EXISTS {
            let existing = FindWindowW(std::ptr::null(), platform::wide(WINDOW_TITLE).as_ptr());
            if !existing.is_null() {
                ShowWindow(existing, SW_RESTORE);
                SetForegroundWindow(existing);
            }
            CloseHandle(mutex);
            return Ok(());
        }

        let root = sync::state_root();
        let settings = match sync::read_settings(&root) {
            Ok(settings) => settings,
            Err(error) => {
                error_box(&error);
                CloseHandle(mutex);
                return Ok(());
            }
        };
        let tray = match Tray::new() {
            Ok(tray) => Some(tray),
            Err(error) => {
                eprintln!("tray icon unavailable: {error}");
                None
            }
        };

        let options = eframe::NativeOptions {
            viewport: egui::ViewportBuilder::default()
                .with_title(WINDOW_TITLE)
                .with_inner_size([1040.0, 780.0])
                .with_min_inner_size([880.0, 640.0])
                .with_visible(!tray_only)
                .with_icon(egui::IconData { rgba: tray::icon_rgba(), width: 32, height: 32 }),
            centered: true,
            ..Default::default()
        };
        let result = eframe::run_native(
            "poe2-filter",
            options,
            Box::new(move |cc| Ok(Box::new(App::new(cc, root, settings, tray)))),
        );
        CloseHandle(mutex);
        result
    }
}

fn error_box(message: &str) {
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            platform::wide(message).as_ptr(),
            platform::wide("poe2-filter").as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

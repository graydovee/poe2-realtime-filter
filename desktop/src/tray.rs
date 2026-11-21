//! Tray icon and its context menu (open / update all / pause all / quit).

use tray_icon::{
    menu::{IsMenuItem, Menu, MenuEvent, MenuItem},
    Icon, TrayIcon, TrayIconBuilder, TrayIconEvent,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayCommand {
    Open,
    UpdateAll,
    ToggleAll,
    Quit,
}

pub struct Tray {
    _icon: TrayIcon,
    open: MenuItem,
    update: MenuItem,
    toggle: MenuItem,
    quit: MenuItem,
}

impl Tray {
    pub fn new() -> Result<Self, String> {
        let menu = Menu::new();
        let open = MenuItem::with_id("open", "打开窗口", true, None);
        let update = MenuItem::with_id("update", "全部更新", true, None);
        let toggle = MenuItem::with_id("toggle", "全部暂停 / 恢复", true, None);
        let quit = MenuItem::with_id("quit", "退出", true, None);
        let items: Vec<&dyn IsMenuItem> = vec![&open, &update, &toggle, &quit];
        menu.append_items(&items).map_err(|error| error.to_string())?;
        let logo = crate::brand::window_icon();
        let icon = Icon::from_rgba(logo.rgba, logo.width, logo.height)
            .map_err(|error| error.to_string())?;
        let tray = TrayIconBuilder::new()
            .with_menu(Box::new(menu))
            .with_tooltip("poe2-filter 过滤器自动更新")
            .with_icon(icon)
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self { _icon: tray, open, update, toggle, quit })
    }

    pub fn poll(&self) -> Vec<TrayCommand> {
        let mut commands = Vec::new();
        while let Ok(event) = MenuEvent::receiver().try_recv() {
            if event.id == *self.open.id() {
                commands.push(TrayCommand::Open);
            } else if event.id == *self.update.id() {
                commands.push(TrayCommand::UpdateAll);
            } else if event.id == *self.toggle.id() {
                commands.push(TrayCommand::ToggleAll);
            } else if event.id == *self.quit.id() {
                commands.push(TrayCommand::Quit);
            }
        }
        while let Ok(event) = TrayIconEvent::receiver().try_recv() {
            if matches!(event, TrayIconEvent::DoubleClick { .. }) {
                commands.push(TrayCommand::Open);
            }
        }
        commands
    }
}

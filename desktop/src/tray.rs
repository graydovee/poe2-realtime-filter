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
        let icon = Icon::from_rgba(icon_rgba(), 32, 32).map_err(|error| error.to_string())?;
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

/// 32x32 gold diamond on a dark tile, drawn procedurally so no binary asset is needed.
pub fn icon_rgba() -> Vec<u8> {
    let mut rgba = vec![0u8; 32 * 32 * 4];
    for y in 0..32i32 {
        for x in 0..32i32 {
            let index = ((y * 32 + x) * 4) as usize;
            let dx = x - 16;
            let dy = y - 16;
            let distance = dx.abs() + dy.abs();
            let (r, g, b, a) = if distance <= 7 {
                (232u8, 220u8, 196u8, 255u8)
            } else if dx * dx + dy * dy <= 15 * 15 {
                (19u8, 16u8, 12u8, 255u8)
            } else {
                (0u8, 0u8, 0u8, 0u8)
            };
            rgba[index] = r;
            rgba[index + 1] = g;
            rgba[index + 2] = b;
            rgba[index + 3] = a;
        }
    }
    rgba
}

//! PoE2 dark design tokens. Mirrors the web palette in app/globals.css (see docs/design-system.md).

use std::sync::Arc;

use eframe::egui::{
    self, Color32, CornerRadius, FontData, FontDefinitions, FontFamily, FontId, Stroke, TextStyle,
};

pub const BG: Color32 = Color32::from_rgb(10, 8, 6);
pub const SURFACE: Color32 = Color32::from_rgb(19, 16, 12);
pub const SURFACE_2: Color32 = Color32::from_rgb(25, 21, 16);
pub const SURFACE_3: Color32 = Color32::from_rgb(34, 28, 21);
pub const INPUT: Color32 = Color32::from_rgb(12, 10, 8);
pub const LINE: Color32 = Color32::from_rgb(43, 36, 26);
pub const LINE_STRONG: Color32 = Color32::from_rgb(61, 50, 35);
pub const INK: Color32 = Color32::from_rgb(232, 220, 196);
pub const INK_MUTED: Color32 = Color32::from_rgb(154, 139, 114);
pub const GOLD: Color32 = Color32::from_rgb(200, 164, 92);
pub const GOLD_BRIGHT: Color32 = Color32::from_rgb(228, 197, 127);
pub const GOLD_PRESS: Color32 = Color32::from_rgb(168, 133, 63);
pub const EMBER: Color32 = Color32::from_rgb(180, 67, 42);
pub const SAGE: Color32 = Color32::from_rgb(127, 168, 107);
pub const ON_GOLD: Color32 = Color32::from_rgb(11, 8, 5);

/// Ask DWM for the dark window frame so the native title bar matches the palette.
pub fn apply_dark_titlebar() {
    use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE};
    use windows_sys::Win32::UI::WindowsAndMessaging::FindWindowW;

    unsafe {
        let handle = FindWindowW(
            std::ptr::null(),
            crate::platform::wide(crate::app::WINDOW_TITLE).as_ptr(),
        );
        if handle.is_null() {
            return;
        }
        let enabled: i32 = 1;
        DwmSetWindowAttribute(
            handle,
            DWMWA_USE_IMMERSIVE_DARK_MODE as u32,
            &enabled as *const i32 as *const _,
            std::mem::size_of::<i32>() as u32,
        );
    }
}

pub fn display_family() -> FontFamily {
    FontFamily::Name("display".into())
}

pub fn heading(size: f32) -> FontId {
    FontId::new(size, display_family())
}

pub fn install(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();
    fonts.font_data.insert(
        "cinzel".to_owned(),
        Arc::new(FontData::from_static(include_bytes!("../assets/fonts/Cinzel.ttf"))),
    );
    fonts
        .families
        .insert(display_family(), vec!["cinzel".to_owned()]);
    fonts
        .families
        .entry(display_family())
        .or_default()
        .push("Ubuntu-Light".to_owned());
    ctx.set_fonts(fonts);

    ctx.set_theme(egui::Theme::Dark);
    let mut style = (*ctx.style_of(egui::Theme::Dark)).clone();
    style.text_styles = [
        (TextStyle::Heading, heading(16.0)),
        (TextStyle::Body, FontId::new(13.0, FontFamily::Proportional)),
        (TextStyle::Button, FontId::new(13.0, FontFamily::Proportional)),
        (TextStyle::Small, FontId::new(11.0, FontFamily::Proportional)),
        (TextStyle::Monospace, FontId::new(12.0, FontFamily::Monospace)),
    ]
    .into();
    style.spacing.item_spacing = egui::vec2(8.0, 8.0);
    style.spacing.button_padding = egui::vec2(10.0, 5.0);
    style.spacing.interact_size = egui::vec2(40.0, 28.0);
    style.spacing.text_edit_width = 200.0;
    style.spacing.combo_width = 120.0;
    style.animation_time = 0.12;
    style.visuals = visuals();
    ctx.set_style_of(egui::Theme::Dark, style);
}

fn widget_visuals(fill: Color32, stroke: Color32, text: Color32) -> egui::style::WidgetVisuals {
    egui::style::WidgetVisuals {
        bg_fill: fill,
        weak_bg_fill: fill,
        bg_stroke: Stroke::new(1.0, stroke),
        corner_radius: CornerRadius::same(4),
        fg_stroke: Stroke::new(1.0, text),
        expansion: 0.0,
    }
}

pub fn visuals() -> egui::Visuals {
    let mut visuals = egui::Visuals::dark();
    visuals.dark_mode = true;
    visuals.panel_fill = BG;
    visuals.window_fill = SURFACE;
    visuals.window_stroke = Stroke::new(1.0, LINE);
    visuals.window_corner_radius = CornerRadius::same(6);
    visuals.menu_corner_radius = CornerRadius::same(6);
    visuals.extreme_bg_color = INPUT;
    visuals.text_edit_bg_color = Some(SURFACE_3);
    visuals.faint_bg_color = SURFACE_2;
    visuals.code_bg_color = INPUT;
    visuals.weak_text_color = Some(INK_MUTED);
    visuals.hyperlink_color = GOLD;
    visuals.error_fg_color = EMBER;
    visuals.warn_fg_color = GOLD_BRIGHT;
    visuals.selection.bg_fill = Color32::from_rgba_unmultiplied(200, 164, 92, 55);
    visuals.selection.stroke = Stroke::new(1.0, GOLD);
    visuals.striped = false;
    visuals.widgets = egui::style::Widgets {
        noninteractive: widget_visuals(SURFACE, LINE, INK),
        inactive: widget_visuals(SURFACE_3, LINE, INK),
        hovered: widget_visuals(SURFACE_2, LINE_STRONG, GOLD_BRIGHT),
        active: widget_visuals(SURFACE_2, GOLD, GOLD),
        open: widget_visuals(SURFACE_2, LINE_STRONG, INK),
    };
    visuals
}

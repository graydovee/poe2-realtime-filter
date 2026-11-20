//! Small themed widget vocabulary shared by every card in the window.

use eframe::egui::{
    self, Color32, CornerRadius, Frame, Margin, RichText, Response, Stroke, Ui, Vec2,
};

use crate::theme;

pub const CARD_RADIUS: u8 = 6;

pub fn card<R>(ui: &mut Ui, add: impl FnOnce(&mut Ui) -> R) -> R {
    let mut inner = None;
    Frame::NONE
        .fill(theme::SURFACE)
        .stroke(Stroke::new(1.0, theme::LINE))
        .corner_radius(CornerRadius::same(CARD_RADIUS))
        .inner_margin(Margin::same(14))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            inner = Some(add(ui));
        });
    inner.expect("card content")
}

pub fn sub_card<R>(
    ui: &mut Ui,
    id: impl std::hash::Hash + std::fmt::Debug,
    active: bool,
    add: impl FnOnce(&mut Ui) -> R,
) -> Response {
    let fill = if active { theme::SURFACE_2 } else { theme::SURFACE_2.gamma_multiply(0.64) };
    let stroke = if active { theme::GOLD.gamma_multiply(0.7) } else { theme::LINE };
    let frame = Frame::NONE
        .fill(fill)
        .stroke(Stroke::new(1.0, stroke))
        .corner_radius(CornerRadius::same(4))
        .inner_margin(Margin::same(10))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            add(ui);
        });
    let response = ui.interact(
        frame.response.rect,
        ui.make_persistent_id(("sub_card", id)),
        egui::Sense::click(),
    );
    if response.hovered() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    response
}

pub fn section_title(ui: &mut Ui, step: &str, title: &str, description: &str) {
    ui.horizontal(|ui| {
        ui.label(RichText::new(step).font(theme::heading(11.0)).color(theme::GOLD));
        ui.vertical(|ui| {
            ui.spacing_mut().item_spacing.y = 2.0;
            ui.label(RichText::new(title).size(14.0).strong().color(theme::INK));
            ui.label(RichText::new(description).size(11.0).color(theme::INK_MUTED));
        });
    });
    ui.add_space(10.0);
}

pub fn field_label(ui: &mut Ui, text: &str) {
    ui.label(RichText::new(text).size(11.0).color(theme::INK_MUTED));
}

pub fn dot(ui: &mut Ui, color: Color32) {
    ui.label(RichText::new("●").size(9.0).color(color));
}

pub fn pill(ui: &mut Ui, text: &str, color: Color32) {
    Frame::NONE
        .fill(theme::SURFACE_2)
        .stroke(Stroke::new(1.0, color.gamma_multiply(0.55)))
        .corner_radius(CornerRadius::same(3))
        .inner_margin(Margin::symmetric(6, 2))
        .show(ui, |ui| {
            ui.label(RichText::new(text).size(9.5).color(color));
        });
}

pub fn primary_button(ui: &mut Ui, text: &str, enabled: bool, width: f32) -> Response {
    let mut response = None;
    ui.scope(|ui| {
        let widgets = &mut ui.visuals_mut().widgets;
        widgets.inactive.weak_bg_fill = theme::GOLD;
        widgets.inactive.bg_stroke = Stroke::new(1.0, theme::GOLD);
        widgets.inactive.fg_stroke = Stroke::new(1.0, theme::ON_GOLD);
        widgets.hovered.weak_bg_fill = theme::GOLD_BRIGHT;
        widgets.hovered.bg_stroke = Stroke::new(1.0, theme::GOLD_BRIGHT);
        widgets.hovered.fg_stroke = Stroke::new(1.0, theme::ON_GOLD);
        widgets.active.weak_bg_fill = theme::GOLD_PRESS;
        widgets.active.bg_stroke = Stroke::new(1.0, theme::GOLD_PRESS);
        widgets.active.fg_stroke = Stroke::new(1.0, theme::ON_GOLD);
        let label = RichText::new(text).size(12.5).strong().color(theme::ON_GOLD);
        response = Some(ui.add_enabled(
            enabled,
            egui::Button::new(label).min_size(Vec2::new(width, 32.0)),
        ));
    });
    response.expect("button")
}

pub fn secondary_button(ui: &mut Ui, text: &str, enabled: bool, width: f32) -> Response {
    let mut response = None;
    ui.scope(|ui| {
        let widgets = &mut ui.visuals_mut().widgets;
        for visuals in [&mut widgets.inactive, &mut widgets.hovered, &mut widgets.active] {
            visuals.weak_bg_fill = Color32::TRANSPARENT;
            visuals.bg_stroke = Stroke::new(1.0, theme::LINE_STRONG);
            visuals.fg_stroke = Stroke::new(1.0, theme::INK);
        }
        widgets.hovered.fg_stroke = Stroke::new(1.0, theme::GOLD_BRIGHT);
        widgets.hovered.bg_stroke = Stroke::new(1.0, theme::GOLD.gamma_multiply(0.6));
        let label = RichText::new(text).size(11.0);
        response = Some(ui.add_enabled(
            enabled,
            egui::Button::new(label).min_size(Vec2::new(width, 28.0)),
        ));
    });
    response.expect("button")
}

pub fn danger_button(ui: &mut Ui, text: &str, enabled: bool) -> Response {
    let mut response = None;
    ui.scope(|ui| {
        let widgets = &mut ui.visuals_mut().widgets;
        for visuals in [&mut widgets.inactive, &mut widgets.hovered, &mut widgets.active] {
            visuals.weak_bg_fill = Color32::TRANSPARENT;
            visuals.bg_stroke = Stroke::new(1.0, theme::EMBER.gamma_multiply(0.55));
            visuals.fg_stroke = Stroke::new(1.0, theme::EMBER);
        }
        widgets.hovered.fg_stroke = Stroke::new(1.0, theme::GOLD_BRIGHT);
        widgets.hovered.bg_stroke = Stroke::new(1.0, theme::EMBER);
        let label = RichText::new(text).size(11.0).color(theme::EMBER);
        response = Some(ui.add_enabled(
            enabled,
            egui::Button::new(label).min_size(Vec2::new(0.0, 28.0)),
        ));
    });
    response.expect("button")
}

pub fn separator(ui: &mut Ui, spacing: f32) {
    ui.add_space(spacing);
    let width = ui.available_width();
    let (rect, _) = ui.allocate_exact_size(Vec2::new(width, 1.0), egui::Sense::hover());
    ui.painter().rect_filled(rect, CornerRadius::ZERO, theme::LINE);
    ui.add_space(spacing);
}

pub fn spinner(ui: &mut Ui) {
    ui.label(RichText::new("⟳").size(14.0).color(theme::GOLD));
}

pub fn empty_state(ui: &mut Ui, glyph: &str, title: &str, description: &str) {
    ui.add_space(26.0);
    ui.vertical_centered(|ui| {
        ui.label(RichText::new(glyph).font(theme::heading(26.0)).color(theme::GOLD));
        ui.add_space(8.0);
        ui.label(RichText::new(title).size(13.0).strong().color(theme::INK));
        ui.add_space(4.0);
        ui.label(RichText::new(description).size(10.5).color(theme::INK_MUTED));
    });
    ui.add_space(26.0);
}

use std::sync::OnceLock;

use eframe::egui::{self, ColorImage, IconData, TextureHandle, TextureOptions};
use image::{imageops, ImageFormat, RgbaImage};

fn logo() -> &'static RgbaImage {
    static LOGO: OnceLock<RgbaImage> = OnceLock::new();
    LOGO.get_or_init(|| {
        image::load_from_memory_with_format(
            include_bytes!("../../public/brand/poe2-filter.png"),
            ImageFormat::Png,
        )
        .expect("decode the bundled poe2-filter logo")
        .into_rgba8()
    })
}

pub fn load_texture(ctx: &egui::Context) -> TextureHandle {
    let logo = logo();
    let pixels = ColorImage::from_rgba_unmultiplied(
        [logo.width() as usize, logo.height() as usize],
        logo.as_raw(),
    );
    ctx.load_texture("poe2-filter-logo", pixels, TextureOptions::LINEAR)
}

pub fn window_icon() -> IconData {
    let icon = imageops::resize(logo(), 48, 48, imageops::FilterType::Lanczos3);
    let (width, height) = icon.dimensions();
    IconData {
        rgba: icon.into_raw(),
        width,
        height,
    }
}

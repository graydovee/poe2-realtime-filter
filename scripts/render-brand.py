"""Render the shared logo and its small-size ICO variants with Pillow."""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
SCALE = 8


def render_logo() -> Image.Image:
    tile = Image.new("RGBA", (64 * SCALE, 64 * SCALE))
    draw = ImageDraw.Draw(tile)
    draw.rounded_rectangle(
        (SCALE, SCALE, 63 * SCALE - 1, 63 * SCALE - 1),
        radius=14 * SCALE,
        fill="black",
    )
    funnel = [(13, 15), (51, 15), (51, 20), (36, 35),
              (36, 49), (28, 49), (28, 35), (13, 20)]
    draw.polygon([(x * SCALE, y * SCALE) for x, y in funnel], fill="white")
    return tile


def main() -> None:
    artwork = render_logo()
    frames = [artwork.resize((size, size), Image.Resampling.LANCZOS) for size in SIZES]
    png = ROOT / "public" / "brand" / "poe2-filter.png"
    png.parent.mkdir(parents=True, exist_ok=True)
    frames[-1].save(png, optimize=True)
    frames[-1].save(ROOT / "app" / "favicon.ico", sizes=[frame.size for frame in frames],
                    append_images=frames[:-1])


if __name__ == "__main__":
    main()

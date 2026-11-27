/** 过滤器里的颜色：`R G B (A)`，每个分量 0–255。 */
export type FilterColor = {
  r: number;
  g: number;
  b: number;
  a: number;
  /** 文本里写了透明度。 */
  hasAlpha: boolean;
};

/** 色相 0–360，饱和度、明度、透明度 0–1。 */
export type Hsva = { h: number; s: number; v: number; a: number };

/** 调色盘里的一种颜色：过滤器的名字、界面上的名字和预览用的色值。 */
export type NamedColor = { name: string; label: string; value: string };

/** 读出 `R G B (A)`；没写透明度时按 255 算。 */
export function parseFilterColor(value?: string): FilterColor | undefined {
  const parts = (value ?? "").trim().split(/\s+/);
  if (parts[0] === "") return undefined;
  if ((parts.length !== 3 && parts.length !== 4) || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return undefined;
  return {
    r: Number(parts[0]),
    g: Number(parts[1]),
    b: Number(parts[2]),
    a: parts.length === 4 ? Number(parts[3]) : 255,
    hasAlpha: parts.length === 4,
  };
}

/** 写成 `R G B (A)`：透明度不是 255，或原文写了透明度时带上第四个分量。 */
export function formatFilterColor({ r, g, b, a, hasAlpha }: FilterColor): string {
  return `${r} ${g} ${b}` + (hasAlpha || a !== 255 ? ` ${a}` : "");
}

/** 转成 CSS 的 `rgba()`。 */
export function cssColor({ r, g, b, a }: Pick<FilterColor, "r" | "g" | "b" | "a">): string {
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

export function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  return "#" + [r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("");
}

/** 读出 `#rgb` 或 `#rrggbb`。 */
export function hexToRgb(value: string): { r: number; g: number; b: number } | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!match) return undefined;
  const full = match[1].length === 3 ? match[1].split("").map((part) => part + part).join("") : match[1];
  const number = Number.parseInt(full, 16);
  return { r: (number >> 16) & 255, g: (number >> 8) & 255, b: number & 255 };
}

/** 色相、饱和度、明度转成 0–255 的 RGB。 */
export function hsvToRgb({ h, s, v }: { h: number; s: number; v: number }): { r: number; g: number; b: number } {
  const chroma = v * s;
  const section = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const [r, g, b] =
    section < 1 ? [chroma, x, 0] : section < 2 ? [x, chroma, 0] : section < 3 ? [0, chroma, x] : section < 4 ? [0, x, chroma] : section < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const m = v - chroma;
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

/** 0–255 的 RGB 转成色相、饱和度、明度；灰色和黑白的色相记为 0。 */
export function rgbToHsv({ r, g, b }: { r: number; g: number; b: number }): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, v: max };
  const degrees = max === r / 255 ? ((g - b) / 255 / delta) % 6 : max === g / 255 ? (b - r) / 255 / delta + 2 : (r - g) / 255 / delta + 4;
  return { h: (degrees * 60 + 360) % 360, s: delta / max, v: max };
}

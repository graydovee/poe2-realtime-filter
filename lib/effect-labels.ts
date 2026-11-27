import { cssColor, parseFilterColor, rgbToHex, type NamedColor } from "./color";
import type { EffectPreset, RuleEffects } from "./types";

/** `MinimapIcon` 的形状，和 GGG 的过滤器文档一致。 */
export const mapIconShapes = [
  "Circle", "Star", "Diamond", "Square", "Pentagon", "Hexagon", "Triangle", "Cross", "Kite", "UpsideDownHouse", "Moon", "Raindrop",
] as const;
export type MapIconShape = (typeof mapIconShapes)[number];

/** 过滤器特效里的颜色与地图图标形状名称。 */
export const beamColorNames: Record<string, string> = {
  Red: "红色", Orange: "橙色", Yellow: "黄色", Green: "绿色", Blue: "蓝色", Cyan: "青色",
  Purple: "紫色", Pink: "粉色", White: "白色", Brown: "棕色", Grey: "灰色",
};

export const beamColorValues: Record<string, string> = {
  Red: "#ff4040", Orange: "#ff9c38", Yellow: "#ffe14d", Green: "#6bdc68", Blue: "#4995ff", Cyan: "#5ee4eb",
  Purple: "#b380f5", Pink: "#ff91cb", White: "#fff", Brown: "#a87950", Grey: "#9a9a9a",
};

/** 光柱和地图图标可选的固定颜色，即调色盘里的顺序。 */
export const beamColors: NamedColor[] = Object.keys(beamColorNames).map((name) => ({
  name, label: beamColorNames[name], value: beamColorValues[name],
}));

/** 地图图标的尺寸：`MinimapIcon` 的第一个参数，0 最大。 */
export const mapIconSizes = [
  { value: "0", label: "大" }, { value: "1", label: "中" }, { value: "2", label: "小" },
];

/** 地图图标尺寸在界面上的叫法。 */
export function mapIconSizeName(size?: string): string | undefined {
  return size === undefined ? undefined : mapIconSizes.find((option) => option.value === size)?.label ?? size;
}

export const mapIconShapeNames: Record<MapIconShape, string> = {
  Circle: "圆形", Star: "星形", Diamond: "菱形", Square: "方形", Pentagon: "五边形", Hexagon: "六边形",
  Triangle: "三角", Cross: "十字", Kite: "风筝", UpsideDownHouse: "倒屋", Moon: "月亮", Raindrop: "水滴",
};

/** `shape` 是过滤器支持的地图图标形状。 */
export function isMapIconShape(shape?: string): shape is MapIconShape {
  return shape !== undefined && (mapIconShapes as readonly string[]).includes(shape);
}

/** 地图图标形状的中文名；形状不受支持时返回 undefined。 */
export function mapIconShapeName(shape?: string): string | undefined {
  return isMapIconShape(shape) ? mapIconShapeNames[shape] : undefined;
}

export function rgbaFromHex(value: string, alpha: number) {
  const hexValue = value.replace("#", "");
  const full = hexValue.length === 3 ? hexValue.split("").map((part) => part + part).join("") : hexValue;
  const number = Number.parseInt(full, 16);
  if (!Number.isFinite(number) || full.length !== 6) return "rgba(255,255,255," + alpha + ")";
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return "rgba(" + red + "," + green + "," + blue + "," + alpha + ")";
}

/** 把过滤器里的 `R G B (A)` 颜色转成 CSS rgba()。 */
export function rgba(value?: string, fallback = "transparent") {
  const color = parseFilterColor(value);
  return color ? cssColor(color) : fallback;
}

/** 把过滤器里的 `R G B (A)` 颜色转成 #rrggbb。 */
export function hex(value?: string) {
  const color = parseFilterColor(value);
  return color ? rgbToHex(color) : (value || "—");
}

/** `MinimapIcon` 的参数：`尺寸 颜色 形状`。 */
export function iconParts(icon?: string) {
  const [size, color, shape] = icon?.split(" ") ?? [];
  return { size, color, shape };
}

/** 换掉 `MinimapIcon` 的一项；原来缺的项用 `defaults` 补齐。`value` 留空表示不显示图标。 */
export function withIconPart(
  icon: string | undefined,
  part: "size" | "color" | "shape",
  value: string,
  defaults: { size: string; color: string; shape: string },
): string {
  if (!value) return "";
  const current = iconParts(icon);
  return (["size", "color", "shape"] as const).map((key) => (key === part ? value : current[key] || defaults[key])).join(" ");
}

/** 把一套完整特效描述成中文，用于预设列表与「当前预设」回显。 */
export function describeEffects(effects: RuleEffects): string {
  const parts: string[] = [];
  if (effects.beam) {
    const [color, temporary] = effects.beam.split(" ");
    parts.push((beamColorNames[color] ?? color) + "光柱" + (temporary ? "（临时）" : ""));
  }
  if (effects.icon) {
    const { size, color, shape } = iconParts(effects.icon);
    parts.push((beamColorNames[color] ?? color ?? "") + (mapIconShapeName(shape) ?? shape ?? "") + "图标" + (size ? "·" + mapIconSizeName(size) : ""));
  }
  if (effects.font) {
    const font = effects.font;
    const bits = [font.fontSize ? font.fontSize + "号" : "", hex(font.textColor), hex(font.borderColor), hex(font.backgroundColor)].filter(Boolean);
    parts.push("字体 " + bits.join(" / "));
  }
  if (effects.sound) {
    parts.push(effects.sound.type === "builtin" ? "音效 " + effects.sound.id : "音效 " + effects.sound.fileName);
  }
  return parts.length ? parts.join(" · ") : "跟随基础过滤器";
}

export function describeIcon(icon: string) {
  const { size, color, shape } = iconParts(icon);
  return (beamColorNames[color] ?? color) + (mapIconShapeName(shape) ?? shape) + " · " + (mapIconSizeName(size) ?? "?");
}

/** 取出预设里实际填写的特效项，空项不写入规则。 */
export function pickEffects(preset: EffectPreset): RuleEffects {
  return {
    ...(preset.beam ? { beam: preset.beam } : {}),
    ...(preset.icon ? { icon: preset.icon } : {}),
    ...(preset.font ? { font: preset.font } : {}),
    ...(preset.sound ? { sound: preset.sound } : {}),
  };
}

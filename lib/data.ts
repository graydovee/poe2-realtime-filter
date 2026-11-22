import catalogData from "../data/item-catalog.json";
import effectsData from "../data/neversink-effects.json";
import rulesData from "../data/default-rules.json";
import mechanicsData from "../data/item-mechanics.json";
import type { EffectPresets, FilterRule, ItemDefinition, Locale, MarketSnapshot, Strictness } from "./types";

export const STRICTNESS_LABELS: Record<Strictness, string> = {
  0: "宽松",
  1: "普通",
  2: "半严格",
  3: "严格",
  4: "非常严格",
  5: "超级严格",
  6: "终极严格",
};

export const STYLE_LABELS = {
  default: "Classic",
  aura: "Aura",
  cobalt: "Cobalt",
  darkmode: "Dark Mode",
  mythic: "Mythic",
  vaal: "Vaal",
  zen: "Zen",
  customsounds: "Custom Sounds",
} as const;

export const LOCALE_LABELS: Record<Locale, string> = {
  cn: "简体中文",
  tw: "繁體中文",
  us: "English",
};

export const CATEGORY_LABELS: Record<string, Record<Locale, string>> = {
  currency: { cn: "通货", tw: "通貨", us: "Currency" },
  rune: { cn: "符文", tw: "符文", us: "Runes" },
  "soul-core": { cn: "灵魂核心", tw: "靈魂核心", us: "Soul Cores" },
  map: { cn: "地图", tw: "地圖", us: "Maps" },
  unique: { cn: "暗金", tw: "暗金", us: "Uniques" },
  base: { cn: "装备基底", tw: "裝備基底", us: "Bases" },
  essence: { cn: "精华", tw: "精華", us: "Essences" },
  fragment: { cn: "碎片", tw: "碎片", us: "Fragments" },
  flask: { cn: "药剂", tw: "藥劑", us: "Flasks" },
  gem: { cn: "宝石", tw: "寶石", us: "Gems" },
};

/** 通货与材料的分组词条与展示顺序，由 scripts/build-item-mechanics.mjs 生成（跟随 poe.ninja 标签页）。 */
export const TAXONOMY = mechanicsData as {
  order: string[];
  groups: Record<string, Record<Locale, string>>;
  items: Record<string, { mechanic: string; evidence: string }>;
};

/** 基础过滤器里出现过的完整特效（光柱 + 图标 + 字体 + 音效），按视觉风格分组。 */
export const EFFECT_PRESETS = effectsData as EffectPresets;

/** 某些风格在 vendored 文件里缺失时回落到 default 的预设。 */
export function effectPresetsFor(style: string) {
  return EFFECT_PRESETS.styles[style] ?? EFFECT_PRESETS.styles.default ?? [];
}

/** 默认 4 条价格规则（崇高石 / 混沌石 / 剥离石 / 神圣石），由 scripts/extract-neversink-effects.mjs 生成。 */
export const DEFAULT_RULES = (rulesData as { rules: FilterRule[] }).rules;

export const ITEM_CATALOG = catalogData.items as ItemDefinition[];

export const FALLBACK_SNAPSHOT: MarketSnapshot = {
  league: "Standard",
  capturedAt: "1970-01-01T00:00:00.000Z",
  expiresAt: "1970-01-01T00:00:00.000Z",
  source: "No market data",
  prices: {},
};

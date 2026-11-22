import catalogData from "../data/item-catalog.json";
import rulesData from "../data/default-rules.json";
import mechanicsData from "../data/item-mechanics.json";
import type { FilterRule, ItemDefinition, Locale, MarketSnapshot, Strictness } from "./types";

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

export const ITEM_CATALOG = catalogData.items as ItemDefinition[];

const craftingItemIds = ITEM_CATALOG.filter((item) => item.categoryPath[0] === "crafting").map((item) => item.id);

/** 新方案的四个价格档，每档默认匹配整个「通货与材料」分类。 */
export const DEFAULT_RULES: FilterRule[] = (rulesData as { rules: FilterRule[] }).rules.map((rule) => ({
  id: rule.id, name: rule.name, enabled: true, hidden: false, autoRange: true, followBaseline: true,
  target: { ...rule.target, itemIds: [...craftingItemIds], itemEnabled: true },
  effects: {},
}));

export const FALLBACK_SNAPSHOT: MarketSnapshot = {
  league: "Standard",
  capturedAt: "1970-01-01T00:00:00.000Z",
  expiresAt: "1970-01-01T00:00:00.000Z",
  source: "No market data",
  prices: {},
};

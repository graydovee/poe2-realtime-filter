import catalogData from "../data/item-catalog.json";
import dropData from "../data/item-drop-metadata.json";
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

const itemMetadata: Record<string, { icon?: string; dropLevel?: number | null }> = dropData.items;
const uniqueNames: Record<string, Record<string, string | null>> = dropData.uniques;
const localizedUniqueNames: Record<string, { cn: string; tw: string }> = dropData.localizedUniqueNames;
const stackableNames = new Set(dropData.stackable);
const wikiImage = (path?: string | null) => path ? `https://www.poe2wiki.net/images/${path}` : undefined;

// 未切割宝石每个等级是一件独立物品，掉落数据和图标仍按不带等级后缀的基底名查。
export const ITEM_CATALOG: ItemDefinition[] = (catalogData.items as ItemDefinition[]).map((item) => {
  const metadataKey = item.name.replace(/ \(Level \d+\)$/, "");
  return {
    ...item,
    stackable: stackableNames.has(metadataKey),
    dropLevel: itemMetadata[metadataKey]?.dropLevel ?? undefined,
    iconUrl: wikiImage(itemMetadata[metadataKey]?.icon),
  };
});

function equipmentPath(item: ItemDefinition, group: "normal-bases" | "unique-equipment") {
  const [, kind, type] = item.categoryPath;
  const oneHand = new Set(["one-hand-maces", "wands", "sceptres", "spears"]);
  const category = kind === "weapons" ? oneHand.has(type) ? "one-hand" : "two-hand" : kind;
  return ["equipment", group, category, ...(type ? [type] : [])];
}

const equipment = ITEM_CATALOG.filter((item) => item.categoryPath[0] === "equipment" && !item.ambiguous && item.matcher.baseType);
const equipmentIds = new Set(equipment.map((item) => item.id));
const baseVariants = equipment.map((item): ItemDefinition => ({
  ...item,
  id: `base:${item.id}`,
  marketItemId: item.id,
  categoryPath: equipmentPath(item, "normal-bases"),
  matcher: { ...item.matcher, nonUnique: true },
}));
const uniqueVariants = equipment.flatMap((item): ItemDefinition[] => {
  const names = uniqueNames[item.name];
  if (!names || !item.matcher.baseType) return [];
  const variants = Object.keys(names).sort();
  const label = variants.join(" / ");
  return [{
    ...item,
    id: `unique:${item.id}`,
    name: label,
    localeNames: {
      cn: variants.map((name) => localizedUniqueNames[name]?.cn ?? name).join(" / "),
      tw: variants.map((name) => localizedUniqueNames[name]?.tw ?? name).join(" / "),
      us: label,
    },
    searchNames: Object.values(item.localeNames),
    category: "unique",
    categoryPath: equipmentPath(item, "unique-equipment"),
    matcher: { ...item.matcher, rarity: "Unique" },
    priceable: false,
    dropLevel: undefined,
    iconUrl: (variants.length === 1 ? wikiImage(names[variants[0]]) : undefined) ?? item.iconUrl,
  }];
});

export const FILTER_ITEMS = [...ITEM_CATALOG, ...baseVariants, ...uniqueVariants];
export const FILTER_ITEMS_BY_ID = new Map(FILTER_ITEMS.map((item) => [item.id, item]));
export const PICKER_ITEMS = [...ITEM_CATALOG.filter((item) => !equipmentIds.has(item.id)), ...baseVariants, ...uniqueVariants];
export const marketItemId = (item: ItemDefinition) => item.marketItemId ?? item.id;

const craftingItemIds = ITEM_CATALOG.filter((item) => item.categoryPath[0] === "crafting").map((item) => item.id);

/** 新方案的四个价格档，每档默认匹配整个「通货与材料」分类。 */
export const DEFAULT_RULES: FilterRule[] = (rulesData as { rules: FilterRule[] }).rules.map((rule) => ({
  id: rule.id, name: rule.name, enabled: true, hidden: false, followBaseline: true,
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

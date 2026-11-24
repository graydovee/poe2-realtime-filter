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

const ONE_HAND_TYPES = new Set(["one-hand-maces", "wands", "sceptres", "spears"]);

/** 装备在选择器里的分类：普通基底和传奇各一棵树，武器再按单手 / 双手分开。入参是目录里的装备路径（装备 › 类别 › 类型）。 */
function equipmentPath(path: string[], group: "normal-bases" | "unique-equipment") {
  const [, kind, type] = path;
  const category = kind === "weapons" ? ONE_HAND_TYPES.has(type ?? "") ? "one-hand" : "two-hand" : kind;
  return ["equipment", group, category, ...(type ? [type] : [])];
}

const equipment = ITEM_CATALOG.filter((item) => item.categoryPath[0] === "equipment" && !item.ambiguous && item.matcher.baseType);
const equipmentIds = new Set(equipment.map((item) => item.id));
const baseVariants = equipment.map((item): ItemDefinition => ({
  ...item,
  id: `base:${item.id}`,
  marketItemId: item.id,
  categoryPath: equipmentPath(item.categoryPath, "normal-bases"),
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
    categoryPath: equipmentPath(item.categoryPath, "unique-equipment"),
    matcher: { ...item.matcher, rarity: "Unique" },
    priceable: false,
    dropLevel: undefined,
    iconUrl: (variants.length === 1 ? wikiImage(names[variants[0]]) : undefined) ?? item.iconUrl,
  }];
});

// 整类条目（只有 Class 条件）不是可选物品：一个分类被全选时，生成器自动换成一条 Class 条件。
// 装备类型的整类条目（项链、弓……）按普通基底 / 传奇各派生一个带稀有度的变体，对应选择器里的两棵装备树；
// 其余整类条目代表它所在分类的全部逐件物品。
// 这一段会打进桌面引擎，在 QuickJS 里执行：只用 es2021 以内的库函数（不要用 Array.prototype.at 之类）。
const classEntries = ITEM_CATALOG.filter((item) => item.matcher.class);
/** 装备的整类条目都放在装备树里（珠宝直接在装备下，其余在类型下），对应选择器里的普通基底 / 传奇两棵树。 */
const isEquipmentType = (path: string[]) => path[0] === "equipment" && path.length >= 3;
/** 装备之外的整类条目：在分类末尾的 class-selection 分组里，或者在分类自己名下（远征日志）。根分类下的标记不算。 */
const classMatchPath = (path: string[]): string[] | undefined =>
  path[path.length - 1] === "class-selection" ? (path.length >= 3 ? path.slice(0, -1) : undefined) : path;
const equipmentClassVariants = classEntries
  .filter((item) => isEquipmentType(item.categoryPath))
  // 去掉末尾的整类标记，剩下的就是目录里的装备路径；珠宝直接在装备下，没有类型段。
  .map((item) => ({ item, path: item.categoryPath.slice(0, -1) }))
  .flatMap(({ item, path }): ItemDefinition[] => [
    { ...item, id: `base:${item.id}`, categoryPath: equipmentPath(path, "normal-bases"), matcher: { class: item.matcher.class, nonUnique: true }, ambiguous: false },
    { ...item, id: `unique:${item.id}`, categoryPath: equipmentPath(path, "unique-equipment"), matcher: { class: item.matcher.class, rarity: "Unique" }, ambiguous: false },
  ]);

export const FILTER_ITEMS = [...ITEM_CATALOG, ...baseVariants, ...uniqueVariants, ...equipmentClassVariants];
export const FILTER_ITEMS_BY_ID = new Map(FILTER_ITEMS.map((item) => [item.id, item]));
const concreteItems = [...ITEM_CATALOG.filter((item) => !equipmentIds.has(item.id) && !item.matcher.class), ...baseVariants, ...uniqueVariants];
export const marketItemId = (item: ItemDefinition) => item.marketItemId ?? item.id;

export type ClassMatch = { path: string[]; item: ItemDefinition; members: ItemDefinition[] };

/**
 * 整类匹配登记表：一条记录 = 一条 Class 条件 + 它代表的选择器分类 + 该分类下的逐件物品。
 * 登记了的整类条目可以被生成器输出；没登记的照旧跳过：
 * - Stackable Currency：它的范围比「通货与材料」小（符文、灵魂核心不属于这个类别）；
 * - 「其他」、通货与材料根分类下的几个标记，和那里的逐件物品不是一回事；
 * - Instance Local Items：不是任务物品，和 Quest Items 挤在同一个分类里；
 * - Augment：目录把它放在石板分类下，但它是符文、灵魂核心那一类（游戏在 2025 年 12 月把 Socketable
 *   改名成了 Augment，见 GGG 的过滤器更新公告；NeverSink 0.10.4 里 Class == "Augment" 搭配的也是符文
 *   和灵魂核心）。石板对应的是 Tablet，这里不登记，石板照旧逐件输出。
 * 类别和物品的对应关系由 tests/class-matches.test.mjs 对照内置的 NeverSink 过滤器核对。
 */
const UNREGISTERED_CLASSES = new Set(["Instance Local Items", "Augment"]);
export const CLASS_MATCHES: ClassMatch[] = [
  ...classEntries
    .filter((item) => !isEquipmentType(item.categoryPath) && !UNREGISTERED_CLASSES.has(item.name))
    .flatMap((item) => {
      const path = classMatchPath(item.categoryPath);
      return path ? [{ path, item }] : [];
    }),
  ...equipmentClassVariants.map((item) => ({ path: item.categoryPath, item })),
].map((match) => ({ ...match, members: concreteItems.filter((item) => item.categoryPath.join("/") === match.path.join("/")) }));
export const CLASS_MATCH_BY_ID = new Map(CLASS_MATCHES.map((match) => [match.item.id, match]));
/** 每件逐件物品属于哪条整类匹配，生成器用它判断后面的规则有没有被整类块覆盖。 */
export const CLASS_OF_ITEM = new Map(CLASS_MATCHES.flatMap((match) => match.members.map((item): [string, ClassMatch] => [item.id, match])));

/** 没有逐件物品的分类（换界石、远征日志、任务物品）只能整类选择：选择器里保留这个分类，全选时直接保存整类条目。 */
export const CLASS_ONLY_ITEMS: ItemDefinition[] = CLASS_MATCHES
  .filter((match) => !match.members.length && !equipmentClassVariants.includes(match.item))
  .map((match) => ({ ...match.item, categoryPath: match.path }));

export const PICKER_ITEMS = [...concreteItems, ...CLASS_ONLY_ITEMS];

const craftingItemIds = ITEM_CATALOG.filter((item) => item.categoryPath[0] === "crafting" && !item.matcher.class).map((item) => item.id);

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

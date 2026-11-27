import catalogData from "../data/item-catalog.json";
import dropData from "../data/item-drop-metadata.json";
import rulesData from "../data/default-rules.json";
import { deriveCatalogView, projectShareCatalog } from "./catalog-view";
import type { FilterRule, ItemDefinition, Locale, MarketSnapshot, Strictness } from "./types";

export type { ClassMatch } from "./catalog-view";

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

const catalogView = deriveCatalogView(catalogData.items as ItemDefinition[], dropData);
export const {
  itemCatalog: ITEM_CATALOG,
  filterItems: FILTER_ITEMS,
  classMatches: CLASS_MATCHES,
  classOnlyItems: CLASS_ONLY_ITEMS,
  pickerItems: PICKER_ITEMS,
} = catalogView;
export const FILTER_ITEMS_BY_ID = new Map(FILTER_ITEMS.map((item) => [item.id, item]));
export const marketItemId = (item: ItemDefinition) => item.marketItemId ?? item.id;
export const CLASS_MATCH_BY_ID = new Map(CLASS_MATCHES.map((match) => [match.item.id, match]));
/** 每件逐件物品属于哪条整类匹配，生成器用它判断后面的规则有没有被整类块覆盖。 */
export const CLASS_OF_ITEM = new Map(CLASS_MATCHES.flatMap((match) => match.members.map((item) => [item.id, match] as const)));

/** 物品目录的版本，写在分享码里。旧的分享地址无法继续沿用时加一。 */
export const CATALOG_VERSION: number = catalogData.catalogVersion;
export const shareCatalog = () => ({
  ...projectShareCatalog(catalogData.shareGroups, catalogView, catalogData.shareTree),
  version: CATALOG_VERSION,
});
/** 分享码槽位里记着、物品目录里已经没有的物品。读取方案时把它们去掉。 */
export const RETIRED_ITEM_IDS: ReadonlySet<string> = new Set(
  Object.values(catalogData.shareGroups)
    .flatMap((group) => Object.keys(group.slots))
    .filter((id) => !FILTER_ITEMS_BY_ID.has(id)),
);

/** 价格档默认匹配的四个分类：通货、玩法、符文和精髓，也就是按件计价的通货和材料。 */
const PRICED_ROOTS = new Set(["currency", "gameplay", "runes", "essences"]);
const pricedItemIds = ITEM_CATALOG.filter((item) => PRICED_ROOTS.has(item.categoryPath[0]) && !item.matcher.class).map((item) => item.id);

/** 四个价格档各自跟随的通货，按规则 ID 对应。 */
export const DEFAULT_EFFECT_ITEMS = {
  "default-exalted": "exalted-orb",
  "default-chaos": "chaos-orb",
  "default-annulment": "orb-of-annulment",
  "default-divine": "divine-orb",
} as const;

export function legacyEffectItemId(ruleId: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(DEFAULT_EFFECT_ITEMS, ruleId)
    ? DEFAULT_EFFECT_ITEMS[ruleId as keyof typeof DEFAULT_EFFECT_ITEMS]
    : undefined;
}

/** 新方案的四个价格档，每档默认匹配通货、玩法、符文和精髓四个分类里的物品。 */
export const DEFAULT_RULES: FilterRule[] = (rulesData as { rules: FilterRule[] }).rules.map((rule) => ({
  id: rule.id, name: rule.name, enabled: true, hidden: false, baselineEffectItemId: legacyEffectItemId(rule.id),
  target: { ...rule.target, itemIds: [...pricedItemIds], itemEnabled: true },
  effects: {},
}));

export const FALLBACK_SNAPSHOT: MarketSnapshot = {
  league: "Standard",
  capturedAt: "1970-01-01T00:00:00.000Z",
  expiresAt: "1970-01-01T00:00:00.000Z",
  source: "No market data",
  prices: {},
};

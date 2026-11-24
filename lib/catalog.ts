import { CLASS_MATCH_BY_ID, TAXONOMY } from "./data";
import type { ItemDefinition, Locale } from "./types";

const GROUP_NAMES: Record<string, [string, string, string]> = {
  "normal-bases": ["普通装备基底", "普通裝備基底", "Normal Bases"],
  "unique-equipment": ["传奇装备", "傳奇裝備", "Unique Equipment"],
  "one-hand": ["单手武器", "單手武器", "One-Handed Weapons"],
  "two-hand": ["双手武器", "雙手武器", "Two-Handed Weapons"],
  equipment: ["装备", "裝備", "Equipment"], weapons: ["武器", "武器", "Weapons"],
  armour: ["防具", "防具", "Armour"], jewellery: ["饰品", "飾品", "Jewellery"], offhands: ["副手", "副手", "Offhands"],
  wands: ["法杖", "法杖", "Wands"], staves: ["长杖", "長杖", "Staves"], bows: ["弓", "弓", "Bows"],
  "one-hand-maces": ["单手锤", "單手錘", "One Hand Maces"], "two-hand-maces": ["双手锤", "雙手錘", "Two Hand Maces"],
  crossbows: ["弩", "弩", "Crossbows"], quarterstaves: ["长棍", "長棍", "Quarterstaves"],
  sceptres: ["权杖", "權杖", "Sceptres"], spears: ["矛", "矛", "Spears"], talismans: ["魔符", "魔符", "Talismans"],
  amulets: ["项链", "項鏈", "Amulets"], rings: ["戒指", "戒指", "Rings"], belts: ["腰带", "腰帶", "Belts"],
  quivers: ["箭袋", "箭袋", "Quivers"], shields: ["盾牌", "盾牌", "Shields"], foci: ["法器", "法器", "Foci"], bucklers: ["轻盾", "輕盾", "Bucklers"],
  gloves: ["手套", "手套", "Gloves"], boots: ["鞋子", "鞋子", "Boots"], "body-armour": ["胸甲", "胸甲", "Body Armours"], helmets: ["头盔", "頭盔", "Helmets"],
  jewels: ["珠宝", "珠寶", "Jewels"], relics: ["遗物", "遺物", "Relics"],
  crafting: ["通货与材料", "通貨與材料", "Currency & Materials"], currency: ["基础通货", "基礎通貨", "Currency"],
  essences: ["精华", "精華", "Essences"], catalysts: ["催化剂", "催化劑", "Catalysts"], shards: ["通货碎片", "通貨碎片", "Currency Shards"],
  emotions: ["液化情绪", "液化情緒", "Liquid Emotions"], omens: ["预兆", "預兆", "Omens"], socketables: ["插槽物品", "插槽物品", "Socketables"],
  runes: ["符文", "符文", "Runes"], "soul-cores": ["灵魂核心", "靈魂核心", "Soul Cores"], "socketables-other": ["其他插槽物品", "其他插槽物品", "Other Socketables"],
  supplies: ["药剂与咒符", "藥劑與咒符", "Flasks & Charms"], flasks: ["药剂", "藥劑", "Flasks"], life: ["生命药剂", "生命藥劑", "Life Flasks"], mana: ["魔力药剂", "魔力藥劑", "Mana Flasks"], charms: ["咒符", "咒符", "Charms"],
  gems: ["宝石", "寶石", "Gems"], "rune-gems": ["符文宝石", "符文寶石", "Rune Gems"], "blood-gems": ["血脉宝石", "血脈寶石", "Blood Gems"],
  "uncut-skill-gems": ["未切割的技能宝石", "未切割的技能寶石", "Uncut Skill Gems"], "uncut-spirit-gems": ["未切割的精魂宝石", "未切割的精魂寶石", "Uncut Spirit Gems"],
  "uncut-support-gems": ["未切割的辅助宝石", "未切割的輔助寶石", "Uncut Support Gems"],
  endgame: ["地图与终局", "地圖與終局", "Maps & Endgame"], fragments: ["碎片", "碎片", "Fragments"], trials: ["试炼物品", "試煉物品", "Trials"],
  ultimatums: ["通牒", "通牒", "Ultimatums"], baryas: ["试炼硬币", "試煉硬幣", "Baryas"], "vault-keys": ["宝库钥匙", "寶庫鑰匙", "Vault Keys"],
  "pinnacle-keys": ["巅峰钥匙", "巔峰鑰匙", "Pinnacle Keys"], logbooks: ["远征日志", "遠征日誌", "Expedition Logbooks"],
  incubators: ["孕育器", "孕育器", "Incubators"], tablets: ["石板", "碑牌", "Tablets"], waystones: ["换界石", "換界石", "Waystones"],
  other: ["其他", "其他", "Other"], "quest-items": ["任务物品", "任務物品", "Quest Items"], "special-items": ["特殊物品", "特殊物品", "Special Items"],
  "other-items": ["其他物品", "其他物品", "Other Items"],
};

const LOCALE_INDEX: Record<Locale, number> = { cn: 0, tw: 1, us: 2 };

/** 通货与材料之外还要固定顺序的分组：宝石下面的子类，未切割的按等级排在前面。 */
const EXTRA_ORDER = ["uncut-skill-gems", "uncut-spirit-gems", "uncut-support-gems", "blood-gems", "rune-gems"];
const GROUP_ORDER = [...TAXONOMY.order, ...EXTRA_ORDER];

/**
 * 分类菜单的展示顺序：通货与材料跟随 poe.ninja 侧栏（基础通货、碎片、深渊骨骸、
 * 精华、预兆、探险…），其余分支保持原本的插入顺序。
 */
export function groupOrder(key: string): number {
  const index = GROUP_ORDER.indexOf(key);
  return index >= 0 ? index : 500;
}

/** 分组名优先取数据文件里的玩法词条（通货与材料），其余回落到内置装备词条。 */
export function groupName(key: string, locale: Locale): string {
  const taxonomy = TAXONOMY.groups[key];
  if (taxonomy) return taxonomy[locale] ?? taxonomy.us ?? key;
  return GROUP_NAMES[key]?.[LOCALE_INDEX[locale]] ?? key;
}
export type CatalogNode = { key: string; path: string[]; items: ItemDefinition[]; children: CatalogNode[] };

export function buildCatalogTree(items: ItemDefinition[]): CatalogNode {
  const root: CatalogNode = { key: "root", path: [], items: [], children: [] };
  for (const item of items) {
    let node = root;
    for (const key of item.categoryPath) {
      let child = node.children.find((child) => child.key === key);
      if (!child) { child = { key, path: [...node.path, key], items: [], children: [] }; node.children.push(child); }
      node = child;
    }
    node.items.push(item);
  }
  return root;
}

/**
 * 物品在选择器里的名字。换界石、远征日志、任务物品这类条目代表它所在的整个分类，目录里只有英文类名，
 * 所以按分类名来叫（「换界石」）；界面上把它当成普通物品，不区分整类还是逐件。
 */
export function itemLabel(item: ItemDefinition, locale: Locale): string {
  const match = CLASS_MATCH_BY_ID.get(item.id);
  return match ? groupName(match.path[match.path.length - 1], locale) : item.localeNames[locale] || item.name;
}

export function catalogNode(root: CatalogNode, path: string[]): CatalogNode | undefined {
  let node = root;
  for (const key of path) { const next = node.children.find((child) => child.key === key); if (!next) return undefined; node = next; }
  return node;
}
export function catalogItems(node: CatalogNode): ItemDefinition[] {
  return [...node.items, ...node.children.flatMap(catalogItems)];
}
export function searchCatalog(items: ItemDefinition[], query: string): ItemDefinition[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return items;
  return items.filter((item) => [item.name, item.matcher.baseType, ...(item.searchNames ?? []), ...Object.values(item.localeNames)].some((name) => name?.toLocaleLowerCase().includes(normalized)));
}
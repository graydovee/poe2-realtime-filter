import type { ItemDefinition, Locale, MarketSnapshot, Strictness } from "./types";

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

export const ITEM_CATALOG: ItemDefinition[] = [
  { id: "divine-orb", name: "Divine Orb", localeNames: { cn: "神圣石", tw: "神聖石", us: "Divine Orb" }, category: "currency", marketKey: "Divine Orb", source: "never-sink", known: true },
  { id: "exalted-orb", name: "Exalted Orb", localeNames: { cn: "崇高石", tw: "崇高石", us: "Exalted Orb" }, category: "currency", marketKey: "Exalted Orb", source: "never-sink", known: true },
  { id: "mirror-of-kalandra", name: "Mirror of Kalandra", localeNames: { cn: "卡兰德的魔镜", tw: "卡蘭德的魔鏡", us: "Mirror of Kalandra" }, category: "currency", marketKey: "Mirror of Kalandra", source: "never-sink", known: true },
  { id: "perfect-jeweller-orb", name: "Perfect Jeweller's Orb", localeNames: { cn: "完美珠宝匠石", tw: "完美珠寶匠石", us: "Perfect Jeweller's Orb" }, category: "currency", marketKey: "Perfect Jeweller's Orb", source: "never-sink", known: true },
  { id: "greater-essence-of-the-body", name: "Greater Essence of the Body", localeNames: { cn: "高级肉体精华", tw: "高級肉體精華", us: "Greater Essence of the Body" }, category: "essence", marketKey: "Greater Essence of the Body", source: "game-data", known: true },
  { id: "greater-rune-of-archer", name: "Greater Rune of the Archer", localeNames: { cn: "高级射手符文", tw: "高級射手符文", us: "Greater Rune of the Archer" }, category: "rune", marketKey: "Greater Rune of the Archer", source: "game-data", known: true },
  { id: "soul-core-of-azcapa", name: "Soul Core of Azcapa", localeNames: { cn: "阿兹卡帕灵魂核心", tw: "阿茲卡帕靈魂核心", us: "Soul Core of Azcapa" }, category: "soul-core", marketKey: "Soul Core of Azcapa", source: "game-data", known: true },
  { id: "sacred-brimstone", name: "Sacred Brimstone", localeNames: { cn: "神圣硫磺", tw: "神聖硫磺", us: "Sacred Brimstone" }, category: "map", marketKey: "Sacred Brimstone", source: "game-data", known: true },
  { id: "citadel-map", name: "Citadel Map", localeNames: { cn: "城塞地图", tw: "城塞地圖", us: "Citadel Map" }, category: "map", marketKey: "Citadel Map", source: "game-data", known: true },
  { id: "temporalis", name: "Temporalis", localeNames: { cn: "时空之物", tw: "時空之物", us: "Temporalis" }, category: "unique", baseType: "Silk Robe", marketKey: "Temporalis", source: "never-sink", known: true },
  { id: "headhunter", name: "Headhunter", localeNames: { cn: "猎首", tw: "獵首", us: "Headhunter" }, category: "unique", baseType: "Leather Belt", marketKey: "Headhunter", source: "never-sink", known: true },
  { id: "advanced-dualstring-bow", name: "Advanced Dualstring Bow", localeNames: { cn: "精良双弦弓", tw: "精良雙弦弓", us: "Advanced Dualstring Bow" }, category: "base", baseType: "Advanced Dualstring Bow", marketKey: "Advanced Dualstring Bow", source: "game-data", known: true },
  { id: "advanced-solar-amulet", name: "Advanced Solar Amulet", localeNames: { cn: "精良太阳护身符", tw: "精良太陽護身符", us: "Advanced Solar Amulet" }, category: "base", baseType: "Advanced Solar Amulet", marketKey: "Advanced Solar Amulet", source: "game-data", known: true },
  { id: "unknown-item", name: "Unknown Item", localeNames: { cn: "未知物品", tw: "未知物品", us: "Unknown Item" }, category: "base", marketKey: "Unknown Item", source: "fallback", known: false },
];

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

export const FALLBACK_SNAPSHOT: MarketSnapshot = {
  league: "Standard",
  capturedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  source: "NeverSink baseline fallback",
  prices: {
    "divine-orb": { itemId: "divine-orb", amount: 1, currency: "divine", confidence: 1, capturedAt: "2026-01-01T00:00:00.000Z", source: "fallback" },
    "exalted-orb": { itemId: "exalted-orb", amount: 0.02, currency: "divine", confidence: 1, capturedAt: "2026-01-01T00:00:00.000Z", source: "fallback" },
    "mirror-of-kalandra": { itemId: "mirror-of-kalandra", amount: 120, currency: "divine", confidence: 0.7, capturedAt: "2026-01-01T00:00:00.000Z", source: "fallback" },
    "perfect-jeweller-orb": { itemId: "perfect-jeweller-orb", amount: 0.12, currency: "divine", confidence: 0.5, capturedAt: "2026-01-01T00:00:00.000Z", source: "fallback" },
    "temporalis": { itemId: "temporalis", amount: 45, currency: "divine", confidence: 0.4, capturedAt: "2026-01-01T00:00:00.000Z", source: "fallback" },
    "headhunter": { itemId: "headhunter", amount: 2.5, currency: "divine", confidence: 0.4, capturedAt: "2026-01-01T00:00:00.000Z", source: "fallback" },
  },
};

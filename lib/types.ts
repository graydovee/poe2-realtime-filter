export type Locale = "cn" | "tw" | "us";
export type Strictness = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type FilterStyle = "default" | "aura" | "cobalt" | "darkmode" | "mythic" | "vaal" | "zen" | "customsounds";
export type Currency = "exalted" | "divine" | "chaos";

export type ItemCategory =
  | "currency"
  | "rune"
  | "soul-core"
  | "map"
  | "unique"
  | "base"
  | "essence"
  | "fragment"
  | "flask"
  | "gem";

export type ItemMatcher = {
  baseType?: string;
  class?: string;
  rarity?: "Normal" | "Magic" | "Rare" | "Unique";
};

export type ItemDefinition = {
  id: string;
  name: string;
  localeNames: Record<Locale, string>;
  category: ItemCategory;
  categoryPath: string[];
  baseType?: string;
  marketKey: string;
  source: "never-sink" | "game-data" | "fallback";
  known: boolean;
  priceable: boolean;
  ambiguous: boolean;
  matcher: ItemMatcher;
};

export type MarketPrice = {
  itemId: string;
  amount: number;
  currency: Currency;
  confidence: number;
  capturedAt: string;
  source: string;
};

export type MarketRates = {
  divineToChaos: number;
  divineToExalted: number;
  capturedAt: string;
  source: string;
};

export type LeagueOption = { id: string; label: string; hardcore: boolean; permanent: boolean };
export type LeagueCatalog = { leagues: LeagueOption[]; defaultLeague: string; capturedAt: string; expiresAt: string };

export type MarketSnapshot = {
  league: string;
  capturedAt: string;
  expiresAt: string;
  source: string;
  rates?: MarketRates;
  prices: Record<string, MarketPrice>;
};

export type PricePoint = {
  amount: number;
  currency: Currency;
  referenceItemId?: string;
};

export type PriceRange = {
  min?: PricePoint;
  max?: PricePoint;
};

export type PresetSound =
  | { type: "builtin"; id: number; volume: number; fileName?: never }
  | { type: "neversink"; fileName: string }
  | { type: "custom"; fileName: string };

/** 规则适用物品：物品集合与价格区间可单选或同时使用，同时使用时取交集。 */
export type RuleTarget = {
  itemIds: string[];
  range?: PriceRange;
};

export type RuleFont = {
  fontSize?: number;
  textColor?: string;
  borderColor?: string;
  backgroundColor?: string;
};

/** 只写已填写的动作；留空的项交给基础过滤器。 */
export type RuleEffects = {
  beam?: string;
  icon?: string;
  font?: RuleFont;
  sound?: PresetSound;
};

export type FilterRule = {
  id: string;
  name: string;
  enabled: boolean;
  hidden: boolean;
  autoRange?: boolean;
  target: RuleTarget;
  effects: RuleEffects;
};

export type FilterProfile = {
  schemaVersion: 2;
  league: string;
  originalLeague?: string;
  strictness: Strictness;
  style: FilterStyle;
  locale: Locale;
  rules: FilterRule[];
  skippedItemIds: string[];
};

/** 从基础过滤器里抽取的特效预设集合（data/neversink-effects.json）。 */
export type EffectPresets = {
  version: number;
  beams: string[];
  icons: string[];
  fonts: RuleFont[];
  sounds: PresetSound[];
  customSounds: string[];
};

export type SafetyReport = {
  sourceVersion: string;
  baselineFile: string;
  catalogSize: number;
  coveredItems: number;
  unknownItems: number;
  unpricedItems: number;
  ambiguousItems: number;
  hiddenHighValueItems: string[];
  exclusionViolations: string[];
  warnings: string[];
  passed: boolean;
};

export type GeneratedBundle = {
  filterFile: string;
  baselineFile: string;
  fileName: string;
  soundFiles: string[];
  appliedRules: Array<{ ruleId: string; ruleName: string; itemCount: number }>;
  safetyReport: SafetyReport;
};

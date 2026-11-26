export type GameServer = "international" | "tencent";
export type Locale = "cn" | "tw" | "us";
export type Strictness = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type FilterStyle = "default" | "aura" | "cobalt" | "darkmode" | "mythic" | "vaal" | "zen" | "customsounds";
/** 行情报价使用的通货单位。 */
export type Currency = "exalted" | "divine" | "chaos";
/** 规则价格区间可用的单位：三种报价通货，外加没有汇率、只能按行情报价换算的剥离石。 */
export type PriceCurrency = Currency | "annulment";

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
  rarity?: ItemRarity;
  nonUnique?: boolean;
  /** 未切割宝石在游戏里只有一个基底，等级靠 GemLevel 条件区分；每个等级是一件独立物品。 */
  gemLevel?: number;
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
  stackable?: boolean;
  dropLevel?: number;
  iconUrl?: string;
  searchNames?: string[];
  marketItemId?: string;
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
  server?: GameServer;
  league: string;
  capturedAt: string;
  expiresAt: string;
  source: string;
  rates?: MarketRates;
  prices: Record<string, MarketPrice>;
};

export type PricePoint = {
  amount: number;
  currency: PriceCurrency;
};

export type PriceRange = {
  min?: PricePoint;
  max?: PricePoint;
};

export type BuiltinSound = { type: "builtin"; id: number; volume: number; positional?: boolean; fileName?: never };

export type PresetSound =
  | BuiltinSound
  | { type: "neversink"; fileName: string }
  | { type: "baseline"; fileName: string; volume?: number; optional?: boolean; fallback?: BuiltinSound }
  | { type: "custom"; fileName: string };

export type ItemRarity = "Normal" | "Magic" | "Rare" | "Unique";
export type DropOperator = ">=" | ">" | "=" | "<" | "<=";
export type DropBound = { op: DropOperator; value: number };
export type DropNumber = { enabled: boolean; bounds: DropBound[] };
export type DropField = "stackSize" | "itemLevel" | "sockets" | "unidentifiedTier";
export type DropConditions = Partial<Record<DropField, DropNumber>> & { rarity?: { enabled: boolean; value: ItemRarity } };

/** 同时启用的物品、单件价格和掉落条件取交集。 */
export type RuleTarget = {
  itemIds: string[];
  /** 关闭时忽略 itemIds（保留已选内容）。 */
  itemEnabled?: boolean;
  range?: PriceRange;
  /** 关闭时忽略 range（保留区间内容）。 */
  priceEnabled?: boolean;
  dropConditions?: DropConditions;
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
  /** 以该目录物品在当前基础过滤器中的样式为准；不要求它出现在规则目标中。 */
  baselineEffectItemId?: string;
  /** 为 true 时在读取阶段转成 `baselineEffectItemId`；为 false 时规则保留自己的样式。 */
  followBaseline?: boolean;
  /** 固定特效预设的回显 ID；生成器只读 effects。 */
  effectPresetId?: string;
  target: RuleTarget;
  effects: RuleEffects;
};

/** 基础过滤器的来源。`imported` 是方案包带进来、存在安装目录里的副本，按基础过滤器表里的 ID 引用。 */
export type BaseFilter =
  | { kind: "local"; path: string; name: string }
  | { kind: "subscribed"; source: "online" | "wegame"; directory: string; entry: string; name: string }
  | { kind: "downloaded"; source: string; version: string; entry: string; name: string }
  | { kind: "imported"; id: string; entry: string; name: string };

export type FilterProfile = {
  server?: GameServer;
  baseFilter?: BaseFilter;
  baseFilterHint?: string;
  schemaVersion: 2 | 3;
  league: string;
  originalLeague?: string;
  strictness: Strictness;
  style: FilterStyle;
  locale: Locale;
  rules: FilterRule[];
  skippedItemIds: string[];
};

/** 一套完整特效：光柱 + 地图图标 + 字体 + 音效。 */
export type EffectPreset = {
  id: string;
  /** 已确认在当前基础过滤器中使用这套样式的目录物品。 */
  sourceItemIds?: string[];
  beam?: string;
  icon?: string;
  font?: RuleFont;
  sound?: PresetSound;
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
  /** 基础过滤器里让游戏拒绝加载的问题（例如用了已改名的物品类别），带着最终文本里的行号。 */
  baselineIssues: string[];
  warnings: string[];
  coveredRules: Array<{ ruleId: string; ruleName: string }>;
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

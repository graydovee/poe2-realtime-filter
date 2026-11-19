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

export type VisualPreset = {
  sourceItemId?: string;
  autoRange?: boolean;
  id: string;
  name: string;
  enabled: boolean;
  effect: string;
  minimapIcon?: string;
  textColor?: string;
  borderColor?: string;
  backgroundColor?: string;
  fontSize?: number;
  range: PriceRange;
  sound: PresetSound;
};

export type WhitelistEntry = {
  id: string;
  label: string;
  itemIds: string[];
};

export type SoundPackConfig = {
  pack: "neversink" | "custom";
  customFileName?: string;
  alertLevel: "economy" | "valuable" | "ultra";
};

export type VisualOverrides = {
  showBeams: boolean;
  showMinimapIcons: boolean;
  fontSize: number;
  highValueColor: string;
  valuableColor: string;
  unknownColor: string;
};

export type FilterProfile = {
  strictness: Strictness;
  style: FilterStyle;
  locale: Locale;
  itemLevelMin: number;
  areaLevelMin: number;
  hideBelowEnabled: boolean;
  hideBelowAmount: number;
  hideBelowCurrency: Currency;
  whitelist: WhitelistEntry[];
  visualPresets: VisualPreset[];
  sound: SoundPackConfig;
  visuals: VisualOverrides;
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
  whitelistViolations: string[];
  warnings: string[];
  passed: boolean;
};

export type GeneratedBundle = {
  filterFile: string;
  baselineFile: string;
  fileName: string;
  soundFiles: string[];
  appliedPresets: Array<{ presetId: string; presetName: string; itemCount: number }>;
  safetyReport: SafetyReport;
};

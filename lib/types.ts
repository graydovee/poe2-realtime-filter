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

export type ItemDefinition = {
  id: string;
  name: string;
  localeNames: Record<Locale, string>;
  category: ItemCategory;
  baseType?: string;
  marketKey: string;
  source: "never-sink" | "game-data" | "fallback";
  known: boolean;
};

export type MarketPrice = {
  itemId: string;
  amount: number;
  currency: Currency;
  confidence: number;
  capturedAt: string;
  source: string;
};

export type MarketSnapshot = {
  league: string;
  capturedAt: string;
  expiresAt: string;
  source: string;
  prices: Record<string, MarketPrice>;
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
  sound: SoundPackConfig;
  visuals: VisualOverrides;
};

export type SafetyReport = {
  sourceVersion: string;
  baselineFile: string;
  catalogSize: number;
  coveredItems: number;
  unknownItems: number;
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
  safetyReport: SafetyReport;
};

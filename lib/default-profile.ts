import { DEFAULT_VISUAL_PRESETS } from "./data";
import type { FilterProfile } from "./types";

export const DEFAULT_PROFILE: FilterProfile = {
  league: "Standard",
  originalLeague: "Standard",
  strictness: 2,
  style: "default",
  locale: "cn",
  itemLevelMin: 65,
  areaLevelMin: 65,
  hideBelowEnabled: false,
  hideBelowAmount: 0.1,
  hideBelowCurrency: "exalted",
  whitelist: [],
  visualPresets: DEFAULT_VISUAL_PRESETS,
  sound: { pack: "neversink", alertLevel: "economy" },
  visuals: { showBeams: true, showMinimapIcons: true, fontSize: 32, highValueColor: "255 220 90", valuableColor: "80 210 255", unknownColor: "255 120 220" },
};


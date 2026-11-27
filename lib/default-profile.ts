import { DEFAULT_RULES } from "./data";
import type { FilterProfile } from "./types";

export const DEFAULT_PROFILE: FilterProfile = {
  schemaVersion: 2,
  league: "Standard",
  originalLeague: "Standard",
  strictness: 2,
  style: "default",
  locale: "cn",
  rules: JSON.parse(JSON.stringify(DEFAULT_RULES)),
  skippedItemIds: [],
  overlays: [],
  editsEnabled: true,
};

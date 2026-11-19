import fs from "node:fs";
import path from "node:path";
import { DEFAULT_VISUAL_PRESETS, FALLBACK_SNAPSHOT, ITEM_CATALOG, STRICTNESS_LABELS } from "./data";
import { applyTemplateAppearances } from "./neversink-appearance";
import { toExalted, currencyDefaultRanges } from "./pricing";
import type { FilterProfile, GeneratedBundle, ItemDefinition, MarketSnapshot, SafetyReport, Strictness, VisualPreset } from "./types";

const BASELINE_NAMES: Record<Strictness, string> = {
  0: "0-SOFT",
  1: "1-REGULAR",
  2: "2-SEMI-STRICT",
  3: "3-STRICT",
  4: "4-VERY-STRICT",
  5: "5-UBER-STRICT",
  6: "6-UBER-PLUS-STRICT",
};

const STYLE_DIRS: Record<string, string> = {
  aura: "(STYLE) AURA",
  cobalt: "(STYLE) COBALT",
  customsounds: "(STYLE) CUSTOMSOUNDS",
  darkmode: "(STYLE) DARKMODE",
  mythic: "(STYLE) MYTHIC",
  vaal: "(STYLE) VAAL",
  zen: "(STYLE) ZEN",
};

export function baselineFileFor(profile: FilterProfile): string {
  const suffix = BASELINE_NAMES[profile.strictness];
  if (profile.style === "default") return "NeverSink's filter 2 - " + suffix + ".filter";
  const dir = STYLE_DIRS[profile.style] ?? STYLE_DIRS.customsounds;
  const styleName = profile.style === "customsounds" ? "customsounds" : profile.style;
  return dir + "/NeverSink's filter 2 - " + suffix + " (" + styleName + ") .filter";
}

function readBaseline(profile: FilterProfile): { contents: string; file: string } {
  const file = baselineFileFor(profile);
  const fullPath = path.join(process.cwd(), "vendor", "neversink", file);
  if (fs.existsSync(fullPath)) return { contents: fs.readFileSync(fullPath, "utf8"), file };
  const fallback = path.join(process.cwd(), "vendor", "neversink", "NeverSink's filter 2 - " + BASELINE_NAMES[profile.strictness] + ".filter");
  return { contents: fs.readFileSync(fallback, "utf8"), file: path.basename(fallback) };
}

function quote(value: string): string {
  return '"' + value.replace(/"/g, '\\"') + '"';
}

export function matcherLines(item: ItemDefinition): string[] {
  const lines: string[] = [];
  if (item.matcher.class) lines.push("\tClass == " + quote(item.matcher.class));
  if (item.matcher.baseType) lines.push("\tBaseType == " + quote(item.matcher.baseType));
  if (item.matcher.rarity) lines.push("\tRarity " + item.matcher.rarity);
  return lines;
}

function presetRule(item: ItemDefinition, preset: VisualPreset): string {
  const actions = [
    preset.fontSize ? "\tSetFontSize " + preset.fontSize : "",
    preset.textColor ? "\tSetTextColor " + preset.textColor : "",
    preset.borderColor ? "\tSetBorderColor " + preset.borderColor : "",
    preset.backgroundColor ? "\tSetBackgroundColor " + preset.backgroundColor : "",
    preset.minimapIcon ? "\tMinimapIcon " + preset.minimapIcon : "",
    preset.effect ? "\tPlayEffect " + preset.effect : "",
    preset.sound.type === "builtin" ? "\tPlayAlertSound " + preset.sound.id + " " + preset.sound.volume : "\tCustomAlertSound " + quote(preset.sound.fileName) + " 300",
  ].filter(Boolean).join("\n");
  return "Show # poe2-filter preset: " + preset.name + " / " + item.name + "\n" + matcherLines(item).join("\n") + "\n" + actions;
}

function whitelistRule(item: ItemDefinition): string {
  return "Show # poe2-filter whitelist: " + item.name + "\n" + matcherLines(item).join("\n") + "\n\tSetFontSize 42\n\tSetTextColor 255 255 255 255\n\tSetBorderColor 255 255 255 255\n\tMinimapIcon 0 White Star\n\tPlayEffect White\n\tPlayAlertSound 6 300";
}

function hideRule(item: ItemDefinition, profile: FilterProfile): string {
  return "Hide # poe2-filter optional low-value rule: " + item.name + "\n" + matcherLines(item).join("\n") + "\n\tItemLevel < " + Math.max(1, profile.itemLevelMin) + "\n\tSetFontSize 18";
}

function isWhitelisted(itemId: string, profile: FilterProfile): boolean {
  return profile.whitelist.some((entry) => entry.itemIds.includes(itemId));
}

function resolvedPresets(profile: FilterProfile): VisualPreset[] {
  return profile.visualPresets ?? DEFAULT_VISUAL_PRESETS;
}

function rangeMatches(exaltedValue: number, preset: VisualPreset, snapshot: MarketSnapshot): boolean {
  const min = preset.range.min ? toExalted(preset.range.min, snapshot.rates, snapshot.prices) : 0;
  const max = preset.range.max ? toExalted(preset.range.max, snapshot.rates, snapshot.prices) : Number.POSITIVE_INFINITY;
  if (min === undefined || max === undefined) return false;
  return exaltedValue >= min && exaltedValue < max;
}

function snapshotUsable(snapshot: MarketSnapshot): boolean {
  return snapshot.source !== FALLBACK_SNAPSHOT.source && Date.parse(snapshot.expiresAt) >= Date.now();
}

function validateSafety(
  profile: FilterProfile,
  baselineFile: string,
  baseline: string,
  hidden: Array<{ item: ItemDefinition; exaltedValue?: number }>,
  warnings: string[],
  divineToExalted?: number,
): SafetyReport {
  const baseTypes = new Set<string>();
  const classes = new Set<string>();
  for (const line of baseline.matchAll(/^\s*(BaseType|Class) == (.+)$/gm)) {
    for (const value of line[2].matchAll(/"([^"\n]+)"/g)) {
      (line[1] === "BaseType" ? baseTypes : classes).add(value[1]);
    }
  }
  const hiddenHighValueItems = hidden.filter((entry) => (entry.exaltedValue ?? 0) >= (divineToExalted ?? Number.POSITIVE_INFINITY)).map((entry) => entry.item.name);
  const whitelistViolations = profile.whitelist.flatMap((entry) => entry.itemIds.filter((itemId) => hidden.some((hiddenItem) => hiddenItem.item.id === itemId)));
  return {
    sourceVersion: "NeverSink PoE2 vendored union + PoE2 client catalog",
    baselineFile,
    catalogSize: ITEM_CATALOG.length,
    coveredItems: baseTypes.size + classes.size,
    unknownItems: ITEM_CATALOG.filter((item) => !item.known).length,
    unpricedItems: 0,
    ambiguousItems: ITEM_CATALOG.filter((item) => item.ambiguous).length,
    hiddenHighValueItems,
    whitelistViolations,
    warnings,
    passed: hiddenHighValueItems.length === 0 && whitelistViolations.length === 0,
  };
}

export function generateFilter(profile: FilterProfile, inputSnapshot?: MarketSnapshot): GeneratedBundle {
  const { contents: baseline, file: baselineFile } = readBaseline(profile);
  const league = profile.league ?? "Standard";
  const snapshot = inputSnapshot && inputSnapshot.league === league && snapshotUsable(inputSnapshot) ? inputSnapshot : { ...FALLBACK_SNAPSHOT, league };
  const presets = currencyDefaultRanges(applyTemplateAppearances(resolvedPresets(profile), profile), snapshot).filter((preset) => preset.enabled);
  const overrides: string[] = [];
  const hidden: Array<{ item: ItemDefinition; exaltedValue?: number }> = [];
  const warnings: string[] = [];
  const soundFiles = new Set<string>();
  const applied = new Map<string, { preset: VisualPreset; count: number }>();
  let unpriced = 0;
  let ambiguous = 0;

  for (const item of ITEM_CATALOG) {
    const price = item.priceable ? snapshot.prices[item.id] : undefined;
    const exaltedValue = price && snapshot.rates ? toExalted({ amount: price.amount, currency: price.currency }, snapshot.rates) : undefined;
    const whitelisted = isWhitelisted(item.id, profile);
    if (item.ambiguous) ambiguous += 1;
    if (item.priceable && exaltedValue === undefined) unpriced += 1;

    if (whitelisted && !item.ambiguous) {
      overrides.push(whitelistRule(item));
      continue;
    }

    if (exaltedValue !== undefined) {
      const preset = presets.find((candidate) => rangeMatches(exaltedValue, candidate, snapshot));
      if (preset) {
        overrides.push(presetRule(item, preset));
        if (preset.sound.type !== "builtin") soundFiles.add(preset.sound.fileName);
        const current = applied.get(preset.id);
        applied.set(preset.id, { preset, count: (current?.count ?? 0) + 1 });
        continue;
      }
    }

    if (profile.hideBelowEnabled && exaltedValue !== undefined && !whitelisted) {
      const floor = toExalted({ amount: profile.hideBelowAmount, currency: profile.hideBelowCurrency }, snapshot.rates);
      if (floor !== undefined && exaltedValue < floor && !item.ambiguous) {
        hidden.push({ item, exaltedValue });
        overrides.push(hideRule(item, profile));
      }
    }
  }

  if (!snapshot.rates || snapshot.source === FALLBACK_SNAPSHOT.source) {
    warnings.push("当前没有有效的 poe.ninja 价格或汇率快照，所有未定价物品继续使用 NeverSink 原始规则。");
  }
  if (unpriced > 0) warnings.push(unpriced + " 个可匹配物品没有可靠当日价格，未新增价格光效或隐藏规则。");
  if (ambiguous > 0) warnings.push(ambiguous + " 个类别/歧义匹配项沿用 NeverSink 原始规则，避免误覆盖其他物品。");
  if (profile.hideBelowEnabled) warnings.push("已启用低于 " + profile.hideBelowAmount + " " + profile.hideBelowCurrency + " 的隐藏；白名单优先且高价值误藏会使安全检查失败。");

  const safetyReport = validateSafety(profile, baselineFile, baseline, hidden, warnings, snapshot.rates?.divineToExalted);
  const header = [
    "# poe2-filter generated overlay",
    "# Base: " + baselineFile,
    "# League: " + league,
    "# Strictness: " + profile.strictness + " - " + STRICTNESS_LABELS[profile.strictness],
    "# Market: " + snapshot.source + " @ " + snapshot.capturedAt,
    "# Safety: unpriced and ambiguous items remain under the NeverSink baseline.",
    "",
  ].join("\n");
  const filterFile = header + (overrides.length ? overrides.join("\n\n") + "\n\n" : "") + baseline;
  for (const match of filterFile.matchAll(/^\s*CustomAlertSound(?:Optional)?\s+"([^"\n]+)"/gm)) soundFiles.add(match[1]);
  return {
    filterFile,
    baselineFile,
    fileName: "poe2-filter-" + league.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + BASELINE_NAMES[profile.strictness].toLowerCase() + ".filter",
    soundFiles: [...soundFiles],
    appliedPresets: [...applied.values()].map(({ preset, count }) => ({ presetId: preset.id, presetName: preset.name, itemCount: count })),
    safetyReport: { ...safetyReport, unpricedItems: unpriced, ambiguousItems: ambiguous },
  };
}

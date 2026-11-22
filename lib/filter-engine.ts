import { inspectBaseStyles } from "./baseline-effects";
import { FALLBACK_SNAPSHOT, ITEM_CATALOG, STRICTNESS_LABELS } from "./data";
import { resolveAutoRanges, toExalted } from "./pricing";
import type {
  FilterProfile,
  FilterRule,
  GeneratedBundle,
  ItemDefinition,
  MarketSnapshot,
  PresetSound,
  PriceRange,
  SafetyReport,
  Strictness,
} from "./types";

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

function soundLine(sound: PresetSound, distinguishCustom: boolean): string {
  return sound.type === "builtin" ? "\tPlayAlertSound " + sound.id + " " + sound.volume : "\tCustomAlertSound " + quote((distinguishCustom && sound.type === "custom" ? "@poe2rf-custom/" : "") + sound.fileName) + " 300";
}

/** 只输出规则里真正填写的动作；留空 = 交给基础过滤器。 */
function effectLines(rule: FilterRule, distinguishCustom: boolean): string[] {
  const lines: string[] = [];
  const { beam, icon, font, sound } = rule.effects;
  if (beam) lines.push("\tPlayEffect " + beam);
  if (icon) lines.push("\tMinimapIcon " + icon);
  if (font) {
    if (Number.isFinite(font.fontSize)) lines.push("\tSetFontSize " + font.fontSize);
    if (font.textColor) lines.push("\tSetTextColor " + font.textColor);
    if (font.borderColor) lines.push("\tSetBorderColor " + font.borderColor);
    if (font.backgroundColor) lines.push("\tSetBackgroundColor " + font.backgroundColor);
  }
  if (sound) lines.push(soundLine(sound, distinguishCustom));
  return lines;
}

function ruleBlock(rule: FilterRule, item: ItemDefinition, actions: string[]): string {
  const head = (rule.hidden ? "Hide" : "Show") + " # poe2-filter rule: " + rule.name + " / " + item.name;
  return [head, ...matcherLines(item), ...actions].join("\n");
}

function withinRange(exaltedValue: number | undefined, range: PriceRange | undefined, snapshot: MarketSnapshot): boolean {
  if (!range) return true;
  if (exaltedValue === undefined) return false;
  const min = range.min ? toExalted(range.min, snapshot.rates, snapshot.prices) : 0;
  const max = range.max ? toExalted(range.max, snapshot.rates, snapshot.prices) : Number.POSITIVE_INFINITY;
  if (min === undefined || max === undefined) return false;
  return exaltedValue >= min && exaltedValue < max;
}

/** 物品条件 / 价格条件各自可关闭；两个都关闭的规则不会命中任何物品。 */
function conditionUse(rule: FilterRule) {
  const itemIds = rule.target.itemIds ?? [];
  return {
    itemIds,
    useItems: rule.target.itemEnabled !== false && itemIds.length > 0,
    usePrice: rule.target.priceEnabled !== false && Boolean(rule.target.range),
  };
}

function matches(rule: FilterRule, item: ItemDefinition, exaltedValue: number | undefined, snapshot: MarketSnapshot): boolean {
  const { itemIds, useItems, usePrice } = conditionUse(rule);
  if (!useItems && !usePrice) return false;
  if (useItems && !itemIds.includes(item.id)) return false;
  if (usePrice && !withinRange(exaltedValue, rule.target.range, snapshot)) return false;
  return true;
}

function snapshotUsable(snapshot: MarketSnapshot): boolean {
  return snapshot.source !== FALLBACK_SNAPSHOT.source && Date.parse(snapshot.expiresAt) >= Date.now();
}

function validateSafety(
  baselineFile: string,
  baseline: string,
  hidden: Array<{ item: ItemDefinition; exaltedValue?: number }>,
  skipped: Set<string>,
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
  const hiddenHighValueItems = hidden
    .filter((entry) => (entry.exaltedValue ?? 0) >= (divineToExalted ?? Number.POSITIVE_INFINITY))
    .map((entry) => entry.item.name);
  const exclusionViolations = hidden.filter((entry) => skipped.has(entry.item.id)).map((entry) => entry.item.name);
  return {
    sourceVersion: "PoE2 client catalog",
    baselineFile,
    catalogSize: ITEM_CATALOG.length,
    coveredItems: baseTypes.size + classes.size,
    unknownItems: ITEM_CATALOG.filter((item) => !item.known).length,
    unpricedItems: 0,
    ambiguousItems: ITEM_CATALOG.filter((item) => item.ambiguous).length,
    hiddenHighValueItems,
    exclusionViolations,
    warnings,
    passed: hiddenHighValueItems.length === 0 && exclusionViolations.length === 0,
  };
}

export function generateFilter(profile: FilterProfile, baseline: string, inputSnapshot?: MarketSnapshot, options: { includeMarketTimestamp?: boolean; baselineName?: string; distinguishCustom?: boolean } = {}): GeneratedBundle {
  const baselineFile = options.baselineName ?? baselineFileFor(profile);
  const league = profile.league ?? "Standard";
  const snapshot = inputSnapshot && inputSnapshot.league === league && snapshotUsable(inputSnapshot)
    ? inputSnapshot
    : { ...FALLBACK_SNAPSHOT, league };
  const skipped = new Set(profile.skippedItemIds ?? []);
  const rawRules = profile.rules ?? [];
  const rules = resolveAutoRanges(rawRules.filter((rule) => rule.enabled), snapshot);
  const autoDisabled = rules.filter((rule) => !rule.enabled).map((rule) => rule.name);

  const overrides: string[] = [];
  const hidden: Array<{ item: ItemDefinition; exaltedValue?: number }> = [];
  const matched = new Set<string>();
  const applied = new Map<string, { rule: FilterRule; count: number }>();
  const inherited = rawRules.some((rule) => rule.enabled && rule.followBaseline) ? inspectBaseStyles(baseline) : {};
  const warnings = rawRules.flatMap((rule) => {
    const warning = rule.enabled && rule.followBaseline ? inherited[rule.id]?.warning : undefined;
    return warning ? [warning] : [];
  });
  const soundFiles = new Set<string>();
  let unpriced = 0;
  let ambiguous = 0;

  for (const item of ITEM_CATALOG) {
    const price = item.priceable ? snapshot.prices[item.id] : undefined;
    const exaltedValue = price && snapshot.rates ? toExalted({ amount: price.amount, currency: price.currency }, snapshot.rates) : undefined;
    if (item.ambiguous) ambiguous += 1;
    if (item.priceable && exaltedValue === undefined) unpriced += 1;
    if (item.ambiguous || skipped.has(item.id)) continue;

    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (!matches(rule, item, exaltedValue, snapshot)) continue;
      overrides.push(ruleBlock(rule, item, rule.followBaseline ? inherited[rule.id]?.actions ?? [] : effectLines(rule, options.distinguishCustom ?? false)));
      matched.add(item.id);
      if (rule.hidden) hidden.push({ item, exaltedValue });
      if (!rule.followBaseline && rule.effects.sound && rule.effects.sound.type !== "builtin") soundFiles.add(rule.effects.sound.fileName);
      const current = applied.get(rule.id);
      applied.set(rule.id, { rule, count: (current?.count ?? 0) + 1 });
      break;
    }
  }

  if (!rawRules.some((rule) => rule.enabled)) warnings.push("没有启用任何自定义规则，输出与基础过滤器完全一致。");
  if (autoDisabled.length) warnings.push(autoDisabled.join("、") + " 跟随市价的价格档因缺少锚点行情被禁用。");
  const unused = rules.filter((rule) => rule.enabled && !applied.has(rule.id)).map((rule) => rule.name);
  if (unused.length) warnings.push(unused.join("、") + " 没有命中任何物品（价格区间或物品选择可能为空）。");
  if (!snapshot.rates || snapshot.source === FALLBACK_SNAPSHOT.source) {
    warnings.push("当前没有有效的 poe.ninja 价格或汇率快照，带价格条件的规则不会生效，其余物品沿用基础过滤器规则。");
  }
  if (unpriced > 0) warnings.push(unpriced + " 个可匹配物品没有可靠当日价格，不会被价格规则匹配。");
  if (ambiguous > 0) warnings.push(ambiguous + " 个类别/歧义匹配项沿用基础过滤器规则，避免误覆盖其他物品。");
  if (skipped.size) warnings.push("跳过名单里的 " + skipped.size + " 件物品不参与自定义规则，保持基础过滤器效果。");

  const safetyReport = validateSafety(baselineFile, baseline, hidden, skipped, warnings, snapshot.rates?.divineToExalted);
  const header = [
    "# poe2-filter generated overlay",
    "# Base: " + baselineFile,
    "# League: " + league,
    ...(!options.baselineName ? ["# Strictness: " + profile.strictness + " - " + STRICTNESS_LABELS[profile.strictness]] : []),
    "# Rules: " + rules.filter((rule) => rule.enabled).length + " enabled / " + skipped.size + " skipped items",
    "# Market: " + snapshot.source + (options.includeMarketTimestamp === false ? "" : " @ " + snapshot.capturedAt),
    "# Safety: 未配置的动作交给基础过滤器；隐藏规则会让安全检查失败。",
    "",
  ].join("\n");
  const filterFile = header + "\n" + (overrides.length ? overrides.join("\n\n") + "\n\n" : "") + baseline;
  for (const match of filterFile.matchAll(/^\s*CustomAlertSound(?:Optional)?\s+"([^"\n]+)"/gm)) soundFiles.add(match[1]);
  return {
    filterFile,
    baselineFile,
    fileName: "poe2-filter-" + league.toLowerCase().replace(/[^a-z0-9]+/g, "-") + (options.baselineName ? "" : "-" + BASELINE_NAMES[profile.strictness].toLowerCase()) + ".filter",
    soundFiles: [...soundFiles],
    appliedRules: [...applied.values()].map(({ rule, count }) => ({ ruleId: rule.id, ruleName: rule.name, itemCount: count })),
    safetyReport: { ...safetyReport, unpricedItems: unpriced, ambiguousItems: ambiguous },
  };
}
import { inspectBaseStyles } from "./baseline-effects";
import { FALLBACK_SNAPSHOT, FILTER_ITEMS_BY_ID, ITEM_CATALOG, marketItemId } from "./data";
import { DROP_KEYS, dropInterval, dropLines, rarityInterval, type Interval } from "./drop-conditions";
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

export function matcherLines(item: ItemDefinition, withRarity = true): string[] {
  const lines: string[] = [];
  if (item.matcher.class) lines.push("\tClass == " + quote(item.matcher.class));
  if (item.matcher.baseType) lines.push("\tBaseType == " + quote(item.matcher.baseType));
  if (withRarity && item.matcher.rarity) lines.push("\tRarity " + item.matcher.rarity);
  if (withRarity && item.matcher.nonUnique) lines.push("\tRarity < Unique");
  return lines;
}

function soundLine(sound: PresetSound, distinguishCustom: boolean): string {
  if (sound.type === "builtin") {
    const command = sound.positional ? "PlayAlertSoundPositional" : "PlayAlertSound";
    return `\t${command} ${sound.id} ${sound.volume}`;
  }
  if (sound.type === "baseline") {
    const command = sound.optional ? "CustomAlertSoundOptional" : "CustomAlertSound";
    const name = (distinguishCustom ? "@poe2rf-baseline/" : "") + sound.fileName;
    const references = name.split(";").map((file, index) => index > 0 && distinguishCustom ? "@poe2rf-baseline/" + file : file).join(";");
    const alert = `\t${command} ${quote(references)}${sound.volume === undefined ? "" : ` ${sound.volume}`}`;
    return sound.fallback ? `${soundLine(sound.fallback, distinguishCustom)}\n${alert}` : alert;
  }
  const name = (distinguishCustom && sound.type === "custom" ? "@poe2rf-custom/" : "") + sound.fileName;
  return `\tCustomAlertSound ${quote(name)} 300`;
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
  const head = (rule.hidden ? "Hide" : "Show") + " # poe2-filter rule: " + rule.id + " / " + item.name;
  const drop = rule.target.dropConditions;
  return [head, ...matcherLines(item, !(drop?.rarity?.enabled || drop?.unidentifiedTier?.enabled)), ...dropLines(drop), ...actions].join("\n");
}

function encloses(outer: Interval, inner: Interval): boolean {
  return outer[0] <= inner[0] && inner[1] <= outer[1];
}

type Candidate = { rule: FilterRule; item: ItemDefinition };

function candidateRarity({ item, rule }: Candidate): Interval {
  const drop = rule.target.dropConditions;
  return rarityInterval(item, drop?.rarity?.enabled ? drop.rarity.value : drop?.unidentifiedTier?.enabled ? "Rare" : undefined);
}

function covers(earlier: Candidate, current: Candidate): boolean {
  const outer = earlier.item.matcher;
  const inner = current.item.matcher;
  if (outer.baseType && outer.baseType !== inner.baseType) return false;
  if (outer.class && outer.class !== inner.class) return false;
  if (!encloses(candidateRarity(earlier), candidateRarity(current))) return false;
  return DROP_KEYS.every((field) => {
    const previous = earlier.rule.target.dropConditions?.[field];
    if (!previous?.enabled) return true;
    const next = current.rule.target.dropConditions?.[field];
    return Boolean(next?.enabled && encloses(dropInterval(field, previous.bounds), dropInterval(field, next.bounds)));
  });
}

function overlapsSkipped(item: ItemDefinition, skipped: ItemDefinition[]): boolean {
  return skipped.some((other) => {
    if (other.id === item.id) return true;
    if (!other.matcher.baseType || other.matcher.baseType !== item.matcher.baseType) return false;
    if (item.matcher.class && other.matcher.class && item.matcher.class !== other.matcher.class) return false;
    const [lo, hi] = rarityInterval(item);
    const [otherLo, otherHi] = rarityInterval(other);
    return lo <= otherHi && otherLo <= hi;
  });
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
  const { useItems, usePrice } = conditionUse(rule);
  if (!useItems && !usePrice) return false;
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
  coveredRules: SafetyReport["coveredRules"],
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
    coveredRules,
    passed: hiddenHighValueItems.length === 0 && exclusionViolations.length === 0,
  };
}

export function generateFilter(profile: FilterProfile, baseline: string | null, inputSnapshot?: MarketSnapshot, options: { includeMarketTimestamp?: boolean; baselineName?: string; distinguishCustom?: boolean } = {}): GeneratedBundle {
  const standalone = baseline === null;
  const baselineFile = standalone ? "" : options.baselineName ?? baselineFileFor(profile);
  const league = profile.league ?? "Standard";
  const snapshot = inputSnapshot && inputSnapshot.league === league && snapshotUsable(inputSnapshot)
    ? inputSnapshot
    : { ...FALLBACK_SNAPSHOT, league };
  const skipped = new Set(standalone ? [] : profile.skippedItemIds ?? []);
  const rawRules = profile.rules ?? [];
  const rules = resolveAutoRanges(rawRules.filter((rule) => rule.enabled), snapshot);
  const autoDisabled = rules.filter((rule) => !rule.enabled).map((rule) => rule.name);

  const overrides: string[] = [];
  const hidden: Array<{ item: ItemDefinition; exaltedValue?: number }> = [];
  const matched = new Set<string>();
  const applied = new Map<string, { rule: FilterRule; count: number }>();
  const followsBaseline = rawRules.some((rule) => rule.enabled && rule.followBaseline);
  const inherited = baseline !== null && followsBaseline ? inspectBaseStyles(baseline) : {};
  const warnings = rawRules.flatMap((rule) => {
    const warning = rule.enabled && rule.followBaseline ? inherited[rule.id]?.warning : undefined;
    return warning ? [warning] : [];
  });
  if (standalone && followsBaseline) warnings.push("跟随基础过滤器的规则使用游戏默认样式。");
  const soundFiles = new Set<string>();
  const exaltedValues = new Map(ITEM_CATALOG.map((item) => {
    const price = item.priceable ? snapshot.prices[item.id] : undefined;
    return [item.id, price && snapshot.rates ? toExalted({ amount: price.amount, currency: price.currency }, snapshot.rates) : undefined];
  }));
  const unpriced = ITEM_CATALOG.filter((item) => item.priceable && exaltedValues.get(item.id) === undefined).length;
  const ambiguous = ITEM_CATALOG.filter((item) => item.ambiguous).length;
  const exclusions = [...skipped].map((id) => FILTER_ITEMS_BY_ID.get(id)).filter((item): item is ItemDefinition => Boolean(item));
  const priorByBase = new Map<string, Candidate[]>();
  const coveredRules: SafetyReport["coveredRules"] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const { itemIds, useItems } = conditionUse(rule);
    const items = useItems ? [...new Set(itemIds)].map((id) => FILTER_ITEMS_BY_ID.get(id)) : ITEM_CATALOG;
    const actions = rule.followBaseline ? inherited[rule.id]?.actions ?? [] : effectLines(rule, options.distinguishCustom ?? false);
    let eligibleCount = 0;
    let emittedCount = 0;
    for (const item of items) {
      if (!item || item.ambiguous || overlapsSkipped(item, exclusions)) continue;
      const exaltedValue = item.priceable ? exaltedValues.get(marketItemId(item)) : undefined;
      if (!matches(rule, item, exaltedValue, snapshot)) continue;
      eligibleCount += 1;
      const key = item.matcher.baseType ?? "";
      const prior = priorByBase.get(key) ?? [];
      const candidate = { rule, item };
      if (prior.some((earlier) => covers(earlier, candidate)) || (key && priorByBase.get("")?.some((earlier) => covers(earlier, candidate)))) continue;
      if (!prior.length) priorByBase.set(key, prior);
      prior.push(candidate);
      overrides.push(ruleBlock(rule, item, actions));
      matched.add(item.id);
      emittedCount += 1;
      if (rule.hidden) hidden.push({ item, exaltedValue });
    }
    if (emittedCount) {
      applied.set(rule.id, { rule, count: emittedCount });
      if (!rule.followBaseline && rule.effects.sound && rule.effects.sound.type !== "builtin") soundFiles.add(rule.effects.sound.fileName);
    } else if (eligibleCount) {
      coveredRules.push({ ruleId: rule.id, ruleName: rule.name });
    }
  }

  const defaultDisplay = standalone ? "使用游戏默认显示" : "沿用基础过滤器规则";
  if (!rawRules.some((rule) => rule.enabled)) warnings.push("当前未启用规则，所有物品" + defaultDisplay + "。");
  if (autoDisabled.length) warnings.push(autoDisabled.join("、") + " 跟随市价的价格档因缺少锚点行情被禁用。");
  const unused = rules.filter((rule) => rule.enabled && !applied.has(rule.id) && !coveredRules.some((entry) => entry.ruleId === rule.id)).map((rule) => rule.name);
  if (unused.length) warnings.push(unused.join("、") + " 没有命中任何物品（价格区间或物品选择可能为空）。");
  if (!snapshot.rates || snapshot.source === FALLBACK_SNAPSHOT.source) {
    warnings.push("当前赛季缺少有效报价或汇率，带价格条件的规则不会生效，未匹配的物品" + defaultDisplay + "。");
  }
  if (unpriced > 0) warnings.push(unpriced + " 个可匹配物品没有可靠当日价格，不会被价格规则匹配。");
  if (ambiguous > 0) warnings.push(ambiguous + " 个类别/歧义匹配项" + defaultDisplay + "。");
  if (skipped.size) warnings.push("跳过名单里的 " + skipped.size + " 件物品不参与自定义规则，保持基础过滤器效果。");

  const safetyReport = validateSafety(baselineFile, baseline ?? "", hidden, skipped, warnings, coveredRules, snapshot.rates?.divineToExalted);
  const header = [
    "# poe2-filter generated overlay",
    standalone ? "# Mode: custom rules" : "# Mode: overlay",
    ...(/^[ -~]+$/.test(league) ? ["# League: " + league] : []),
    ...(!standalone && !options.baselineName ? ["# Strictness: " + profile.strictness] : []),
    "# Rules: " + rules.filter((rule) => rule.enabled).length + " enabled / " + skipped.size + " skipped items",
    "# Market: " + snapshot.source + (options.includeMarketTimestamp === false ? "" : " @ " + snapshot.capturedAt),
    standalone ? "# Unmatched items: game defaults" : "# Safety: Unspecified actions are handled by the base filter.",
    "",
  ].join("\n");
  const filterFile = header + "\n" + (overrides.length ? overrides.join("\n\n") + "\n\n" : "") + (baseline ?? "Show\n");
  for (const match of filterFile.matchAll(/^\s*CustomAlertSound(?:Optional)?\s+"([^"\n]+)"/gm)) soundFiles.add(match[1]);
  return {
    filterFile,
    baselineFile,
    fileName: "poe2-filter-" + league.toLowerCase().replace(/[^a-z0-9]+/g, "-") + (options.baselineName || standalone ? "" : "-" + BASELINE_NAMES[profile.strictness].toLowerCase()) + ".filter",
    soundFiles: [...soundFiles],
    appliedRules: [...applied.values()].map(({ rule, count }) => ({ ruleId: rule.id, ruleName: rule.name, itemCount: count })),
    safetyReport: { ...safetyReport, unpricedItems: unpriced, ambiguousItems: ambiguous },
  };
}
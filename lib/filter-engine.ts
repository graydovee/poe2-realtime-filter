import { inspectBaseStyles } from "./baseline-effects";
import { CLASS_MATCHES, CLASS_MATCH_BY_ID, CLASS_OF_ITEM, FALLBACK_SNAPSHOT, FILTER_ITEMS_BY_ID, ITEM_CATALOG, marketItemId, type ClassMatch } from "./data";
import { DROP_KEYS, dropInterval, dropLines, rarityInterval, type Interval } from "./drop-conditions";
import { toExalted } from "./pricing";
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
  // 未切割宝石每个等级共用一个基底，靠 GemLevel 区分。
  if (item.matcher.gemLevel !== undefined) lines.push("\tGemLevel = " + item.matcher.gemLevel);
  // 换界石每个阶数是一件独立物品，靠 WaystoneTier 区分。
  if (item.matcher.waystoneTier !== undefined) lines.push("\tClass == \"Waystones\"", "\tWaystoneTier = " + item.matcher.waystoneTier);
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
  if (outer.gemLevel !== inner.gemLevel) return false;
  // 整类条目不限阶数，盖得住它那一类里的每一阶换界石；选定一阶的块只盖得住同一阶。
  if (outer.waystoneTier !== undefined && outer.waystoneTier !== inner.waystoneTier) return false;
  // 逐件物品自己不带 Class 条件，它属于哪个类别记在登记表里。
  const outerClass = outer.class ?? CLASS_OF_ITEM.get(earlier.item.id)?.item.matcher.class;
  const innerClass = inner.class ?? CLASS_OF_ITEM.get(current.item.id)?.item.matcher.class;
  if (outerClass && outerClass !== innerClass) return false;
  if (!encloses(candidateRarity(earlier), candidateRarity(current))) return false;
  return DROP_KEYS.every((field) => {
    const previous = earlier.rule.target.dropConditions?.[field];
    if (!previous?.enabled) return true;
    const next = current.rule.target.dropConditions?.[field];
    return Boolean(next?.enabled && encloses(dropInterval(field, previous.bounds), dropInterval(field, next.bounds)));
  });
}

/** 一件物品属于哪个游戏类别：整类条目自己带着 Class 条件，其余的记在登记表里。 */
const classOf = (item: ItemDefinition) => item.matcher.class ?? CLASS_OF_ITEM.get(item.id)?.item.matcher.class;
/** 不带基底、也不带稀有度的条目：整类条目和换界石各阶。 */
const unbased = (item: ItemDefinition) => !item.matcher.baseType && !item.matcher.nonUnique && !item.matcher.rarity;

function overlapsSkipped(item: ItemDefinition, skipped: ItemDefinition[]): boolean {
  return skipped.some((other) => {
    if (other.id === item.id) return true;
    // 这类条目按类别比：整类条目和它那一类里的物品是同一批，跳过了一个，另一个也不再生成规则。
    if (unbased(other) && unbased(item)) {
      const otherClass = classOf(other);
      if (otherClass && otherClass === classOf(item)) return other.matcher.waystoneTier === undefined || item.matcher.waystoneTier === undefined
        || other.matcher.waystoneTier === item.matcher.waystoneTier;
      return false;
    }
    if (!other.matcher.baseType || other.matcher.baseType !== item.matcher.baseType) return false;
    if (other.matcher.gemLevel !== item.matcher.gemLevel) return false;
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

function classMatchBlock(rule: FilterRule, match: ClassMatch, actions: string[]): string {
  // 和逐件块一样用条目自己的名字（Omen、Waystones、Amulets）作注释。
  const head = (rule.hidden ? "Hide" : "Show") + " # poe2-filter rule: " + rule.id + " / " + match.item.name;
  return [head, ...matcherLines(match.item), ...dropLines(rule.target.dropConditions), ...actions].join("\n");
}

/**
 * 规则把某个分类的逐件物品全部选中时，换成登记表里对应的整类条目（嵌套时只取最大的那个）。
 * 带价格条件的规则不合并：整类条目没有行情，表达不了价格区间。
 * 这一类里有物品在跳过物品里时也不合并，否则整类块会盖掉基础过滤器对那件物品的处理。
 */
function compactClassMatches(selected: Set<string>, skipped: Set<string>): ClassMatch[] {
  const full = CLASS_MATCHES.filter((match) =>
    match.members.length > 0 && match.members.every((item) => selected.has(item.id) && !skipped.has(item.id)));
  return full.filter((match) => !full.some((other) => other !== match && other.members.length > match.members.length
    && match.members.every((item) => other.members.some((member) => member.id === item.id))));
}

function snapshotUsable(snapshot: MarketSnapshot): boolean {
  return snapshot.source !== FALLBACK_SNAPSHOT.source && Date.parse(snapshot.expiresAt) >= Date.now();
}

/**
 * 游戏已经改名的物品类别（旧名 → 现名）。过滤器里再用旧名字，游戏会拒绝加载整份过滤器，报的是
 * 「无法分析规则 Class 参数：找不到与 "Socketable" 完全相符的物品种类」。
 * 依据：GGG 的过滤器更新公告（2025-12，Path of Exile 2: The Last of the Druids）的 Updated Keywords 一节。
 */
export const RENAMED_ITEM_CLASSES: Record<string, string> = { Socketable: "Augment" };

/** 仓库内置的 NeverSink 版本。本地的基础过滤器比它旧时提醒用户；tests 保证它和 vendor 里的文件头一致。 */
export const NEVERSINK_REFERENCE_VERSION = "0.10.4";

/** 过滤器里生效的 Class 条件用到的类名 → 出现的行号（从 1 数）。注释行不算，`Class == "A" "B"` 和 `Class A` 两种写法都算。 */
function classLineNumbers(filterFile: string): Map<string, number[]> {
  const lines = new Map<string, number[]>();
  filterFile.split("\n").forEach((line, index) => {
    if (!/^\s*Class\b/.test(line)) return;
    const rest = line.replace(/^\s*Class\s*(?:==|!=|<=|>=|=|!|<|>)?/, "");
    const quoted = [...rest.matchAll(/"([^"\n]+)"/g)].map((match) => match[1]);
    for (const name of quoted.length ? quoted : rest.trim().split(/\s+/).filter(Boolean)) {
      const found = lines.get(name) ?? [];
      found.push(index + 1);
      lines.set(name, found);
    }
  });
  return lines;
}

/** 在最终文本上查已改名的类别，这样报出的行号和游戏报的行号是同一个数。 */
function renamedClassIssues(filterFile: string): string[] {
  const used = classLineNumbers(filterFile);
  return Object.entries(RENAMED_ITEM_CLASSES).flatMap(([previous, current]) => {
    const found = used.get(previous);
    if (!found) return [];
    return [`第 ${found[0]} 行：物品类别 "${previous}" 已被游戏改名为 "${current}"，游戏会拒绝加载整份过滤器。基础过滤器需要更新到当前游戏版本。`
      + (found.length > 1 ? `（共 ${found.length} 行用了旧名字）` : "")];
  });
}

/** NeverSink 的过滤器文件头写着版本号（# VERSION:  0.10.4）。 */
function neversinkVersion(text: string): number[] | undefined {
  const match = /^#\s*VERSION:\s*(\d+(?:\.\d+)+)/m.exec(text);
  return match ? match[1].split(".").map(Number) : undefined;
}

function olderVersion(left: number[], right: number[]): boolean {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

function validateSafety(
  baselineFile: string,
  baseline: string,
  hidden: Array<{ item: ItemDefinition; exaltedValue?: number }>,
  skipped: Set<string>,
  warnings: string[],
  coveredRules: SafetyReport["coveredRules"],
  divineToExalted: number | undefined,
  baselineIssues: string[],
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
    ambiguousItems: ITEM_CATALOG.filter((item) => item.ambiguous && !item.matcher.class).length,
    hiddenHighValueItems,
    exclusionViolations,
    baselineIssues,
    warnings,
    coveredRules,
    passed: hiddenHighValueItems.length === 0 && exclusionViolations.length === 0 && baselineIssues.length === 0,
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
  const rules = rawRules.filter((rule) => rule.enabled);

  const overrides: string[] = [];
  const hidden: Array<{ item: ItemDefinition; exaltedValue?: number }> = [];
  const matched = new Set<string>();
  const applied = new Map<string, { rule: FilterRule; count: number }>();
  const baselineEffectItemIds = new Set(rules.flatMap(({ baselineEffectItemId }) => baselineEffectItemId === undefined ? [] : [baselineEffectItemId]));
  const inherited = baseline !== null && baselineEffectItemIds.size ? inspectBaseStyles(baseline, baselineEffectItemIds) : {};
  const warnings = Object.values(inherited).flatMap(({ warning }) => warning ? [warning] : []);
  if (standalone && baselineEffectItemIds.size) warnings.push("跟随基础过滤器的规则使用游戏默认样式。");
  const soundFiles = new Set<string>();
  const exaltedValues = new Map(ITEM_CATALOG.map((item) => {
    const price = item.priceable ? snapshot.prices[item.id] : undefined;
    return [item.id, price && snapshot.rates ? toExalted({ amount: price.amount, currency: price.currency }, snapshot.rates) : undefined];
  }));
  const unpriced = ITEM_CATALOG.filter((item) => item.priceable && exaltedValues.get(item.id) === undefined).length;
  // 整类条目不算歧义项：它们要么由全选换出来，要么不可选。
  const ambiguous = ITEM_CATALOG.filter((item) => item.ambiguous && !item.matcher.class).length;
  const exclusions = [...skipped].map((id) => FILTER_ITEMS_BY_ID.get(id)).filter((item): item is ItemDefinition => Boolean(item));
  const priorByBase = new Map<string, Candidate[]>();
  const coveredRules: SafetyReport["coveredRules"] = [];

  for (const rule of rules) {
    const { itemIds, useItems, usePrice } = conditionUse(rule);
    // 没选物品时规则作用于整个目录，但整类条目只在被选中（或由全选换出来）时才生成规则。
    const selectedItems = useItems
      ? [...new Set(itemIds)].map((id) => FILTER_ITEMS_BY_ID.get(id)).filter((item): item is ItemDefinition => Boolean(item))
      : ITEM_CATALOG.filter((item) => !item.matcher.class);
    const sourceItemId = rule.baselineEffectItemId;
    const actions = sourceItemId === undefined ? effectLines(rule, options.distinguishCustom ?? false) : inherited[sourceItemId]?.actions ?? [];
    // 整类条目排在它覆盖的逐件物品前面，后面的规则才能判断自己有没有被覆盖。
    const compacted = useItems && !usePrice ? compactClassMatches(new Set(selectedItems.map((item) => item.id)), skipped) : [];
    const compactedMembers = new Set(compacted.flatMap((match) => match.members.map((item) => item.id)));
    // 整类块排在最前面；被它覆盖的逐件物品还要走一遍循环，才能知道这条规则有没有被更早的规则盖住。
    const items = [
      ...compacted.map((match) => match.item),
      ...compacted.flatMap((match) => match.members),
      ...selectedItems.filter((item) => !compactedMembers.has(item.id)),
    ];
    let eligibleCount = 0;
    let emittedCount = 0;
    for (const item of items) {
      if (!item || skipped.has(item.id) || overlapsSkipped(item, exclusions)) continue;
      // 没登记的整类条目（Stackable Currency 等）不生成任何规则。
      if (item.matcher.class && !CLASS_MATCH_BY_ID.has(item.id)) continue;
      const exaltedValue = item.priceable ? exaltedValues.get(marketItemId(item)) : undefined;
      if (!matches(rule, item, exaltedValue, snapshot)) continue;
      eligibleCount += 1;
      const key = item.matcher.baseType ?? "";
      const prior = priorByBase.get(key) ?? [];
      const candidate = { rule, item };
      if (prior.some((earlier) => covers(earlier, candidate)) || (key && priorByBase.get("")?.some((earlier) => covers(earlier, candidate)))) continue;
      if (!prior.length) priorByBase.set(key, prior);
      prior.push(candidate);
      const match = CLASS_MATCH_BY_ID.get(item.id);
      if (match) {
        overrides.push(classMatchBlock(rule, match, actions));
        for (const member of match.members.length ? match.members : [match.item]) {
          matched.add(member.id);
          if (rule.hidden) hidden.push({ item: member, exaltedValue: member.priceable ? exaltedValues.get(marketItemId(member)) : undefined });
        }
        emittedCount += Math.max(match.members.length, 1);
      } else {
        overrides.push(ruleBlock(rule, item, actions));
        matched.add(item.id);
        emittedCount += 1;
        if (rule.hidden) hidden.push({ item, exaltedValue });
      }
    }
    if (emittedCount) {
      applied.set(rule.id, { rule, count: emittedCount });
      if (sourceItemId === undefined && rule.effects.sound && rule.effects.sound.type !== "builtin") soundFiles.add(rule.effects.sound.fileName);
    } else if (eligibleCount) {
      coveredRules.push({ ruleId: rule.id, ruleName: rule.name });
    }
  }

  const defaultDisplay = standalone ? "使用游戏默认显示" : "沿用基础过滤器规则";
  if (!rawRules.some((rule) => rule.enabled)) warnings.push("当前未启用规则，所有物品" + defaultDisplay + "。");
  const unused = rules.filter((rule) => !applied.has(rule.id) && !coveredRules.some((entry) => entry.ruleId === rule.id)).map((rule) => rule.name);
  if (unused.length) warnings.push(unused.join("、") + " 没有命中任何物品（价格区间或物品选择可能为空）。");
  if (!snapshot.rates || snapshot.source === FALLBACK_SNAPSHOT.source) {
    warnings.push("当前赛季缺少有效报价或汇率，带价格条件的规则不会生效，未匹配的物品" + defaultDisplay + "。");
  }
  if (unpriced > 0) warnings.push(unpriced + " 个可匹配物品没有可靠当日价格，不会被价格条件命中。");
  if (ambiguous > 0) warnings.push(ambiguous + " 个类别/歧义匹配项" + defaultDisplay + "。");
  if (skipped.size) warnings.push("跳过物品里的 " + skipped.size + " 件物品不参与自定义规则，保持基础过滤器效果。");
  if (baseline !== null) {
    const version = neversinkVersion(baseline);
    if (version && olderVersion(version, NEVERSINK_REFERENCE_VERSION.split(".").map(Number))) {
      warnings.push("基础过滤器是 NeverSink " + version.join(".") + "，比应用内置的参考版本 " + NEVERSINK_REFERENCE_VERSION + " 旧。游戏更新后，旧版里可能有已经改名或删除的类别和物品。");
    }
  }

  const header = [
    "# poe2-filter generated overlay",
    standalone ? "# Mode: custom rules" : "# Mode: overlay",
    ...(/^[ -~]+$/.test(league) ? ["# League: " + league] : []),
    ...(!standalone && !options.baselineName ? ["# Strictness: " + profile.strictness] : []),
    "# Rules: " + rules.length + " enabled / " + skipped.size + " skipped items",
    "# Market: " + snapshot.source + (options.includeMarketTimestamp === false ? "" : " @ " + snapshot.capturedAt),
    standalone ? "# Unmatched items: game defaults" : "# Safety: Unspecified actions are handled by the base filter.",
    "",
  ].join("\n");
  const filterFile = header + "\n" + (overrides.length ? overrides.join("\n\n") + "\n\n" : "") + (baseline ?? "Show\n");
  for (const match of filterFile.matchAll(/^\s*CustomAlertSound(?:Optional)?\s+"([^"\n]+)"/gm)) soundFiles.add(match[1]);
  // 基础过滤器可能和当前游戏版本不兼容。在拼好的最终文本上查，报出的行号才和游戏报的行号一致。
  const baselineIssues = baseline === null ? [] : renamedClassIssues(filterFile);
  const safetyReport = validateSafety(baselineFile, baseline ?? "", hidden, skipped, warnings, coveredRules, snapshot.rates?.divineToExalted, baselineIssues);
  return {
    filterFile,
    baselineFile,
    fileName: "poe2-filter-" + league.toLowerCase().replace(/[^a-z0-9]+/g, "-") + (options.baselineName || standalone ? "" : "-" + BASELINE_NAMES[profile.strictness].toLowerCase()) + ".filter",
    soundFiles: [...soundFiles],
    appliedRules: [...applied.values()].map(({ rule, count }) => ({ ruleId: rule.id, ruleName: rule.name, itemCount: count })),
    safetyReport: { ...safetyReport, unpricedItems: unpriced, ambiguousItems: ambiguous },
  };
}
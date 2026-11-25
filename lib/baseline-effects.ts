import { CLASS_OF_ITEM, DEFAULT_EFFECT_ITEMS, FILTER_ITEMS_BY_ID } from "./data";
import type { EffectPreset, ItemDefinition, RuleEffects } from "./types";

export { DEFAULT_EFFECT_ITEMS } from "./data";

type ActionGroup = "beam" | "icon" | "fontSize" | "textColor" | "borderColor" | "backgroundColor" | "builtinSound" | "customSound" | "dropSound" | "dropSoundIfAlert";
type Action = { key: ActionGroup; command: string; value: string };
type Probe = { baseType: string; className?: string; gemLevel?: number; rarity?: number; nonUnique?: boolean; currency: boolean };
type Condition = (item: Probe) => boolean | undefined;
type Block = { index: number; show: boolean; continue: boolean; baseTypes?: Set<string>; conditions: Condition[]; actions: Action[] };
type BlockIndex = { general: Block[]; exact: Map<string, Block[]> };
export type InheritedStyle = { effects: RuleEffects; actions: string[]; warning?: string };

/** 样式按参考物品的目录 ID 查找，和应用特效的规则 ID 无关。 */
export type BaseInspection = { styles: Record<string, InheritedStyle>; presets: EffectPreset[] };
type AudioReferences = Record<string, string>;

const actionGroups: Record<string, ActionGroup> = {
  PlayEffect: "beam", MinimapIcon: "icon", SetFontSize: "fontSize", SetTextColor: "textColor",
  SetBorderColor: "borderColor", SetBackgroundColor: "backgroundColor", PlayAlertSound: "builtinSound",
  PlayAlertSoundPositional: "builtinSound", CustomAlertSound: "customSound", CustomAlertSoundOptional: "customSound",
  DisableDropSound: "dropSound", EnableDropSound: "dropSound", DisableDropSoundIfAlertSound: "dropSoundIfAlert",
  EnableDropSoundIfAlertSound: "dropSoundIfAlert",
};

function tokenize(line: string): string[] {
  return (line.match(/"[^"]*"|#[^\r\n]*|[^\s"#]+/g) ?? []).filter((word) => !word.startsWith("#"));
}

function readBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | undefined;
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const [command, ...args] = tokenize(line);
    if (!command) continue;
    if (command === "Show" || command === "Hide" || command === "Minimal") {
      current = { index: blocks.length, show: command === "Show", continue: false, conditions: [], actions: [] };
      blocks.push(current);
    } else if (current) {
      if (command === "Continue") current.continue = true;
      else if (Object.prototype.hasOwnProperty.call(actionGroups, command)) {
        current.actions.push({ key: actionGroups[command], command, value: args.join(" ") });
      } else if (command === "BaseType" && args[0] === "==" && args.length > 1 && !current.baseTypes) {
        current.baseTypes = new Set(args.slice(1).map(filterName));
      } else current.conditions.push(compileCondition(command, args));
    }
  }
  return blocks;
}

function indexBlocks(blocks: Block[]): BlockIndex {
  const general: Block[] = [];
  const exact = new Map<string, Block[]>();
  for (const block of blocks) {
    if (!block.baseTypes) general.push(block);
    else for (const baseType of block.baseTypes) {
      const selected = exact.get(baseType);
      if (selected) selected.push(block);
      else exact.set(baseType, [block]);
    }
  }
  return { general, exact };
}

const operators = new Set(["=", "==", "!=", ">", ">=", "<", "<="]);
const rarities = ["Normal", "Magic", "Rare", "Unique"];
const currencyFlags = new Set(["Corrupted", "TwiceCorrupted", "Mirrored", "Identified", "FracturedItem", "SynthesisedItem", "AnyEnchantment", "ShapedMap", "ElderMap", "BlightedMap", "UberBlightedMap", "Replica"]);
const currencyMods = new Set(["HasExplicitMod", "HasEnchantment", "EnchantmentPassiveNode", "HasImplicitMod", "HasInfluence"]);
const filterName = (word: string) => word.replace(/^"|"$/g, "").toLowerCase();
const unknown: Condition = () => undefined;

function compare(operator: string, actual: number, target: number) {
  switch (operator) {
    case ">": return actual > target;
    case ">=": return actual >= target;
    case "<": return actual < target;
    case "<=": return actual <= target;
    case "!=": return actual !== target;
    default: return actual === target;
  }
}

function compileCondition(field: string, args: string[]): Condition {
  const operator = operators.has(args[0]) ? args.shift()! : "=";
  if (!args.length) return unknown;
  if (field === "BaseType" || field === "Class") {
    if (!["=", "==", "!="].includes(operator)) return unknown;
    const values = new Set(args.map(filterName));
    const names = [...values];
    return (item) => {
      const actual = field === "BaseType" ? item.baseType : item.className;
      if (!actual) return undefined;
      if (operator === "==") return values.has(actual);
      if (operator === "!=") return !values.has(actual);
      return names.some((name) => actual.includes(name));
    };
  }
  if (field === "Rarity") {
    const choices = args.map((value) => rarities.indexOf(value));
    if (choices.includes(-1) || (choices.length > 1 && !["=", "==", "!="].includes(operator))) return unknown;
    const matches = (actual: number) => choices.length === 1
      ? compare(operator, actual, choices[0])
      : choices.includes(actual) === (operator !== "!=");
    const possible = rarities.map((_, index) => matches(index));
    return (item) => {
      if (item.rarity !== undefined) return possible[item.rarity];
      const limit = item.nonUnique ? 3 : 4;
      for (let index = 1; index < limit; index += 1) if (possible[index] !== possible[0]) return undefined;
      return possible[0];
    };
  }
  if (field === "GemLevel" || field === "StackSize" || field === "Quality") {
    const target = Number(args[0]);
    if (args.length !== 1 || !Number.isFinite(target)) return unknown;
    return (item) => {
      const actual = field === "GemLevel" ? item.gemLevel : item.currency ? (field === "StackSize" ? 1 : 0) : undefined;
      return actual === undefined ? undefined : compare(operator, actual, target);
    };
  }
  if (currencyFlags.has(field)) {
    if (args.length !== 1 || !["True", "False"].includes(args[0]) || !["=", "==", "!="].includes(operator)) return unknown;
    const matches = ((field === "Identified") === (args[0] === "True")) === (operator !== "!=");
    return (item) => item.currency ? matches : undefined;
  }
  if (currencyMods.has(field) && operator !== "!=") return (item) => item.currency ? false : undefined;
  return unknown;
}

export function canFollowBaselineItem(item: ItemDefinition | undefined): item is ItemDefinition {
  return Boolean(item?.known && !item.ambiguous && item.matcher.baseType);
}

function catalogProbe(item: ItemDefinition): Probe {
  const { baseType, gemLevel, rarity, nonUnique } = item.matcher;
  const [group, section] = item.categoryPath;
  // 保留旧价格档的单份、无品质通货探针。其他物品只用目录有把握的条件，不假定其掉落属性。
  const currency = group === "crafting" && item.stackable === true
    && (section === "currency" || (section === "shards" && item.category === "currency"));
  const className = item.matcher.class ?? CLASS_OF_ITEM.get(item.id)?.item.matcher.class ?? (currency ? "Stackable Currency" : undefined);
  return {
    baseType: baseType!.toLowerCase(), className: className?.toLowerCase(), gemLevel,
    rarity: rarity ? rarities.indexOf(rarity) : (currency ? 0 : undefined), nonUnique, currency,
  };
}

function displayEffects(actions: Action[], audio: AudioReferences): RuleEffects {
  const latest = new Map(actions.map((action) => [action.key, action]));
  // Build in a fixed order so equivalent effects have the same preset key.
  actions = [...latest.values()].sort((left, right) => left.key.localeCompare(right.key));
  const effects: RuleEffects = {};
  for (const { key, command, value } of actions) {
    if (key === "beam" && value !== "None") effects.beam = value;
    if (key === "icon" && value !== "-1") effects.icon = value;
    if (key === "fontSize") effects.font = { ...effects.font, fontSize: Number(value) };
    if (key === "textColor" || key === "borderColor" || key === "backgroundColor") effects.font = { ...effects.font, [key]: value };
    if (key === "builtinSound" || key === "customSound") {
      const [first, volume] = tokenize(value);
      if (!first || /^(?:"?none"?|0)$/i.test(first)) continue;
      if (command.startsWith("Custom")) {
        const references = first.replace(/^"|"$/g, "").split(";");
        if (references.every((reference) => Object.prototype.hasOwnProperty.call(audio, reference))) effects.sound = {
          type: "baseline", fileName: references.map((reference) => audio[reference]).join(";"),
          ...(volume !== undefined ? { volume: Number(volume) } : {}),
          ...(command === "CustomAlertSoundOptional" ? { optional: true, ...(effects.sound?.type === "builtin" ? { fallback: effects.sound } : {}) } : {}),
        };
      } else if (/^\d+$/.test(first)) effects.sound = {
        type: "builtin", id: Number(first), volume: Number(volume ?? 50),
        ...(command === "PlayAlertSoundPositional" ? { positional: true } : {}),
      };
    }
  }
  return effects;
}

/** Treat an unresolved condition as branching. Inherit only when both outcomes agree. */
function styleFor(blocks: BlockIndex, item: Probe, audio: AudioReferences): InheritedStyle | undefined {
  type State = { actions: Action[]; show: boolean };
  let active: State[] = [{ actions: [], show: false }];
  let result: State | undefined;
  const signature = (state: State) => JSON.stringify([state.show, state.actions.map(({ command, value }) => [command, value]).sort()]);
  const finish = (state: State) => {
    if (result && signature(result) !== signature(state)) return false;
    result = state;
    return true;
  };
  // 按原顺序合并通用块和匹配该基底的块，避免每件物品重复检查所有精确匹配条件。
  const { general } = blocks;
  const exact = blocks.exact.get(item.baseType) ?? [];
  let generalIndex = 0;
  let exactIndex = 0;
  while (active.length && (generalIndex < general.length || exactIndex < exact.length)) {
    const broad = general[generalIndex];
    const specific = exact[exactIndex];
    const block = broad && (!specific || broad.index < specific.index) ? general[generalIndex++] : exact[exactIndex++];
    let uncertain = false;
    if (block.conditions.some((condition) => {
      const match = condition(item);
      if (match === undefined) uncertain = true;
      return match === false;
    })) continue;
    const next = new Map<string, State>();
    for (const state of active) {
      if (uncertain) next.set(signature(state), state);
      const actions = new Map(state.actions.map((action) => [action.key, action]));
      for (const action of block.actions) actions.set(action.key, action);
      const matched = { show: block.show, actions: [...actions.values()] };
      if (block.continue) next.set(signature(matched), matched);
      else if (!finish(matched)) return undefined;
    }
    if (next.size > 32) return undefined;
    active = [...next.values()];
  }
  for (const state of active) if (!finish(state)) return undefined;
  if (!result?.show) return undefined;
  return {
    effects: displayEffects(result.actions, audio),
    actions: result.actions.map(({ command, value }) => "\t" + command + (value ? " " + value : "")),
  };
}

function itemStyles(blocks: Block[], audio: AudioReferences, itemIds: Iterable<string>): BaseInspection["styles"] {
  const index = indexBlocks(blocks);
  const entries: [string, InheritedStyle][] = [];
  for (const itemId of itemIds) {
    const item = FILTER_ITEMS_BY_ID.get(itemId);
    if (!canFollowBaselineItem(item)) continue;
    entries.push([itemId, styleFor(index, catalogProbe(item), audio) ?? {
      effects: {}, actions: [], warning: `无法确定基础过滤器中「${item.name}」的显示特效，使用游戏默认显示样式。`,
    }]);
  }
  return Object.fromEntries(entries);
}

export function inspectBaseStyles(baseline: string, itemIds: Iterable<string> = Object.values(DEFAULT_EFFECT_ITEMS)): BaseInspection["styles"] {
  return itemStyles(readBlocks(baseline), {}, itemIds);
}

export function inspectBaseFilter(baseline: string, audio: AudioReferences): BaseInspection {
  const blocks = readBlocks(baseline);
  const styles = itemStyles(blocks, audio, FILTER_ITEMS_BY_ID.keys());
  const presets = new Map<string, EffectPreset>();
  function add(effects: RuleEffects, sourceItemId?: string) {
    if (!Object.keys(effects).length) return;
    const key = JSON.stringify(effects);
    let preset = presets.get(key);
    if (!preset) {
      preset = { id: `base-${presets.size + 1}`, ...effects };
      presets.set(key, preset);
    }
    if (sourceItemId !== undefined) (preset.sourceItemIds ??= []).push(sourceItemId);
  }
  for (const block of blocks) if (block.show) add(displayEffects(block.actions, audio));
  for (const [itemId, style] of Object.entries(styles)) if (!style.warning) add(style.effects, itemId);
  return { styles, presets: [...presets.values()] };
}

import { ITEM_CATALOG } from "./data";
import type { EffectPreset, ItemMatcher, RuleEffects } from "./types";

export const DEFAULT_EFFECT_ITEMS = {
  "default-exalted": "exalted-orb",
  "default-chaos": "chaos-orb",
  "default-annulment": "orb-of-annulment",
  "default-divine": "divine-orb",
} as const;

type ActionGroup = "beam" | "icon" | "fontSize" | "textColor" | "borderColor" | "backgroundColor" | "builtinSound" | "customSound" | "dropSound" | "dropSoundIfAlert";
type Action = { key: ActionGroup; command: string; value: string };
type Block = { show: boolean; continue: boolean; conditions: string[]; actions: Action[] };
export type InheritedStyle = { effects: RuleEffects; actions: string[]; warning?: string };

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
      current = { show: command === "Show", continue: false, conditions: [], actions: [] };
      blocks.push(current);
    } else if (current) {
      if (command === "Continue") current.continue = true;
      else if (Object.prototype.hasOwnProperty.call(actionGroups, command)) {
        current.actions.push({ key: actionGroups[command], command, value: args.join(" ") });
      } else current.conditions.push([command, ...args].join(" "));
    }
  }
  return blocks;
}

const operators = new Set(["=", "==", "!=", ">", ">=", "<", "<="]);
const rarities = ["Normal", "Magic", "Rare", "Unique"];
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

function matchesCondition(condition: string, item: ItemMatcher): boolean | undefined {
  const [field, ...args] = tokenize(condition);
  const operator = operators.has(args[0]) ? args.shift()! : "=";
  if (!args.length) return undefined;
  if (field === "BaseType" || field === "Class") {
    const actual = (field === "BaseType" ? item.baseType : item.class)?.toLowerCase();
    if (!actual || !["=", "==", "!="].includes(operator)) return undefined;
    const values = args.map((value) => value.replace(/^"|"$/g, "").toLowerCase());
    if (operator === "!=") return !values.includes(actual);
    return values.some((value) => operator === "==" ? actual === value : actual.includes(value));
  }
  if (field === "Rarity") {
    const target = rarities.indexOf(args[0]);
    const actual = rarities.indexOf(item.rarity ?? "Normal");
    if (args.length > 1 && ["=", "==", "!="].includes(operator)) {
      const choices = args.map((value) => rarities.indexOf(value));
      if (choices.includes(-1)) return undefined;
      return operator === "!=" ? !choices.includes(actual) : choices.includes(actual);
    }
    return target === -1 ? undefined : compare(operator, actual, target);
  }
  if (field === "StackSize" || field === "Quality") {
    const target = Number(args[0]);
    return Number.isFinite(target) ? compare(operator, field === "StackSize" ? 1 : 0, target) : undefined;
  }
  if (["Corrupted", "TwiceCorrupted", "Mirrored", "Identified", "FracturedItem", "SynthesisedItem", "AnyEnchantment", "ShapedMap", "ElderMap", "BlightedMap", "UberBlightedMap", "Replica"].includes(field)) {
    if (args[0] !== "True" && args[0] !== "False") return undefined;
    const actual = field === "Identified";
    return operator === "!=" ? actual !== (args[0] === "True") : actual === (args[0] === "True");
  }
  if (["HasExplicitMod", "HasEnchantment", "EnchantmentPassiveNode", "HasImplicitMod", "HasInfluence"].includes(field)) return operator === "!=" ? undefined : false;
  return undefined;
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
function styleFor(blocks: Block[], item: ItemMatcher, audio: AudioReferences): InheritedStyle | undefined {
  type State = { actions: Action[]; show: boolean };
  let active: State[] = [{ actions: [], show: false }];
  let result: State | undefined;
  const signature = (state: State) => JSON.stringify([state.show, state.actions.map(({ command, value }) => [command, value]).sort()]);
  const finish = (state: State) => {
    if (result && signature(result) !== signature(state)) return false;
    result = state;
    return true;
  };
  for (const block of blocks) {
    if (!active.length) break;
    const conditions = block.conditions.map((condition) => matchesCondition(condition, item));
    if (conditions.includes(false)) continue;
    const next = new Map<string, State>();
    for (const state of active) {
      if (conditions.includes(undefined)) next.set(signature(state), state);
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

function anchorStyles(blocks: Block[], audio: AudioReferences): Record<string, InheritedStyle> {
  return Object.fromEntries(Object.entries(DEFAULT_EFFECT_ITEMS).map(([ruleId, itemId]) => {
    const item = ITEM_CATALOG.find((entry) => entry.id === itemId)!;
    return [ruleId, styleFor(blocks, { class: "Stackable Currency", ...item.matcher }, audio) ?? {
      effects: {}, actions: [], warning: `无法确定基础过滤器中「${item.name}」的显示特效，使用游戏默认显示样式。`,
    }];
  }));
}

export function inspectBaseStyles(baseline: string): Record<string, InheritedStyle> {
  return anchorStyles(readBlocks(baseline), {});
}

export function inspectBaseFilter(baseline: string, audio: AudioReferences): BaseInspection {
  const blocks = readBlocks(baseline);
  const styles = anchorStyles(blocks, audio);
  const presets: EffectPreset[] = [];
  const seen = new Set<string>();
  function add(effects: RuleEffects) {
    const key = JSON.stringify(effects);
    if (!Object.keys(effects).length || seen.has(key)) return;
    seen.add(key);
    presets.push({ id: `base-${presets.length + 1}`, ...effects });
  }
  for (const block of blocks) if (block.show) add(displayEffects(block.actions, audio));
  for (const style of Object.values(styles)) add(style.effects);
  return { styles, presets };
}

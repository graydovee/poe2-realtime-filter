import { displayEffects } from "./baseline-effects";
import { FILTER_ITEMS } from "./data";
import { parseFilterBlocks, soundLine, ACTION_GROUPS, type ActionGroup, type FilterBlock, type ParsedFilter } from "./filter-blocks";
import type { BaseOverlay, ItemDefinition, RuleEffects } from "./types";

export const MAX_OVERLAYS = 500;
export const MAX_CONDITIONS = 40;
export const MAX_CONDITION_LENGTH = 300;

/** 修改在当前基础过滤器上的状态。`blocks` 是它命中的规则序号，条件相同的规则一起命中。 */
export type OverlayState = { state: "ok"; blocks: number[] } | { state: "invalid"; reason: "noBase" | "baseChanged" | "ruleChanged" };

/** 规则的标识：规范化后的条件行，不分大小写。 */
export const blockKey = (conditions: string[]) => conditions.join("\n").toLowerCase();

export function resolveOverlays(overlays: BaseOverlay[], baseName: string | undefined, blocks: FilterBlock[]): Map<string, OverlayState> {
  const byKey = new Map<string, number[]>();
  for (const block of blocks) {
    const key = blockKey(block.conditions);
    const found = byKey.get(key);
    if (found) found.push(block.index);
    else byKey.set(key, [block.index]);
  }
  const states = new Map<string, OverlayState>();
  for (const overlay of overlays) {
    if (baseName === undefined) states.set(overlay.id, { state: "invalid", reason: "noBase" });
    else if (overlay.baseName !== baseName) states.set(overlay.id, { state: "invalid", reason: "baseChanged" });
    else {
      const found = byKey.get(blockKey(overlay.conditions));
      states.set(overlay.id, found ? { state: "ok", blocks: found } : { state: "invalid", reason: "ruleChanged" });
    }
  }
  return states;
}

/** 修改不生效的原因。 */
export function overlayReason(reason: Exclude<OverlayState, { state: "ok" }>["reason"], overlay: BaseOverlay, baseName: string | undefined): string {
  switch (reason) {
    case "noBase": return "方案没有选择基础过滤器。";
    case "baseChanged": return `它是对基础过滤器「${overlay.baseName}」做的，当前是「${baseName}」。`;
    default: return `基础过滤器「${overlay.baseName}」里找不到条件相同的规则，它可能已经改动或删除。`;
  }
}

export function overlayWarnings(overlays: BaseOverlay[], states: Map<string, OverlayState>, baseName: string | undefined): string[] {
  const groups = new Map<string, number>();
  for (const overlay of overlays) {
    const state = states.get(overlay.id);
    if (!overlay.enabled || !state || state.state !== "invalid") continue;
    const reason = overlayReason(state.reason, overlay, baseName);
    groups.set(reason, (groups.get(reason) ?? 0) + 1);
  }
  return [...groups].map(([reason, count]) => `${count} 处对基础规则的修改不生效：${reason}`);
}

const SOUND_KEYS: ActionGroup[] = ["builtinSound", "customSound"];
const COLOR_LINES = [["textColor", "SetTextColor"], ["borderColor", "SetBorderColor"], ["backgroundColor", "SetBackgroundColor"]] as const;

/** 修改要替换的动作，以及替换后的行。没写的项不在这个表里，保持基础规则原样。 */
function replacements(effects: RuleEffects): Array<{ keys: ActionGroup[]; lines: string[]; at?: number }> {
  const groups: Array<{ keys: ActionGroup[]; lines: string[]; at?: number }> = [];
  const font = effects.font;
  if (effects.beam !== undefined) groups.push({ keys: ["beam"], lines: ["\tPlayEffect " + effects.beam] });
  if (effects.icon !== undefined) groups.push({ keys: ["icon"], lines: ["\tMinimapIcon " + effects.icon] });
  if (font?.fontSize !== undefined) groups.push({ keys: ["fontSize"], lines: ["\tSetFontSize " + font.fontSize] });
  for (const [key, command] of COLOR_LINES) {
    if (font?.[key] !== undefined) groups.push({ keys: [key], lines: ["\t" + command + " " + font[key]] });
  }
  if (effects.sound) groups.push({ keys: SOUND_KEYS, lines: soundLine(effects.sound, true).split("\n") });
  return groups;
}

type Cell = { text: string; eol: string };

/** 在原规则的基础上写出改后的那几行。没改到的行原样保留，换行风格也跟着原来的行。 */
function patchBlock(parsed: ParsedFilter, block: FilterBlock, overlay: BaseOverlay): string[] {
  const { lines } = parsed;
  const content = (line: number) => lines[line].replace(/\r$/, "");
  const eolOf = (line: number) => (lines[line].endsWith("\r") ? "\r" : "");
  // 新行跟着块里第一行带换行符的行；整块只有文件最后一行时跟着文件里的换行风格。
  const eol = block.parts.map((part) => eolOf(part.line)).find(Boolean) ?? (parsed.crlf ? "\r" : "");
  const groups = replacements(overlay.effects);
  const edited = overlay.conditionLines;
  const flip = overlay.hidden !== undefined && overlay.hidden !== !block.show;
  const kept: Cell[] = [];
  // `at` 是新行要插在 `kept` 的第几项之前；原规则里没有对应的那一行时插在最后。
  const inserted: Array<{ at: number; lines: string[] }> = [];
  let conditionsAt = -1;
  const keep = (line: number) => kept.push({ text: content(line), eol: eolOf(line) });

  for (const part of block.parts) {
    // 块尾、空行之前的注释不属于这条规则的内容，原样留着。
    if (part.line < block.start || part.line > block.end) continue;
    if (part.kind === "head") {
      const text = flip
        ? content(part.line).replace(/^(\uFEFF?\s*)(?:Show|Hide|Minimal)/, (_, lead: string) => lead + (overlay.hidden ? "Hide" : "Show"))
        : content(part.line);
      kept.push({ text, eol: eolOf(part.line) });
    } else if (part.kind === "condition") {
      if (edited === undefined) keep(part.line);
      else if (conditionsAt < 0) {
        conditionsAt = kept.length;
        inserted.push({ at: conditionsAt, lines: edited.map((line) => "\t" + line) });
      }
    } else if (part.kind === "action") {
      const group = groups.find((entry) => entry.keys.includes(part.action.key));
      if (!group) keep(part.line);
      else if (group.at === undefined) {
        group.at = kept.length;
        inserted.push({ at: group.at, lines: group.lines });
      }
    } else keep(part.line);
  }
  // 原规则没有条件时，改后的条件接在块头后面。
  if (edited !== undefined && conditionsAt < 0) inserted.unshift({ at: Math.min(1, kept.length), lines: edited.map((line) => "\t" + line) });
  for (const group of groups) {
    if (group.at === undefined) {
      group.at = kept.length;
      inserted.push({ at: kept.length, lines: group.lines });
    }
  }

  const cells = [...kept];
  for (let at = kept.length; at >= 0; at -= 1) {
    const here = inserted.filter((bucket) => bucket.at === at);
    if (here.length) cells.splice(at, 0, ...here.flatMap((bucket) => bucket.lines.map((text) => ({ text, eol }))));
  }
  // 文件最后一行原本没有换行符，后面接了内容就要补上。
  for (let index = 0; index + 1 < cells.length; index += 1) if (!cells[index].eol) cells[index].eol = eol;
  return cells.map((cell) => cell.text + cell.eol);
}

/** 把生效的修改写进基础过滤器。`byBlock` 的键是规则序号。 */
export function applyOverlays(parsed: ParsedFilter, byBlock: Map<number, BaseOverlay>): string {
  const lines = [...parsed.lines];
  for (const block of [...parsed.blocks].reverse()) {
    const overlay = byBlock.get(block.index);
    if (overlay) lines.splice(block.start, block.end - block.start + 1, ...patchBlock(parsed, block, overlay));
  }
  return lines.join("\n");
}

const OPERATORS = new Set(["==", "!=", ">=", "<=", ">", "<", "="]);
const RESERVED = new Set(["show", "hide", "minimal", "continue", ...Object.keys(ACTION_GROUPS).map((command) => command.toLowerCase())]);

/** 改过的条件行的格式问题。只查语法：条件名、运算符、值和引号。 */
export function conditionLineIssue(line: string): string | undefined {
  const text = line.trim();
  if (!text) return "条件不能为空";
  if (text.length > MAX_CONDITION_LENGTH) return `一行最多 ${MAX_CONDITION_LENGTH} 个字符`;
  if (/[\x00-\x1f]/.test(text)) return "条件里不能换行";
  if (text.includes("#")) return "条件里不能写注释";
  const match = /^([A-Za-z]+)\s*(?:(==|!=|>=|<=|>|<|=)\s*)?(.*)$/.exec(text);
  if (!match) return "要以条件名开头，例如 StackSize";
  const [, field, , rest] = match;
  if (RESERVED.has(field.toLowerCase())) return `「${field}」是显示动作，不是条件`;
  if (!rest.trim()) return "条件后面要有值";
  if (rest.includes('""')) return "引号里不能是空的";
  if ((rest.match(/"/g)?.length ?? 0) % 2) return "引号要成对";
  return undefined;
}

const ITEM_BY_BASE_TYPE = new Map<string, ItemDefinition>();
const remember = (item: ItemDefinition) => {
  const key = item.matcher.baseType?.toLowerCase();
  if (key && !ITEM_BY_BASE_TYPE.has(key)) ITEM_BY_BASE_TYPE.set(key, item);
};
for (const item of FILTER_ITEMS) if (!item.id.includes(":")) remember(item);
for (const item of FILTER_ITEMS) if (item.id.startsWith("base:")) remember(item);

/** 一条规则的名字和其余条件：物品能对上目录就用中文名，否则用类名、块头的注释。 */
export function describeBlock(block: FilterBlock): { label: string; detail: string } {
  const first = (command: string) => block.conditions.find((line) => line.split(" ")[0] === command);
  const values = (line?: string) => {
    if (!line) return [];
    const quoted = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
    if (quoted.length) return quoted;
    const words = line.split(" ");
    return words.slice(OPERATORS.has(words[1]) ? 2 : 1);
  };
  const bases = values(first("BaseType"));
  const classes = values(first("Class"));
  const names = bases.length
    ? bases.map((name) => ITEM_BY_BASE_TYPE.get(name.toLowerCase())?.localeNames.cn || name)
    : classes;
  const used = bases.length ? first("BaseType") : first("Class");
  return {
    label: names.length ? names.slice(0, 2).join("、") + (names.length > 2 ? ` 等 ${names.length} 项` : "") : block.comment || `第 ${block.index + 1} 条规则`,
    detail: block.conditions.filter((line) => line !== used).join(" · "),
  };
}

export function mergeEffects(base: RuleEffects, patch: RuleEffects): RuleEffects {
  const merged: RuleEffects = { ...base };
  if (patch.beam !== undefined) merged.beam = patch.beam;
  if (patch.icon !== undefined) merged.icon = patch.icon;
  if (patch.font) {
    const font = { ...base.font };
    if (patch.font.fontSize !== undefined) font.fontSize = patch.font.fontSize;
    if (patch.font.textColor !== undefined) font.textColor = patch.font.textColor;
    if (patch.font.borderColor !== undefined) font.borderColor = patch.font.borderColor;
    if (patch.font.backgroundColor !== undefined) font.backgroundColor = patch.font.backgroundColor;
    if (Object.keys(font).length) merged.font = font;
  }
  if (patch.sound) merged.sound = patch.sound;
  return merged;
}

/** 基础过滤器里的一条规则，说的都是基础过滤器本身的样子。方案里的修改叠上去之后是什么样，由使用方按修改算。 */
export type BaseRuleView = {
  index: number;
  section: string;
  comment: string;
  label: string;
  detail: string;
  hidden: boolean;
  conditions: string[];
  effects: RuleEffects;
};

export type OverlayStatus = { state: "ok"; blocks: number[] } | { state: "invalid"; reason: string };

export type BaseRules = {
  rules: BaseRuleView[];
  overlays: Record<string, OverlayStatus>;
  /** 基础过滤器里用到的条件名，小写。改条件时用来提醒拼写。 */
  conditionNames: string[];
};

/** 界面用的基础规则表：每条规则在基础过滤器里的样子，以及方案里每处修改的状态。 */
export function inspectBaseRules(text: string, audio: Record<string, string>, baseName: string | undefined, overlays: BaseOverlay[]): BaseRules {
  const parsed = parseFilterBlocks(text);
  const states = resolveOverlays(overlays, baseName, parsed.blocks);
  const status: Record<string, OverlayStatus> = {};
  for (const overlay of overlays) {
    const state = states.get(overlay.id);
    if (!state) continue;
    status[overlay.id] = state.state === "ok"
      ? { state: "ok", blocks: state.blocks }
      : { state: "invalid", reason: overlayReason(state.reason, overlay, baseName) };
  }
  const rules = parsed.blocks.map((block) => ({
    index: block.index, section: block.section, comment: block.comment,
    ...describeBlock(block),
    hidden: !block.show,
    conditions: block.conditions,
    effects: displayEffects(block.actions, audio),
  }));
  const conditionNames = new Set(parsed.blocks.flatMap((block) => block.conditions.map((line) => line.split(" ")[0].toLowerCase())));
  return { rules, overlays: status, conditionNames: [...conditionNames] };
}

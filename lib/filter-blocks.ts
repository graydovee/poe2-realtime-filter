import type { PresetSound } from "./types";

export type ActionGroup = "beam" | "icon" | "fontSize" | "textColor" | "borderColor" | "backgroundColor" | "builtinSound" | "customSound" | "dropSound" | "dropSoundIfAlert";
export type BlockAction = { key: ActionGroup; command: string; value: string };

/** 动作指令和它管的那一项显示效果。 */
export const ACTION_GROUPS: Record<string, ActionGroup> = {
  PlayEffect: "beam", MinimapIcon: "icon", SetFontSize: "fontSize", SetTextColor: "textColor",
  SetBorderColor: "borderColor", SetBackgroundColor: "backgroundColor", PlayAlertSound: "builtinSound",
  PlayAlertSoundPositional: "builtinSound", CustomAlertSound: "customSound", CustomAlertSoundOptional: "customSound",
  DisableDropSound: "dropSound", EnableDropSound: "dropSound", DisableDropSoundIfAlertSound: "dropSoundIfAlert",
  EnableDropSoundIfAlertSound: "dropSoundIfAlert",
};

const BLOCK_HEADS = new Set(["Show", "Hide", "Minimal"]);

/** 一行里的指令和参数。引号里的内容算一个词，注释不算。 */
export function tokenize(line: string): string[] {
  return (line.replace(/^\uFEFF/, "").match(/"[^"]*"|#[^\r\n]*|[^\s"#]+/g) ?? []).filter((word) => !word.startsWith("#"));
}

function quote(value: string): string {
  return '"' + value.replace(/"/g, '\\"') + '"';
}

/** 规则或修改的音效指令。`distinguishCustom` 给自定义音效和基础过滤器音效加上客户端自己的前缀，处理音效时靠前缀分辨它们。 */
export function soundLine(sound: PresetSound, distinguishCustom: boolean): string {
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

export type BlockPart =
  | { line: number; kind: "head" }
  | { line: number; kind: "condition"; command: string }
  | { line: number; kind: "action"; action: BlockAction }
  | { line: number; kind: "continue" }
  | { line: number; kind: "comment" };

/** 过滤器里的一条规则：从 `Show` / `Hide` 那一行起，到下一条规则的头之前。`line` 都是 `lines` 里的下标。 */
export type FilterBlock = {
  index: number;
  start: number;
  /** 最后一句有内容的指令所在的那一行。 */
  end: number;
  show: boolean;
  continue: boolean;
  /** 块头 `#` 之后的内容。 */
  comment: string;
  /** 规则前面最近的分节注释。 */
  section: string;
  /** 规范化后的条件行：去掉注释，词之间只留一个空格。 */
  conditions: string[];
  actions: BlockAction[];
  parts: BlockPart[];
};

export type ParsedFilter = { lines: string[]; blocks: FilterBlock[]; crlf: boolean };

const headComment = (line: string) => /^\uFEFF?\s*(?:Show|Hide|Minimal)\s*#?(.*)\r?$/.exec(line)?.[1]?.trim() ?? "";

/** 注释行里的分节名：去掉 `[[0100]]`、`[1101]` 这样的编号。分隔线和 `!` 开头的备注不算分节。 */
function sectionTitle(line: string): string {
  const match = /^\uFEFF?\s*#\s*(.*)\r?$/.exec(line);
  if (!match) return "";
  const text = match[1].trim();
  if (!text.startsWith("!")) {
    const title = text.replace(/^\[+\s*[^[\]]*\]*\s*/, "").trim();
    if (/[^\s\W_]/.test(title)) return title;
  }
  return "";
}

const isComment = (line: string) => /^\uFEFF?\s*#/.test(line);

/** 把过滤器按行拆开，并切出每一条规则。行尾的 `\r` 留在行里，原样拼回去时文件的其他部分一个字节都不变。 */
export function parseFilterBlocks(text: string): ParsedFilter {
  const lines = text.split("\n");
  const blocks: FilterBlock[] = [];
  let current: FilterBlock | undefined;
  // 当前规则后面已经空过一行：再出现的注释属于下一条规则前面。
  let detached = false;
  let section = "";
  lines.forEach((raw, line) => {
    const [command, ...args] = tokenize(raw);
    if (BLOCK_HEADS.has(command)) {
      current = {
        index: blocks.length, start: line, end: line, show: command === "Show", continue: false,
        comment: headComment(raw), section, conditions: [], actions: [], parts: [{ line, kind: "head" }],
      };
      blocks.push(current);
      detached = false;
    } else if (current) {
      if (!command) {
        if (isComment(raw)) {
          if (detached) {
            const title = sectionTitle(raw);
            if (title) section = title;
          } else current.parts.push({ line, kind: "comment" });
        } else detached = true;
      } else {
        current.end = line;
        if (command === "Continue") {
          current.continue = true;
          current.parts.push({ line, kind: "continue" });
        } else if (Object.prototype.hasOwnProperty.call(ACTION_GROUPS, command)) {
          const action = { key: ACTION_GROUPS[command], command, value: args.join(" ") };
          current.actions.push(action);
          current.parts.push({ line, kind: "action", action });
        } else {
          current.conditions.push([command, ...args].join(" "));
          current.parts.push({ line, kind: "condition", command });
        }
      }
    } else {
      const title = sectionTitle(raw);
      if (title) section = title;
    }
  });
  return { lines, blocks, crlf: text.includes("\r\n") };
}

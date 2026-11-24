export type TokenKind = "rule" | "prop" | "op" | "num" | "str" | "value" | "comment";

export type FilterToken = { text: string; kind: TokenKind };

export type FilterLine = {
  /** `Show` / `Hide` 所在的规则序号，同一序号的行属于同一条规则；首个规则之前为空。 */
  block: number | null;
  /** 空行 | 注释 | 规则起点 | 条件行 | 动作行 */
  type: "blank" | "comment" | "rule" | "condition" | "action";
  indent: string;
  tokens: FilterToken[];
};

const ACTIONS = new Set([
  "SetTextColor", "SetBackgroundColor", "SetBorderColor", "SetFontSize", "RemoveBorderColor",
  "MinimapIcon", "PlayEffect", "PlayAlertSound", "PlayAlertSoundPositional", "CustomAlertSound",
  "DisableDropSound", "EnableDropSound", "Continue",
]);

function tokenize(rest: string): FilterToken[] {
  const tokens: FilterToken[] = [];
  for (const match of rest.matchAll(/"[^"]*"|==|>=|<=|!=|[<>=]|[^\s"]+/g)) {
    const text = match[0];
    const kind: TokenKind = text.startsWith('"')
      ? "str"
      : /^[<>=!]/.test(text)
        ? "op"
        : /^-?\d+(?:\.\d+)?$/.test(text)
          ? "num"
          : "value";
    tokens.push({ text, kind });
  }
  return tokens;
}

/**
 * 把过滤器文本拆成逐行带语法类别的结构，供预览着色。
 * 只做逐行识别，不解析语义：`Show`/`Hide` 起新规则，已知的动作名算动作行，其余算条件行。
 */
export function tokenizeFilter(code: string): FilterLine[] {
  const lines: FilterLine[] = [];
  let block: number | null = null;
  for (const raw of code.split(/\r?\n/)) {
    const content = raw.trim();
    if (!content) {
      lines.push({ block, type: "blank", indent: "", tokens: [] });
      continue;
    }
    const indent = raw.slice(0, raw.length - raw.trimStart().length);
    if (content.startsWith("#")) {
      lines.push({ block, type: "comment", indent, tokens: [{ text: content, kind: "comment" }] });
      continue;
    }
    const rule = /^(Show|Hide)\b(.*)$/i.exec(content);
    if (rule) {
      block = (block ?? -1) + 1;
      const tokens: FilterToken[] = [{ text: rule[1], kind: "rule" }];
      const trailing = rule[2].trim();
      if (trailing) tokens.push({ text: trailing, kind: "comment" });
      lines.push({ block, type: "rule", indent, tokens });
      continue;
    }
    const [head, ...rest] = content.split(/\s+/);
    const type = ACTIONS.has(head) ? "action" : "condition";
    lines.push({ block, type, indent, tokens: [{ text: head, kind: "prop" }, ...tokenize(rest.join(" "))] });
  }
  return lines;
}

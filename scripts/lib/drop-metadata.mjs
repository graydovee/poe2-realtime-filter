/**
 * data/item-drop-metadata.json 的分段改写。文件里每个物品占一行，改写时整段按行替换，
 * 没改到的行原样写回，其余内容不动。各段的记录都是「键: 值」，冒号和逗号后面各一个空格。
 */

const SECTIONS = {
  stackable: ['  "stackable": [', "  ],"],
  dropEnabled: ['  "dropEnabled": {', "  },"],
  items: ['  "items": {', "  },"],
  uniques: ['  "uniques": {', "  },"],
  localizedUniqueNames: ['  "localizedUniqueNames": {', "  },"],
};
const LINE = /^    ("(?:[^"\\]|\\.)*")(?:: (.*?))?(,?)$/;

/** 一条记录写成文件里的一行；record 的每个冒号和逗号后面各一个空格。 */
const record = (value) => value && typeof value === "object"
  ? "{" + Object.entries(value).map(([key, item]) => JSON.stringify(key) + ": " + record(item)).join(", ") + "}"
  : JSON.stringify(value);
const line = (entry, last) => "    " + JSON.stringify(entry.name) + (entry.value === undefined ? "" : ": " + record(entry.value)) + (last ? "" : ",");

/**
 * 把 edit 收到的五个分段（名字 → 记录数组，每条是 { name, value }；stackable 段只有 name）改写后放回文件。
 * 返回新的文件内容，以及每段改动（增、删、改）的条数。
 */
export function editDropMetadata(text, edit) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const spans = {};
  const sections = {};
  for (const [name, [open, close]] of Object.entries(SECTIONS)) {
    const start = lines.indexOf(open);
    const end = lines.findIndex((line, index) => index > start && (line === close || line === close.replace(/,$/, "")));
    if (start < 0 || end < 0) throw new Error("item-drop-metadata.json 里找不到分段 " + open.trim());
    spans[name] = { start, end };
    sections[name] = lines.slice(start + 1, end).map((text) => {
      const match = LINE.exec(text);
      if (!match) throw new Error(open.trim() + " 段里有无法识别的行：" + text);
      const entry = { name: JSON.parse(match[1]), value: match[2] === undefined ? undefined : JSON.parse(match[2]) };
      if (line(entry, true) !== text.replace(/,$/, "")) throw new Error(open.trim() + " 段里的写法和预期不同：" + text);
      return entry;
    });
  }
  const before = Object.fromEntries(Object.entries(sections).map(([name, entries]) => [name, new Map(entries.map((entry) => [entry.name, line(entry, true)]))]));
  edit(sections);
  const changed = {};
  for (const [name, { start, end }] of [...Object.entries(spans)].reverse()) {
    const rendered = sections[name].map((entry, index) => line(entry, index === sections[name].length - 1));
    const after = new Map(sections[name].map((entry) => [entry.name, line(entry, true)]));
    changed[name] = {
      added: [...after.keys()].filter((key) => !before[name].has(key)).length,
      removed: [...before[name].keys()].filter((key) => !after.has(key)).length,
      changed: [...after.keys()].filter((key) => before[name].has(key) && before[name].get(key) !== after.get(key)).length,
    };
    lines.splice(start + 1, end - start - 1, ...rendered);
  }
  return { text: lines.join(eol), changed };
}

/** 原有顺序是同一种排法时给出比较函数，否则返回 null。 */
const sorter = (names) => {
  const sorted = (compare) => names.every((name, index) => index === 0 || compare(names[index - 1], name) <= 0);
  const plain = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return sorted(plain) ? plain : sorted((a, b) => a.localeCompare(b)) ? (a, b) => a.localeCompare(b) : null;
};

/** 写入一条记录（已有同名记录时替换），新记录按原有的排法插进去。 */
export function setEntry(entries, name, value) {
  const existing = entries.find((entry) => entry.name === name);
  if (existing) {
    existing.value = value;
    return;
  }
  entries.push({ name, value });
  const compare = sorter(entries.slice(0, -1).map((entry) => entry.name));
  if (compare) entries.sort((a, b) => compare(a.name, b.name));
}

export const removeEntry = (entries, name) => {
  const index = entries.findIndex((entry) => entry.name === name);
  if (index >= 0) entries.splice(index, 1);
};

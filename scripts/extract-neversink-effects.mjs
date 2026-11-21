import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * 从 vendored 的 NeverSink 过滤器里抽取「特效预设集合」，并生成 4 条默认规则。
 *
 *   node scripts/extract-neversink-effects.mjs
 *
 * 产物：
 *   data/neversink-effects.json —— 光柱 / 地图图标 / 字体组合 / 音效 的可选预设
 *   data/default-rules.json     —— 崇高石 / 混沌石 / 剥离石 / 神圣石四条默认价格规则
 */

const ROOT = path.resolve("vendor/neversink");
const DEFAULT_ANCHORS = [
  { itemId: "exalted-orb", name: "Exalted Orb", ruleId: "default-exalted", label: "崇高石价格档" },
  { itemId: "chaos-orb", name: "Chaos Orb", ruleId: "default-chaos", label: "混沌石价格档" },
  { itemId: "orb-of-annulment", name: "Orb of Annulment", ruleId: "default-annulment", label: "剥离石价格档" },
  { itemId: "divine-orb", name: "Divine Orb", ruleId: "default-divine", label: "神圣石价格档" },
];

const styles = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("(STYLE)"))
  .map((entry) => entry.name);

const files = [];
for (const name of readdirSync(ROOT).filter((name) => name.endsWith(".filter")).sort()) files.push({ style: "default", file: name });
for (const style of styles.sort()) {
  for (const name of readdirSync(path.join(ROOT, style)).filter((name) => name.endsWith(".filter")).sort()) {
    files.push({ style, file: path.join(style, name) });
  }
}

const action = (block, pattern) => {
  const match = pattern.exec(block);
  return match ? match[1].trim() : undefined;
};

const beams = new Map();
const icons = new Map();
const fonts = new Map();
const sounds = new Map();
const customSounds = new Map();
const appearances = new Map();

for (const { style, file } of files) {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  const blocks = text.split(/(?=^(?:Show|Hide|Minimal)\b)/m).filter((block) => /^(?:Show|Hide|Minimal)\b/.test(block));
  for (const block of blocks) {
    const beam = action(block, /^\tPlayEffect (.+)$/m);
    if (beam) beams.set(beam, (beams.get(beam) ?? 0) + 1);
    const icon = action(block, /^\tMinimapIcon (.+)$/m);
    if (icon) icons.set(icon, (icons.get(icon) ?? 0) + 1);
    const fontSize = action(block, /^\tSetFontSize (\d+)$/m);
    const textColor = action(block, /^\tSetTextColor (.+)$/m);
    const borderColor = action(block, /^\tSetBorderColor (.+)$/m);
    const backgroundColor = action(block, /^\tSetBackgroundColor (.+)$/m);
    if (fontSize || textColor || borderColor || backgroundColor) {
      const font = {
        ...(fontSize ? { fontSize: Number(fontSize) } : {}),
        ...(textColor ? { textColor } : {}),
        ...(borderColor ? { borderColor } : {}),
        ...(backgroundColor ? { backgroundColor } : {}),
      };
      fonts.set(JSON.stringify(font), font);
    }
    const alert = action(block, /^\tPlayAlertSound (.+)$/m);
    if (alert) {
      const [id, volume] = alert.split(/\s+/);
      const sound = { type: "builtin", id: Number(id), volume: Number(volume ?? 300) };
      sounds.set("builtin:" + sound.id + ":" + sound.volume, sound);
    }
    const custom = action(block, /^\tCustomAlertSound(?:Optional)? "([^"]+)"/m);
    if (custom) {
      customSounds.set(custom, (customSounds.get(custom) ?? 0) + 1);
      const sound = { type: "neversink", fileName: custom };
      sounds.set("neversink:" + custom, sound);
    }
    // 默认规则的外观取自 default 风格的 2-SEMI-STRICT 档位。
    if (style === "default" && file.includes("2-SEMI-STRICT")) {
      for (const anchor of DEFAULT_ANCHORS) {
        if (appearances.has(anchor.itemId)) continue;
        if (!block.includes('"' + anchor.name + '"')) continue;
        if (!/^\s*BaseType == /m.test(block)) continue;
        appearances.set(anchor.itemId, { beam, icon, font: fontSize || textColor || borderColor || backgroundColor ? {
          ...(fontSize ? { fontSize: Number(fontSize) } : {}),
          ...(textColor ? { textColor } : {}),
          ...(borderColor ? { borderColor } : {}),
          ...(backgroundColor ? { backgroundColor } : {}),
        } : undefined, sound: alert ? { type: "builtin", id: Number(alert.split(/\s+/)[0]), volume: Number(alert.split(/\s+/)[1] ?? 300) } : custom ? { type: "neversink", fileName: custom } : undefined });
      }
    }
  }
}

const sortBeam = (list) => list.sort((a, b) => a.localeCompare(b));
const sortIcons = (list) => list.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
const sortFonts = (list) => list.sort((a, b) => (a.fontSize ?? 0) - (b.fontSize ?? 0) || JSON.stringify(a).localeCompare(JSON.stringify(b)));

const payload = {
  version: 1,
  generatedBy: "scripts/extract-neversink-effects.mjs",
  sources: { files: files.length, styles: ["default", ...styles.map((style) => style.replace("(STYLE) ", "").toLowerCase())] },
  beams: sortBeam([...beams.keys()]),
  icons: sortIcons([...icons.keys()]),
  fonts: sortFonts([...fonts.values()]),
  sounds: [...sounds.values()],
  customSounds: [...customSounds.keys()].sort(),
};
writeFileSync(path.resolve("data/neversink-effects.json"), JSON.stringify(payload, null, 2) + "\n");

const pricePoint = (itemId) => ({ amount: 1, currency: "exalted", referenceItemId: itemId });
const rules = DEFAULT_ANCHORS.map((anchor, index) => {
  const appearance = appearances.get(anchor.itemId);
  if (!appearance) throw new Error("没有在 2-SEMI-STRICT 里找到 " + anchor.name + " 的原始规则");
  const next = DEFAULT_ANCHORS[index + 1];
  return {
    id: anchor.ruleId,
    name: anchor.label,
    enabled: true,
    hidden: false,
    autoRange: true,
    target: { itemIds: [], range: { min: pricePoint(anchor.itemId), ...(next ? { max: pricePoint(next.itemId) } : {}) } },
    effects: {
      ...(appearance.beam ? { beam: appearance.beam } : {}),
      ...(appearance.icon ? { icon: appearance.icon } : {}),
      ...(appearance.font ? { font: appearance.font } : {}),
      ...(appearance.sound ? { sound: appearance.sound } : {}),
    },
  };
});
writeFileSync(path.resolve("data/default-rules.json"), JSON.stringify({ version: 1, generatedBy: "scripts/extract-neversink-effects.mjs", rules }, null, 2) + "\n");

console.log("特效集合：光柱 " + payload.beams.length + " / 图标 " + payload.icons.length + " / 字体 " + payload.fonts.length + " / 音效 " + payload.sounds.length + "（自定义音效文件 " + payload.customSounds.length + "）");
console.log("默认规则：" + rules.map((rule) => rule.name + "[" + [rule.effects.beam, rule.effects.icon, rule.effects.font?.fontSize, rule.effects.sound?.id].filter(Boolean).join("/") + "]").join("  "));

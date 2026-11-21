import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * 从 vendored 的 NeverSink 过滤器里抽取「完整特效预设」，并生成 4 条默认规则。
 *
 *   node scripts/extract-neversink-effects.mjs
 *
 * 产物：
 *   data/neversink-effects.json —— 每套视觉风格各一份完整外观预设列表
 *                                  （光柱 + 地图图标 + 字体 + 音效，一个预设就是一套完整特效）
 *   data/default-rules.json     —— 崇高石 / 混沌石 / 剥离石 / 神圣石四条默认价格规则
 */

const ROOT = path.resolve("vendor/neversink");
const DEFAULT_ANCHORS = [
  { itemId: "exalted-orb", name: "Exalted Orb", ruleId: "default-exalted", label: "崇高石价格档" },
  { itemId: "chaos-orb", name: "Chaos Orb", ruleId: "default-chaos", label: "混沌石价格档" },
  { itemId: "orb-of-annulment", name: "Orb of Annulment", ruleId: "default-annulment", label: "剥离石价格档" },
  { itemId: "divine-orb", name: "Divine Orb", ruleId: "default-divine", label: "神圣石价格档" },
];

const styleDirs = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("(STYLE)"))
  .map((entry) => entry.name);

const styles = new Map();
styles.set("default", readdirSync(ROOT).filter((name) => name.endsWith(".filter")).sort().map((name) => ({ file: name, style: "default" })));
for (const dir of styleDirs.sort()) {
  const style = dir.replace("(STYLE) ", "").toLowerCase();
  styles.set(style, readdirSync(path.join(ROOT, dir)).filter((name) => name.endsWith(".filter")).sort().map((name) => ({ file: path.join(dir, name), style })));
}

const grab = (block, pattern) => {
  const match = pattern.exec(block);
  return match ? match[1].trim() : undefined;
};

function appearanceOf(block) {
  const beam = grab(block, /^\tPlayEffect (.+)$/m);
  const icon = grab(block, /^\tMinimapIcon (.+)$/m);
  const fontSize = grab(block, /^\tSetFontSize (\d+)$/m);
  const textColor = grab(block, /^\tSetTextColor (.+)$/m);
  const borderColor = grab(block, /^\tSetBorderColor (.+)$/m);
  const backgroundColor = grab(block, /^\tSetBackgroundColor (.+)$/m);
  const alert = grab(block, /^\tPlayAlertSound (\d+) (\d+)$/m);
  const custom = grab(block, /^\tCustomAlertSound(?:Optional)? "([^"]+)"/m);
  let sound;
  if (alert) {
    const [id, volume] = alert.split(/\s+/);
    sound = { type: "builtin", id: Number(id), volume: Number(volume ?? 300) };
  } else if (custom) {
    sound = { type: "neversink", fileName: custom };
  }
  const font = fontSize || textColor || borderColor || backgroundColor
    ? {
        ...(fontSize ? { fontSize: Number(fontSize) } : {}),
        ...(textColor ? { textColor } : {}),
        ...(borderColor ? { borderColor } : {}),
        ...(backgroundColor ? { backgroundColor } : {}),
      }
    : undefined;
  if (!beam && !icon && !font) return undefined;
  return { ...(beam ? { beam } : {}), ...(icon ? { icon } : {}), ...(font ? { font } : {}), ...(sound ? { sound } : {}) };
}

const presetSets = {};
const sounds = new Map();
const customSounds = new Set();
let anchorAppearances;

for (const [style, files] of styles) {
  const looks = new Map();
  for (const { file } of files) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    const blocks = text.split(/(?=^(?:Show|Hide|Minimal)\b)/m).filter((block) => /^(?:Show|Hide|Minimal)\b/.test(block));
    for (const block of blocks) {
      const appearance = appearanceOf(block);
      if (!appearance) continue;
      const key = JSON.stringify(appearance);
      const entry = looks.get(key) ?? { appearance, count: 0 };
      entry.count += 1;
      looks.set(key, entry);
      if (appearance.sound) {
        const soundKey = JSON.stringify(appearance.sound);
        sounds.set(soundKey, appearance.sound);
        if (appearance.sound.type !== "builtin") customSounds.add(appearance.sound.fileName);
      }
    }
  }
  const ordered = [...looks.values()].sort((a, b) => b.count - a.count || JSON.stringify(a.appearance).localeCompare(JSON.stringify(b.appearance)));
  presetSets[style] = ordered.map((entry, index) => ({
    id: "look-" + style + "-" + String(index + 1).padStart(2, "0"),
    ...entry.appearance,
  }));

  // 默认 4 条规则的外观取自 default 风格的 2-SEMI-STRICT。
  if (style === "default") {
    const semiStrict = files.find((entry) => entry.file.includes("2-SEMI-STRICT"));
    const text = readFileSync(path.join(ROOT, semiStrict.file), "utf8");
    const blocks = text.split(/(?=^(?:Show|Hide|Minimal)\b)/m).filter((block) => /^(?:Show|Hide|Minimal)\b/.test(block));
    anchorAppearances = new Map();
    for (const anchor of DEFAULT_ANCHORS) {
      const block = blocks.find((candidate) => /^\s*BaseType == /m.test(candidate) && candidate.includes('"' + anchor.name + '"'));
      if (!block) throw new Error("2-SEMI-STRICT 里找不到 " + anchor.name + " 的原始规则");
      const appearance = appearanceOf(block);
      const preset = presetSets.default.find((candidate) => JSON.stringify({ beam: candidate.beam, icon: candidate.icon, font: candidate.font, sound: candidate.sound }) === JSON.stringify(appearance));
      if (!preset) throw new Error(anchor.name + " 的外观不在 default 预设集合里");
      anchorAppearances.set(anchor.itemId, { appearance, presetId: preset.id });
    }
  }
}

const styleNames = ["default", ...styleDirs.map((dir) => dir.replace("(STYLE) ", "").toLowerCase()).sort()];
const payload = {
  version: 2,
  generatedBy: "scripts/extract-neversink-effects.mjs",
  sources: { styles: styleNames },
  styles: Object.fromEntries(styleNames.map((style) => [style, presetSets[style]])),
  sounds: [...sounds.values()],
  customSounds: [...customSounds].sort(),
};
writeFileSync(path.resolve("data/neversink-effects.json"), JSON.stringify(payload, null, 2) + "\n");

const pricePoint = (itemId) => ({ amount: 1, currency: "exalted", referenceItemId: itemId });
const rules = DEFAULT_ANCHORS.map((anchor, index) => {
  const { appearance, presetId } = anchorAppearances.get(anchor.itemId);
  const next = DEFAULT_ANCHORS[index + 1];
  return {
    id: anchor.ruleId,
    name: anchor.label,
    enabled: true,
    hidden: false,
    autoRange: true,
    effectPresetId: presetId,
    target: { itemIds: [], range: { min: pricePoint(anchor.itemId), ...(next ? { max: pricePoint(next.itemId) } : {}) } },
    effects: appearance,
  };
});
writeFileSync(path.resolve("data/default-rules.json"), JSON.stringify({ version: 2, generatedBy: "scripts/extract-neversink-effects.mjs", rules }, null, 2) + "\n");

console.log("预设数量：" + styleNames.map((style) => style + " " + presetSets[style].length).join(" / "));
console.log("默认规则预设：" + rules.map((rule) => rule.name + "=" + rule.effectPresetId).join("  "));

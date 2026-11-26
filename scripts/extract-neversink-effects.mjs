import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * 从 vendored 的 NeverSink 过滤器里抽取特效，生成 4 条默认规则。
 *
 *   node scripts/extract-neversink-effects.mjs
 *
 * 产物：
 *   data/default-rules.json —— 崇高石 / 混沌石 / 剥离石 / 神圣石四个默认价格档。
 *                             区间就是普通价格点：每档「≥ 1 枚本档通货，且 < 1 枚下一档通货」。
 */

const ROOT = path.resolve("vendor/neversink");
const DEFAULT_ANCHORS = [
  { itemId: "exalted-orb", name: "Exalted Orb", unit: "exalted", ruleId: "default-exalted", label: "崇高石价格档" },
  { itemId: "chaos-orb", name: "Chaos Orb", unit: "chaos", ruleId: "default-chaos", label: "混沌石价格档" },
  { itemId: "orb-of-annulment", name: "Orb of Annulment", unit: "annulment", ruleId: "default-annulment", label: "剥离石价格档" },
  { itemId: "divine-orb", name: "Divine Orb", unit: "divine", ruleId: "default-divine", label: "神圣石价格档" },
];

const files = readdirSync(ROOT).filter((name) => name.endsWith(".filter")).sort();
const blocksOf = (file) => readFileSync(path.join(ROOT, file), "utf8")
  .split(/(?=^(?:Show|Hide|Minimal)\b)/m).filter((block) => /^(?:Show|Hide|Minimal)\b/.test(block));

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

// 默认风格里每套不同的完整外观按出现次数排位，规则用自己那套的编号（effectPresetId）回指。
const looks = new Map();
for (const file of files) {
  for (const block of blocksOf(file)) {
    const appearance = appearanceOf(block);
    if (!appearance) continue;
    const key = JSON.stringify(appearance);
    const entry = looks.get(key) ?? { appearance, count: 0 };
    entry.count += 1;
    looks.set(key, entry);
  }
}
const presets = [...looks.values()]
  .sort((a, b) => b.count - a.count || JSON.stringify(a.appearance).localeCompare(JSON.stringify(b.appearance)))
  .map((entry, index) => ({ id: "look-default-" + String(index + 1).padStart(2, "0"), ...entry.appearance }));

// 默认 4 条规则的外观取自 2-SEMI-STRICT。
const semiStrict = blocksOf(files.find((file) => file.includes("2-SEMI-STRICT")));
const anchorAppearances = new Map();
for (const anchor of DEFAULT_ANCHORS) {
  const block = semiStrict.find((candidate) => /^\s*BaseType == /m.test(candidate) && candidate.includes('"' + anchor.name + '"'));
  if (!block) throw new Error("2-SEMI-STRICT 里找不到 " + anchor.name + " 的原始规则");
  const appearance = appearanceOf(block);
  const preset = presets.find((candidate) => JSON.stringify({ beam: candidate.beam, icon: candidate.icon, font: candidate.font, sound: candidate.sound }) === JSON.stringify(appearance));
  if (!preset) throw new Error(anchor.name + " 的外观不在 default 预设集合里");
  anchorAppearances.set(anchor.itemId, { appearance, presetId: preset.id });
}

const pricePoint = (unit) => ({ amount: 1, currency: unit });
const rules = DEFAULT_ANCHORS.map((anchor, index) => {
  const { appearance, presetId } = anchorAppearances.get(anchor.itemId);
  const next = DEFAULT_ANCHORS[index + 1];
  return {
    id: anchor.ruleId,
    name: anchor.label,
    enabled: true,
    hidden: false,
    effectPresetId: presetId,
    target: { itemIds: [], itemEnabled: true, priceEnabled: true, range: { min: pricePoint(anchor.unit), ...(next ? { max: pricePoint(next.unit) } : {}) } },
    effects: appearance,
  };
});
writeFileSync(path.resolve("data/default-rules.json"), JSON.stringify({ version: 3, generatedBy: "scripts/extract-neversink-effects.mjs", rules }, null, 2) + "\n");

console.log("默认规则预设：" + rules.map((rule) => rule.name + "=" + rule.effectPresetId).join("  "));

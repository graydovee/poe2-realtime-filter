import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const effects = JSON.parse(readFileSync("data/neversink-effects.json", "utf8"));
const rules = JSON.parse(readFileSync("data/default-rules.json", "utf8")).rules;
const baseline = readFileSync("vendor/neversink/NeverSink's filter 2 - 2-SEMI-STRICT.filter", "utf8");
const styleNames = ["default", "aura", "cobalt", "customsounds", "darkmode", "mythic", "vaal", "zen"];

test("每套视觉风格都有一份完整特效预设，一个预设包含光柱 / 图标 / 字体 / 音效", () => {
  for (const style of styleNames) {
    const presets = effects.styles[style];
    assert.ok(Array.isArray(presets) && presets.length >= 20, style + " 预设太少");
    const ids = new Set();
    for (const preset of presets) {
      assert.ok(preset.id && !ids.has(preset.id), style + " 预设 id 重复：" + preset.id);
      ids.add(preset.id);
      assert.ok(preset.beam || preset.icon || preset.font, preset.id + " 是空预设");
      if (preset.sound) {
        assert.ok(preset.sound.type === "builtin" ? Number.isInteger(preset.sound.id) : typeof preset.sound.fileName === "string");
      }
    }
  }
  assert.ok(effects.styles.default.some((preset) => preset.beam && preset.icon && preset.font && preset.sound), "应存在四项齐全的预设");
});

test("默认 4 条规则各自引用一个完整预设，且外观与之一致", () => {
  assert.equal(rules.length, 4);
  const presets = new Map(effects.styles.default.map((preset) => [preset.id, preset]));
  // 价格档从低到高：崇高石、混沌石、剥离石、神圣石；区间端点是普通的计价单位。
  assert.deepEqual(rules.map((rule) => rule.target.range.min.currency), ["exalted", "chaos", "annulment", "divine"]);
  assert.deepEqual(rules.map((rule) => rule.target.range.max?.currency ?? null), ["chaos", "annulment", "divine", null]);
  for (const rule of rules) {
    const preset = presets.get(rule.effectPresetId);
    assert.ok(preset, rule.id + " 的预设不存在：" + rule.effectPresetId);
    const picked = {
      ...(preset.beam ? { beam: preset.beam } : {}),
      ...(preset.icon ? { icon: preset.icon } : {}),
      ...(preset.font ? { font: preset.font } : {}),
      ...(preset.sound ? { sound: preset.sound } : {}),
    };
    assert.deepEqual(rule.effects, picked, rule.id + " 的特效应与预设一致");
    assert.equal(rule.autoRange, undefined, "价格档是普通规则，没有跟随市价的特殊开关");
    assert.deepEqual(rule.target.itemIds, []);
  }
});

test("默认规则的特效确实来自基础过滤器原文", () => {
  const expectations = [
    ["Exalted Orb", "White", "1 Yellow Circle"],
    ["Chaos Orb", "Yellow", "1 Yellow Circle"],
    ["Orb of Annulment", "Red", "0 Red Circle"],
    ["Divine Orb", "Red", "0 Red Star"],
  ];
  for (const [itemName, beam, icon] of expectations) {
    const block = baseline.split(/(?=^(?:Show|Hide)\b)/m).find((candidate) => /^\s*BaseType == /m.test(candidate) && candidate.includes('"' + itemName + '"'));
    assert.ok(block, "基线里找不到 " + itemName);
    assert.ok(block.includes("\tPlayEffect " + beam), itemName + " 的光柱应为 " + beam);
    assert.ok(block.includes("\tMinimapIcon " + icon), itemName + " 的图标应为 " + icon);
  }
});

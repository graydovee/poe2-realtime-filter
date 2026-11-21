import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const palette = JSON.parse(readFileSync("data/neversink-effects.json", "utf8"));
const rules = JSON.parse(readFileSync("data/default-rules.json", "utf8")).rules;
const baseline = readFileSync("vendor/neversink/NeverSink's filter 2 - 2-SEMI-STRICT.filter", "utf8");

test("特效集合覆盖光柱 / 图标 / 字体 / 音效", () => {
  assert.ok(palette.beams.length >= 10);
  assert.ok(palette.icons.length >= 20);
  assert.ok(palette.fonts.length >= 20);
  assert.ok(palette.sounds.length >= 4);
  assert.ok(palette.beams.includes("White"));
  assert.ok(palette.icons.includes("1 Yellow Circle"));
  assert.ok(palette.sounds.some((sound) => sound.type === "builtin" && sound.id === 2));
});

test("默认 4 条规则的价格档互不重叠且跟随市价", () => {
  assert.equal(rules.length, 4);
  assert.deepEqual(rules.map((rule) => rule.target.range.min.referenceItemId), ["exalted-orb", "chaos-orb", "orb-of-annulment", "divine-orb"]);
  for (const rule of rules) {
    assert.equal(rule.autoRange, true);
    assert.deepEqual(rule.target.itemIds, []);
    assert.equal(rule.hidden, false);
  }
  for (let index = 0; index < rules.length - 1; index += 1) {
    assert.deepEqual(rules[index].target.range.max, rules[index + 1].target.range.min);
  }
  assert.equal(rules[rules.length - 1].target.range.max, undefined);
});

test("默认规则的特效确实来自基础过滤器", () => {
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
    const rule = rules.find((candidate) => candidate.name.startsWith(itemName.replace(" ", "")) || candidate.id.endsWith(itemName.split(" ")[0].toLowerCase()));
    assert.ok(rule || itemName, itemName);
  }
  const beams = new Set(palette.beams);
  const icons = new Set(palette.icons);
  const fonts = new Set(palette.fonts.map((font) => JSON.stringify(font)));
  const sounds = new Set(palette.sounds.map((sound) => JSON.stringify(sound)));
  for (const rule of rules) {
    assert.ok(beams.has(rule.effects.beam), rule.id + " 的光柱不在集合里");
    assert.ok(icons.has(rule.effects.icon), rule.id + " 的图标不在集合里");
    assert.ok(fonts.has(JSON.stringify(rule.effects.font)), rule.id + " 的字体不在集合里");
    assert.ok(sounds.has(JSON.stringify(rule.effects.sound)), rule.id + " 的音效不在集合里");
  }
});

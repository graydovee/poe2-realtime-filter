import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rules = JSON.parse(readFileSync("data/default-rules.json", "utf8")).rules;
const baseline = readFileSync("vendor/neversink/NeverSink's filter 2 - 2-SEMI-STRICT.filter", "utf8");

test("默认 4 条规则各自带着一套完整的特效和它的预设 ID", () => {
  assert.equal(rules.length, 4);
  // 价格档从低到高：崇高石、混沌石、剥离石、神圣石；区间端点是普通的计价单位。
  assert.deepEqual(rules.map((rule) => rule.target.range.min.currency), ["exalted", "chaos", "annulment", "divine"]);
  assert.deepEqual(rules.map((rule) => rule.target.range.max?.currency ?? null), ["chaos", "annulment", "divine", null]);
  for (const rule of rules) {
    assert.ok(rule.effectPresetId, rule.id + " 缺少预设 ID");
    assert.ok(rule.effects.beam && rule.effects.icon && rule.effects.font, rule.id + " 的特效不完整");
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

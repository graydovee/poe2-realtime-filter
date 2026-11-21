import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanup, data, engine, pricing, makeRule, snapshot, blockFor, ruleBlocks, withPrice, DEFAULT_PROFILE, DIVINE } from "./helpers.mjs";

test.after(cleanup);

const { generateFilter } = engine;
const profile = (patch) => ({ ...DEFAULT_PROFILE, ...patch });

test("默认 4 条价格规则复刻基础过滤器里四枚通货的特效", () => {
  const generated = generateFilter(profile({ skippedItemIds: [] }), snapshot);
  assert.equal(generated.appliedRules.length, 4);
  const baseline = readFileSync("vendor/neversink/NeverSink's filter 2 - 2-SEMI-STRICT.filter", "utf8");
  const expectations = [
    ["崇高石价格档", "Exalted Orb", ["\tPlayEffect White", "\tMinimapIcon 1 Yellow Circle", "\tSetFontSize 42", "\tPlayAlertSound 2 300"]],
    ["混沌石价格档", "Chaos Orb", ["\tPlayEffect Yellow", "\tPlayAlertSound 2 300"]],
    ["剥离石价格档", "Orb of Annulment", ["\tPlayEffect Red", "\tMinimapIcon 0 Red Circle", "\tSetFontSize 45", "\tPlayAlertSound 1 300"]],
    ["神圣石价格档", "Divine Orb", ["\tPlayEffect Red", "\tMinimapIcon 0 Red Star", "\tPlayAlertSound 6 300"]],
  ];
  for (const [ruleName, itemName, lines] of expectations) {
    const baselineBlock = baseline.split(/(?=^(?:Show|Hide)\b)/m).find((block) => /^\s*BaseType == /m.test(block) && block.includes('"' + itemName + '"'));
    assert.ok(baselineBlock, "基线条目缺失：" + itemName);
    const generatedBlock = blockFor(generated.filterFile, "# poe2-filter rule: " + ruleName);
    assert.ok(generatedBlock, "生成规则块缺失：" + ruleName);
    for (const line of lines) {
      assert.ok(baselineBlock.includes(line), itemName + " 基线里没有 " + line);
      assert.ok(generatedBlock.includes(line), ruleName + " 生成结果里没有 " + line);
    }
  }
});

test("没有填写的特效不生成动作，避免凭空出现的音效", () => {
  const generated = generateFilter(profile({ rules: [makeRule({ target: { itemIds: ["divine-orb"] } })] }), snapshot);
  const block = blockFor(generated.filterFile, "# poe2-filter rule: 测试规则 / Divine Orb");
  assert.ok(block, "规则块缺失");
  assert.ok(block.includes('BaseType == "Divine Orb"'));
  for (const action of ["PlayAlertSound", "CustomAlertSound", "MinimapIcon", "PlayEffect", "SetFontSize"]) {
    assert.ok(!block.includes(action), "不应写入 " + action);
  }
  assert.equal(generated.soundFiles.length, 0);
});

test("物品集合与价格区间同时使用时取交集", () => {
  const currency = data.ITEM_CATALOG.filter((item) => item.categoryPath[0] === "crafting" && item.categoryPath[1] === "currency").map((item) => item.id);
  const target = { itemIds: currency, range: { min: { amount: 1, currency: "exalted" }, max: { amount: 2, currency: "divine" } } };
  const priced = withPrice(snapshot, "gnawed-jawbone", 0.5);
  const generated = generateFilter(profile({ rules: [makeRule({ target, effects: { beam: "Blue" } })] }), priced);
  const blocks = ruleBlocks(generated.filterFile);
  assert.ok(blocks.some((block) => block.includes("/ Divine Orb")), "区间内的基础通货应命中");
  assert.ok(!blocks.some((block) => block.includes("Gnawed Jawbone")), "深渊骨骸不在物品集合里，不应命中");
  const unselected = generateFilter(profile({ rules: [makeRule({ target: { range: { min: { amount: 1, currency: "exalted" } } } })] }), priced);
  const all = ruleBlocks(unselected.filterFile);
  assert.ok(all.some((block) => block.includes("/ Gnawed Jawbone")), "只填价格时应对所有有价物品生效");
  assert.ok(all.length > blocks.length, "只填价格应命中更多物品");
});

test("规则按列表顺序首个命中，后面的规则不再覆盖", () => {
  const generated = generateFilter(
    profile({
      rules: [
        makeRule({ id: "first", name: "先匹配", target: { itemIds: ["divine-orb"] }, effects: { beam: "Red" } }),
        makeRule({ id: "second", name: "后匹配", target: { itemIds: ["divine-orb"] }, effects: { beam: "Blue" } }),
      ],
    }),
    snapshot,
  );
  const block = blockFor(generated.filterFile, "/ Divine Orb");
  assert.ok(block.includes("PlayEffect Red"));
  assert.ok(!block.includes("PlayEffect Blue"));
  assert.deepEqual(generated.appliedRules.map((entry) => entry.ruleId), ["first"]);
});

test("物品条件与价格条件可以单独关闭，但不会两个都关", () => {
  const priced = withPrice(snapshot, "gnawed-jawbone", 0.5);
  const target = { itemIds: ["gnawed-jawbone"], range: { min: { amount: 1, currency: "divine" } } };
  const both = generateFilter(profile({ rules: [makeRule({ target })] }), priced);
  assert.ok(!ruleBlocks(both.filterFile).some((block) => block.includes("Gnawed Jawbone")), "交集不满足时不应命中");
  const itemsOnly = generateFilter(profile({ rules: [makeRule({ target: { ...target, priceEnabled: false } })] }), priced);
  assert.ok(ruleBlocks(itemsOnly.filterFile).some((block) => block.includes("Gnawed Jawbone")), "关闭价格条件后应按物品命中");
  const priceOnly = generateFilter(profile({ rules: [makeRule({ target: { ...target, itemEnabled: false } })] }), priced);
  const blocks = ruleBlocks(priceOnly.filterFile);
  assert.ok(blocks.some((block) => block.includes("Divine Orb")), "关闭物品条件后应按价格命中 1D 以上物品");
  assert.ok(!blocks.some((block) => block.includes("Gnawed Jawbone")), "价格条件仍然生效（骨骸低于 1D）");
  const neither = generateFilter(profile({ rules: [makeRule({ target: { ...target, itemEnabled: false, priceEnabled: false } })] }), priced);
  assert.equal(ruleBlocks(neither.filterFile).length, 0, "两个条件都关闭时规则不命中任何物品");
});

test("隐藏是规则选项，隐藏块仍可带特效", () => {
  const generated = generateFilter(
    profile({ rules: [makeRule({ hidden: true, target: { itemIds: ["scroll-of-wisdom"] }, effects: { sound: { type: "builtin", id: 6, volume: 300 }, beam: "White" } })] }),
    snapshot,
  );
  const block = blockFor(generated.filterFile, "Hide # poe2-filter rule: 测试规则 / Scroll of Wisdom");
  assert.ok(block, "隐藏块缺失");
  assert.ok(block.includes("PlayAlertSound 6 300"));
  assert.ok(block.includes("PlayEffect White"));
});

test("跳过名单里的物品不参与任何规则", () => {
  const generated = generateFilter(
    profile({ skippedItemIds: ["divine-orb"], rules: [makeRule({ hidden: true, target: { range: { min: { amount: 1, currency: "exalted" } } } })] }),
    snapshot,
  );
  const blocks = ruleBlocks(generated.filterFile);
  assert.ok(!blocks.some((block) => block.includes("Divine Orb")), "跳过名单物品不应被规则命中");
  assert.ok(blocks.some((block) => block.includes("Chaos Orb")), "其他物品仍应被隐藏规则命中");
  assert.equal(generated.safetyReport.exclusionViolations.length, 0);
  assert.ok(generated.safetyReport.warnings.some((warning) => warning.includes("跳过名单")));
});

test("隐藏高价值物品会让安全检查失败", () => {
  const generated = generateFilter(
    profile({ rules: [makeRule({ hidden: true, target: { itemIds: ["divine-orb"] } })] }),
    snapshot,
  );
  assert.equal(generated.safetyReport.passed, false);
  assert.deepEqual(generated.safetyReport.hiddenHighValueItems, ["Divine Orb"]);
});

test("缺少锚点行情时跟随市价的价格档被禁用", () => {
  const generated = generateFilter(profile({}), { ...snapshot, rates: undefined, prices: {} });
  assert.equal(generated.appliedRules.length, 0);
  assert.ok(generated.safetyReport.warnings.some((warning) => warning.includes("锚点")));
});

test("快照赛季不一致时价格规则不生效", () => {
  const generated = generateFilter(profile({ league: "Season A" }), snapshot);
  assert.equal(generated.appliedRules.length, 0);
  assert.ok(generated.filterFile.includes("# League: Season A"));
  assert.ok(generated.fileName.includes("season-a"));
  const right = generateFilter(profile({ league: "Standard" }), snapshot);
  assert.equal(right.appliedRules.length, 4);
});

test("锚点区间按当日价格重排", () => {
  const tiers = pricing.currencyPriceTiers(snapshot);
  assert.deepEqual(tiers.map((tier) => tier.itemId), ["exalted-orb", "chaos-orb", "orb-of-annulment", "divine-orb"]);
  assert.deepEqual(tiers.map((tier) => tier.exaltedValue), [1, DIVINE / 100, DIVINE / 10, DIVINE]);
});
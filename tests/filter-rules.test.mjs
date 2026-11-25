import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanup, data, engine, pricing, makeRule, snapshot, blockFor, ruleBlocks, withPrice, validateProfile, DEFAULT_PROFILE } from "./helpers.mjs";

import { parseExchange } from "../worker/market-adapter.mjs";

test.after(cleanup);

const { generateFilter } = engine;
const profile = (patch) => ({ ...DEFAULT_PROFILE, ...patch });

test("默认 4 条价格规则复刻基础过滤器里四枚通货的特效", () => {
  const generated = generateFilter(profile({ skippedItemIds: [] }), snapshot);
  assert.equal(generated.appliedRules.length, 4);
  const baseline = readFileSync("vendor/neversink/NeverSink's filter 2 - 2-SEMI-STRICT.filter", "utf8");
  const expectations = [
    ["default-exalted", "Exalted Orb", ["\tPlayEffect White", "\tMinimapIcon 1 Yellow Circle", "\tSetFontSize 42", "\tPlayAlertSound 2 300"]],
    ["default-chaos", "Chaos Orb", ["\tPlayEffect Yellow", "\tPlayAlertSound 2 300"]],
    ["default-annulment", "Orb of Annulment", ["\tPlayEffect Red", "\tMinimapIcon 0 Red Circle", "\tSetFontSize 45", "\tPlayAlertSound 1 300"]],
    ["default-divine", "Divine Orb", ["\tPlayEffect Red", "\tMinimapIcon 0 Red Star", "\tPlayAlertSound 6 300"]],
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
  const block = blockFor(generated.filterFile, "# poe2-filter rule: rule-test / Divine Orb");
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

test("Most Popular uses the reciprocal quote and converts D, C and E before matching", () => {
  const examples = [
    ["lesser-jeweller-s-orb", "divine", 100, 10],
    ["greater-jeweller-s-orb", "chaos", 20, 0.5],
    ["greater-regal-orb", "exalted", 0.25, 4],
  ];
  const items = examples.map(([id]) => ({ id, name: data.ITEM_CATALOG.find((item) => item.id === id).marketKey }));
  const lines = examples.map(([id, maxVolumeCurrency, maxVolumeRate]) => ({ id, maxVolumeCurrency, maxVolumeRate, primaryValue: 1 }));
  delete lines[2].primaryValue;
  const { prices, rates } = parseExchange({ core: { primary: "divine", rates: { exalted: 1000, chaos: 100 } }, items, lines }, data.ITEM_CATALOG, snapshot.capturedAt);
  for (const [id, currency, rate, exalted] of examples) {
    assert.equal(prices[id].currency, currency);
    assert.equal(prices[id].amount, 1 / rate);
    assert.equal(pricing.toExalted(prices[id], rates), exalted);
  }
  const generated = generateFilter(profile({ skippedItemIds: [], rules: [makeRule({
    hidden: true,
    target: { itemIds: examples.map(([id]) => id), range: { max: { amount: 1, currency: "exalted" } } },
  })] }), { ...snapshot, rates, prices });
  const blocks = ruleBlocks(generated.filterFile);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /^Hide .*Greater Jeweller/);
});

test("generated filter bytes stay stable when only the market timestamp changes", () => {
  const nextMarket = { ...snapshot, capturedAt: new Date(Date.parse(snapshot.capturedAt) + 60_000).toISOString() };
  const config = profile({ skippedItemIds: [] });
  const options = { includeMarketTimestamp: false };
  const first = generateFilter(config, snapshot, options);
  const second = generateFilter(config, nextMarket, options);
  assert.equal(first.filterFile, second.filterFile);
  assert.deepEqual(first.soundFiles, second.soundFiles);
  assert.notEqual(generateFilter(config, snapshot).filterFile, generateFilter(config, nextMarket).filterFile);
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
  const block = blockFor(generated.filterFile, "Hide # poe2-filter rule: rule-test / Scroll of Wisdom");
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

test("缺少汇率时价格规则不生效，并提示行情不可用", () => {
  const generated = generateFilter(profile({}), { ...snapshot, rates: undefined, prices: {} });
  assert.equal(generated.appliedRules.length, 0);
  assert.ok(generated.safetyReport.warnings.some((warning) => warning.includes("缺少有效报价或汇率")));
});

test("快照赛季不一致时价格规则不生效", () => {
  const generated = generateFilter(profile({ league: "Season A" }), snapshot);
  assert.equal(generated.appliedRules.length, 0);
  assert.ok(generated.filterFile.includes("# League: Season A"));
  assert.ok(generated.fileName.includes("season-a"));
  const right = generateFilter(profile({ league: "Standard" }), snapshot);
  assert.equal(right.appliedRules.length, 4);
});

test("默认价格档是普通的相邻区间，每件有报价的通货与材料只落进一档", () => {
  assert.deepEqual(DEFAULT_PROFILE.rules.map((rule) => [rule.target.range.min, rule.target.range.max ?? null]), [
    [{ amount: 1, currency: "exalted" }, { amount: 1, currency: "chaos" }],
    [{ amount: 1, currency: "chaos" }, { amount: 1, currency: "annulment" }],
    [{ amount: 1, currency: "annulment" }, { amount: 1, currency: "divine" }],
    [{ amount: 1, currency: "divine" }, null],
  ]);
  const blocks = ruleBlocks(generateFilter(profile({ skippedItemIds: [] }), snapshot).filterFile);
  const tierOf = new Map();
  for (const block of blocks) {
    const [, ruleId, itemName] = /^Show # poe2-filter rule: (\S+) \/ (.+)$/.exec(block.split("\n")[0]);
    assert.ok(!tierOf.has(itemName), itemName + " 落进了两档");
    tierOf.set(itemName, ruleId);
  }
  assert.equal(tierOf.get("Exalted Orb"), "default-exalted");
  assert.equal(tierOf.get("Chaos Orb"), "default-chaos");
  assert.equal(tierOf.get("Orb of Annulment"), "default-annulment");
  assert.equal(tierOf.get("Divine Orb"), "default-divine");
  // 区间是普通数值：把「混沌石价格档」的上限放宽到 1D，1 枚剥离石（100E）就归到它，不再归剥离石档。
  const widened = DEFAULT_PROFILE.rules.map((rule) => (rule.id === "default-chaos" ? { ...rule, target: { ...rule.target, range: { min: rule.target.range.min, max: { amount: 1, currency: "divine" } } } } : rule));
  const edited = ruleBlocks(generateFilter(profile({ skippedItemIds: [], rules: widened }), snapshot).filterFile);
  assert.ok(edited.some((block) => block.startsWith("Show # poe2-filter rule: default-chaos / Orb of Annulment")));
  assert.ok(!edited.some((block) => block.includes("rule: default-annulment / Orb of Annulment")));
});

test("剥离石作为计价单位时按它的行情报价折算", () => {
  const point = { amount: 2, currency: "annulment" };
  assert.equal(pricing.toExalted(point, snapshot.rates, snapshot.prices), 200);
  assert.equal(pricing.toDivines(point, snapshot.rates, snapshot.prices), 0.2);
  assert.equal(pricing.toExalted(point, snapshot.rates, {}), undefined, "没有剥离石报价时无法换算");
  assert.equal(pricing.formatPrice(point, snapshot), "2 剥离石 ≈ 200 E");
  assert.equal(pricing.formatPrice({ amount: 1, currency: "annulment" }), "1 剥离石（等待行情）");
  assert.equal(pricing.formatPrice({ amount: 1.5, currency: "chaos" }), "1.5 C");
  const target = { range: { min: { amount: 1, currency: "annulment" }, max: { amount: 1, currency: "divine" } } };
  const blocks = ruleBlocks(generateFilter(profile({ rules: [makeRule({ target })] }), snapshot).filterFile);
  assert.ok(blocks.some((block) => block.includes("/ Orb of Annulment")));
  assert.ok(!blocks.some((block) => block.includes("/ Chaos Orb")), "1 枚混沌石（10E）低于 1 枚剥离石（100E）");
  assert.ok(!blocks.some((block) => block.includes("/ Divine Orb")), "上限不含 1D");
});

test("旧方案里的锚点价格点读成普通计价单位", () => {
  const legacy = {
    ...DEFAULT_PROFILE,
    rules: [{
      id: "default-chaos",
      name: "混沌石价格档",
      enabled: true,
      hidden: false,
      autoRange: true,
      followBaseline: true,
      target: {
        itemIds: [],
        range: {
          min: { amount: 1, currency: "exalted", referenceItemId: "chaos-orb" },
          max: { amount: 1, currency: "exalted", referenceItemId: "orb-of-annulment" },
        },
      },
      effects: {},
    }],
  };
  const [rule] = validateProfile(legacy).rules;
  assert.deepEqual(rule.target.range, { min: { amount: 1, currency: "chaos" }, max: { amount: 1, currency: "annulment" } });
  assert.equal(rule.autoRange, undefined);
  assert.equal(rule.baselineEffectItemId, "chaos-orb", "默认价格档沿用基础过滤器里对应通货的样式");
  assert.equal(rule.followBaseline, undefined);
  // 单位必须是四种之一；没见过的单位直接报错。
  const bad = { ...DEFAULT_PROFILE, rules: [{ ...makeRule(), target: { range: { min: { amount: 1, currency: "annulment-orb" } } } }] };
  assert.throws(() => validateProfile(bad), /价格下限无效/);
});

test("未切割宝石按等级各自匹配、覆盖和跳过", () => {
  const levels = (ids) => ({ itemIds: ids, itemEnabled: true });
  const high = makeRule({ id: "high", name: "二十级", target: levels(["uncut-skill-gem-20"]), effects: { beam: "Red" } });
  const low = makeRule({ id: "low", name: "十九级", target: levels(["uncut-skill-gem-19"]), effects: { beam: "Blue" } });
  const separate = ruleBlocks(generateFilter(profile({ rules: [high, low] }), snapshot).filterFile);
  assert.equal(separate.length, 2);
  assert.match(separate[0], /^Show # poe2-filter rule: high \/ Uncut Skill Gem \(Level 20\)\n\tBaseType == "Uncut Skill Gem"\n\tGemLevel = 20\n\tPlayEffect Red$/);
  assert.match(separate[1], /BaseType == "Uncut Skill Gem"\n\tGemLevel = 19\n\tPlayEffect Blue$/);
  // 同一个等级被前面的规则覆盖；别的等级不受影响。
  const again = makeRule({ id: "again", name: "二十级", target: levels(["uncut-skill-gem-20"]), effects: { beam: "Green" } });
  const other = makeRule({ id: "other", name: "十九级", target: levels(["uncut-skill-gem-19"]), effects: { beam: "Green" } });
  const covered = generateFilter(profile({ rules: [high, again, other] }), snapshot);
  assert.deepEqual(covered.safetyReport.coveredRules, [{ ruleId: "again", ruleName: "二十级" }]);
  assert.deepEqual(covered.appliedRules.map((entry) => entry.ruleId), ["high", "other"]);
  assert.equal(ruleBlocks(covered.filterFile).length, 2);
  // 跳过名单只排除选中的那个等级。
  const all = ["uncut-skill-gem-20", "uncut-skill-gem-19", "uncut-skill-gem-1"];
  const skipped = ruleBlocks(generateFilter(profile({ skippedItemIds: ["uncut-skill-gem-20"], rules: [makeRule({ target: levels(all) })] }), snapshot).filterFile);
  assert.deepEqual(skipped.map((block) => block.match(/GemLevel = (\d+)/)[1]), ["19", "1"]);
  // 各等级有各自的报价：只有满级的那件够贵。
  const market = withPrice(withPrice(snapshot, "uncut-skill-gem-20", 4), "uncut-skill-gem-19", 0.001);
  const priced = ruleBlocks(generateFilter(profile({ rules: [makeRule({ target: { ...levels(all), range: { min: { amount: 1, currency: "divine" } } } })] }), market).filterFile);
  assert.deepEqual(priced.map((block) => block.match(/GemLevel = (\d+)/)[1]), ["20"]);
  // 只填价格时同样逐级生成。
  const byPrice = ruleBlocks(generateFilter(profile({ rules: [makeRule({ target: { range: { min: { amount: 1, currency: "divine" } } } })] }), market).filterFile);
  assert.equal(byPrice.filter((block) => /Uncut Skill Gem \(Level 20\)/.test(block) && block.includes("GemLevel = 20")).length, 1);
  assert.ok(!byPrice.some((block) => /Uncut Skill Gem \(Level 1\)/.test(block)));
});

test("poe.ninja 的逐级未切割宝石报价按名字对上对应等级", () => {
  const names = ["Uncut Skill Gem (Level 19)", "Uncut Spirit Gem (Level 18)", "Uncut Support Gem (Level 3)"];
  const items = names.map((name) => ({ id: "ninja-" + name, name }));
  const lines = names.map((name, index) => ({ id: "ninja-" + name, maxVolumeCurrency: "exalted", maxVolumeRate: 1 / (index + 2), primaryValue: 1 }));
  const { prices } = parseExchange({ core: { primary: "divine", rates: { exalted: 1000, chaos: 100 } }, items, lines }, data.ITEM_CATALOG, snapshot.capturedAt);
  assert.deepEqual(Object.keys(prices).filter((id) => id.startsWith("uncut-")).sort(), ["uncut-skill-gem-19", "uncut-spirit-gem-18", "uncut-support-gem-3"]);
  assert.equal(prices["uncut-skill-gem-19"].amount, 2);
  assert.equal(prices["uncut-support-gem-3"].amount, 4);
});
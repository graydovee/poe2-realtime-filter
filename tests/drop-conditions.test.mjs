import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROFILE, cleanup, data, generateOnBase, makeRule, ruleBlocks, searchCatalog, snapshot, validateProfile, withPrice } from "./helpers.mjs";

test.after(cleanup);

const stack = (op, value) => ({ stackSize: { enabled: true, bounds: [{ op, value }] } });
const rule = (id, items, dropConditions, options = {}) => makeRule({ id, name: id, target: { itemIds: items, dropConditions }, ...options });
const profile = (...rules) => validateProfile({ ...DEFAULT_PROFILE, rules });
const generate = (input, market = snapshot) => generateOnBase(input, null, market);

function hitStack(blocks, name, count) {
  const compare = { "<": (a, b) => a < b, "<=": (a, b) => a <= b, "=": (a, b) => a === b, ">=": (a, b) => a >= b, ">": (a, b) => a > b };
  return blocks.find((block) => block.includes(`BaseType == "${name}"`) && [...block.matchAll(/StackSize (<=|>=|<|>|=) (\d+)/g)].every((match) => compare[match[1]](count, +match[2])));
}

test("堆叠数量按实际掉落首条命中并支持通货共用阈值", () => {
  const small = rule("small", ["gold"], stack("<", 500), { hidden: true });
  const large = rule("large", ["gold"], stack(">=", 500), { effects: { beam: "Yellow", sound: { type: "builtin", id: 2, volume: 250 } } });
  const exalted = rule("exalted", ["exalted-orb"], stack(">", 2));
  const shard = data.ITEM_CATALOG.find((item) => item.name === "Regal Shard");
  const shared = rule("shared", ["chaos-orb", shard.id], stack("<=", 9));
  const bundle = generate(profile(small, large, exalted, shared));
  const blocks = ruleBlocks(bundle.filterFile);
  assert.match(hitStack(blocks, "Gold", 499), /^Hide/);
  for (const count of [500, 501]) assert.match(hitStack(blocks, "Gold", count), /PlayAlertSound 2 250/);
  assert.equal(hitStack(blocks, "Exalted Orb", 2), undefined);
  assert.match(hitStack(blocks, "Exalted Orb", 3), /StackSize > 2/);
  for (const name of ["Chaos Orb", "Regal Shard"]) assert.match(hitStack(blocks, name, 9), /StackSize <= 9/);
  assert.ok(bundle.filterFile.endsWith("\nShow\n"));
});

test("较窄的堆叠条件与兜底规则共存，反向排序后报告覆盖", () => {
  const narrow = rule("large", ["exalted-orb"], stack(">=", 5), { effects: { beam: "Yellow" } });
  const fallback = rule("all", ["exalted-orb"], undefined);
  const blocks = ruleBlocks(generate(profile(narrow, fallback)).filterFile);
  assert.equal(blocks.length, 2);
  assert.match(hitStack(blocks, "Exalted Orb", 5), /PlayEffect Yellow/);
  assert.match(hitStack(blocks, "Exalted Orb", 4), /rule: all /);
  const covered = generate(profile(fallback, narrow));
  assert.deepEqual(covered.safetyReport.coveredRules, [{ ruleId: "large", ruleName: "large" }]);
  assert.equal(ruleBlocks(covered.filterFile).length, 1);
});

test("堆叠、选物和单件价格取交集", () => {
  const shard = data.ITEM_CATALOG.find((item) => item.name === "Regal Shard");
  const chosen = rule("range", ["chaos-orb", shard.id], stack(">=", 3));
  chosen.target.range = { min: { amount: 4, currency: "exalted" }, max: { amount: 20, currency: "exalted" } };
  const market = withPrice(snapshot, shard.id, 0.001);
  const blocks = ruleBlocks(generate(profile(chosen), market).filterFile);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /BaseType == "Chaos Orb"\n\tStackSize >= 3/);
});

test("掉落条件校验范围、离散区间、稀有度及物品适用性", () => {
  assert.throws(() => profile(rule("empty", [], stack(">=", 1))), /选择物品或价格区间|选择物品或分类/);
  assert.throws(() => profile(rule("mix", ["chaos-orb", "base:omen-crest-shield"], stack(">=", 1))), /堆叠数量不适用于 Omen Crest Shield/);
  assert.throws(() => profile(rule("contradiction", ["chaos-orb"], { stackSize: { enabled: true, bounds: [{ op: ">", value: 2 }, { op: "<", value: 3 }] } })), /有效数值/);
  assert.throws(() => profile(rule("operator", ["chaos-orb"], stack("\nHide", 1))), /有效的整数和比较方式/);
  assert.throws(() => profile(rule("rarity", ["base:omen-crest-shield"], { rarity: { enabled: true, value: "Unique" } })), /与所选稀有度不匹配/);
  const saved = profile(rule("off", ["gold"], { stackSize: { enabled: false, bounds: [{ op: ">=", value: 80 }] } }));
  assert.equal(saved.schemaVersion, 3);
  assert.deepEqual(validateProfile(saved), saved);
  assert.doesNotMatch(generate(saved).filterFile, /StackSize/);
  assert.equal(profile(rule("simple", ["gold"], undefined)).schemaVersion, 2);
});

test("基底、同基底传奇和宝石从目录生成对应游戏条件", () => {
  const base = data.FILTER_ITEMS_BY_ID.get("base:omen-crest-shield");
  const unique = data.FILTER_ITEMS_BY_ID.get("unique:omen-crest-shield");
  assert.equal(base.dropLevel, 36);
  assert.ok(searchCatalog(data.PICKER_ITEMS, "噩兆纹章盾").some((item) => item.id === base.id));
  assert.match(unique.name, /Machination.*Rise of the Phoenix/);
  assert.ok(searchCatalog(data.PICKER_ITEMS, "烈炎之翼").some((item) => item.id === unique.id));
  assert.match(data.FILTER_ITEMS_BY_ID.get("gold").iconUrl, /Gold_inventory_icon/);
  // 未切割宝石每个等级是一件独立物品，生成时用 GemLevel 区分，不需要额外的掉落条件。
  const gem = rule("gem", ["uncut-skill-gem-19", "uncut-spirit-gem-19", "uncut-support-gem-5"]);
  const gear = rule("gear", [base.id], { itemLevel: { enabled: true, bounds: [{ op: ">=", value: 80 }] }, sockets: { enabled: true, bounds: [{ op: ">=", value: 2 }] }, unidentifiedTier: { enabled: true, bounds: [{ op: ">=", value: 4 }] } });
  const blocks = ruleBlocks(generate(profile(gem, gear, rule("unique", [unique.id]), rule("ordinary", [base.id]))).filterFile);
  assert.equal(blocks.filter((block) => block.includes("GemLevel = 19")).length, 2);
  assert.match(blocks.find((block) => block.includes("rule: gem / Uncut Skill Gem (Level 19)")), /^Show # poe2-filter rule: gem \/ Uncut Skill Gem \(Level 19\)\n\tBaseType == "Uncut Skill Gem"\n\tGemLevel = 19$/);
  assert.match(blocks.find((block) => block.includes("rule: gem / Uncut Support Gem (Level 5)")), /\n\tGemLevel = 5$/);
  assert.match(blocks.find((block) => block.includes("rule: gem / Uncut Spirit Gem (Level 19)")), /\n\tGemLevel = 19$/);
  assert.match(blocks.find((block) => block.includes("rule: gear")), /ItemLevel >= 80\n\tSockets >= 2\n\tUnidentifiedItemTier >= 4\n\tRarity Rare\n\tIdentified False/);
  assert.match(blocks.find((block) => block.includes("rule: unique")), /BaseType == "Omen Crest Shield"\n\tRarity Unique/);
  assert.match(blocks.find((block) => block.includes("rule: ordinary")), /Rarity < Unique/);
});

test("无法识别的掉落条件被拒绝", () => {
  assert.throws(
    () => profile(rule("unknown", ["uncut-skill-gem-1"], { unknownField: { enabled: true, bounds: [{ op: "=", value: 1 }] } })),
    /无法识别的掉落条件/,
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cleanup, data, DEFAULT_PROFILE, engine, generateOnBase, itemLabel, makeRule, ruleBlocks, snapshot, validateProfile } from "./helpers.mjs";

test.after(cleanup);

// 换界石 16 阶各是一件物品，目录里从高阶到低阶排。
const tierIds = Array.from({ length: 16 }, (_, index) => "waystone-tier-" + (16 - index));
const item = (id) => data.FILTER_ITEMS_BY_ID.get(id);
const build = (rules, skippedItemIds = []) => validateProfile({ ...DEFAULT_PROFILE, rules, skippedItemIds });
const itemRule = (id, itemIds, overrides = {}) => makeRule({ id, name: id, target: { itemIds }, ...overrides });

test("换界石 16 阶各是一件物品，从高阶到低阶排在「终局 › 换界石」里", () => {
  const shown = data.PICKER_ITEMS.filter((entry) => entry.categoryPath.join("/") === "endgame/waystones");
  assert.deepEqual(shown.map((entry) => entry.id), tierIds);
  assert.deepEqual(shown.map((entry) => entry.matcher), tierIds.map((_, index) => ({ waystoneTier: 16 - index })));
  assert.deepEqual(tierIds.map((id) => item(id).localeNames.cn), Array.from({ length: 16 }, (_, index) => "引路石（ " + (16 - index) + " 阶）"));
  assert.equal(itemLabel(item("waystone-tier-16"), "cn"), "引路石（ 16 阶）");
  // 整类条目自己不再出现在选择器里；它留作登记表里的条目，成员是这 16 阶。
  assert.equal(data.PICKER_ITEMS.some((entry) => entry.id === "class-waystones"), false);
  assert.deepEqual(data.CLASS_MATCH_BY_ID.get("class-waystones").members.map((entry) => entry.id), tierIds);
  assert.ok(tierIds.every((id) => item(id).priceable === false), "换界石没有行情");
});

test("选了哪一阶，就写出这一阶的 WaystoneTier 条件", () => {
  const output = generateOnBase(build([itemRule("t16", ["waystone-tier-16"]), itemRule("t3", ["waystone-tier-3"])]), null, snapshot);
  assert.deepEqual(ruleBlocks(output.filterFile), [
    'Show # poe2-filter rule: t16 / Waystone (Tier 16)\n\tClass == "Waystones"\n\tWaystoneTier = 16',
    'Show # poe2-filter rule: t3 / Waystone (Tier 3)\n\tClass == "Waystones"\n\tWaystoneTier = 3',
  ]);
});

test("16 阶全选时合并成一条整类块，少一阶就逐件输出", () => {
  const whole = generateOnBase(build([itemRule("all", tierIds)]), null, snapshot);
  assert.deepEqual(ruleBlocks(whole.filterFile), ['Show # poe2-filter rule: all / Waystones\n\tClass == "Waystones"']);
  assert.equal(whole.appliedRules[0].itemCount, 16);
  const partial = generateOnBase(build([itemRule("most", tierIds.slice(1))]), null, snapshot).filterFile;
  assert.equal(ruleBlocks(partial).length, 15);
  assert.ok(ruleBlocks(partial).every((block) => block.includes("\tWaystoneTier = ")));
  assert.ok(!partial.includes("WaystoneTier = 16"));
});

test("整类块盖得住后面某一阶的规则，不同阶之间互不覆盖", () => {
  const covered = generateOnBase(build([itemRule("all", tierIds), itemRule("one", ["waystone-tier-5"])]), null, snapshot);
  assert.equal(ruleBlocks(covered.filterFile).length, 1);
  assert.deepEqual(covered.safetyReport.coveredRules.map((entry) => entry.ruleId), ["one"]);
  // 先命中一阶的规则不会被后面的整类块盖住。
  const reversed = generateOnBase(build([itemRule("one", ["waystone-tier-5"]), itemRule("all", tierIds)]), null, snapshot);
  assert.equal(ruleBlocks(reversed.filterFile).length, 2);
  assert.deepEqual(reversed.safetyReport.coveredRules, []);
  const separate = generateOnBase(build([itemRule("t5", ["waystone-tier-5"]), itemRule("t6", ["waystone-tier-6"])]), null, snapshot);
  assert.equal(ruleBlocks(separate.filterFile).length, 2);
  assert.deepEqual(separate.safetyReport.coveredRules, []);
});

test("跳过物品里的换界石：跳过了一阶，剩下的逐件输出", () => {
  // 跳过物品只在有基础过滤器时生效，所以这里带着基础过滤器生成。
  const one = engine.generateFilter(build([itemRule("all", tierIds)], ["waystone-tier-5"]), snapshot).filterFile;
  assert.equal(ruleBlocks(one).length, 15);
  assert.ok(!one.includes("WaystoneTier = 5\n"));
  assert.ok(ruleBlocks(one).every((block) => block.includes("\tWaystoneTier = ")));
  // 规则直接带着整类条目时：它那一类里有物品被跳过，整类块不生成。
  const profile = build([itemRule("whole", tierIds)], ["waystone-tier-5"]);
  profile.rules[0].target.itemIds = ["class-waystones"];
  assert.equal(ruleBlocks(engine.generateFilter(profile, snapshot).filterFile).length, 0);
  profile.skippedItemIds = [];
  const whole = engine.generateFilter(profile, snapshot);
  assert.deepEqual(ruleBlocks(whole.filterFile), ['Show # poe2-filter rule: whole / Waystones\n\tClass == "Waystones"']);
  assert.equal(whole.appliedRules[0].itemCount, 16);
});

test("旧方案里选的换界石整类条目，读取时展开成 16 阶", () => {
  const profile = build([
    itemRule("maps", ["class-waystones", "exalted-orb"]),
    itemRule("logs", ["class-expedition-logbook", "class-quest-items"]),
  ], ["class-waystones", "divine-orb"]);
  assert.deepEqual(profile.rules[0].target.itemIds, [...tierIds, "exalted-orb"]);
  // 只能整类选择的远征日志、任务物品在选择器里就是一件物品，保持原样。
  assert.deepEqual(profile.rules[1].target.itemIds, ["class-expedition-logbook", "class-quest-items"]);
  assert.deepEqual(profile.skippedItemIds, [...tierIds, "divine-orb"]);
  // 再读一次结果不变。
  assert.deepEqual(validateProfile(profile), profile);
});

test("分享码目录里 16 阶各有地址，整类条目的旧地址仍然有效", () => {
  const catalog = JSON.parse(readFileSync("data/item-catalog.json", "utf8"));
  const share = data.shareCatalog();
  for (const id of tierIds) {
    const [group, slot] = share.current[id];
    assert.equal(share.groups[group].slots[slot], id, id);
    assert.deepEqual(catalog.shareGroups[group].path, ["endgame", "waystones"], id);
  }
  const [group] = share.current["waystone-tier-16"];
  // 整类条目不再出现在选择器里，当前地址在未展示条目的分组；它在这个分类里留着的旧地址照旧解析。
  const [oldGroup, oldSlot] = Object.entries(catalog.shareGroups).flatMap(([id, entry]) => Object.entries(entry.slots).filter(([itemId]) => itemId === "class-waystones").map(([itemId, slot]) => [Number(id), slot]))[0];
  assert.equal(oldGroup, group);
  assert.equal(share.groups[oldGroup].slots[oldSlot], "class-waystones");
  assert.notEqual(share.current["class-waystones"][0], group);
  // 旧分享码整选「换界石」时展开成这 16 阶和整类条目，生成出来还是一条整类块。
  const ids = share.groups[group].activeSlots.map((slot) => share.groups[group].slots[slot]);
  assert.deepEqual([...ids].sort(), [...tierIds, "class-waystones"].sort());
  const whole = generateOnBase(build([itemRule("old", ids)]), null, snapshot);
  assert.deepEqual(ruleBlocks(whole.filterFile), ['Show # poe2-filter rule: old / Waystones\n\tClass == "Waystones"']);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { DEFAULT_PROFILE, cleanup, data, engine, generateOnBase, itemLabel, makeRule, ruleBlocks, snapshot, validateProfile, withPrice } from "./helpers.mjs";

test.after(cleanup);

const match = (id) => data.CLASS_MATCHES.find((entry) => entry.item.id === id);
const memberIds = (id) => match(id).members.map((item) => item.id);
const omenIds = () => memberIds("class-omen");
const pathOf = (item) => item.categoryPath.join("/");
// 规则名用 id，方便在生成的块里认出来。
const build = (rules, skippedItemIds = []) => validateProfile({ ...DEFAULT_PROFILE, rules, skippedItemIds });
const itemRule = (id, itemIds, overrides = {}) => makeRule({ id, name: id, target: { itemIds }, ...overrides });
const classLines = (filter) => ruleBlocks(filter).filter((block) => block.includes("\tClass == "));

test("整类条目不是可选物品", () => {
  const selectable = data.PICKER_ITEMS.filter((item) => item.matcher.class);
  // 只有换界石、远征日志、任务物品没有逐件物品，全选这几个分类时直接保存整类条目。
  assert.deepEqual(selectable.map((item) => item.id).sort(), ["class-expedition-logbook", "class-quest-items", "class-waystones"]);
  for (const item of selectable) {
    assert.equal(data.ITEM_CATALOG.filter((entry) => pathOf(entry) === pathOf(item) && !entry.matcher.class).length, 0, item.id + " 所在的分类不该有逐件物品");
  }
  // 搜索也找不到其他整类条目。
  const hidden = ["Amulets", "Stackable Currency", "Map Fragments", "Omen"];
  for (const query of hidden) assert.ok(!data.PICKER_ITEMS.some((item) => item.name === query), query);
  // 这三个条目在界面上就是普通物品的名字（按分类叫），不显示英文类名，也不带「整类」字样。
  assert.equal(itemLabel(data.FILTER_ITEMS_BY_ID.get("class-waystones"), "cn"), "换界石");
  assert.equal(itemLabel(data.FILTER_ITEMS_BY_ID.get("class-expedition-logbook"), "cn"), "远征日志");
  assert.equal(itemLabel(data.FILTER_ITEMS_BY_ID.get("class-quest-items"), "cn"), "任务物品");
  for (const item of data.PICKER_ITEMS) assert.ok(!itemLabel(item, "cn").includes("整类"), item.id);
  // 默认价格档的物品范围里没有整类条目：它们没有行情。
  for (const rule of DEFAULT_PROFILE.rules) assert.ok(!rule.target.itemIds.some((id) => data.FILTER_ITEMS_BY_ID.get(id)?.matcher.class), rule.id);
});

test("登记表里的每条整类匹配对应选择器里的一个分类", () => {
  assert.equal(data.CLASS_MATCHES.length, 57);
  for (const entry of data.CLASS_MATCHES) {
    const key = entry.path.join("/");
    const inCategory = data.PICKER_ITEMS.filter((item) => pathOf(item) === key && !item.matcher.class);
    assert.deepEqual(entry.members.map((item) => item.id), inCategory.map((item) => item.id), key);
    for (const item of entry.members) assert.equal(data.CLASS_OF_ITEM.get(item.id), entry, item.id + " 应该登记在自己的分类下");
  }
  const nonEquipment = data.CLASS_MATCHES.filter((entry) => !/^(base|unique):class-/.test(entry.item.id));
  assert.deepEqual(nonEquipment.map((entry) => entry.item.id), [
    "class-augment", "class-charms", "class-expedition-logbook", "class-incubators", "class-life-flasks", "class-mana-flasks",
    "class-omen", "class-pinnacle-keys", "class-quest-items", "class-skill-gems", "class-support-gems", "class-vault-keys", "class-waystones",
  ]);
  assert.equal(memberIds("class-omen").length, 37);
  assert.equal(memberIds("class-skill-gems").length, 22);
  assert.equal(memberIds("class-support-gems").length, 85);
  assert.equal(match("class-waystones").members.length, 0);
  // 装备的每个类型各有普通基底、传奇两个变体，带各自的稀有度条件。
  const equipment = data.CLASS_MATCHES.filter((entry) => /^(base|unique):class-/.test(entry.item.id));
  assert.equal(equipment.length, 44);
  for (const entry of equipment) {
    const [group] = entry.item.id.split(":");
    assert.deepEqual(entry.path.slice(0, 2), ["equipment", group === "base" ? "normal-bases" : "unique-equipment"], entry.item.id);
    assert.deepEqual(entry.item.matcher, group === "base" ? { class: entry.item.matcher.class, nonUnique: true } : { class: entry.item.matcher.class, rarity: "Unique" });
  }
  // 这几个整类条目不代表任何选择器分类，保持不可用。
  for (const id of ["class-stackable-currency", "class-map-fragments", "class-tablet", "class-fishing-rods", "class-instance-local-items", "class-amulets", "class-jewels"]) {
    assert.equal(data.CLASS_MATCH_BY_ID.has(id), false, id + " 不该登记");
  }
});

test("整类块用的类名都是游戏里真实存在的类名", () => {
  // NeverSink 的过滤器是现成的参照：它用 Class 条件写过的类名才是游戏认的类名。
  const baseline = readFileSync("vendor/neversink/NeverSink's filter 2 - 2-SEMI-STRICT.filter", "utf8");
  const used = new Set([...baseline.matchAll(/^\s*Class\s*==?\s*([^\n]+)/gm)].flatMap(([, line]) => [...line.matchAll(/"([^"]+)"/g)].map(([, name]) => name)));
  for (const entry of data.CLASS_MATCHES) assert.ok(used.has(entry.item.matcher.class), entry.item.matcher.class + " 没有在基础过滤器里出现过");
});

test("全选一个分类时输出一条整类块，不再逐件输出", () => {
  const output = generateOnBase(build([itemRule("omens", omenIds())]), null, snapshot);
  // 注释和逐件块一样用条目自己的名字，不另加「整类」标记。
  assert.deepEqual(ruleBlocks(output.filterFile), ['Show # poe2-filter rule: omens / Omen\n\tClass == "Omen"']);
  assert.equal(output.appliedRules[0].itemCount, 37);
  assert.equal(output.safetyReport.ambiguousItems, 0);
  assert.ok(!output.safetyReport.warnings.some((line) => line.includes("歧义")), output.safetyReport.warnings.join(" / "));
});

test("带价格条件的规则不合并：整类条目没有行情", () => {
  const [priced, other] = omenIds();
  const market = withPrice(withPrice(snapshot, priced, 2), other, 2);
  const rule = itemRule("omens", omenIds(), { target: { itemIds: omenIds(), range: { min: { amount: 1, currency: "exalted" } } } });
  const blocks = ruleBlocks(generateOnBase(build([rule]), null, market).filterFile);
  assert.equal(blocks.length, 2, "只有两件预兆有报价且达到 1 E");
  assert.equal(classLines(generateOnBase(build([rule]), null, market).filterFile).length, 0);
  assert.ok(blocks.every((block) => /\n\tBaseType == "Omen/.test(block)));
});

test("少选一件、或者这一类里有物品被跳过时，照旧逐件输出", () => {
  const ids = omenIds();
  const partial = generateOnBase(build([itemRule("omens", ids.slice(1))]), null, snapshot).filterFile;
  assert.equal(classLines(partial).length, 0);
  assert.equal(ruleBlocks(partial).length, 36);
  // 跳过名单只在有基础过滤器时生效，所以这里带着基础过滤器生成。
  const skipped = engine.generateFilter(build([itemRule("omens", ids)], [ids[0]]), snapshot).filterFile;
  assert.equal(classLines(skipped).length, 0);
  assert.equal(ruleBlocks(skipped).length, 36);
});

test("装备按普通基底和传奇分别整类，各带稀有度条件", () => {
  const output = generateOnBase(build([
    itemRule("bases", memberIds("base:class-amulets")),
    itemRule("uniques", memberIds("unique:class-bows")),
  ]), null, snapshot);
  assert.deepEqual(ruleBlocks(output.filterFile), [
    'Show # poe2-filter rule: bases / Amulets\n\tClass == "Amulets"\n\tRarity < Unique',
    'Show # poe2-filter rule: uniques / Bows\n\tClass == "Bows"\n\tRarity Unique',
  ]);
  // 掉落条件照常跟在整类条件后面。
  const leveled = itemRule("bases", memberIds("base:class-amulets"), { target: { itemIds: memberIds("base:class-amulets"), dropConditions: { itemLevel: { enabled: true, bounds: [{ op: ">=", value: 80 }] } } } });
  assert.deepEqual(ruleBlocks(generateOnBase(build([leveled]), null, snapshot).filterFile), [
    'Show # poe2-filter rule: bases / Amulets\n\tClass == "Amulets"\n\tRarity < Unique\n\tItemLevel >= 80',
  ]);
});

test("整类块能覆盖后面的规则，逐件块覆盖不了后面的整类块", () => {
  const covered = generateOnBase(build([itemRule("all", omenIds()), itemRule("one", [omenIds()[0]])]), null, snapshot);
  assert.equal(ruleBlocks(covered.filterFile).length, 1);
  assert.deepEqual(covered.safetyReport.coveredRules.map((entry) => entry.ruleId), ["one"]);
  // 全选之后又有一条少选一件的规则：它的物品都被整类块盖住了。
  const subset = generateOnBase(build([itemRule("all", omenIds()), itemRule("rest", omenIds().slice(1))]), null, snapshot);
  assert.equal(ruleBlocks(subset.filterFile).length, 1);
  assert.deepEqual(subset.safetyReport.coveredRules.map((entry) => entry.ruleId), ["rest"]);
  // 反过来，先命中单件的规则不会被后面的整类块盖住。
  const reversed = generateOnBase(build([itemRule("one", [omenIds()[0]]), itemRule("all", omenIds())]), null, snapshot);
  assert.equal(ruleBlocks(reversed.filterFile).length, 2);
  assert.deepEqual(reversed.safetyReport.coveredRules, []);
});

test("只能整类选择的分类可以直接选", () => {
  const output = generateOnBase(build([itemRule("maps", ["class-waystones"]), { ...itemRule("logs", ["class-expedition-logbook"]), hidden: true }]), null, snapshot);
  assert.deepEqual(ruleBlocks(output.filterFile), [
    'Show # poe2-filter rule: maps / Waystones\n\tClass == "Waystones"',
    'Hide # poe2-filter rule: logs / Expedition Logbook\n\tClass == "Expedition Logbook"',
  ]);
  assert.equal(output.appliedRules[0].itemCount, 1);
  // 在跳过名单里的整类条目不生成规则。
  const skipped = engine.generateFilter(build([itemRule("maps", ["class-waystones"])], ["class-waystones"]), snapshot);
  assert.equal(ruleBlocks(skipped.filterFile).length, 0);
});

test("没登记的整类条目不生成任何规则", () => {
  const ids = ["class-stackable-currency", "class-map-fragments", "class-tablet", "class-fishing-rods", "class-instance-local-items", "class-amulets"];
  const output = generateOnBase(build([itemRule("markers", ids)]), null, snapshot);
  assert.equal(ruleBlocks(output.filterFile).length, 0);
  assert.ok(output.safetyReport.warnings.some((line) => line.includes("markers") && line.includes("没有命中")), output.safetyReport.warnings.join(" / "));
});

test("只按价格匹配的默认价格档不会输出整类块", () => {
  const output = generateOnBase(build(DEFAULT_PROFILE.rules), null, snapshot);
  assert.equal(classLines(output.filterFile).length, 0);
});

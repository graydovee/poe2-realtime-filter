import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { DEFAULT_PROFILE, cleanup, data, engine, generateOnBase, itemLabel, makeRule, ruleBlocks, snapshot, validateProfile, withPrice } from "./helpers.mjs";

test.after(cleanup);

const match = (id) => data.CLASS_MATCHES.find((entry) => entry.item.id === id);
const memberIds = (id) => match(id).members.map((item) => item.id);
const omenIds = () => memberIds("class-omen");
const pathOf = (item) => item.categoryPath.join("/");
const leafOf = (id) => data.FILTER_ITEMS_BY_ID.get(id).categoryPath.join("/");
// 规则名用 id，方便在生成的块里认出来。
const build = (rules, skippedItemIds = []) => validateProfile({ ...DEFAULT_PROFILE, rules, skippedItemIds });
const itemRule = (id, itemIds, overrides = {}) => makeRule({ id, name: id, target: { itemIds }, ...overrides });
const classLines = (filter) => ruleBlocks(filter).filter((block) => block.includes("\tClass == "));

test("整类条目不是可选物品", () => {
  const selectable = data.PICKER_ITEMS.filter((item) => item.matcher.class);
  // 只有远征日志、任务物品没有逐件物品，全选这两个分类时直接保存整类条目。
  assert.deepEqual(selectable.map((item) => item.id).sort(), ["class-expedition-logbook", "class-quest-items"]);
  // 任务物品自己占一个分类；远征日志和两件三曲碎片同在「探险 › 碎片」里。
  const shown = (id) => data.PICKER_ITEMS.find((item) => item.id === id);
  assert.equal(pathOf(shown("class-quest-items")), "other/quest-items");
  assert.equal(pathOf(shown("class-expedition-logbook")), "gameplay/expedition/fragments");
  assert.deepEqual(data.PICKER_ITEMS.filter((item) => item.id !== "class-expedition-logbook" && pathOf(item) === "gameplay/expedition/fragments").map((item) => item.name), ["Shattered Triskelion", "The Triskelion Reforged"]);
  // 搜索也找不到其他整类条目。
  const hidden = ["Amulets", "Stackable Currency", "Map Fragments", "Omen", "Waystones"];
  for (const query of hidden) assert.ok(!data.PICKER_ITEMS.some((item) => item.name === query), query);
  // 这两个条目在界面上就是普通物品的名字（按分类叫），不显示英文类名，也不带「整类」字样。
  assert.equal(itemLabel(data.FILTER_ITEMS_BY_ID.get("class-expedition-logbook"), "cn"), "远征日志");
  assert.equal(itemLabel(data.FILTER_ITEMS_BY_ID.get("class-quest-items"), "cn"), "任务物品");
  for (const item of data.PICKER_ITEMS) assert.ok(!itemLabel(item, "cn").includes("整类"), item.id);
  // 默认价格档的物品范围里没有整类条目：它们没有行情。
  for (const rule of DEFAULT_PROFILE.rules) assert.ok(!rule.target.itemIds.some((id) => data.FILTER_ITEMS_BY_ID.get(id)?.matcher.class), rule.id);
});

test("登记表里的每条整类匹配，成员是它那个类别的逐件物品", () => {
  const classOnly = ["class-expedition-logbook", "class-quest-items"];
  assert.equal(data.CLASS_MATCHES.length, 56);
  for (const entry of data.CLASS_MATCHES) {
    assert.ok(entry.members.length > 0 || classOnly.includes(entry.item.id), entry.item.id);
    for (const item of entry.members) assert.equal(data.CLASS_OF_ITEM.get(item.id), entry, item.id + " 应该登记在自己的类别下");
  }
  const nonEquipment = data.CLASS_MATCHES.filter((entry) => !/^(base|unique):class-/.test(entry.item.id));
  assert.deepEqual(nonEquipment.map((entry) => entry.item.id), [
    "class-charms", "class-expedition-logbook", "class-incubators", "class-life-flasks", "class-mana-flasks",
    "class-omen", "class-pinnacle-keys", "class-quest-items", "class-skill-gems", "class-support-gems", "class-vault-keys", "class-waystones",
  ]);
  // 预兆的类别里也有探险的五个传说（Vorana's Saga 这些），它们在客户端里的类别同样是 Omen。
  assert.equal(memberIds("class-omen").length, 42);
  assert.equal(memberIds("class-skill-gems").length, 23);
  assert.equal(memberIds("class-support-gems").length, 84);
  // 换界石每一阶是一件物品，16 阶合起来是 Waystones 这一个类别。
  assert.deepEqual(memberIds("class-waystones").map(leafOf), Array(16).fill("endgame/waystones"));
  // 一个类别的物品可以分布在几个分类里：预兆分在四个玩法下，头盔的普通基底按属性分成七个。
  const leaves = (ids) => [...new Set(ids.map(leafOf))].sort();
  assert.deepEqual(leaves(memberIds("class-omen")), ["gameplay/abyss/omens", "gameplay/expedition/omens", "gameplay/ritual/equipment-omens", "gameplay/ritual/map-omens", "other/unavailable"]);
  assert.deepEqual(leaves(memberIds("base:class-helmets")), ["equipment/helmets/str", "equipment/helmets/dex", "equipment/helmets/int", "equipment/helmets/str-dex", "equipment/helmets/str-int", "equipment/helmets/dex-int", "equipment/helmets/str-dex-int"].sort());
  assert.deepEqual(leaves(memberIds("base:class-shields")), ["equipment/off-hand/shields-str", "equipment/off-hand/shields-str-dex", "equipment/off-hand/shields-str-int"]);
  assert.deepEqual(leaves(memberIds("unique:class-helmets")), ["uniques/equipment/helmets"]);
  // 装备的每个类型各有普通基底、传奇两个变体，带各自的稀有度条件。
  const equipment = data.CLASS_MATCHES.filter((entry) => /^(base|unique):class-/.test(entry.item.id));
  assert.equal(equipment.length, 44);
  for (const entry of equipment) {
    const [group] = entry.item.id.split(":");
    assert.deepEqual(entry.item.matcher, group === "base" ? { class: entry.item.matcher.class, nonUnique: true } : { class: entry.item.matcher.class, rarity: "Unique" });
    assert.ok(entry.members.every((item) => (group === "base") === Boolean(item.matcher.nonUnique)), entry.item.id);
  }
  // 这几个整类条目不代表任何选择器分类，保持不可用。
  for (const id of ["class-stackable-currency", "class-map-fragments", "class-tablet", "class-fishing-rods", "class-instance-local-items", "class-amulets", "class-jewels", "class-augment"]) {
    assert.equal(data.CLASS_MATCH_BY_ID.has(id), false, id + " 不该登记");
  }
});

// 内置的 NeverSink 过滤器：拆成规则块，取出每个块里的 Class 条件和 BaseType 名单。
// Class == "A" "B" 和 Class "A" "B" 两种写法都算，注释行不算。
const reference = readFileSync("vendor/neversink/NeverSink's filter 2 - 2-SEMI-STRICT.filter", "utf8")
  .split(/(?=^(?:Show|Hide|Minimal)\b)/m)
  .filter((block) => /^(?:Show|Hide|Minimal)\b/.test(block))
  .map((block) => {
    const lines = block.split("\n").filter((line) => /^\s*[A-Za-z]/.test(line));
    const quoted = (line) => [...line.matchAll(/"([^"]+)"/g)].map(([, name]) => name);
    return { classes: lines.filter((line) => /^\s*Class\b/.test(line)).flatMap(quoted), baseTypes: lines.filter((line) => /^\s*BaseType\b/.test(line)).flatMap(quoted) };
  });
const referenceClasses = new Set(reference.flatMap((block) => block.classes));
/** NeverSink 在带某个类别的块里点过名的物品。 */
const pairedWith = (className) => reference.filter((block) => block.classes.includes(className)).flatMap((block) => block.baseTypes);

test("整类块用的类名都是游戏里真实存在的类名", () => {
  // NeverSink 的过滤器是现成的参照：它用 Class 条件写过的类名才是游戏认的类名。
  for (const entry of data.CLASS_MATCHES) assert.ok(referenceClasses.has(entry.item.matcher.class), entry.item.matcher.class + " 没有在基础过滤器里出现过");
  // 游戏在 2025 年 12 月把 Socketable 改名成了 Augment（GGG 的过滤器更新公告）。
  assert.equal(referenceClasses.has("Socketable"), false);
  assert.equal(referenceClasses.has("Augment"), true);
});

test("登记的类别确实对应它所代表分类里的物品", () => {
  // NeverSink 会把物品名单和 Class 条件写在同一个块里。如果它在某个类别下点过不少物品，
  // 而我们登记给这个类别的分类一件都不在其中，对应关系就是错的。
  // 只有名字能看出对应的装备类型不在这里核对（类别名就是物品类型名）。
  const byClass = (className) => data.CLASS_MATCHES.filter((entry) => !/^(base|unique):class-/.test(entry.item.id) && entry.item.matcher.class === className);
  const tablets = data.ITEM_CATALOG.filter((item) => item.categoryPath.join("/") === "endgame/tablets" && !item.matcher.class);
  assert.ok(tablets.length >= 8);
  assert.ok(pairedWith("Augment").length >= 20 && !tablets.some((item) => pairedWith("Augment").includes(item.name)), "NeverSink 在 Augment 下点名的是别的物品，不是石板");
  assert.equal(byClass("Augment").length, 0, "Augment 不该登记给任何分类");

  // 这几类在 NeverSink 里没法用物品名单核对，依据写在本测试后半部分：
  // 药剂只写了档位名；符文宝石只按名字匹配、Skill Gems 和 Support Gems 写在同一个条件里；
  // 巅峰钥匙和宝库钥匙用的是不带物品名单的整类块；换界石只写 Class 和 WaystoneTier。
  const unverifiableInReference = new Set(["class-life-flasks", "class-mana-flasks", "class-skill-gems", "class-pinnacle-keys", "class-vault-keys", "class-waystones"]);
  for (const entry of data.CLASS_MATCHES) {
    if (/^(base|unique):class-/.test(entry.item.id) || !entry.members.length || unverifiableInReference.has(entry.item.id)) continue;
    const paired = pairedWith(entry.item.matcher.class);
    const overlap = entry.members.filter((item) => paired.includes(item.name)).map((item) => item.name);
    assert.ok(overlap.length > 0, entry.item.matcher.class + "：NeverSink 在这个类别下点过 " + paired.length + " 件物品，没有一件属于「" + entry.item.id + "」");
  }
  // 换界石：NeverSink 的条件从 1 阶写到 16 阶，目录里的 16 阶正好是整个类别。
  const waystoneTiers = [...readFileSync("vendor/neversink/NeverSink's filter 2 - 2-SEMI-STRICT.filter", "utf8").matchAll(/WaystoneTier (>=|<=) (\d+)/g)].map(([, operator, value]) => operator + value);
  for (const bound of [">=16", ">=1", "<=14", "<=5"]) assert.ok(waystoneTiers.includes(bound), bound);
  // NeverSink 点名的物品和分类成员完全重合的几类。药瓶和咒符上的传奇也是这些类别的成员，NeverSink 的名单只对得上普通物品。
  for (const [className, id] of [["Omen", "class-omen"], ["Charms", "class-charms"], ["Incubators", "class-incubators"]]) {
    assert.deepEqual(memberIds(id).map((itemId) => data.FILTER_ITEMS_BY_ID.get(itemId)).filter((item) => item.category !== "unique").map((item) => item.name).filter((name) => !pairedWith(className).includes(name)), [], className);
  }
  // 药瓶和咒符上的传奇跟着基底进了同一个类别的成员里。
  for (const [id, count] of [["class-charms", 12], ["class-life-flasks", 2], ["class-mana-flasks", 3]]) {
    assert.equal(memberIds(id).filter((itemId) => data.FILTER_ITEMS_BY_ID.get(itemId).category === "unique").length, count, id);
  }
  // 下面几类在 NeverSink 里没法用物品名单核对，依据逐条写在这里。按名字查目录，不凭印象写 id。
  const catalogId = (name) => {
    const item = data.ITEM_CATALOG.find((entry) => entry.name === name);
    assert.ok(item, "目录里找不到 " + name);
    return item.id;
  };
  // GGG 的过滤器更新公告（2025-12）把 Atziri's Communion 列在 Item class: Support Gems 下，它在目录里是血脉宝石。
  assert.ok(memberIds("class-support-gems").includes(catalogId("Atziri's Communion")));
  // wiki 上 Frostflame Nova 的物品类别是 Skill Gem，它在目录里是符文宝石。
  assert.ok(memberIds("class-skill-gems").includes(catalogId("Frostflame Nova")));
  // wiki 上 Origin Spark 是 Pinnacle Key、Olroth's Reliquary Key 是 Vault Key；NeverSink 对这两类只用不带物品名单的整类块。
  assert.ok(memberIds("class-pinnacle-keys").includes(catalogId("Origin Spark")));
  assert.ok(memberIds("class-vault-keys").includes(catalogId("Olroth's Reliquary Key")));
  assert.ok(memberIds("class-vault-keys").every((itemId) => data.FILTER_ITEMS_BY_ID.get(itemId).name.includes("Reliquary Key")));
  // NeverSink 点名药剂时只写档位（"Gargantuan"），和全名对不上；类别和物品类型同名。
  for (const [id, suffix] of [["class-life-flasks", " Life Flask"], ["class-mana-flasks", " Mana Flask"]]) {
    assert.ok(memberIds(id).map((itemId) => data.FILTER_ITEMS_BY_ID.get(itemId)).filter((item) => item.category !== "unique").every((item) => item.name.endsWith(suffix)), id);
  }
});

test("石板按逐件输出，不生成 Class 条件", () => {
  const tablets = data.ITEM_CATALOG.filter((item) => item.categoryPath.join("/") === "endgame/tablets" && !item.matcher.class);
  assert.equal(tablets.length, 8);
  const output = generateOnBase(build([itemRule("tablets", tablets.map((item) => item.id))]), null, snapshot);
  assert.equal(classLines(output.filterFile).length, 0);
  assert.ok(!output.filterFile.includes("Augment"));
  assert.equal(ruleBlocks(output.filterFile).length, 8);
});

test("全选一个类别时输出一条整类块", () => {
  const output = generateOnBase(build([itemRule("omens", omenIds())]), null, snapshot);
  // 注释和逐件块一样用条目自己的名字，不另加「整类」标记。
  assert.deepEqual(ruleBlocks(output.filterFile), ['Show # poe2-filter rule: omens / Omen\n\tClass == "Omen"']);
  assert.equal(output.appliedRules[0].itemCount, 42);
  assert.equal(output.safetyReport.ambiguousItems, 0);
  assert.ok(!output.safetyReport.warnings.some((line) => line.includes("歧义")), output.safetyReport.warnings.join(" / "));
  // 预兆分散在四个玩法的叶子下：只全选其中一个叶子，或者全选「祭祀」，都还不是整个类别，按逐件输出。
  for (const leaf of ["gameplay/ritual/equipment-omens", "gameplay/ritual"]) {
    const ids = omenIds().filter((id) => leafOf(id) === leaf || leafOf(id).startsWith(leaf + "/"));
    const partial = generateOnBase(build([itemRule("omens", ids)]), null, snapshot).filterFile;
    assert.equal(classLines(partial).length, 0, leaf);
    assert.equal(ruleBlocks(partial).length, ids.length, leaf);
  }
});

test("带价格条件的规则不合并：整类条目没有行情", () => {
  const [priced, other] = omenIds();
  const market = withPrice(withPrice(snapshot, priced, 2), other, 2);
  const rule = itemRule("omens", omenIds(), { target: { itemIds: omenIds(), range: { min: { amount: 1, currency: "exalted" } } } });
  const blocks = ruleBlocks(generateOnBase(build([rule]), null, market).filterFile);
  assert.equal(blocks.length, 2, "只有两件预兆有报价且达到 1 E");
  assert.equal(classLines(generateOnBase(build([rule]), null, market).filterFile).length, 0);
  assert.ok(blocks.every((block) => /\n\tBaseType == "/.test(block)));
});

test("少选一件、或者这一类里有物品被跳过时，按逐件输出", () => {
  const ids = omenIds();
  const partial = generateOnBase(build([itemRule("omens", ids.slice(1))]), null, snapshot).filterFile;
  assert.equal(classLines(partial).length, 0);
  assert.equal(ruleBlocks(partial).length, 41);
  // 跳过物品只在有基础过滤器时生效，所以这里带着基础过滤器生成。
  const skipped = engine.generateFilter(build([itemRule("omens", ids)], [ids[0]]), snapshot).filterFile;
  assert.equal(classLines(skipped).length, 0);
  assert.equal(ruleBlocks(skipped).length, 41);
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
  const output = generateOnBase(build([itemRule("logs", ["class-expedition-logbook"]), { ...itemRule("quests", ["class-quest-items"]), hidden: true }]), null, snapshot);
  assert.deepEqual(ruleBlocks(output.filterFile), [
    'Show # poe2-filter rule: logs / Expedition Logbook\n\tClass == "Expedition Logbook"',
    'Hide # poe2-filter rule: quests / Quest Items\n\tClass == "Quest Items"',
  ]);
  assert.equal(output.appliedRules[0].itemCount, 1);
  // 在跳过物品里的整类条目不生成规则。
  const skipped = engine.generateFilter(build([itemRule("logs", ["class-expedition-logbook"])], ["class-expedition-logbook"]), snapshot);
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

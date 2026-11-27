import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LIST_LEAF_PATHS, CATEGORY_NODES, categoryPathFor, LEAF_PATHS, uniquePathFor, UNAVAILABLE } from "../scripts/lib/item-classes.mjs";

// 物品列表里每件物品所在的叶子，连同它客户端记录里的类别编号、标签、编号和掉落等级。
const reference = JSON.parse(readFileSync("data/item-category-reference.json", "utf8"));
const record = ({ itemClass, tags, id, dropLevel }) => ({ ItemClass: itemClass, Tags: tags, Id: "Metadata/Items/" + id, DropLevel: dropLevel });
const pathOf = (item) => categoryPathFor(record(item), item.name)?.join("/");

test("分类规则 reproduce 物品列表的物品归属", () => {
  assert.ok(reference.items.length > 1500 && reference.uniques.length > 400);
  const mismatches = reference.items.filter((item) => pathOf(item) !== item.path)
    .map((item) => item.name + "：" + (pathOf(item) ?? "未分类") + "，应为 " + item.path);
  assert.deepEqual(mismatches, []);
  // 它的每个叶子都对应到分类树里的一个叶子。
  for (const [leaf, path] of Object.entries(LIST_LEAF_PATHS)) assert.ok(LEAF_PATHS.includes(path), leaf + " → " + path);
});

test("传奇跟着基底归到「传奇」下对应的叶子", () => {
  const basePaths = new Map(reference.items.map((item) => [item.name, item.path]));
  for (const base of reference.uniqueBases) basePaths.set(base.name, categoryPathFor(record(base), base.name)?.join("/"));
  const mismatches = reference.uniques.filter((unique) => uniquePathFor((basePaths.get(unique.base) ?? "").split("/"))?.join("/") !== unique.path)
    .map((unique) => unique.name + "（" + unique.base + "）：" + basePaths.get(unique.base));
  assert.deepEqual(mismatches, []);
  // 药剂、咒符、石板和圣物上的传奇也各归其位。
  assert.equal(uniquePathFor(["equipment", "accessories", "charms"]).join("/"), "uniques/accessories/charms");
  assert.equal(uniquePathFor(["endgame", "sekhema-trials"]).join("/"), "uniques/misc/relics");
  assert.equal(uniquePathFor(["equipment", "helmets", "str-dex"]).join("/"), "uniques/equipment/helmets");
  assert.equal(uniquePathFor(["equipment", "off-hand", "shields-str-int"]).join("/"), "uniques/off-hand/shields");
});

test("分类树的每个叶子路径唯一，只有任务物品是我们自己的节点", () => {
  assert.equal(new Set(LEAF_PATHS).size, LEAF_PATHS.length);
  assert.equal(new Set(CATEGORY_NODES.map((entry) => entry.path)).size, CATEGORY_NODES.length);
  // 任务物品是分类树里自己加的节点，物品列表里没有它。
  assert.deepEqual(CATEGORY_NODES.filter((entry) => entry.node.own).map((entry) => entry.path), ["other/quest-items"]);
  // 顶层的顺序照页面：通货、传奇、玩法、终局、符文、精髓、技能、装备、其他。
  assert.deepEqual(CATEGORY_NODES.filter((entry) => !entry.path.includes("/")).map((entry) => entry.node.name.cn), ["通货", "传奇", "玩法", "终局", "符文", "精髓", "技能", "装备", "其他"]);
  for (const entry of CATEGORY_NODES) {
    for (const language of ["cn", "tw", "us"]) assert.ok(entry.node.name[language], entry.path + " 缺 " + language + " 名字");
  }
});

test("规则按客户端字段归类，逐个分支各有一条记录核对", () => {
  // 「不存在」按名单，其余看类别编号、标签和编号。这里用的是几条构造的记录，不依赖物品表里有没有这件物品。
  assert.equal(UNAVAILABLE.size, 21);
  const cases = [
    [{ name: "Omen of Recombination", itemClass: 108, tags: [], id: "Currency/OmenRecombination" }, "gameplay/ritual/equipment-omens"],
    [{ name: "Omen of Sinistral Alchemy", itemClass: 108, tags: [], id: "Currency/OmenOnAlchemyMaximumPrefixes" }, "gameplay/ritual/equipment-omens"],
    [{ name: "Test of Cunning Barya", itemClass: 91, tags: [33], id: "Sanctum/SanctumFloor3" }, "endgame/sekhema-trials"],
    [{ name: "Primary Calamity Fragment", itemClass: 109, tags: [], id: "Pinnacle/PinnacleKeyUber1" }, "endgame/keys"],
    [{ name: "Mutated Verisium", itemClass: 30, tags: [], id: "Currency/CurrencyVerisiumMetalBreach1" }, "gameplay/expedition/anvils"],
    [{ name: "Preserved Vertebrae", itemClass: 30, tags: [], id: "Currency/AbyssalBenchTicketWaystone" }, "gameplay/abyss/bones"],
    [{ name: "Rogue's Marker", itemClass: 30, tags: [596], id: "Heist/HeistCoin" }, "currency/currency"],
    [{ name: "Legacy of Bramblejack", itemClass: 106, tags: [1165], id: "SoulCores/RuneOlrothsLegacyBramblejack" }, "runes/special"],
    [{ name: "Atziri's Call", itemClass: 19, tags: [], id: "Gem/SupportGemAtzirisCall", dropLevel: 65 }, "gems/lineage"],
    [{ name: "Olroth's Hubris", itemClass: 19, tags: [1252], id: "Gems/SupportGemOlrothsHubris", dropLevel: 65 }, "gems/lineage"],
    [{ name: "Fist of Kalguur", itemClass: 19, tags: [1252], id: "Gem/SupportGemFistOfKalguur", dropLevel: 1 }, "gems/runic"],
    [{ name: "Thaumaturgic Flux (Level 3)", itemClass: 30, tags: [], id: "Currency/CurrencySetKalguuranSkillGemLevel3" }, "gems/runic"],
    [{ name: "Uncut Spirit Gem (Level 4)", itemClass: 113, tags: [], id: "Gems/ReservationGemUncut4" }, "gems/spirit"],
    [{ name: "Cleansing Charm", itemClass: 33, tags: [], id: "Flasks/FourCharm13" }, "equipment/accessories/charms"],
    [{ name: "Ancient Reliquary Key", itemClass: 90, tags: [703], id: "MapFragments/ClassicVaultKey1" }, "other/unavailable"],
  ];
  for (const [item, expected] of cases) assert.equal(categoryPathFor(record(item), item.name)?.join("/"), expected, item.name);
  // 没有登记的类别，和缺属性标签的防具，不定分类。
  assert.equal(categoryPathFor({ ItemClass: 6, Tags: [], Id: "Metadata/Items/Weapons/Claw1", Name: "Crude Claw" }), undefined);
  assert.equal(categoryPathFor({ ItemClass: 25, Tags: [33, 662], Id: "Metadata/Items/Armours/Helmets/HelmetDemigods1", Name: "Golden Visage" }), undefined);
  // 匕首、单手剑和双手剑的类别不登记。
  for (const [itemClass, id] of [[7, "Weapons/OneHandWeapons/Daggers/Dagger1"], [9, "Weapons/OneHandWeapons/OneHandSwords/Sword1"], [15, "Weapons/TwoHandWeapons/TwoHandSwords/Greatsword3"]]) {
    assert.equal(categoryPathFor({ ItemClass: itemClass, Tags: [], Id: "Metadata/Items/" + id, Name: "X" }), undefined, "类别 " + itemClass);
  }
  // 同名记录里取类别登记过分类的那一条。
  const entry = { name: "An Audience with the King", records: [
    { ItemClass: 31, Tags: [1050], Id: "Metadata/Items/QuestItems/Gallows/Endgame/RitualBossFragment", Name: "An Audience with the King" },
    { ItemClass: 38, Tags: [], Id: "Metadata/Items/MapFragments/CurrencyRitualBossFragment", Name: "An Audience with the King" },
  ] };
  assert.equal(classified(entry).ItemClass, 38);
});

function classified(entry) {
  return entry.records.find((item) => categoryPathFor(item, entry.name));
}

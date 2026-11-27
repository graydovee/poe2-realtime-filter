import assert from "node:assert/strict";
import test from "node:test";

import { buildCategoryReference, formatCategoryReference } from "../scripts/lib/category-reference.mjs";
import { syncStackable } from "../scripts/sync-client-items.mjs";

const record = (Name, ItemClass, tags = [], id = Name, DropLevel = 1) => ({ Id: "Metadata/Items/" + id, ItemClass, Tags: tags, Name, DropLevel });
const clientOf = (records) => {
  const entries = records.map((item) => [{ name: item.Name, records: [item], dropLevel: item.DropLevel, localeNames: { us: item.Name, cn: "中" + item.Name, tw: "繁" + item.Name } }][0]);
  return { records, byName: new Map(entries.map((entry) => [entry.name, entry])), byLowerName: new Map(entries.map((entry) => [entry.name.toLowerCase(), entry])) };
};
const item = (name) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, matcher: { baseType: name } });

test("由物品列表和客户端表生成参考数据", () => {
  const client = clientOf([
    record("Acrid Wand", 8, [], "Armours/Wands/Wand1", 33),
    record("Exalted Orb", 30, [232], "Currency/CurrencyRerollRare"),
    record("Minion Splash I", 19, [], "Gem/SupportGemMinionSplash1"),
    record("Fist of Kalguur", 19, [1252], "Gem/SupportGemFistOfKalguur"),
    record("Golden Visage", 25, [33], "Armours/Helmets/HelmetDemigods1"),
    record("Incense Relic", 86, [989], "Relics/SanctumRelic4x1", 65),
  ]);
  const table = {
    version: "0.5.5", captured: "2026-11-27", hash: "abc",
    items: [
      { category: "one_hand_weapons", subcategory: "wands", name: "Acrid Wand", cn: "刻薄法杖", tw: "刺鼻法杖" },
      { category: "currency", subcategory: "currency_items", name: "exalted orb", cn: "崇高石", tw: "崇高石", stackSize: [1, 20] },
      { category: "skills_gem", subcategory: "support_gems", name: "Minion Splash I", cn: "x", tw: "x" },
      { category: "skills_gem", subcategory: "support_gems", name: "Fist of Kalguur", cn: "x", tw: "x" },
      { category: "helmets", subcategory: "helmets_str", name: "Golden Visage", cn: "x", tw: "x" },
      { category: "unique_one_hand_weapons", subcategory: "unique_wands", name: "Cursecarver", base: "Acrid Wand", cn: "刻咒", tw: "刻咒", unique: true },
      { category: "unique_misc", subcategory: "relics", name: "The Last Flame", base: "Incense Relic", cn: "终末之火", tw: "終末之火", unique: true },
    ],
  };
  const reference = buildCategoryReference(client, table);
  // 名字按不区分大小写对应客户端记录，记录里带着定分类要用的字段；分类路径是物品列表里的叶子对应的路径。
  assert.deepEqual(reference.items.map((item) => [item.name, item.itemClass, item.id, item.dropLevel, item.path]), [
    ["Acrid Wand", 8, "Armours/Wands/Wand1", 33, "equipment/one-hand/wands"],
    ["exalted orb", 30, "Currency/CurrencyRerollRare", 1, "currency/currency"],
    ["Fist of Kalguur", 19, "Gem/SupportGemFistOfKalguur", 1, "gems/runic"],
  ]);
  // 客户端里不定分类的内部记录，和只从未切割的辅助宝石里切出来的普通辅助宝石，不进参考数据。
  assert.deepEqual(reference.skipped, { internal: ["Golden Visage"], cutOnly: ["Minion Splash I"] });
  assert.deepEqual(reference.uniques, [
    { name: "Cursecarver", base: "Acrid Wand", cn: "刻咒", tw: "刻咒", leaf: "unique_one_hand_weapons/unique_wands", path: "uniques/one-hand/wands" },
    { name: "The Last Flame", base: "Incense Relic", cn: "终末之火", tw: "終末之火", leaf: "unique_misc/relics", path: "uniques/misc/relics" },
  ]);
  // 只在传奇的基底里出现、物品表里没有单列的基底。
  assert.deepEqual(reference.uniqueBases, [{ name: "Incense Relic", itemClass: 86, tags: [989], id: "Relics/SanctumRelic4x1", dropLevel: 65 }]);
  // 版本、抓取日期和散列跟着物品表走；写出来的文件每条记录一行，能原样读回。
  assert.deepEqual([reference.hash, reference.version, reference.captured], ["abc", "0.5.5", "2026-11-27"]);
  const text = formatCategoryReference(reference);
  assert.ok(text.includes('\n    {"name":"Acrid Wand","itemClass":8,'));
  const parsed = JSON.parse(text);
  assert.deepEqual([parsed.version, parsed.captured, parsed.hash, parsed.items.length, parsed.uniques.length, parsed.uniqueBases.length], ["0.5.5", "2026-11-27", "abc", 3, 2, 1]);
  // 客户端表里根本没有的物品，和还没有对应到分类树的叶子，都是硬错误。
  assert.throws(() => buildCategoryReference(client, { ...table, items: [{ category: "currency", subcategory: "currency_items", name: "No Such Orb" }] }), /客户端表里找不到物品列表里的这些物品：No Such Orb/);
  assert.throws(() => buildCategoryReference(client, { ...table, items: [{ category: "new", subcategory: "leaf", name: "Exalted Orb" }] }), /物品列表里的叶子还没有对应到分类树：new\/leaf/);
});

test("可堆叠名单按物品详情重写", () => {
  const catalog = { items: ["Divine Orb", "Ancient Rune", "Secret Orb", "Brand New Orb", "Uncut Skill Gem (Level 20)"].map(item) };
  const details = {
    items: {
      "Divine Orb": { listed: true, stackSize: [1, 10] },
      "Ancient Rune": { listed: true },
    },
  };
  const text = '{\n  "stackable": [\n    "Ancient Rune",\n    "Secret Orb",\n    "Uncut Skill Gem (Level 20)"\n  ],\n  "dropEnabled": {}\n}';
  const result = syncStackable(text, catalog, details);
  // 物品详情里有堆叠上限的可堆叠；收录了却没有堆叠上限的去掉；详情里没有的保持原样，原先不在名单里的也不加进去。
  assert.deepEqual(JSON.parse(result.text).stackable, ["Divine Orb", "Secret Orb", "Uncut Skill Gem (Level 20)"]);
  assert.deepEqual([result.added, result.removed], [1, 1]);
  // 按等级拆分的物品只有还在目录里才留着。
  const withoutLeveled = syncStackable(text, { items: catalog.items.filter((item) => !/\(Level \d+\)$/.test(item.name)) }, details);
  assert.deepEqual(JSON.parse(withoutLeveled.text).stackable, ["Divine Orb", "Secret Orb"]);
});

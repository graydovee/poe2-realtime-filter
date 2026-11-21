import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync("data/item-catalog.json", "utf8"));
const mechanics = JSON.parse(readFileSync("data/item-mechanics.json", "utf8"));
const pathOf = (name) => catalog.items.find((item) => item.name === name)?.categoryPath?.join("/");

test("通货与材料按玩法分组，不再有单一的基础通货大杂烩", () => {
  const crafting = catalog.items.filter((item) => item.categoryPath[0] === "crafting");
  const mechanicsInUse = new Set(crafting.map((item) => item.categoryPath[1]));
  for (const key of ["basic", "abyss", "expedition", "breach", "ritual", "delirium", "temple", "trial"]) {
    assert.ok(mechanicsInUse.has(key), "缺少玩法分组：" + key);
  }
  // 旧的四合一分组必须消失，否则就还是「没分细」。
  for (const legacy of ["crafting/currency", "crafting/shards", "crafting/catalysts", "crafting/emotions", "crafting/omens"]) {
    assert.equal(catalog.items.filter((item) => item.categoryPath.join("/") === legacy).length, 0, "旧分组仍然存在：" + legacy);
  }
});

test("每件通货与材料都有可追溯的玩法归属", () => {
  const keys = new Set(Object.keys(mechanics.mechanics));
  const unmapped = catalog.items.filter(
    (item) => item.categoryPath[0] === "crafting" && keys.has(item.categoryPath[1]) && !mechanics.items[item.name],
  );
  assert.deepEqual(unmapped.map((item) => item.name), []);
  for (const [name, entry] of Object.entries(mechanics.items)) {
    assert.ok(keys.has(entry.mechanic), name + " 的玩法键无效：" + entry.mechanic);
    assert.ok(entry.evidence && entry.evidence.trim(), name + " 缺少判定依据");
  }
});

test("玩法归属与掉落来源一致", () => {
  assert.equal(pathOf("Divine Orb"), "crafting/basic");
  assert.equal(pathOf("Gnawed Jawbone"), "crafting/abyss/bones");
  assert.equal(pathOf("Preserved Cranium"), "crafting/abyss/bones");
  assert.equal(pathOf("Omen of Light"), "crafting/abyss/omens");
  assert.equal(pathOf("Adaptive Alloy"), "crafting/expedition/alloys");
  assert.equal(pathOf("Perfect Flux"), "crafting/expedition/flux");
  assert.equal(pathOf("Starlit Ore"), "crafting/expedition/verisium");
  assert.equal(pathOf("Medved's Crest of the Circle"), "crafting/expedition/crests");
  assert.equal(pathOf("Yugul's Orb of Sacrifice"), "crafting/temple/orbs");
  assert.equal(pathOf("Vaal Arcanist's Infuser"), "crafting/temple/infusers");
  assert.equal(pathOf("Esh's Catalyst"), "crafting/breach/catalysts");
  assert.equal(pathOf("Breach Splinter"), "crafting/breach/splinters");
  assert.equal(pathOf("Omen of Chance"), "crafting/ritual/omens");
  assert.equal(pathOf("Liquid Paranoia"), "crafting/delirium/emotions");
  assert.equal(pathOf("Simulacrum Splinter"), "crafting/delirium/splinters");
  assert.equal(pathOf("Bronze Key"), "crafting/trial/keys");
});

test("wiki 分类是首选依据，神庙整组都由分类判定", () => {
  const entries = Object.entries(mechanics.items);
  const fromCategory = entries.filter(([, entry]) => entry.evidence.startsWith("wiki-category:"));
  assert.ok(fromCategory.length >= 30, "wiki 分类只判定了 " + fromCategory.length + " 条");
  const categoryKeys = new Set(Object.keys(mechanics.mechanics));
  for (const [name, entry] of fromCategory) {
    assert.ok(categoryKeys.has(entry.mechanic), name + " 的玩法键无效：" + entry.mechanic);
  }
  const temple = entries.filter(([, entry]) => entry.mechanic === "temple");
  assert.equal(temple.length, 14);
  for (const [name, entry] of temple) assert.equal(entry.evidence, "wiki-category: Fate of the Vaal", name);
});

test("玩法与细分小组都有三种语言的词条", () => {
  for (const [key, labels] of Object.entries(mechanics.mechanics)) {
    for (const locale of ["cn", "tw", "us"]) assert.ok(labels[locale], "玩法 " + key + " 缺少 " + locale);
  }
  for (const [key, labels] of Object.entries(mechanics.kinds)) {
    for (const locale of ["cn", "tw", "us"]) assert.ok(labels[locale], "小组 " + key + " 缺少 " + locale);
  }
});

test("整类匹配标记不归属任何玩法", () => {
  const markers = catalog.items.filter((item) => item.categoryPath[0] === "crafting" && item.categoryPath[1] === "class-selection");
  assert.ok(markers.length > 0);
  for (const marker of markers) assert.equal(marker.categoryPath.join("/"), "crafting/class-selection");
});
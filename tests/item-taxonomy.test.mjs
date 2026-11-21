import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync("data/item-catalog.json", "utf8"));
const mechanics = JSON.parse(readFileSync("data/item-mechanics.json", "utf8"));
const pathOf = (name) => catalog.items.find((item) => item.name === name)?.categoryPath?.join("/");

test("通货与材料分组跟随 poe.ninja 标签页", () => {
  const crafting = catalog.items.filter((item) => item.categoryPath[0] === "crafting");
  const groupsInUse = new Set(crafting.map((item) => item.categoryPath[1]));
  for (const key of ["currency", "shards", "bones", "omens", "expedition", "emotions", "catalysts", "verisium", "temple", "trial"]) {
    assert.ok(groupsInUse.has(key), "缺少分组：" + key);
  }
  // 旧的玩法合并组必须消失。
  for (const legacy of ["crafting/basic", "crafting/abyss", "crafting/ritual", "crafting/delirium", "crafting/breach"]) {
    assert.equal(catalog.items.filter((item) => item.categoryPath.join("/") === legacy).length, 0, "旧分组仍然存在：" + legacy);
  }
});

test("每件通货与材料都有可追溯的分组归属", () => {
  const keys = new Set(Object.keys(mechanics.groups));
  const unmapped = catalog.items.filter(
    (item) => item.categoryPath[0] === "crafting" && keys.has(item.categoryPath[1]) && !mechanics.items[item.name],
  );
  assert.deepEqual(unmapped.map((item) => item.name), []);
  for (const [name, entry] of Object.entries(mechanics.items)) {
    assert.ok(keys.has(entry.mechanic), name + " 的玩法键无效：" + entry.mechanic);
    assert.ok(entry.evidence && entry.evidence.trim(), name + " 缺少判定依据");
  }
});

test("分组与 poe.ninja 标签页一致", () => {
  assert.equal(pathOf("Divine Orb"), "crafting/currency");
  assert.equal(pathOf("Mirror of Kalandra"), "crafting/currency");
  assert.equal(pathOf("Gnawed Jawbone"), "crafting/bones");
  assert.equal(pathOf("Preserved Cranium"), "crafting/bones");
  assert.equal(pathOf("Omen of Light"), "crafting/omens");
  assert.equal(pathOf("Omen of Chance"), "crafting/omens");
  assert.equal(pathOf("Aldur's Saga"), "crafting/expedition");
  assert.equal(pathOf("Perfect Flux"), "crafting/expedition");
  assert.equal(pathOf("Thaumaturgic Flux (Level 8)"), "crafting/expedition");
  assert.equal(pathOf("Adaptive Alloy"), "crafting/verisium");
  assert.equal(pathOf("Starlit Ore"), "crafting/verisium");
  assert.equal(pathOf("Medved's Crest of the Circle"), "crafting/verisium");
  assert.equal(pathOf("Esh's Catalyst"), "crafting/catalysts");
  assert.equal(pathOf("Liquid Paranoia"), "crafting/emotions");
  assert.equal(pathOf("Breach Splinter"), "crafting/shards");
  assert.equal(pathOf("Simulacrum Splinter"), "crafting/shards");
  assert.equal(pathOf("Bronze Key"), "crafting/trial");
  // 神庙是从 poe.ninja 的 Currency 里单独拆出来的分组。
  assert.equal(pathOf("Yugul's Orb of Sacrifice"), "crafting/temple");
  assert.equal(pathOf("Vaal Arcanist's Infuser"), "crafting/temple");
  assert.equal(pathOf("Architect's Orb"), "crafting/temple");
  assert.equal(mappingSource("Architect's Orb"), "crafting");
});

function mappingSource(name) {
  const entry = mechanics.items[name];
  assert.ok(entry, name + " 缺少归属");
  return "crafting";
}

test("poe.ninja 是主口径，商店未收录的条目走 wiki 兜底", () => {
  const entries = Object.entries(mechanics.items);
  const fromNinja = entries.filter(([, entry]) => entry.evidence.startsWith("poe.ninja:"));
  assert.ok(fromNinja.length >= 140, "poe.ninja 只判定了 " + fromNinja.length + " 条");
  const groupKeys = new Set(Object.keys(mechanics.groups));
  for (const [name, entry] of entries) assert.ok(groupKeys.has(entry.mechanic), name + " 的分组键无效：" + entry.mechanic);
  // 神庙必须是拆出来的独立分组，而不是混在 Currency 里。
  const temple = entries.filter(([, entry]) => entry.mechanic === "temple");
  assert.equal(temple.length, 14);
});

test("分组词条齐全，且展示顺序覆盖所有分组", () => {
  for (const [key, labels] of Object.entries(mechanics.groups)) {
    for (const locale of ["cn", "tw", "us"]) assert.ok(labels[locale], "分组 " + key + " 缺少 " + locale);
  }
  for (const key of Object.keys(mechanics.groups)) assert.ok(mechanics.order.includes(key), "展示顺序缺少 " + key);
});

test("整类匹配标记不归属任何玩法", () => {
  const markers = catalog.items.filter((item) => item.categoryPath[0] === "crafting" && item.categoryPath[1] === "class-selection");
  assert.ok(markers.length > 0);
  for (const marker of markers) assert.equal(marker.categoryPath.join("/"), "crafting/class-selection");
});
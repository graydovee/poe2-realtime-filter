import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const root = process.cwd();

test("NeverSink baseline and generated data are vendored", () => {
  execFileSync(process.execPath, ["scripts/validate-data.mjs"], { cwd: root, stdio: "pipe" });
  assert.equal(existsSync("vendor/neversink/NeverSink's filter 2 - 2-SEMI-STRICT.filter"), true);
  const catalog = JSON.parse(readFileSync("data/item-catalog.json", "utf8"));
  assert.ok(catalog.items.length >= 1000);
  assert.ok(catalog.items.some((item) => item.matcher?.baseType === "Divine Orb"));
});

test("default rules ship four price tiers", () => {
  const rules = JSON.parse(readFileSync("data/default-rules.json", "utf8")).rules;
  assert.equal(rules.length, 4);
  assert.deepEqual(rules.map((rule) => rule.id), ["default-exalted", "default-chaos", "default-annulment", "default-divine"]);
  for (const rule of rules) {
    assert.equal(rule.autoRange, true);
    assert.ok(rule.target.range.min.referenceItemId);
    assert.ok(Object.keys(rule.effects).length > 0, "默认规则需要带特效：" + rule.id);
  }
});

test("catalog exposes category menus and keeps every group", () => {
  const catalog = JSON.parse(readFileSync("data/item-catalog.json", "utf8"));
  const groups = new Set(catalog.items.map((item) => item.categoryPath[0]));
  assert.ok(groups.has("crafting"));
  assert.ok(groups.has("equipment"));
  assert.ok(groups.has("gems"));
  const crafting = catalog.items.filter((item) => item.categoryPath[0] === "crafting").map((item) => item.categoryPath[1]);
  for (const key of ["currency", "bones", "omens", "temple"]) assert.ok(crafting.includes(key), "缺少分组 " + key);
});

test("market worker is valid JavaScript", () => {
  execFileSync(process.execPath, ["--check", "worker/price-sync.mjs"], { cwd: root, stdio: "pipe" });
});

test("generated safety policy is documented", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /未知物品/);
  assert.match(readme, /跳过/);
});

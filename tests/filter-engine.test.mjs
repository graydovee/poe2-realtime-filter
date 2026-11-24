import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cleanup, groupName, groupOrder } from "./helpers.mjs";

const root = process.cwd();

test.after(cleanup);

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
  // 价格档就是普通的相邻区间：每档「≥ 1 枚本档通货，且 < 1 枚下一档通货」，最高档不封顶。
  assert.deepEqual(rules.map((rule) => [rule.target.range.min, rule.target.range.max ?? null]), [
    [{ amount: 1, currency: "exalted" }, { amount: 1, currency: "chaos" }],
    [{ amount: 1, currency: "chaos" }, { amount: 1, currency: "annulment" }],
    [{ amount: 1, currency: "annulment" }, { amount: 1, currency: "divine" }],
    [{ amount: 1, currency: "divine" }, null],
  ]);
  for (const rule of rules) {
    assert.equal(rule.autoRange, undefined, "价格档不该再有特殊开关：" + rule.id);
    assert.ok(Object.keys(rule.effects).length > 0, "默认规则需要带特效：" + rule.id);
  }
});

test("未切割宝石按等级拆成独立物品，宝石分组按游戏里的叫法", () => {
  const items = JSON.parse(readFileSync("data/item-catalog.json", "utf8")).items;
  const gems = items.filter((item) => item.categoryPath[0] === "gems");
  const count = (path) => gems.filter((item) => item.categoryPath.join("/") === path).length;
  assert.deepEqual(
    Object.fromEntries(["uncut-skill-gems", "uncut-spirit-gems", "uncut-support-gems", "blood-gems", "rune-gems"].map((key) => [key, count("gems/" + key)])),
    { "uncut-skill-gems": 20, "uncut-spirit-gems": 20, "uncut-support-gems": 5, "blood-gems": 85, "rune-gems": 22 },
  );
  // 客户端的 Support Gems 类别里是血脉宝石，Skill Gems 类别里是符文宝石。
  assert.ok(gems.some((item) => item.categoryPath[1] === "blood-gems" && item.name === "Atalui's Bloodletting"));
  assert.ok(gems.some((item) => item.categoryPath[1] === "rune-gems" && item.name === "Frostflame Nova"));
  // 命源碎片在客户端数据里单独占一个类别，但它就是一枚符文技能宝石，不该自成一组。
  assert.deepEqual(items.find((item) => item.id === "animus-splinters").categoryPath, ["gems", "rune-gems"]);
  assert.ok(!gems.some((item) => ["uncut", "skill-gems", "support-gems", "spirit-gems", "gem-materials"].includes(item.categoryPath[1])), "旧的宝石分组不该残留");
  const uncut = items.filter((item) => /^Uncut (Skill|Spirit|Support) Gem \(Level \d+\)$/.exec(item.name));
  assert.equal(uncut.length, 45);
  assert.ok(!items.some((item) => /^uncut-(skill|spirit|support)-gem$/.test(item.id)), "不分等级的旧条目不该残留");
  for (const item of uncut) {
    const [, kind, level] = /^Uncut (Skill|Spirit|Support) Gem \(Level (\d+)\)$/.exec(item.name);
    assert.equal(item.id, "uncut-" + kind.toLowerCase() + "-gem-" + level);
    assert.equal(item.marketKey, item.name, "行情按「Uncut Skill Gem (Level N)」这个名字报价");
    assert.equal(item.baseType, "Uncut " + kind + " Gem");
    assert.deepEqual(item.matcher, { baseType: "Uncut " + kind + " Gem", gemLevel: Number(level) });
    assert.equal(item.categoryPath.join("/"), "gems/uncut-" + kind.toLowerCase() + "-gems");
    assert.equal(item.priceable, true);
  }
  for (const key of ["uncut-skill-gems", "uncut-spirit-gems", "uncut-support-gems", "blood-gems", "rune-gems"]) {
    assert.notEqual(groupName(key, "cn"), key, "缺少分组名：" + key);
  }
  assert.equal(groupName("blood-gems", "cn"), "血脉宝石");
  assert.equal(groupName("rune-gems", "cn"), "符文宝石");
  assert.equal(groupName("uncut-support-gems", "cn"), "未切割的辅助宝石");
  // 分类菜单里未切割的三类排在前面，然后是血脉、符文。
  assert.ok(groupOrder("uncut-support-gems") < groupOrder("blood-gems") && groupOrder("blood-gems") < groupOrder("rune-gems"));
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

test("market adapter is valid JavaScript", () => {
  execFileSync(process.execPath, ["--check", "worker/market-adapter.mjs"], { cwd: root, stdio: "pipe" });
});

test("generated safety policy is documented", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /未知物品/);
  assert.match(readme, /跳过/);
});

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

test("未切割宝石按等级拆成独立物品，宝石分组的叫法照物品列表", () => {
  const items = JSON.parse(readFileSync("data/item-catalog.json", "utf8")).items;
  const gems = items.filter((item) => item.categoryPath[0] === "gems");
  const count = (path) => gems.filter((item) => item.categoryPath.join("/") === path).length;
  assert.deepEqual(
    Object.fromEntries(["lineage", "skill", "spirit", "support", "runic"].map((key) => [key, count("gems/" + key)])),
    // 未切割精魂宝石从 4 级起才有，和交易所「Uncut Gems」栏里的 20 + 17 + 5 件一致。
    // 符文技能里除了 23 颗符文技能宝石和 7 颗符文辅助宝石，还有按等级卖的 16 档泰瑟奇术通量。
    { lineage: 77, skill: 20, spirit: 17, support: 5, runic: 46 },
  );
  // 客户端的 Support Gems 类别里是血脉宝石和符文辅助宝石，Skill Gems 类别里是符文技能宝石。
  assert.ok(gems.some((item) => item.categoryPath[1] === "lineage" && item.name === "Atalui's Bloodletting"));
  assert.ok(gems.some((item) => item.categoryPath[1] === "runic" && item.name === "Frostflame Nova"));
  // NeverSink 把这两颗宝石名字里的 of 小写；卡古兰之拳是符文辅助宝石，往昔碎片是符文技能宝石。
  assert.ok(gems.some((item) => item.categoryPath[1] === "runic" && item.name === "Fist Of Kalguur"));
  assert.ok(gems.some((item) => item.categoryPath[1] === "runic" && item.name === "Fragments Of The Past"));
  // 命源碎片在客户端数据里单独占一个类别，但它就是一枚符文技能宝石，不该自成一组。
  assert.deepEqual(items.find((item) => item.id === "animus-splinters").categoryPath, ["gems", "runic"]);
  // 泰瑟奇术通量在物品列表里是 5–20 级，每级一件。
  assert.deepEqual(items.filter((item) => /^Thaumaturgic Flux \(Level \d+\)$/.test(item.name)).map((item) => item.categoryPath.join("/")), Array(16).fill("gems/runic"));
  for (const key of ["uncut", "blood-gems", "rune-gems", "skill-gems", "support-gems", "spirit-gems", "gem-materials"]) assert.ok(!gems.some((item) => item.categoryPath[1] === key), "旧的宝石分组不该残留：" + key);
  const uncut = items.filter((item) => /^Uncut (Skill|Spirit|Support) Gem \(Level \d+\)$/.exec(item.name));
  assert.equal(uncut.length, 42);
  assert.ok(!items.some((item) => /^uncut-(skill|spirit|support)-gem$/.test(item.id)), "不分等级的旧条目不该残留");
  for (const item of uncut) {
    const [, kind, level] = /^Uncut (Skill|Spirit|Support) Gem \(Level (\d+)\)$/.exec(item.name);
    assert.ok(kind !== "Spirit" || Number(level) >= 4, "未切割精魂宝石没有 1–3 级：" + item.name);
    assert.equal(item.id, "uncut-" + kind.toLowerCase() + "-gem-" + level);
    assert.equal(item.marketKey, item.name, "行情按「Uncut Skill Gem (Level N)」这个名字报价");
    assert.equal(item.baseType, "Uncut " + kind + " Gem");
    assert.deepEqual(item.matcher, { baseType: "Uncut " + kind + " Gem", gemLevel: Number(level) });
    assert.equal(item.categoryPath.join("/"), "gems/" + kind.toLowerCase());
    assert.equal(item.priceable, true);
  }
  for (const key of ["lineage", "skill", "spirit", "support", "runic"]) {
    assert.notEqual(groupName(["gems", key], "cn"), key, "缺少分组名：" + key);
  }
  assert.equal(groupName(["gems", "lineage"], "cn"), "血脉宝石");
  assert.equal(groupName(["gems", "runic"], "cn"), "符文技能");
  assert.equal(groupName(["gems", "support"], "cn"), "辅助宝石");
  // 分类菜单里技能下面依次是血脉、技能、精魄、辅助、符文技能。
  const order = ["lineage", "skill", "spirit", "support", "runic"].map((key) => groupOrder(["gems", key]));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("catalog exposes category menus and keeps every group", () => {
  const catalog = JSON.parse(readFileSync("data/item-catalog.json", "utf8"));
  const items = catalog.items.filter((item) => !item.matcher.class);
  const roots = new Set(items.map((item) => item.categoryPath[0]));
  // 顶层分类和顺序照物品列表：通货、传奇、玩法、终局、符文、精髓、技能、装备、其他（传奇条目由基底派生，目录里没有这一层）。
  for (const key of ["currency", "gameplay", "endgame", "runes", "essences", "gems", "equipment", "other"]) assert.ok(roots.has(key), "缺少顶层分类 " + key);
  assert.equal(roots.size, 8);
  const under = (...prefix) => new Set(items.filter((item) => item.categoryPath.slice(0, prefix.length).join("/") === prefix.join("/")).map((item) => item.categoryPath[prefix.length]));
  assert.deepEqual([...under("gameplay")].sort(), ["abyss", "breach", "delirium", "expedition", "ritual", "temple"]);
  assert.deepEqual([...under("equipment")].sort(), ["accessories", "body-armour", "boots", "gloves", "helmets", "off-hand", "one-hand", "two-hand"]);
  assert.deepEqual([...under("equipment", "helmets")].sort(), ["dex", "dex-int", "int", "str", "str-dex", "str-dex-int", "str-int"]);
  assert.deepEqual([...under("runes")].sort(), ["greater", "greater-idols", "greater-soul-cores", "idols", "normal", "perfect", "soul-cores", "special"]);
  // 名字按路径取：同一个 key 在不同父分类下叫法不同。
  assert.equal(groupName(["gameplay", "expedition", "omens"], "cn"), "预兆");
  assert.equal(groupName(["gameplay", "temple", "currency"], "cn"), "通货");
  assert.equal(groupName(["equipment", "helmets", "str-dex-int"], "cn"), "头盔(力敏智)");
  assert.equal(groupName(["equipment", "off-hand", "shields-str-dex"], "cn"), "盾🔴⚡");
  assert.equal(groupName(["endgame", "waystones", "class-selection"], "cn"), "换界石");
  // 顶层分类的先后就是菜单里的先后。
  const top = ["currency", "gameplay", "endgame", "runes", "essences", "gems", "equipment", "other"].map((key) => groupOrder([key]));
  assert.deepEqual(top, [...top].sort((a, b) => a - b));
});

test("market adapter is valid JavaScript", () => {
  execFileSync(process.execPath, ["--check", "worker/market-adapter.mjs"], { cwd: root, stdio: "pipe" });
});

test("generated safety policy is documented", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /未知物品/);
  assert.match(readme, /跳过/);
});

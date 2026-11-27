import fs from "node:fs";
import path from "node:path";
import { CATEGORY_NODES, EQUIPMENT_CLASSES } from "./lib/item-classes.mjs";
import { validateCatalogShareData, catalogPickerPaths } from "./lib/catalog-data.mjs";
import { CATEGORY_REFERENCE, ITEM_LIST } from "./lib/item-data.mjs";

const root = process.cwd();
const vendor = path.join(root, "vendor", "neversink");
const required = [
  "NeverSink's filter 2 - 0-SOFT.filter",
  "NeverSink's filter 2 - 1-REGULAR.filter",
  "NeverSink's filter 2 - 2-SEMI-STRICT.filter",
  "NeverSink's filter 2 - 3-STRICT.filter",
  "NeverSink's filter 2 - 4-VERY-STRICT.filter",
  "NeverSink's filter 2 - 5-UBER-STRICT.filter",
  "NeverSink's filter 2 - 6-UBER-PLUS-STRICT.filter",
];
const missing = required.filter((name) => !fs.existsSync(path.join(vendor, name)));
if (missing.length) throw new Error("missing NeverSink baseline files: " + missing.join(", "));

const problems = [];
const uncutGroup = (item) => (item.categoryPath?.[0] === "gems" ? item.categoryPath[1] : undefined);
for (const name of required) {
  const text = fs.readFileSync(path.join(vendor, name), "utf8");
  if (!/^Show\b/m.test(text)) problems.push(name + ": no Show rule");
  if (!/^Hide\b/m.test(text)) problems.push(name + ": no Hide rule");
  if (!text.includes("Unknown")) problems.push(name + ": unknown-item marker not found");
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "item-catalog.json"), "utf8"));
if (!Array.isArray(catalog.items) || catalog.items.length < 1000) problems.push("catalog: expected at least 1000 parsed items");
if (!Number.isInteger(catalog.catalogVersion) || catalog.catalogVersion < 1) problems.push("catalog: catalogVersion must be a positive integer");
// 参考数据是由当前的物品列表生成的：两边的版本、取数日期和内容散列一致。
if (["hash", "version", "captured"].some((field) => CATEGORY_REFERENCE[field] !== ITEM_LIST[field])) {
  problems.push("reference: data/item-category-reference.json was not built from the current data/item-list.json，运行 npm run catalog:update -- --client <客户端版本目录> --apply 重新生成");
}
const expectedSourceVersion = ITEM_LIST.version + " 版本物品列表";
if (catalog.sourceVersion !== expectedSourceVersion) problems.push("catalog: sourceVersion must be " + expectedSourceVersion + ", found " + catalog.sourceVersion);
const dropMetadata = JSON.parse(fs.readFileSync(path.join(root, "data", "item-drop-metadata.json"), "utf8"));
const dropEnabled = dropMetadata.dropEnabled ?? {};
const itemClasses = dropMetadata.items ?? {};
const itemIds = new Set();
for (const item of catalog.items || []) {
  if (!item.id || itemIds.has(item.id)) problems.push("catalog: duplicate or empty item id " + item.id);
  itemIds.add(item.id);
  if (!item.name || !item.matcher || (!item.matcher.baseType && !item.matcher.class && item.matcher.waystoneTier === undefined)) problems.push("catalog: invalid matcher " + item.id);
  if (!Array.isArray(item.categoryPath) || item.categoryPath.length < 2) problems.push("catalog: missing category path " + item.id);
  // 分类路径都在分类树里：可选物品在叶子上，整类条目以 class-selection 结尾、前面是它所代表的那个节点。
  const categoryPath = item.categoryPath ?? [];
  const isClassEntry = Boolean(item.matcher?.class);
  const classMarker = isClassEntry && categoryPath.at(-1) === "class-selection";
  if (isClassEntry && !classMarker) problems.push("catalog: class entry path must end with class-selection " + item.id);
  const known = CATEGORY_NODES.some((entry) => entry.path === (classMarker ? categoryPath.slice(0, -1) : categoryPath).join("/") && (classMarker || entry.leaf));
  if (!known && categoryPath[1] !== "other-items") {
    problems.push("catalog: category path is not in the category tree: " + categoryPath.join("/") + " (" + item.id + ")，运行 node scripts/build-catalog-groups.mjs <客户端版本目录> 重新定分类");
  }
  // 落进「其他物品」的不是可选的物品：客户端表里没有它，或者它的类别还没有登记分类。
  if (categoryPath[1] === "other-items") problems.push("catalog: item filed under other/other-items " + item.id);
  if (!item.localeNames?.cn || !item.localeNames?.tw || !item.localeNames?.us) problems.push("catalog: missing locale name " + item.id);
  // 未切割宝石每个等级是一件独立物品：id 里的等级、GemLevel 和分组必须一致。
  const uncut = /^uncut-(skill|spirit|support)-gem-(\d+)$/.exec(item.id || "");
  if (uncut && (item.matcher.gemLevel !== Number(uncut[2]) || categoryPath.join("/") !== "gems/" + uncut[1])) {
    problems.push("catalog: inconsistent uncut gem level " + item.id);
  }
  // 每件物品的客户端类别编号都要记下，整类匹配按它认出同一个类别的物品。
  if (!isClassEntry && !itemClasses[item.name] && !/\(Level \d+\)$/.test(item.name)) problems.push("catalog: missing item class " + item.name);
}
// 未切割宝石每个等级是一件独立物品，等级范围和客户端一致：技能 1–20，精魂 4–20，辅助 1–5。
for (const [kind, first, last] of [["skill", 1, 20], ["spirit", 4, 20], ["support", 1, 5]]) {
  const levels = (catalog.items || []).filter((item) => uncutGroup(item) === kind).map((item) => item.matcher.gemLevel);
  const expected = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  if (levels.length !== expected.length || expected.some((level) => !levels.includes(level))) {
    problems.push("catalog: expected uncut " + kind + " gem levels " + first + "-" + last + ", found " + levels.join(","));
  }
}
// 换界石每个阶数是一件独立物品，1–16 阶各一条，名字、阶数和分类一致。
for (let tier = 1; tier <= 16; tier += 1) {
  const waystones = (catalog.items || []).filter((item) => item.id === "waystone-tier-" + tier || item.name === "Waystone (Tier " + tier + ")" || item.matcher?.waystoneTier === tier);
  const [waystone] = waystones;
  if (waystones.length !== 1 || waystone.id !== "waystone-tier-" + tier || waystone.name !== "Waystone (Tier " + tier + ")"
    || JSON.stringify(waystone.matcher) !== JSON.stringify({ waystoneTier: tier }) || waystone.categoryPath.join("/") !== "endgame/waystones") {
    problems.push("catalog: waystone tier " + tier + " must be one item waystone-tier-" + tier + " with matcher {waystoneTier: " + tier + "} under endgame/waystones");
  }
}
// 物品目录就是物品列表：列表里的每件物品和每件传奇都在目录里，目录里也没有列表里没有的物品和传奇。
// 目录里另有按类别匹配的整类条目（远征日志在选择器里就是一件整类条目），和只给列表里的传奇挂基底的几件（列表里的 uniqueBases）。
const listedNames = new Set(CATEGORY_REFERENCE.items.map((entry) => entry.name.toLowerCase()));
const catalogNames = new Set((catalog.items || []).map((item) => item.name.toLowerCase()));
const selectableNames = new Set((catalog.items || []).filter((item) => !item.matcher?.class).map((item) => item.name.toLowerCase()));
const carrierNames = new Set(CATEGORY_REFERENCE.uniqueBases.map((entry) => entry.name.toLowerCase()));
const missingItems = [...listedNames].filter((name) => !catalogNames.has(name));
const extraItems = [...selectableNames].filter((name) => !listedNames.has(name) && !carrierNames.has(name));
const listedUniques = new Set(CATEGORY_REFERENCE.uniques.map((entry) => entry.name));
const catalogUniques = new Set(Object.values(dropMetadata.uniques ?? {}).flatMap((variants) => Object.keys(variants)));
const missingUniques = [...listedUniques].filter((name) => !catalogUniques.has(name));
const extraUniques = [...catalogUniques].filter((name) => !listedUniques.has(name));
for (const name of missingItems) console.error("FAIL: 物品列表里有、目录里没有的物品：" + name);
for (const name of extraItems) console.error("FAIL: 目录里有、物品列表里没有的物品：" + name);
for (const name of missingUniques) console.error("FAIL: 物品列表里有、目录里没有的传奇：" + name);
for (const name of extraUniques) console.error("FAIL: 目录里有、物品列表里没有的传奇：" + name);
const listedDiffers = missingItems.length + extraItems.length + missingUniques.length + extraUniques.length;
if (listedDiffers) {
  problems.push("catalog: " + listedDiffers + " entries differ from the item list (see FAIL lines above)，运行 npm run catalog:update -- --client <客户端版本目录> --apply");
}
// 分类树里的每个叶子在选择器里都有条目。
const pickerPaths = await catalogPickerPaths(catalog);
const emptyLeaves = CATEGORY_NODES.filter((entry) => entry.leaf).map((entry) => entry.path).filter((path) => !pickerPaths.has(path));
if (emptyLeaves.length) problems.push("category tree: leaves without items in the picker: " + emptyLeaves.join(", "));
// 每件装备基底都要有会不会以普通、魔法或稀有掉落的记录，选择器据此决定给不给它普通基底。
const unrecorded = (catalog.items || [])
  .filter((item) => item.matcher?.baseType && !item.matcher.class && EQUIPMENT_CLASSES.has(itemClasses[item.name]?.itemClass) && typeof dropEnabled[item.name] !== "boolean")
  .map((item) => item.name);
if (unrecorded.length) {
  for (const name of unrecorded.slice(0, 10)) console.warn("WARN: 装备基底没有掉落记录，请运行 node scripts/sync-client-items.mjs <客户端版本目录>：" + name);
  problems.push(unrecorded.length + " equipment bases have no drop record (see WARN above)");
}
try {
  await validateCatalogShareData(catalog);
} catch (error) {
  problems.push("share catalog: " + error.message + "。更新槽位及分类路径序号请运行 node scripts/sync-share-addresses.mjs");
}

const defaultRules = JSON.parse(fs.readFileSync(path.join(root, "data", "default-rules.json"), "utf8")).rules || [];
if (defaultRules.length !== 4) problems.push("default rules: expected 4 price tiers, found " + defaultRules.length);
// 价格档就是普通价格区间，从低到高每档「≥ 1 枚本档通货，且 < 1 枚下一档通货」，最高档不封顶。
const tiers = [["default-exalted", "exalted"], ["default-chaos", "chaos"], ["default-annulment", "annulment"], ["default-divine", "divine"]];
const ruleIds = new Set();
defaultRules.forEach((rule, index) => {
  if (!rule.id || ruleIds.has(rule.id)) problems.push("default rules: duplicate id " + rule.id);
  ruleIds.add(rule.id);
  if (!rule.name || typeof rule.enabled !== "boolean" || typeof rule.hidden !== "boolean") problems.push("default rules: incomplete " + rule.id);
  if (!Array.isArray(rule.target?.itemIds) || rule.target.itemIds.length !== 0) problems.push("default rules: price tier must not select items " + rule.id);
  if (rule.autoRange !== undefined) problems.push("default rules: price tiers are ordinary ranges, no autoRange " + rule.id);
  const [expectedId, unit] = tiers[index] ?? [];
  const next = tiers[index + 1];
  if (rule.id !== expectedId) problems.push("default rules: expected " + expectedId + " at position " + index + ", found " + rule.id);
  const wrong = (point, currency) => !point || point.amount !== 1 || point.currency !== currency;
  const max = rule.target?.range?.max;
  if (wrong(rule.target?.range?.min, unit)) problems.push("default rules: lower bound of " + rule.id + " must be 1 " + unit + ", found " + JSON.stringify(rule.target?.range?.min));
  if (next ? wrong(max, next[1]) : max !== undefined) problems.push("default rules: upper bound of " + rule.id + (next ? " must be 1 " + next[1] : " must be unset") + ", found " + JSON.stringify(max));
  // 读取方案时用规则最初的完整外观和预设 ID，认出还保持着这套外观的规则（lib/profile.ts）。
  if (!rule.effectPresetId || !rule.effects?.beam || !rule.effects?.icon || !rule.effects?.font) problems.push("default rules: incomplete appearance " + rule.id);
});

if (problems.length) {
  for (const problem of problems) console.error("FAIL: " + problem);
  process.exit(1);
}
console.log("data validation: ok (" + required.length + " baselines, " + catalog.items.length + " catalog items, " + defaultRules.length + " default rules)");

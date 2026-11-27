import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { categoryPathFor, classifiedRecord, UNIQUE_BASE_CLASSES } from "./lib/item-classes.mjs";
import { loadClient } from "./lib/client-data.mjs";
import { editDropMetadata, removeEntry, setEntry } from "./lib/drop-metadata.mjs";
import { CATEGORY_REFERENCE, ITEM_DETAILS } from "./lib/item-data.mjs";
import { BASE_CLASSES, namesInClasses } from "./sync-client-items.mjs";

/**
 * 按物品列表核对目录里的传奇、通货、材料、宝石和终局物品，并给没有图标的物品补图标。
 * 收哪些物品和传奇、传奇挂在哪件基底上、传奇的译名，都以 data/item-list.json 为准：列表里有的补上，没有的去掉。
 * 图标取自 data/item-details.json。
 *
 *   node scripts/sync-item-list.mjs <client-version-directory> [--apply]
 *
 * 不带 --apply 只报告差异。装备基底、药瓶和咒符的清单由 sync-client-items.mjs 按物品列表补全。
 * 新物品的分类由 lib/item-classes.mjs 的规则按客户端记录算出来。整个流程用 update-item-catalog.mjs 一次跑完。
 */

const LEVELED = /\(Level \d+\)$/;
const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const CATEGORY_BY_ROOT = { currency: "currency", essences: "essence", gems: "gem", endgame: "fragment" };
const categoryFor = (categoryPath) => {
  const [root, group, leaf] = categoryPath;
  if (root === "runes") return /soul-cores/.test(group) ? "soul-core" : "rune";
  if (root === "gameplay" && leaf === "fragments") return "fragment";
  if (categoryPath.join("/") === "endgame/waystones") return "map";
  return CATEGORY_BY_ROOT[root] ?? "base";
};
/** 换界石名字里的阶数；别的物品是 0。 */
const waystoneTier = (name) => Number(/^Waystone \(Tier (\d+)\)$/.exec(name)?.[1] ?? 0);

/**
 * 比对物品列表和目录，返回要做的改动：
 * - items：物品列表里要加的通货、材料、宝石和终局物品，和列表里没有、要从目录里去掉的物品；
 * - uniques：要加、要去、要换基底、要改译名的传奇；
 * - icons：能从物品详情里补上图标的物品和传奇（目录里还没有图标的）。
 */
export function buildItemPlan({ client, catalog, metadata, reference, details }) {
  const concrete = catalog.items.filter((item) => !item.matcher.class);
  const catalogByName = new Map(concrete.map((item) => [item.name.toLowerCase(), item]));
  const classEntryNames = new Set(catalog.items.filter((item) => item.matcher.class).map((item) => item.name.toLowerCase()));
  // 传奇挂得上基底的目录条目：客户端类别属于装备、药瓶、咒符和石板的那些。
  const uniqueBaseNames = new Set(namesInClasses(catalog, client, UNIQUE_BASE_CLASSES));

  const itemPlan = { add: [], remove: [] };
  for (const listed of reference.items) {
    // 装备基底、药瓶和咒符的清单由 sync-client-items.mjs 按物品列表补全。
    if (BASE_CLASSES.has(listed.itemClass)) continue;
    const entry = client.byName.get(listed.name) ?? client.byLowerName.get(listed.name.toLowerCase());
    if (!entry || catalogByName.has(entry.name.toLowerCase()) || classEntryNames.has(entry.name.toLowerCase())) continue;
    const record = classifiedRecord(entry);
    if (!record) continue;
    // 按等级拆分的物品共用一个不带等级的基底名，不单独收。
    if ([...catalogByName.keys()].some((other) => other.startsWith(entry.name.toLowerCase() + " (level "))) continue;
    itemPlan.add.push({ name: entry.name, categoryPath: categoryPathFor(record, entry.name), localeNames: entry.localeNames, icon: details.items[entry.name]?.icon });
  }
  // 新物品按分类排；换界石从高阶到低阶。
  itemPlan.add.sort((a, b) => a.categoryPath.join("/").localeCompare(b.categoryPath.join("/")) || waystoneTier(b.name) - waystoneTier(a.name));
  // 物品列表里没有的物品从目录里去掉。只给传奇挂基底的几件（列表里的 uniqueBases）留着。
  const kept = new Set([...reference.items, ...reference.uniqueBases].map((item) => item.name.toLowerCase()));
  const removed = new Set(concrete.filter((item) => !kept.has(item.name.toLowerCase())).map((item) => item.name));
  itemPlan.remove.push(...removed);

  // 一件传奇在物品列表里可以有几条记录，各写一个基底（例如三色珠宝上的 Grand Spectrum）。
  const listedUniques = new Map();
  for (const { name, base, cn, tw } of reference.uniques) {
    const listed = listedUniques.get(name) ?? { bases: [], cn, tw };
    if (!listed.bases.includes(base)) listed.bases.push(base);
    listedUniques.set(name, listed);
  }
  const catalogBaseOf = new Map(Object.entries(metadata.uniques).flatMap(([base, variants]) => Object.keys(variants).map((name) => [name, base])));
  const mine = metadata.localizedUniqueNames;
  const uniquePlan = { add: [], remove: [], move: [], rename: [], withoutBase: [] };
  const uniqueIcons = [];
  for (const [name, listed] of listedUniques) {
    const hanging = listed.bases.filter((base) => uniqueBaseNames.has(base));
    if (!hanging.length) {
      uniquePlan.withoutBase.push(name);
      continue;
    }
    // 目录里挂的基底只要还在物品列表写的这几个里就不动。
    const base = hanging.includes(catalogBaseOf.get(name)) ? catalogBaseOf.get(name) : hanging[0];
    const icon = details.uniques[name]?.icon ?? null;
    // 译名是物品列表里的传奇名。
    const localized = { cn: listed.cn ?? mine[name]?.cn, tw: listed.tw ?? mine[name]?.tw };
    if (!catalogBaseOf.has(name)) uniquePlan.add.push({ name, base, ...localized, icon });
    else {
      if (catalogBaseOf.get(name) !== base) uniquePlan.move.push({ name, from: catalogBaseOf.get(name), base });
      if (icon && !metadata.uniques[catalogBaseOf.get(name)]?.[name]) uniqueIcons.push({ name, base, icon });
    }
    if (localized.cn && localized.tw && (mine[name]?.cn !== localized.cn || mine[name]?.tw !== localized.tw)) uniquePlan.rename.push({ name, ...localized });
  }
  for (const [name, base] of catalogBaseOf) {
    if (!listedUniques.has(name)) uniquePlan.remove.push({ name, base });
  }

  const icons = { fill: [] };
  for (const item of concrete) {
    if (removed.has(item.name) || LEVELED.test(item.name) || metadata.items[item.name]?.icon) continue;
    const icon = details.items[item.name]?.icon;
    if (icon) icons.fill.push({ name: item.name, icon });
  }
  return { uniques: uniquePlan, uniqueIcons, items: itemPlan, icons };
}

/** 把比对结果里的报告写成人读的行。 */
export function describePlan(plan) {
  const lines = [];
  const section = (title, rows) => {
    lines.push(title + "：" + rows.length);
    for (const row of rows) lines.push("  - " + row);
  };
  section("新增传奇", plan.uniques.add.map((unique) => unique.name + "（" + unique.base + "）"));
  section("换基底的传奇", plan.uniques.move.map((unique) => unique.name + "：" + unique.from + " → " + unique.base));
  section("改译名的传奇", plan.uniques.rename.map((unique) => unique.name + "：" + unique.cn + " / " + unique.tw));
  section("去掉的传奇", plan.uniques.remove.map((unique) => unique.name + "（" + unique.base + "）"));
  lines.push("基底不在目录里的传奇：" + plan.uniques.withoutBase.length + " 件");
  section("新增物品", plan.items.add.map((item) => item.name + " → " + item.categoryPath.join("/")));
  section("去掉的物品", plan.items.remove);
  section("补图标", [...plan.icons.fill.map((icon) => icon.name), ...plan.uniqueIcons.map((icon) => icon.name)]);
  return lines;
}

/**
 * 把比对结果写进目录，返回一个交给 editDropMetadata 改写数据文件的函数。
 * 传奇的图标在物品详情里没有时记为 null，选择器退回用基底自己的图标。
 */
export function applyItemPlan(plan, catalog) {
  const removed = new Set(plan.items.remove);
  catalog.items = catalog.items.filter((item) => !removed.has(item.name));
  for (const item of plan.items.add) {
    // 换界石每个阶数是一件独立物品，靠 WaystoneTier 区分，没有行情。
    const tier = item.categoryPath.join("/") === "endgame/waystones" ? waystoneTier(item.name) : 0;
    catalog.items.push({
      id: slugOf(item.name),
      name: item.name,
      localeNames: item.localeNames,
      category: categoryFor(item.categoryPath),
      baseType: tier ? undefined : item.name,
      marketKey: item.name,
      known: true,
      priceable: !tier,
      matcher: tier ? { waystoneTier: tier } : { baseType: item.name },
      ambiguous: false,
      categoryPath: item.categoryPath,
    });
  }

  return (sections) => {
    for (const item of plan.items.add) if (item.icon) setEntry(sections.items, item.name, { icon: item.icon });
    // items 段只留目录里物品的记录：按等级拆分的物品，带等级的全名和不带等级的名字都算。
    const recorded = new Set(catalog.items.filter((item) => !item.matcher.class).flatMap((item) => [item.name, item.name.replace(/ \(Level \d+\)$/, "")]));
    for (const entry of [...sections.items]) if (!recorded.has(entry.name)) removeEntry(sections.items, entry.name);
    for (const { name, icon } of plan.icons.fill) {
      const { dropLevel, ...rest } = sections.items.find((entry) => entry.name === name)?.value ?? {};
      setEntry(sections.items, name, dropLevel === undefined ? { ...rest, icon } : { dropLevel, ...rest, icon });
    }
    const baseEntry = (base) => {
      if (!sections.uniques.some((entry) => entry.name === base)) setEntry(sections.uniques, base, {});
      return sections.uniques.find((entry) => entry.name === base);
    };
    const detach = (base, name) => {
      const entry = sections.uniques.find((item) => item.name === base);
      if (!entry) return undefined;
      const { [name]: icon, ...rest } = entry.value;
      if (Object.keys(rest).length) entry.value = rest;
      else removeEntry(sections.uniques, base);
      return icon;
    };
    for (const unique of plan.uniques.add) baseEntry(unique.base).value = { ...baseEntry(unique.base).value, [unique.name]: unique.icon };
    for (const { name, from, base } of plan.uniques.move) {
      const icon = detach(from, name);
      baseEntry(base).value = { ...baseEntry(base).value, [name]: icon ?? null };
    }
    for (const { name, base } of plan.uniques.remove) detach(base, name);
    for (const { name, base, icon } of plan.uniqueIcons) baseEntry(base).value = { ...baseEntry(base).value, [name]: icon };
    for (const unique of [...plan.uniques.add, ...plan.uniques.rename]) {
      if (unique.cn && unique.tw) setEntry(sections.localizedUniqueNames, unique.name, { cn: unique.cn, tw: unique.tw });
    }
    for (const { name } of plan.uniques.remove) removeEntry(sections.localizedUniqueNames, name);
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [clientRoot] = process.argv.slice(2);
  if (!clientRoot) throw new Error("Usage: node scripts/sync-item-list.mjs <client-version-directory> [--apply]");
  const client = loadClient(clientRoot);
  const catalogFile = path.resolve("data/item-catalog.json");
  const metadataFile = path.resolve("data/item-drop-metadata.json");
  const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
  const metadataText = fs.readFileSync(metadataFile, "utf8");
  const plan = buildItemPlan({ client, catalog, metadata: JSON.parse(metadataText), reference: CATEGORY_REFERENCE, details: ITEM_DETAILS });
  for (const line of describePlan(plan)) console.log(line);
  if (!process.argv.includes("--apply")) {
    console.log("\n只报告差异。加 --apply 写入，然后运行 node scripts/update-item-catalog.mjs 完成其余步骤。");
  } else {
    const { text } = editDropMetadata(metadataText, applyItemPlan(plan, catalog));
    fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + "\n");
    fs.writeFileSync(metadataFile, text);
    console.log("\n已写入。接着运行 node scripts/update-item-catalog.mjs 完成其余步骤。");
  }
}

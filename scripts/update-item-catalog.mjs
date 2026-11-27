import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { categorizeCatalog } from "./lib/item-classes.mjs";
import { loadClient } from "./lib/client-data.mjs";
import { writeCatalogWithShareData } from "./lib/catalog-data.mjs";
import { editDropMetadata } from "./lib/drop-metadata.mjs";
import { buildCategoryReference, formatCategoryReference } from "./lib/category-reference.mjs";
import { ITEM_DETAILS, ITEM_LIST } from "./lib/item-data.mjs";
import { applyItemPlan, buildItemPlan, describePlan } from "./sync-item-list.mjs";
import { syncCatalogItems, syncDropEnabled, syncDropLevels, syncItemClasses, syncStackable } from "./sync-client-items.mjs";

/**
 * 按输入数据刷新物品目录，一条命令跑完全程：
 *
 *   npm run catalog:update -- --client <客户端版本目录> [--apply]
 *
 * 读三份数据，都不联网：物品列表（data/item-list.json）、物品详情（data/item-details.json）和客户端表（poe2-data 仓库的版本目录）。
 * 物品目录就是物品列表：收哪些物品和传奇、传奇挂在哪件基底上、传奇的译名，都以它为准。客户端表提供其余物品的三语名字、
 * 物品类别编号和掉落等级，物品详情提供堆叠上限和图标。前两个文件由 poe2-filter-data skill 生成，怎么取见 docs/filter-generation.md。
 * 分类由 lib/item-classes.mjs 的规则按客户端记录算出来，分类树在 data/item-categories.json。
 * 默认只报告差异，加 --apply 才写入。步骤：
 *
 * 1. 由物品列表和客户端表生成参考数据（lib/category-reference.mjs），加 --apply 时写入 data/item-category-reference.json。
 * 2. 物品列表和客户端表：补全装备基底、药瓶和咒符，刷新三语名字（sync-client-items.mjs）。
 * 3. 物品列表：核对传奇、通货、材料、宝石和终局物品（sync-item-list.mjs）。
 * 4. 刷新掉落等级、物品类别编号、dropEnabled 和可堆叠名单，给每件物品定分类，同步分享码的槽位和分类序号。
 * 5. 运行 validate:data。
 */

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const flag = (name) => args.includes(name);
const clientRoot = option("--client");
if (!clientRoot) throw new Error("Usage: node scripts/update-item-catalog.mjs --client <client-version-directory> [--apply]");

const client = loadClient(clientRoot);
const reference = buildCategoryReference(client, ITEM_LIST);
const skippedMessages = {
  internal: "客户端里是内部记录、规则不定分类的物品（不进参考数据）",
  cutOnly: "只从没切割的辅助宝石里出来的普通辅助宝石（不进参考数据）",
};
for (const [reason, names] of Object.entries(reference.skipped)) if (names.length) console.log(skippedMessages[reason] + "：" + names.join(", "));
if (reference.unknownClasses.length) console.log("还没有登记类名的物品类别编号：" + reference.unknownClasses.join(", "));

const catalogFile = path.resolve("data/item-catalog.json");
const metadataFile = path.resolve("data/item-drop-metadata.json");
const referenceFile = path.resolve("data/item-category-reference.json");
const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
// 物品目录的版本说明跟着物品列表的版本走。
catalog.sourceVersion = reference.version + " 版本物品列表";
let metadataText = fs.readFileSync(metadataFile, "utf8");

// 物品列表里的基底，客户端表里的三语名字。
const bases = syncCatalogItems(catalog, client, reference);
console.log("物品列表里、目录里新增的装备基底：" + bases.added.length);
for (const name of bases.added) console.log("  - " + name);
console.log("三语名字换成客户端写法：" + bases.renamed + " 处");

// 物品列表：传奇、通货、材料、宝石和终局物品。
const plan = buildItemPlan({ client, catalog, metadata: JSON.parse(metadataText), reference, details: ITEM_DETAILS });
for (const line of describePlan(plan)) console.log(line);

if (!flag("--apply")) {
  console.log("\n只报告差异，没有写入。确认后加 --apply 运行。");
  process.exit(0);
}

const itemEdit = editDropMetadata(metadataText, applyItemPlan(plan, catalog));
const levels = syncDropLevels(itemEdit.text, catalog, client);
const classes = syncItemClasses(levels.text, catalog, client);
const drops = syncDropEnabled(classes.text, catalog, client, reference);
const stackable = syncStackable(drops.text, catalog);
console.log("掉落等级更新 " + levels.changed + " 条，物品类别编号更新 " + classes.changed + " 条，掉落记录更新 " + drops.changed + " 条，可堆叠名单新增 " + stackable.added + " 条、去掉 " + stackable.removed + " 条");

const unclassified = categorizeCatalog(catalog, client);
if (unclassified.length) console.warn("客户端表里没有、或者类别还没有登记分类，放在「其他物品」：" + unclassified.join(", "));
// 分享码的地址按选择器里的条目分配，条目要用掉落数据里的物品类别编号来分普通基底和传奇，所以先写掉落数据再写目录。
fs.writeFileSync(referenceFile, formatCategoryReference(reference));
fs.writeFileSync(metadataFile, stackable.text);
await writeCatalogWithShareData(catalogFile, catalog);

console.log("\n已写入。检查：");
const validation = spawnSync(process.execPath, [path.resolve("scripts/validate-data.mjs")], { stdio: "inherit" });
if (validation.status !== 0) throw new Error("validate:data 没有通过，先看上面的问题");
console.log("接下来运行 npm run build:engine、npm test，以及 cargo test。");

import fs from "node:fs";
import path from "node:path";
import { categorizeCatalog } from "./lib/item-classes.mjs";
import { loadClient } from "./lib/client-data.mjs";
import { writeCatalogWithShareData } from "./lib/catalog-data.mjs";

/**
 * 按客户端表给目录里的每件物品重新定分类，然后同步分享码的槽位和分类序号。
 * 物品增减、改名、传奇和图标由 update-item-catalog.mjs 负责，这里只管分类。
 *
 *   node scripts/build-catalog-groups.mjs <client-version-directory>
 */
const clientRoot = process.argv[2];
if (!clientRoot) throw new Error("Usage: node scripts/build-catalog-groups.mjs <client-version-directory>");
const client = loadClient(clientRoot);
const catalogFile = path.resolve("data/item-catalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
const unclassified = categorizeCatalog(catalog, client);
if (unclassified.length) console.warn("客户端表里没有、或者类别还没有登记分类，放在「其他物品」：" + unclassified.join(", "));
// 按最终的选择器树分配槽位与分类路径序号，避免给中间路径分配编号。
await writeCatalogWithShareData(catalogFile, catalog);
const paths = new Set(catalog.items.map((item) => item.categoryPath.join("/")));
console.log("已按客户端表给 " + catalog.items.length + " 件物品定分类（" + paths.size + " 个分类路径），并同步分享码槽位和分类序号");

import fs from "node:fs";
import path from "node:path";
import { writeCatalogWithShareData } from "./lib/catalog-data.mjs";

/**
 * 同步分享码的槽位和分类路径序号。手动改过 data/item-catalog.json 或 data/item-drop-metadata.json 之后运行。
 *
 *   node scripts/sync-share-addresses.mjs
 */
const catalogFile = path.resolve("data/item-catalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
await writeCatalogWithShareData(catalogFile, catalog);
console.log("已同步 " + Object.keys(catalog.shareGroups).length + " 个分享码分类及其路径序号");

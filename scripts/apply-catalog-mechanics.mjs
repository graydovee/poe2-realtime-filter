import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { writeCatalogWithShareData } from "./lib/catalog-data.mjs";
import { GROUPS, UNMANAGED_GROUPS, categoryPathFor } from "./lib/item-taxonomy.mjs";

/**
 * 把 data/item-mechanics.json 的玩法归属写回 data/item-catalog.json 的 categoryPath。
 * 纯离线脚本：可重复运行，结果确定。
 *
 *   node scripts/apply-catalog-mechanics.mjs
 *   node scripts/apply-catalog-mechanics.mjs --allow-unmapped   # 数据刚升级、还没跑抓取脚本时
 *   node scripts/apply-catalog-mechanics.mjs --share-only       # 手动改过目录或掉落数据后，只同步分享码槽位与分类路径序号
 */
export function applyCatalogMechanics(catalog, allowUnmapped = false) {
  const mechanics = JSON.parse(fs.readFileSync("data/item-mechanics.json", "utf8"));
  const mapping = mechanics.items ?? {};
  const executable = new Set(Object.keys(GROUPS));

  for (const [name, entry] of Object.entries(mapping)) {
    if (!executable.has(entry?.mechanic)) throw new Error("data/item-mechanics.json 里有未知玩法：" + name + " -> " + entry?.mechanic);
  }

  // Stackable Currency 只是「保持原始规则」的标记，不归属任何玩法。
  for (const item of catalog.items) {
    if (item.categoryPath[0] === "crafting" && item.categoryPath[item.categoryPath.length - 1] === "class-selection" && item.name === "Stackable Currency") {
      item.categoryPath = ["crafting", "class-selection"];
    }
  }
  // 预兆的整类条目留在预兆分类里：全选预兆时，生成器把它换成一条 Class 条件。
  const omenClass = catalog.items.find((item) => item.matcher?.class === "Omen");
  if (omenClass) omenClass.categoryPath = ["crafting", "omens", "class-selection"];

  const unmapped = [];
  const stale = new Set(Object.keys(mapping));
  let applied = 0;

  for (const item of catalog.items) {
    const entry = mapping[item.name];
    if (!entry) {
      const path = item.categoryPath ?? [];
      if (path[0] === "crafting" && path.length > 1 && !UNMANAGED_GROUPS.has(path[1]) && !item.matcher?.class) unmapped.push(item.name);
      continue;
    }
    stale.delete(item.name);
    item.categoryPath = categoryPathFor(entry.mechanic);
    applied += 1;
  }

  const summary = {};
  for (const item of catalog.items) {
    if (item.categoryPath[0] !== "crafting") continue;
    const key = item.categoryPath.slice(1).join("/");
    summary[key] = (summary[key] ?? 0) + 1;
  }
  console.log("已按玩法归类 " + applied + " 件物品");
  console.log("通货与材料分组：" + Object.entries(summary).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + " " + value).join(" / "));
  if (stale.size) console.error("映射里有 " + stale.size + " 条已不在 catalog：" + [...stale].slice(0, 20).join(", "));
  if (unmapped.length) {
    const message = "有 " + unmapped.length + " 件通货与材料物品缺少玩法归属，请先运行 node scripts/build-item-mechanics.mjs：" + unmapped.slice(0, 20).join(", ");
    if (allowUnmapped) console.warn(message);
    else throw new Error(message);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const catalogFile = path.resolve("data/item-catalog.json");
  const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
  if (!process.argv.includes("--share-only")) applyCatalogMechanics(catalog, process.argv.includes("--allow-unmapped"));
  await writeCatalogWithShareData(catalogFile, catalog);
  console.log("已同步 " + Object.keys(catalog.shareGroups).length + " 个分享码分类及其路径序号");
}

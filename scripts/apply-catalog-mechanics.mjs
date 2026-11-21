import fs from "node:fs";
import path from "node:path";

import { CLASSIFIED_GROUPS, MECHANICS, categoryPathFor } from "./lib/item-taxonomy.mjs";

/**
 * 把 data/item-mechanics.json 的玩法归属写回 data/item-catalog.json 的 categoryPath。
 * 纯离线脚本：可重复运行，结果确定。
 *
 *   node scripts/apply-catalog-mechanics.mjs
 *   node scripts/apply-catalog-mechanics.mjs --allow-unmapped   # 数据刚升级、还没跑抓取脚本时
 */

const catalogFile = path.resolve("data/item-catalog.json");
const mechanicsFile = path.resolve("data/item-mechanics.json");
const allowUnmapped = process.argv.includes("--allow-unmapped");

const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
const mechanics = JSON.parse(fs.readFileSync(mechanicsFile, "utf8"));
const mapping = mechanics.items ?? {};
const executable = new Set(Object.keys(MECHANICS));

for (const [name, entry] of Object.entries(mapping)) {
  if (!executable.has(entry?.mechanic)) throw new Error("data/item-mechanics.json 里有未知玩法：" + name + " -> " + entry?.mechanic);
}

// 整类匹配（Stackable Currency / Omen）只是「保持原始规则」的标记，不归属任何玩法。
for (const item of catalog.items) {
  if (item.categoryPath[0] === "crafting" && item.categoryPath[item.categoryPath.length - 1] === "class-selection") {
    item.categoryPath = ["crafting", "class-selection"];
  }
}

const unmapped = [];
const stale = new Set(Object.keys(mapping));
let applied = 0;

for (const item of catalog.items) {
  if (!CLASSIFIED_GROUPS.has(item.categoryPath.join("/")) && !stale.has(item.name)) continue;
  const entry = mapping[item.name];
  if (!entry) {
    unmapped.push(item.name);
    continue;
  }
  stale.delete(item.name);
  item.categoryPath = categoryPathFor(item, entry.mechanic);
  applied += 1;
}

// 只报告本模块负责的分组里漏掉的条目；其他分支（精华 / 符文等）不参与玩法归类。
const missingInGroups = unmapped.filter((name) => {
  const item = catalog.items.find((candidate) => candidate.name === name);
  return item && CLASSIFIED_GROUPS.has(item.categoryPath.join("/"));
});

fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + "\n");

const summary = {};
for (const item of catalog.items) {
  if (item.categoryPath[0] !== "crafting") continue;
  const key = item.categoryPath.slice(1).join("/");
  summary[key] = (summary[key] ?? 0) + 1;
}
console.log("已按玩法归类 " + applied + " 件物品");
console.log("通货与材料分组：" + Object.entries(summary).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + " " + value).join(" / "));
if (stale.size) console.error("映射里有 " + stale.size + " 条已不在 catalog：" + [...stale].slice(0, 20).join(", "));
if (missingInGroups.length) {
  const message = "有 " + missingInGroups.length + " 件通货与材料物品缺少玩法归属，请先运行 node scripts/build-item-mechanics.mjs：" + missingInGroups.slice(0, 20).join(", ");
  if (allowUnmapped) console.warn(message);
  else throw new Error(message);
}
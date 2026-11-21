import fs from "node:fs";
import path from "node:path";

import { CLASSIFIED_GROUPS, KINDS, MECHANICS, classifyItem } from "./lib/item-taxonomy.mjs";

/**
 * 从 poe2wiki 抓取通货与材料条目的分类、tags 与 drop_text，判定每件物品的来源玩法，
 * 写出 data/item-mechanics.json。只在升级 NeverSink / 客户端数据后运行：
 *
 *   node scripts/build-item-mechanics.mjs
 *   node scripts/apply-catalog-mechanics.mjs
 *
 * 生成结果离线生效，构建和测试都不需要网络。
 */

const API = "https://www.poe2wiki.net/api.php";
const OUTPUT = path.resolve("data/item-mechanics.json");
const BATCH = 40;
const USER_AGENT = "poe2-filter/0.3 (+https://git.graydove.cn/graydove/poe2-filter)";

/** 人工校正：少数条目 wiki 元数据与实际情况不符，或归属需要按玩法解释。 */
const OVERRIDES = {
  // 扎多谍报产出的强箱钥匙不是赛季玩法通货，放回基础通货。
  "Cryptic Key": { mechanic: "basic", reason: "扎多谍报强箱钥匙，不属于任何赛季玩法" },
  // wiki 上没有独立条目，但它是基础通货碎片。
  "Alchemy Shard": { mechanic: "basic", reason: "wiki 缺条目，按基础通货碎片处理" },
  // 掉落自欧罗什（探险巅峰首领），因此归入探险。
  "Shattered Triskelion": { mechanic: "expedition", reason: "掉落自探险巅峰首领欧罗什" },
};

const catalog = JSON.parse(fs.readFileSync("data/item-catalog.json", "utf8"));
const MECHANIC_KEYS = new Set(Object.keys(MECHANICS));

/** 目标集合：旧的单一通货分组，以及已经按玩法归类过的条目（重跑时保持一致）。 */
function isClassified(item) {
  const path = item.categoryPath ?? [];
  if (path[path.length - 1] === "class-selection") return false;
  return CLASSIFIED_GROUPS.has(path.join("/")) || (path[0] === "crafting" && MECHANIC_KEYS.has(path[1]));
}

const targets = catalog.items
  .filter(isClassified)
  .map((item) => item.name)
  .filter((name, index, names) => names.indexOf(name) === index)
  .sort();

if (!targets.length) throw new Error("catalog 中没有可分类的通货与材料条目");

async function fetchBatch(names) {
  const params = new URLSearchParams({
    action: "query",
    prop: "categories|revisions",
    cllimit: "max",
    rvslots: "main",
    rvprop: "content",
    format: "json",
    formatversion: "2",
    redirects: "1",
    titles: names.join("|"),
  });
  const response = await fetch(API + "?" + params, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error("poe2wiki 返回 " + response.status);
  return response.json();
}

function pick(text, key) {
  const match = new RegExp("\\|\\s*" + key + "\\s*=\\s*([^\\n|]*)").exec(text);
  return match ? match[1].trim() : "";
}

function readPage(page) {
  const text = page?.revisions?.[0]?.slots?.main?.content ?? "";
  return {
    tags: pick(text, "tags"),
    drop: pick(text, "drop_text"),
    categories: (page?.categories ?? []).map((category) => category.title.replace(/^Category:/, "")),
  };
}

const missing = [];
const items = {};

for (let offset = 0; offset < targets.length; offset += BATCH) {
  const names = targets.slice(offset, offset + BATCH);
  const payload = await fetchBatch(names);
  for (const page of payload?.query?.pages ?? []) {
    const text = page?.revisions?.[0]?.slots?.main?.content;
    if (!text) {
      missing.push(page.title);
      continue;
    }
    const override = OVERRIDES[page.title];
    items[page.title] = classifyItem({
      name: page.title,
      ...readPage(page),
      override: override?.mechanic,
      reason: override?.reason,
    });
  }
  process.stdout.write(".");
  if (offset + BATCH < targets.length) await new Promise((resolve) => setTimeout(resolve, 250));
}
process.stdout.write("\n");

// wiki 缺条目的物品：优先用人工校正，其次按名称规则兜底，并在输出里点名，避免静默归类。
for (const name of targets) {
  if (items[name]) continue;
  const override = OVERRIDES[name];
  items[name] = classifyItem({ name, override: override?.mechanic, reason: override?.reason });
  if (!missing.includes(name)) missing.push(name);
}

const counts = {};
const evidenceKinds = {};
for (const entry of Object.values(items)) {
  counts[entry.mechanic] = (counts[entry.mechanic] ?? 0) + 1;
  const family = entry.evidence.split(":")[0];
  evidenceKinds[family] = (evidenceKinds[family] ?? 0) + 1;
}

const byName = Object.fromEntries(Object.entries(items).sort(([a], [b]) => a.localeCompare(b)));
const payload = {
  version: 2,
  updatedAt: new Date().toISOString().slice(0, 10),
  generatedBy: "scripts/build-item-mechanics.mjs",
  sources: [
    "poe2wiki.net / Category：Abyss、Breach、Delirium、Expedition、Ritual、Fate of the Vaal 等显式分类",
    "poe2wiki.net：条目 tags 与 drop_text（分类缺失时兜底）",
    "poe.ninja PoE2 economy：Currency / Fragments / Abyss / Expedition / Delirium / Breach / Ritual / Verisium 分类交叉核对",
  ],
  mechanics: MECHANICS,
  kinds: KINDS,
  items: byName,
};

fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2) + "\n");
if (missing.length) {
  console.warn("wiki 无条目、按人工校正或名称规则归类：" + missing.join(", "));
}
console.log("已写入 " + path.relative(process.cwd(), OUTPUT) + "：" + Object.keys(items).length + " 条，" +
  Object.entries(counts).map(([key, value]) => key + " " + value).join(" / "));
console.log("判定依据：" + Object.entries(evidenceKinds).map(([key, value]) => key + " " + value).join(" / "));

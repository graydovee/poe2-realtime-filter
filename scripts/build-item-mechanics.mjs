import fs from "node:fs";
import path from "node:path";

import { CLASSIFIED_GROUPS, MECHANICS, KINDS, classifyMechanic } from "./lib/item-taxonomy.mjs";

/**
 * 从 poe2wiki 抓取通货与材料条目的 tags / drop_text，判定每件物品的来源玩法，
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

/** 人工校正：少数条目的 wiki 元数据不足以判定玩法，或归属有更合适的解释。 */
const OVERRIDES = {
  // 扎多谍报产出的强箱钥匙不是赛季玩法通货，放回基础通货。
  "Cryptic Key": "basic",
  // wiki 上没有独立条目，但它是基础通货碎片。
  "Alchemy Shard": "basic",
  // 掉落自欧罗什（探险巅峰首领），因此归入探险。
  "Shattered Triskelion": "expedition",
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
    prop: "revisions",
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

function readItem(text) {
  return { tags: pick(text, "tags"), drop: pick(text, "drop_text"), release: pick(text, "release_version") };
}

const missing = [];
const items = {};

for (let offset = 0; offset < targets.length; offset += BATCH) {
  const names = targets.slice(offset, offset + BATCH);
  const payload = await fetchBatch(names);
  const pages = payload?.query?.pages ?? [];
  for (const page of pages) {
    const text = page?.revisions?.[0]?.slots?.main?.content;
    if (!text) {
      missing.push(page.title);
      continue;
    }
    const wiki = readItem(text);
    items[page.title] = OVERRIDES[page.title] ?? classifyMechanic({ name: page.title, tags: wiki.tags, drop: wiki.drop });
  }
  process.stdout.write(".");
  if (offset + BATCH < targets.length) await new Promise((resolve) => setTimeout(resolve, 250));
}
process.stdout.write("\n");

// wiki 缺条目的物品：优先用人工校正，其次按名称规则兜底，并在输出里点名，避免静默归类。
for (const name of targets) {
  if (items[name]) continue;
  const mechanic = OVERRIDES[name] ?? classifyMechanic({ name });
  if (!MECHANICS[mechanic]) throw new Error("无法判定来源玩法：" + name);
  items[name] = mechanic;
  if (!missing.includes(name)) missing.push(name);
}

const counts = {};
for (const mechanic of Object.values(items)) counts[mechanic] = (counts[mechanic] ?? 0) + 1;

const payload = {
  version: 1,
  updatedAt: new Date().toISOString().slice(0, 10),
  generatedBy: "scripts/build-item-mechanics.mjs",
  sources: [
    "poe2wiki.net：条目 tags 与 drop_text 判定来源玩法",
    "poe.ninja PoE2 economy：Currency / Fragments / Abyss / Expedition / Delirium / Breach / Ritual / Verisium 分类交叉核对",
  ],
  mechanics: MECHANICS,
  kinds: KINDS,
  items: Object.fromEntries(Object.entries(items).sort(([a], [b]) => a.localeCompare(b))),
};

fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2) + "\n");
if (missing.length) {
  console.warn("wiki 无条目、按人工校正或名称规则归类：" + missing.join(", "));
}
console.log("已写入 " + path.relative(process.cwd(), OUTPUT) + "：" + Object.keys(items).length + " 条，" +
  Object.entries(counts).map(([key, value]) => key + " " + value).join(" / "));

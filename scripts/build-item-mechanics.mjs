import fs from "node:fs";
import path from "node:path";

import { GROUPS, GROUP_ORDER, NINJA_TABS, UNMANAGED_GROUPS, classifyItem } from "./lib/item-taxonomy.mjs";

/**
 * 按 poe.ninja 的 PoE2 经济标签页归类「通货与材料」，商店没收录的条目回落到 poe2wiki
 * 的分类 / tags / drop_text，写出 data/item-mechanics.json。只在升级 NeverSink、客户端数据
 * 或 poe.ninja 标签页调整后运行：
 *
 *   node scripts/build-item-mechanics.mjs
 *   node scripts/apply-catalog-mechanics.mjs
 *
 * 生成结果离线生效，构建和测试都不需要网络。
 */

const NINJA_INDEX = "https://poe.ninja/poe2/api/data/index-state";
const NINJA_OVERVIEW = "https://poe.ninja/poe2/api/economy/exchange/current/overview";
const WIKI_API = "https://www.poe2wiki.net/api.php";
const OUTPUT = path.resolve("data/item-mechanics.json");
const BATCH = 40;
const USER_AGENT = "poe2-filter/0.3 (+https://git.graydove.cn/graydove/poe2-filter)";

/** 人工校正：wiki / 商店元数据与实际情况不符，或归属需要按玩法解释。 */
const OVERRIDES = {
  // 扎多谍报产出的强箱钥匙属于通用通货，poe.ninja 也把它放在 Currency。
  "Cryptic Key": { mechanic: "currency", reason: "扎多谍报强箱钥匙，通用通货" },
  // wiki 没有独立条目，但它是基础通货碎片。
  "Alchemy Shard": { mechanic: "shards", reason: "wiki 缺条目，按通货碎片处理" },
};

const catalog = JSON.parse(fs.readFileSync("data/item-catalog.json", "utf8"));
const GROUP_KEYS = new Set(Object.keys(GROUPS));

function isClassified(item) {
  const path = item.categoryPath ?? [];
  if (path[0] !== "crafting" || path.length < 2) return false;
  return !UNMANAGED_GROUPS.has(path[1]);
}

const targets = catalog.items
  .filter(isClassified)
  .map((item) => item.name)
  .filter((name, index, names) => names.indexOf(name) === index)
  .sort();

if (!targets.length) throw new Error("catalog 中没有可分类的通货与材料条目");

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(url + " 返回 " + response.status);
  return response.json();
}

/** 选一个经济区拉标签页；分类归属与赛季无关，优先环境变量指定的赛季。 */
async function pickLeague() {
  if (process.env.POE2_CATEGORY_LEAGUE) return process.env.POE2_CATEGORY_LEAGUE;
  const index = await fetchJson(NINJA_INDEX);
  const leagues = (index?.economyLeagues ?? []).filter((league) => !league.isPrivate && !league.hardcore);
  const league = leagues[0] ?? (index?.economyLeagues ?? [])[0];
  if (!league?.name) throw new Error("poe.ninja 没有可用的经济区");
  return league.name;
}

async function readNinjaTabs(league) {
  const tabs = {};
  for (const type of Object.keys(NINJA_TABS)) {
    const url = NINJA_OVERVIEW + "?" + new URLSearchParams({ league, type });
    const payload = await fetchJson(url);
    const items = new Map([...(payload.items ?? []), ...(payload.core?.items ?? [])].map((item) => [item.id, item.name]));
    for (const line of payload.lines ?? []) {
      const name = items.get(line.id);
      if (name) tabs[name] = type;
    }
    process.stdout.write(".");
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return tabs;
}

function pick(text, key) {
  const match = new RegExp("\\|\\s*" + key + "\\s*=\\s*([^\\n|]*)").exec(text);
  return match ? match[1].trim() : "";
}

async function readWiki(names) {
  const pages = {};
  for (let offset = 0; offset < names.length; offset += BATCH) {
    const batch = names.slice(offset, offset + BATCH);
    const params = new URLSearchParams({
      action: "query",
      prop: "categories|revisions",
      cllimit: "max",
      rvslots: "main",
      rvprop: "content",
      format: "json",
      formatversion: "2",
      redirects: "1",
      titles: batch.join("|"),
    });
    const response = await fetch(WIKI_API + "?" + params, { headers: { "user-agent": USER_AGENT } });
    if (!response.ok) throw new Error("poe2wiki 返回 " + response.status);
    const payload = await response.json();
    for (const page of payload?.query?.pages ?? []) {
      const text = page?.revisions?.[0]?.slots?.main?.content ?? "";
      pages[page.title] = {
        tags: pick(text, "tags"),
        drop: pick(text, "drop_text"),
        categories: (page?.categories ?? []).map((category) => category.title.replace(/^Category:/, "")),
      };
    }
    process.stdout.write(".");
    if (offset + BATCH < names.length) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return pages;
}

const league = await pickLeague();
const ninjaTabs = await readNinjaTabs(league);
const wiki = await readWiki(targets);
process.stdout.write("\n");

const missing = [];
const items = {};
for (const name of targets) {
  const page = wiki[name];
  const override = OVERRIDES[name];
  if (!page) missing.push(name);
  items[name] = classifyItem({
    name,
    tags: page?.tags,
    drop: page?.drop,
    categories: page?.categories,
    ninjaTab: ninjaTabs[name],
    override: override?.mechanic,
    reason: override?.reason,
  });
  if (!GROUP_KEYS.has(items[name].mechanic)) throw new Error("未知分组：" + name + " -> " + items[name].mechanic);
}

const counts = {};
const evidenceFamilies = {};
for (const entry of Object.values(items)) {
  counts[entry.mechanic] = (counts[entry.mechanic] ?? 0) + 1;
  const family = entry.evidence.split(":")[0];
  evidenceFamilies[family] = (evidenceFamilies[family] ?? 0) + 1;
}
for (const key of Object.keys(GROUPS)) {
  if (!counts[key]) throw new Error("分组 " + key + " 没有任何物品，检查标签页口径");
}

const payload = {
  version: 3,
  updatedAt: new Date().toISOString().slice(0, 10),
  generatedBy: "scripts/build-item-mechanics.mjs",
  league,
  sources: [
    "poe.ninja PoE2 经济标签页：" + Object.keys(NINJA_TABS).join(" / ") + "（主口径）",
    "poe2wiki.net：Category（Abyss / Breach / Delirium / Expedition / Ritual / Fate of the Vaal）、tags、drop_text（商店未收录时兜底）",
    "神庙从 poe.ninja 的 Currency 中单独拆出：阿兹里神庙专属通货",
  ],
  order: GROUP_ORDER,
  groups: GROUPS,
  items: Object.fromEntries(Object.entries(items).sort(([a], [b]) => a.localeCompare(b))),
};

fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2) + "\n");
if (missing.length) console.warn("wiki 无条目，按 poe.ninja / 名称规则归类：" + missing.join(", "));
console.log("已写入 " + path.relative(process.cwd(), OUTPUT) + "（标签页取自 " + league + "）：" + Object.keys(items).length + " 条");
console.log("分组：" + Object.entries(counts).map(([key, value]) => key + " " + value).join(" / "));
console.log("依据：" + Object.entries(evidenceFamilies).map(([key, value]) => key + " " + value).join(" / "));
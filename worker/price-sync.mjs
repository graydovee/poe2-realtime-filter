import fs from "node:fs/promises";
import path from "node:path";

const dataDir = process.env.DATA_DIR || path.resolve("data/runtime");
const target = path.join(dataDir, "market-snapshot.json");
const interval = Number(process.env.MARKET_SYNC_INTERVAL_MS || 21600000);
const sourceUrl = process.env.MARKET_SNAPSHOT_URL;
const league = process.env.POE2_LEAGUE || "Standard";
const ninjaTypes = (process.env.MARKET_NINJA_TYPES || "Currency,Runes,SoulCores,Essences,Fragments,Unique,SkillGems,BaseTypes,Waystones").split(",").map((value) => value.trim()).filter(Boolean);
const exchangeEndpoint = "https://poe.ninja/poe2/api/economy/exchange/current/overview";
const statsEndpoint = "https://poe.ninja/poe2/api/economy/stats/overview";

async function readPrevious() {
  try { return JSON.parse(await fs.readFile(target, "utf8")); } catch { return null; }
}

async function readCatalog() {
  try {
    const payload = JSON.parse(await fs.readFile(path.resolve("data/item-catalog.json"), "utf8"));
    return (payload.items || []).filter((item) => item.marketKey && item.priceable);
  } catch {
    return [];
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "poe2-filter/0.2" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("market source returned " + response.status);
  return response.json();
}

function findName(item, line) {
  return item?.name || item?.detailsId || line?.name || line?.detailsId || line?.id;
}

function indexCatalog(catalog) {
  const byName = new Map();
  for (const item of catalog) {
    byName.set(String(item.marketKey).toLowerCase(), item);
    byName.set(String(item.name).toLowerCase(), item);
  }
  return byName;
}

function priceFromLine(itemId, line, source = "poe.ninja") {
  const amount = Number(line.chaosEquivalent ?? line.primaryValue);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return { itemId, amount, currency: "chaos", confidence: Number(line.listingCount || line.count || 1) > 10 ? 0.9 : 0.6, capturedAt: new Date().toISOString(), source };
}

async function fetchStats(catalog) {
  const payload = await fetchJson(statsEndpoint + "?league=" + encodeURIComponent(league) + "&type=Currency");
  const lines = payload.lines || [];
  const byName = new Map(lines.map((line) => [String(line.name || line.detailsId || "").toLowerCase(), line]));
  const divineChaos = Number(byName.get("divine orb")?.chaosEquivalent);
  const exaltedChaos = Number(byName.get("exalted orb")?.chaosEquivalent);
  if (!Number.isFinite(divineChaos) || divineChaos <= 0 || !Number.isFinite(exaltedChaos) || exaltedChaos <= 0) throw new Error("poe.ninja currency rates are incomplete");
  const prices = {};
  const catalogByName = indexCatalog(catalog);
  for (const line of lines) {
    const item = catalogByName.get(String(line.name || line.detailsId || "").toLowerCase());
    const price = item && priceFromLine(item.id, line);
    if (price) prices[item.id] = price;
  }
  return {
    prices,
    rates: { divineToChaos: divineChaos, divineToExalted: divineChaos / exaltedChaos, capturedAt: new Date().toISOString(), source: "poe.ninja currency stats" },
  };
}

async function fetchExchange(catalog) {
  const prices = {};
  const catalogByName = indexCatalog(catalog);
  for (const type of ninjaTypes) {
    try {
      const payload = await fetchJson(exchangeEndpoint + "?league=" + encodeURIComponent(league) + "&type=" + encodeURIComponent(type));
      const items = new Map((payload.items || []).map((item) => [item.id, item]));
      for (const line of payload.lines || []) {
        const item = items.get(line.id);
        const name = String(findName(item, line)).toLowerCase();
        const catalogItem = catalogByName.get(name) || catalog.find((candidate) => name.includes(String(candidate.marketKey).toLowerCase()));
        const price = catalogItem && priceFromLine(catalogItem.id, line);
        if (price) prices[catalogItem.id] = price;
      }
    } catch (error) {
      console.warn("[market] skipped poe.ninja type " + type + ": " + error.message);
    }
  }
  return prices;
}

async function fetchSource(previous) {
  if (sourceUrl) {
    const payload = await fetchJson(sourceUrl);
    if (!payload || typeof payload !== "object" || !payload.prices) throw new Error("custom market source has no prices object");
    return { ...payload, source: payload.source || "configured market adapter", capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + interval * 2).toISOString() };
  }
  const catalog = await readCatalog();
  let stats;
  try { stats = await fetchStats(catalog); } catch (error) { console.warn("[market] stats rates unavailable: " + error.message); }
  const exchangePrices = await fetchExchange(catalog);
  const prices = { ...(previous?.prices || {}), ...(stats?.prices || {}), ...exchangePrices };
  if (!stats?.rates) throw new Error("poe.ninja rates unavailable; keeping previous snapshot");
  return { league, capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + interval * 2).toISOString(), source: "poe.ninja PoE2 exchange", rates: stats.rates, prices };
}

async function syncOnce() {
  const previous = await readPrevious();
  try {
    const next = await fetchSource(previous);
    await fs.mkdir(dataDir, { recursive: true });
    const temp = target + ".tmp";
    await fs.writeFile(temp, JSON.stringify(next, null, 2) + "\n", "utf8");
    await fs.rename(temp, target);
    console.log("[market] saved " + next.source + " at " + next.capturedAt);
  } catch (error) {
    if (previous) console.warn("[market] keeping previous snapshot: " + error.message);
    else console.warn("[market] using NeverSink baseline until next retry: " + error.message);
  }
}

await syncOnce();
if (process.env.RUN_ONCE !== "1") setInterval(syncOnce, interval);

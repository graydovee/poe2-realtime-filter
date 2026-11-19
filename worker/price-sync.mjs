import fs from "node:fs/promises";
import path from "node:path";
import { NINJA_TYPES, parseExchange } from "./market-adapter.mjs";

const dataDir = process.env.DATA_DIR || path.resolve("data/runtime");
const target = path.join(dataDir, "market-snapshot.json");
const interval = Number(process.env.MARKET_SYNC_INTERVAL_MS || 21600000);
const league = process.env.POE2_LEAGUE || "Standard";
const endpoint = "https://poe.ninja/poe2/api/economy/exchange/current/overview";
const types = [...new Set(["Currency", ...(process.env.MARKET_NINJA_TYPES || NINJA_TYPES.join(",")).split(",").map((value) => value.trim()).filter(Boolean)])];

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "poe2-filter/0.2" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("market source returned " + response.status);
  return response.json();
}

async function fetchSnapshot() {
  if (process.env.MARKET_SNAPSHOT_URL) {
    const snapshot = await fetchJson(process.env.MARKET_SNAPSHOT_URL);
    if (!snapshot?.prices || !(snapshot?.rates?.divineToChaos > 0) || !(snapshot?.rates?.divineToExalted > 0)) throw new Error("Custom snapshot has no prices or rates");
    return snapshot;
  }
  const catalog = JSON.parse(await fs.readFile(path.resolve("data/item-catalog.json"), "utf8")).items;
  const capturedAt = new Date().toISOString();
  const currency = parseExchange(await fetchJson(endpoint + "?league=" + encodeURIComponent(league) + "&type=Currency"), catalog, capturedAt);
  if (!currency.rates) throw new Error("Missing poe.ninja exchange rates");
  const prices = { ...currency.prices };
  for (const type of types.filter((type) => type !== "Currency")) {
    try {
      const parsed = parseExchange(await fetchJson(endpoint + "?league=" + encodeURIComponent(league) + "&type=" + encodeURIComponent(type)), catalog, capturedAt);
      Object.assign(prices, parsed.prices);
    } catch (error) { console.warn("[market] skipped " + type + ": " + error.message); }
  }
  // Never renew stale item prices by merging them into a fresh snapshot.
  return { league, capturedAt, expiresAt: new Date(Date.now() + interval * 2).toISOString(), source: "poe.ninja PoE2 exchange", rates: currency.rates, prices };
}

async function syncOnce() {
  try {
    const snapshot = await fetchSnapshot();
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(target + ".tmp", JSON.stringify(snapshot, null, 2) + "\n", "utf8");
    await fs.rename(target + ".tmp", target);
    console.log("[market] saved " + Object.keys(snapshot.prices).length + " prices at " + snapshot.capturedAt);
  } catch (error) { console.warn("[market] keeping previous snapshot: " + error.message); }
}
await syncOnce();
if (process.env.RUN_ONCE !== "1") setInterval(syncOnce, interval);

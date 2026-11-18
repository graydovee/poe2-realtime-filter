import fs from "node:fs/promises";
import path from "node:path";

const dataDir = process.env.DATA_DIR || path.resolve("data/runtime");
const target = path.join(dataDir, "market-snapshot.json");
const interval = Number(process.env.MARKET_SYNC_INTERVAL_MS || 21600000);
const sourceUrl = process.env.MARKET_SNAPSHOT_URL;
const league = process.env.POE2_LEAGUE || "Standard";
const ninjaTypes = (process.env.MARKET_NINJA_TYPES || "Currency,Runes,SoulCores,Essences,Fragments").split(",").map((value) => value.trim()).filter(Boolean);
const ninjaEndpoint = "https://poe.ninja/poe2/api/economy/exchange/current/overview";

const ids = { "Divine Orb": "divine-orb", "Exalted Orb": "exalted-orb", "Mirror of Kalandra": "mirror-of-kalandra", "Perfect Jeweller's Orb": "perfect-jeweller-orb", Temporalis: "temporalis", Headhunter: "headhunter", "Greater Essence of the Body": "greater-essence-of-the-body", "Greater Rune of the Archer": "greater-rune-of-the-archer", "Soul Core of Azcapa": "soul-core-of-azcapa" };

const aliases = {
  "Divine Orb": ["Divine Orb"],
  "Exalted Orb": ["Exalted Orb"],
  "Mirror of Kalandra": ["Mirror of Kalandra"],
  "Perfect Jeweller's Orb": ["Perfect Jeweller's Orb"],
  "Temporalis": ["Temporalis"],
  Headhunter: ["Headhunter"],
  "Greater Essence of the Body": ["Greater Essence of the Body"],
  "Greater Rune of the Archer": ["Greater Rune of the Archer"],
  "Soul Core of Azcapa": ["Soul Core of Azcapa"],
};

async function readPrevious() {
  try { return JSON.parse(await fs.readFile(target, "utf8")); } catch { return null; }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "poe2-filter/0.1" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`market source returned ${response.status}`);
  return response.json();
}

async function fetchNinja() {
  const prices = {};
  let found = 0;
  for (const type of ninjaTypes) {
    const payload = await fetchJson(`${ninjaEndpoint}?league=${encodeURIComponent(league)}&type=${encodeURIComponent(type)}`);
    const items = new Map((payload.items || []).map((item) => [item.id, item]));
    for (const line of payload.lines || []) {
      const item = items.get(line.id);
      const name = item?.name || item?.detailsId || line.id;
      const matching = Object.entries(aliases).find(([, names]) => names.some((candidate) => candidate.toLowerCase() === String(name).toLowerCase() || String(item?.detailsId || "").toLowerCase().includes(candidate.toLowerCase())));
      if (!matching || !Number.isFinite(Number(line.primaryValue))) continue;
      const [marketKey, names] = matching;
      prices[ids[marketKey]] = { itemId: ids[marketKey], amount: Number(line.primaryValue), currency: "divine", confidence: Number(line.listingCount || 1) > 10 ? 0.9 : 0.6, capturedAt: new Date().toISOString(), source: "poe.ninja" };
      found += 1;
    }
  }
  if (!found) throw new Error("poe.ninja returned no catalog matches");
  return prices;
}

async function fetchSource(previous) {
  if (sourceUrl) {
    const payload = await fetchJson(sourceUrl);
    if (!payload || typeof payload !== "object" || !payload.prices) throw new Error("custom market source has no prices object");
    return { ...payload, source: payload.source || "configured market adapter", capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + interval * 2).toISOString() };
  }
  const prices = await fetchNinja();
  return { league, capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + interval * 2).toISOString(), source: "poe.ninja PoE2 exchange", prices: { ...(previous?.prices || {}), ...prices } };
}

async function syncOnce() {
  const previous = await readPrevious();
  try {
    const next = await fetchSource(previous);
    await fs.mkdir(dataDir, { recursive: true });
    const temp = `${target}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await fs.rename(temp, target);
    console.log(`[market] saved ${next.source} at ${next.capturedAt}`);
  } catch (error) {
    if (previous) console.warn(`[market] keeping previous snapshot: ${error.message}`);
    else console.warn(`[market] using in-process NeverSink fallback until next retry: ${error.message}`);
  }
}

await syncOnce();
if (process.env.RUN_ONCE !== "1") setInterval(syncOnce, interval);

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { NINJA_TYPES, parseExchange } from "./market-adapter.mjs";

const pending = new Map();
const retryAfter = new Map();
const DEFAULT_INTERVAL = 21600000;
const FALLBACK_SOURCE = "NeverSink baseline fallback";
const dataDirectory = (options) => options.dataDir || process.env.DATA_DIR || path.resolve("data/runtime");
const validTime = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

export function normalizeLeague(league) {
  if (typeof league !== "string" || !league.trim() || league.trim().length > 120 || /[\u0000-\u001f]/.test(league)) throw new Error("无效赛季");
  return league.trim();
}
export function leagueSnapshotPath(league, options = {}) {
  const key = crypto.createHash("sha256").update(normalizeLeague(league)).digest("hex");
  return path.join(dataDirectory(options), "markets", key + ".json");
}
export function emptySnapshot(league) {
  return { league, capturedAt: "1970-01-01T00:00:00.000Z", expiresAt: "1970-01-01T00:00:00.000Z", source: FALLBACK_SOURCE, prices: {} };
}
async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "poe2-filter/0.3" }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("market source returned " + response.status);
  return response.json();
}
async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return undefined; }
}
async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + "." + process.pid + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
  try { await fs.writeFile(temporary, JSON.stringify(data, null, 2) + "\n", "utf8"); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}
function validLeagueList(value) {
  return Array.isArray(value?.leagues) && value.leagues.length > 0 && value.leagues.every((league) => typeof league.id === "string" && league.id && typeof league.label === "string");
}
export function leaguesFromSources(ninja, official) {
  const economy = (ninja?.economyLeagues || []).filter((league) => typeof league.name === "string" && !league.isPrivate);
  const officialLeagues = (official?.result || []).filter((league) => league.realm === "poe2" && typeof league.id === "string");
  const candidates = officialLeagues.length ? officialLeagues.map((league) => ({ id: league.id, label: league.text || league.id, hardcore: league.id.startsWith("HC ") || league.id === "Hardcore" })).filter((league) => !economy.length || economy.some((entry) => entry.name === league.id)) : economy.map((league) => ({ id: league.name, label: league.displayName || league.name, hardcore: Boolean(league.hardcore) }));
  return [...new Map(candidates.map((league) => [league.id, { ...league, permanent: ["Standard", "Hardcore"].includes(league.id) }])).values()];
}
export async function getLeagueCatalog(options = {}) {
  const file = path.join(dataDirectory(options), "leagues.json");
  const previous = await readJson(file);
  if (validLeagueList(previous) && Date.parse(previous.expiresAt) > Date.now()) return previous;
  const key = "leagues:" + file;
  if (pending.has(key)) return pending.get(key);
  const promise = (async () => {
    const fetcher = options.fetcher || fetchJson;
    const results = await Promise.allSettled([fetcher("https://poe.ninja/poe2/api/data/index-state"), fetcher("https://www.pathofexile.com/api/trade2/data/leagues")]);
    const leagues = leaguesFromSources(results[0].status === "fulfilled" ? results[0].value : undefined, results[1].status === "fulfilled" ? results[1].value : undefined);
    if (leagues.length) {
      const configured = options.defaultLeague || process.env.POE2_LEAGUE || "Standard";
      const catalog = { leagues, defaultLeague: leagues.some((league) => league.id === configured) ? configured : leagues.find((league) => !league.hardcore)?.id || leagues[0].id, capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() };
      await writeJson(file, catalog);
      return catalog;
    }
    if (validLeagueList(previous)) return previous;
    return { leagues: [{ id: "Standard", label: "Standard", hardcore: false, permanent: true }], defaultLeague: "Standard", capturedAt: "1970-01-01T00:00:00.000Z", expiresAt: "1970-01-01T00:00:00.000Z" };
  })();
  pending.set(key, promise);
  try { return await promise; } finally { pending.delete(key); }
}

export function validSnapshot(snapshot, league) {
  if (snapshot?.league !== league || !validTime(snapshot.capturedAt) || !validTime(snapshot.expiresAt) || Date.parse(snapshot.expiresAt) <= Date.now()) return false;
  if (!Number.isFinite(snapshot.rates?.divineToChaos) || snapshot.rates.divineToChaos <= 0 || !Number.isFinite(snapshot.rates?.divineToExalted) || snapshot.rates.divineToExalted <= 0) return false;
  return snapshot.prices && typeof snapshot.prices === "object" && !Array.isArray(snapshot.prices) && Object.values(snapshot.prices).every((price) => Number.isFinite(price?.amount) && price.amount >= 0 && ["divine", "chaos", "exalted"].includes(price.currency));
}
export async function readLeagueSnapshot(league, options = {}) {
  league = normalizeLeague(league);
  const snapshot = await readJson(leagueSnapshotPath(league, options));
  if (validSnapshot(snapshot, league)) return snapshot;
  // The old single-file cache is only eligible for the exact same league.
  const legacy = await readJson(path.join(dataDirectory(options), "market-snapshot.json"));
  return validSnapshot(legacy, league) ? legacy : emptySnapshot(league);
}
async function fetchLeagueSnapshot(league, options) {
  const fetcher = options.fetcher || fetchJson;
  const sourceUrl = options.sourceUrl ?? process.env.MARKET_SNAPSHOT_URL;
  if (sourceUrl) {
    const url = new URL(sourceUrl); url.searchParams.set("league", league);
    const snapshot = await fetcher(url.toString());
    if (!validSnapshot(snapshot, league)) throw new Error("Custom snapshot does not match selected league or is invalid");
    return snapshot;
  }
  const catalog = options.catalog || JSON.parse(await fs.readFile(path.resolve("data/item-catalog.json"), "utf8")).items;
  const endpoint = "https://poe.ninja/poe2/api/economy/exchange/current/overview";
  const urlFor = (type) => endpoint + "?" + new URLSearchParams({ league, type });
  const capturedAt = new Date().toISOString();
  const currency = parseExchange(await fetcher(urlFor("Currency")), catalog, capturedAt);
  if (!currency.rates) throw new Error("Missing exchange rates for selected league");
  const prices = { ...currency.prices };
  const configured = options.types || (process.env.MARKET_NINJA_TYPES ? process.env.MARKET_NINJA_TYPES.split(",").map((type) => type.trim()).filter(Boolean) : NINJA_TYPES);
  const types = [...new Set(configured)].filter((type) => type !== "Currency");
  for (let offset = 0; offset < types.length; offset += 3) {
    const batch = await Promise.allSettled(types.slice(offset, offset + 3).map(async (type) => parseExchange(await fetcher(urlFor(type)), catalog, capturedAt)));
    for (const result of batch) if (result.status === "fulfilled") Object.assign(prices, result.value.prices);
  }
  const interval = options.intervalMs || Number(process.env.MARKET_SYNC_INTERVAL_MS || DEFAULT_INTERVAL);
  return { league, capturedAt, expiresAt: new Date(Date.now() + interval * 2).toISOString(), source: "poe.ninja PoE2 exchange", rates: currency.rates, prices };
}

export async function getMarketSnapshot(selectedLeague, options = {}) {
  const league = normalizeLeague(selectedLeague);
  const leagues = await getLeagueCatalog(options);
  if (!leagues.leagues.some((entry) => entry.id === league)) throw new Error("不支持的赛季：" + league);
  const previous = await readLeagueSnapshot(league, options);
  if (!options.force && validSnapshot(previous, league)) return previous;
  const file = leagueSnapshotPath(league, options);
  if (!options.force && (retryAfter.get(file) || 0) > Date.now()) return previous;
  if (pending.has(file)) return pending.get(file);
  const promise = (async () => {
    try {
      const snapshot = await fetchLeagueSnapshot(league, options);
      if (!validSnapshot(snapshot, league)) throw new Error("Invalid league snapshot");
      await writeJson(file, snapshot);
      retryAfter.delete(file);
      return snapshot;
    } catch (error) {
      retryAfter.set(file, Date.now() + 60000);
      console.warn("[market] " + league + ": keeping matching cache (" + error.message + ")");
      return validSnapshot(previous, league) ? previous : emptySnapshot(league);
    }
  })();
  pending.set(file, promise);
  try { return await promise; } finally { pending.delete(file); }
}

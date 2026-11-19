import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { getLeagueCatalog, getMarketSnapshot, readLeagueSnapshot, leagueSnapshotPath, leaguesFromSources, validSnapshot } from "../worker/market-service.mjs";
const catalog = JSON.parse(readFileSync("data/item-catalog.json", "utf8")).items;
const directories = [];
test.after(async () => { for (const directory of directories) await fs.rm(directory, { recursive: true, force: true }); });
const leagueIds = ["Season A", "Season B", "Standard"];
const quote = { "Season A": { exalted: 100, chaos: 10, annul: .1 }, "Season B": { exalted: 2000, chaos: 20, annul: .2 }, Standard: { exalted: 50, chaos: 5, annul: .05 } };
function payload(league) {
  const rates = quote[league];
  return { core: { primary: "divine", rates: { exalted: rates.exalted, chaos: rates.chaos } }, items: [{ id: "annul", name: "Orb of Annulment" }], lines: [{ id: "annul", primaryValue: rates.annul }] };
}
async function fixture() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "poe2-leagues-")); directories.push(dataDir);
  const calls = [];
  const fetcher = async (value) => {
    const url = new URL(value); calls.push(url);
    if (url.pathname.endsWith("index-state")) return { economyLeagues: leagueIds.map((name) => ({ name, displayName: name, isPrivate: false })) };
    if (url.pathname.endsWith("/leagues")) return { result: leagueIds.map((id) => ({ id, text: id, realm: "poe2" })) };
    const league = url.searchParams.get("league");
    assert.ok(leagueIds.includes(league));
    return payload(league);
  };
  return { options: { dataDir, catalog, fetcher, types: ["Currency"] }, calls };
}

test("league options include public PoE2 economies and exclude private/SSF leagues", () => {
  const result = leaguesFromSources({ economyLeagues: [{ name: "Season A" }, { name: "Private", isPrivate: true }, { name: "Standard" }] }, { result: [{ id: "Season A", realm: "poe2" }, { id: "SSF Season A", realm: "poe2" }, { id: "Season A", realm: "poe1" }, { id: "Private", realm: "poe2" }, { id: "Standard", realm: "poe2" }] });
  assert.deepEqual(result.map((league) => league.id), ["Season A", "Standard"]);
  assert.equal(result[1].permanent, true);
});

test("prices, rates and on-disk caches are isolated by league", async () => {
  const { options, calls } = await fixture();
  const leagues = await getLeagueCatalog(options);
  assert.equal(leagues.defaultLeague, "Standard");
  const a = await getMarketSnapshot("Season A", options);
  const b = await getMarketSnapshot("Season B", options);
  assert.equal(a.league, "Season A"); assert.equal(b.league, "Season B");
  assert.equal(a.rates.divineToExalted, 100); assert.equal(b.rates.divineToExalted, 2000);
  assert.equal(a.prices["orb-of-annulment"].amount, .1); assert.equal(b.prices["orb-of-annulment"].amount, .2);
  assert.notEqual(leagueSnapshotPath("Season A", options), leagueSnapshotPath("Season B", options));
  assert.equal(JSON.parse(await fs.readFile(leagueSnapshotPath("Season A", options))).league, "Season A");
  const requests = calls.length;
  assert.deepEqual(await getMarketSnapshot("Season A", options), a);
  assert.equal(calls.length, requests);
});

test("failed or expired league fetches never fall back to another league", async () => {
  const { options } = await fixture();
  const standard = await getMarketSnapshot("Standard", options);
  await fs.writeFile(path.join(options.dataDir, "market-snapshot.json"), JSON.stringify(standard));
  const broken = { ...options, fetcher: async () => { throw new Error("offline"); } };
  const unavailable = await getMarketSnapshot("Season A", broken);
  assert.equal(unavailable.league, "Season A"); assert.deepEqual(unavailable.prices, {}); assert.equal(unavailable.rates, undefined);
  const b = await getMarketSnapshot("Season B", options);
  const preserved = await getMarketSnapshot("Season B", { ...broken, force: true });
  assert.deepEqual(preserved, b);
  await fs.writeFile(leagueSnapshotPath("Season B", options), JSON.stringify({ ...b, expiresAt: "2000-01-01T00:00:00Z" }));
  const expired = await getMarketSnapshot("Season B", { ...broken, force: true });
  assert.equal(expired.league, "Season B"); assert.deepEqual(expired.prices, {});
  assert.deepEqual(await readLeagueSnapshot("Standard", options), standard);
});

test("concurrent requests for one league share the same upstream fetch", async () => {
  const { options, calls } = await fixture();
  const snapshots = await Promise.all([getMarketSnapshot("Season A", options), getMarketSnapshot("Season A", options), getMarketSnapshot("Season A", options)]);
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.equal(calls.filter((url) => url.searchParams.get("type") === "Currency").length, 1);
});

test("custom adapters must return the exact selected league", async () => {
  const { options } = await fixture();
  const b = await getMarketSnapshot("Season B", options);
  let requested;
  const wrong = await getMarketSnapshot("Season A", { ...options, sourceUrl: "https://adapter.test/snapshot", fetcher: async (url) => { requested = new URL(url).searchParams.get("league"); return b; } });
  assert.equal(requested, "Season A");
  assert.equal(wrong.league, "Season A"); assert.deepEqual(wrong.prices, {});
  assert.equal(validSnapshot(b, "Season A"), false);
});

test("unknown league IDs are rejected and cannot choose filesystem paths", async () => {
  const { options } = await fixture();
  await assert.rejects(getMarketSnapshot("../Season A", options), /不支持的赛季/);
  assert.equal(path.dirname(leagueSnapshotPath("../../escape", options)), path.join(options.dataDir, "markets"));
  assert.equal((await fs.readdir(options.dataDir)).includes("escape"), false);
});

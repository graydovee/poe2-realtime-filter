import { getLeagueCatalog, getMarketSnapshot } from "./market-service.mjs";
const interval = Number(process.env.MARKET_SYNC_INTERVAL_MS || 21600000);
async function syncOnce() {
  const catalog = await getLeagueCatalog();
  for (const league of catalog.leagues) {
    const snapshot = await getMarketSnapshot(league.id, { force: true });
    console.log("[market] " + league.id + ": " + Object.keys(snapshot.prices).length + " prices @ " + snapshot.capturedAt);
  }
}
await syncOnce();
if (process.env.RUN_ONCE !== "1") {
  let syncing = false;
  setInterval(async () => { if (syncing) return; syncing = true; try { await syncOnce(); } finally { syncing = false; } }, interval);
}

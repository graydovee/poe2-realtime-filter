import { getMarketSnapshot, getLeagueCatalog, normalizeLeague } from "../worker/market-service.mjs";
export { toExalted, toDivines, formatPrice } from "./pricing";
export { getLeagueCatalog, normalizeLeague };

export async function loadMarketSnapshot(league = process.env.POE2_LEAGUE || "Standard") {
  return getMarketSnapshot(league);
}

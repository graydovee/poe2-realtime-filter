import fs from "node:fs/promises";
import path from "node:path";
import { FALLBACK_SNAPSHOT } from "./data";
import type { MarketSnapshot } from "./types";

const dataDir = () => process.env.DATA_DIR || path.join(process.cwd(), "data", "runtime");
const snapshotPath = () => path.join(dataDir(), "market-snapshot.json");

export async function loadMarketSnapshot(): Promise<MarketSnapshot> {
  try {
    const raw = await fs.readFile(snapshotPath(), "utf8");
    const parsed = JSON.parse(raw) as MarketSnapshot;
    if (!parsed.prices || Object.keys(parsed.prices).length === 0 || !parsed.expiresAt) return FALLBACK_SNAPSHOT;
    return parsed;
  } catch {
    return FALLBACK_SNAPSHOT;
  }
}

export async function saveMarketSnapshot(snapshot: MarketSnapshot): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  const temp = `${snapshotPath()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await fs.rename(temp, snapshotPath());
}

export async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  const now = new Date();
  const expires = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const previous = await loadMarketSnapshot();
  return {
    ...previous,
    league: process.env.POE2_LEAGUE || "Standard",
    capturedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    source: "snapshot adapter (poe.ninja/trade ready)",
  };
}

import fs from "node:fs/promises";
import path from "node:path";
import { FALLBACK_SNAPSHOT } from "./data";
import type { MarketSnapshot } from "./types";
export { toExalted, toDivines, formatPrice } from "./pricing";

const dataDir = () => process.env.DATA_DIR || path.join(process.cwd(), "data", "runtime");
const snapshotPath = () => path.join(dataDir(), "market-snapshot.json");

export async function loadMarketSnapshot(): Promise<MarketSnapshot> {
  try {
    const parsed = JSON.parse(await fs.readFile(snapshotPath(), "utf8")) as MarketSnapshot;
    if (!parsed.prices || !parsed.expiresAt || Date.parse(parsed.expiresAt) < Date.now()) return FALLBACK_SNAPSHOT;
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

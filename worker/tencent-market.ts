import type { ItemDefinition, LeagueCatalog, MarketPrice, MarketSnapshot } from "../lib/types";
import { normalizeLeague } from "../lib/profile";

const day = 24 * 60 * 60 * 1000;
const source = "poecurrency.top PoE2";
const units = { e: "exalted", c: "chaos", d: "divine" } as const;
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function tencentCatalog(input: unknown): LeagueCatalog {
  if (!Array.isArray(input) || input.length === 0) throw new Error("poecurrency.top 没有返回可用赛季");
  const ids = [...new Set(input.map((id) => normalizeLeague(id, true)))];
  const now = Date.now();
  return {
    leagues: ids.map((id) => ({ id, label: id, hardcore: false, permanent: id.toLowerCase() === "standard" })),
    defaultLeague: ids[0], capturedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString(),
  };
}

type Quote = {
  engname?: unknown;
  latest_buy1?: unknown;
  latest_sell1?: unknown;
  currency_unit?: string;
  latest_datetime?: string;
  error?: boolean;
};

export function tencentSnapshot(
  input: { league: string; body: unknown; lifetime: number },
  items: ItemDefinition[],
  now = Date.now(),
): MarketSnapshot {
  if (!Array.isArray(input.body) || !input.body.length) throw new Error("poecurrency.top 没有返回该赛季的行情");
  const quotes = new Map<string, MarketPrice>();
  const byName = new Map<string, ItemDefinition | null>();
  for (const item of items) {
    if (!item.priceable || item.ambiguous) continue;
    const key = item.marketKey.toLowerCase();
    byName.set(key, byName.has(key) ? null : item);
  }
  for (const group of input.body as Array<{ items?: Quote[] }>) {
    if (!Array.isArray(group?.items)) continue;
    for (const row of group.items) {
      if (row?.error !== false || typeof row.engname !== "string") continue;
      const item = byName.get(row.engname.trim().toLowerCase());
      const currency = units[row.currency_unit as keyof typeof units];
      const amount = positive(row.latest_buy1) ? row.latest_buy1 : row.latest_sell1;
      const timestamp = row.latest_datetime;
      if (!item || !currency || !positive(amount) || typeof timestamp !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)) continue;
      const time = Date.parse(timestamp.replace(" ", "T") + "+08:00");
      if (!Number.isFinite(time) || time > now + 300000 || time + day <= now) continue;
      const capturedAt = new Date(time).toISOString();
      const previous = quotes.get(item.id);
      if (previous && previous.capturedAt >= capturedAt) continue;
      quotes.set(item.id, { itemId: item.id, amount, currency, capturedAt, confidence: 0.9, source });
    }
  }
  const divine = quotes.get("divine-orb");
  const chaos = quotes.get("chaos-orb");
  if (!divine || !chaos || divine.currency !== "exalted" || chaos.currency === "chaos") {
    throw new Error("poecurrency.top 缺少有效的神圣石或混沌石汇率，报价可能已过期");
  }
  const divineToExalted = divine.amount;
  const chaosInExalted = chaos.amount * (chaos.currency === "divine" ? divineToExalted : 1);
  const divineToChaos = divineToExalted / chaosInExalted;
  if (!positive(divineToChaos) || !positive(chaosInExalted)) throw new Error("poecurrency.top 汇率无效");
  if (quotes.size <= 2) throw new Error("poecurrency.top 缺少有效物品报价");
  const rateTime = Math.min(Date.parse(divine.capturedAt), Date.parse(chaos.capturedAt));
  const capturedAt = new Date(rateTime).toISOString();
  const rates = { divineToChaos, divineToExalted, capturedAt, source };
  const prices: MarketSnapshot["prices"] = {};
  for (const [id, quote] of quotes) {
    const multiplier = quote.currency === "divine" ? divineToExalted : quote.currency === "chaos" ? chaosInExalted : 1;
    const amount = quote.amount * multiplier;
    if (positive(amount)) prices[id] = { ...quote, amount, currency: "exalted" };
  }
  prices["exalted-orb"] = { itemId: "exalted-orb", amount: 1, currency: "exalted", confidence: 1, capturedAt, source };
  return {
    server: "tencent", league: input.league, prices, rates, source, capturedAt,
    expiresAt: new Date(Math.min(now + input.lifetime, rateTime + day)).toISOString(),
  };
}

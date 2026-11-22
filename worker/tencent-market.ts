import type { Currency, ItemDefinition, LeagueCatalog, MarketPrice } from "../lib/types";
import { normalizeLeague } from "../lib/profile";
import { marketSnapshot, mergeMarketQuotes, type MarketQuotes, type MarketUpdate } from "./market-quotes";

const source = "poecurrency.top PoE2";
const units = new Map<string, Currency>([["e", "exalted"], ["c", "chaos"], ["d", "divine"]]);
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
  error_info?: string;
};

function parseQuotes(body: unknown, byName: Map<string, ItemDefinition | null>, now: number): MarketQuotes {
  const prices: MarketQuotes["prices"] = {};
  if (!Array.isArray(body)) return { prices };
  for (const group of body as Array<{ items?: Quote[] }>) {
    if (!Array.isArray(group?.items)) continue;
    for (const row of group.items) {
      if (typeof row?.engname !== "string") continue;
      // This specific flag describes quote age. Other flags can indicate incorrect prices.
      if (row.error !== false && !(row.error === true && row.error_info === "数据已过时超过24h")) continue;
      const item = byName.get(row.engname.trim().toLowerCase());
      const currency = units.get(row.currency_unit ?? "");
      const amount = positive(row.latest_buy1) ? row.latest_buy1 : row.latest_sell1;
      const timestamp = row.latest_datetime;
      if (!item || !currency || !positive(amount) || typeof timestamp !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)) continue;
      if ((item.id === "divine-orb" && currency !== "exalted") || (item.id === "chaos-orb" && currency === "chaos")) continue;
      const localTime = timestamp.replace(" ", "T");
      const time = Date.parse(localTime + "+08:00");
      if (!Number.isFinite(time) || time > now + 300000) continue;
      if (new Date(time + 8 * 3600000).toISOString().slice(0, 19) !== localTime) continue;
      const capturedAt = new Date(time).toISOString();
      const previous = prices[item.id];
      if (!previous || capturedAt > previous.capturedAt) {
        prices[item.id] = { itemId: item.id, amount, currency, capturedAt, confidence: 0.9, source };
      }
    }
  }
  return { prices };
}

export function tencentSnapshot(
  input: { league: string; body: unknown; previousBody?: unknown; previousQuotes?: MarketQuotes; lifetime: number },
  items: ItemDefinition[],
  now = Date.now(),
): MarketUpdate {
  if (!Array.isArray(input.body) || !input.body.length) throw new Error("poecurrency.top 没有返回该赛季的行情");
  const byName = new Map<string, ItemDefinition | null>();
  for (const item of items) {
    if (!item.priceable || item.ambiguous) continue;
    const key = item.marketKey.toLowerCase();
    byName.set(key, byName.has(key) ? null : item);
  }
  const incoming = parseQuotes(input.body, byName, now);
  if (!Object.keys(incoming.prices).length) throw new Error("poecurrency.top 没有返回可用报价");
  const cached = input.previousQuotes ?? parseQuotes(input.previousBody, byName, now);
  const quotes = mergeMarketQuotes(cached, incoming);
  const divine = quotes.prices["divine-orb"];
  const chaos = quotes.prices["chaos-orb"];
  if (!divine || !chaos) throw new Error("poecurrency.top 缺少有效的神圣石或混沌石汇率");

  const divineToExalted = divine.amount;
  const chaosInExalted = chaos.amount * (chaos.currency === "divine" ? divineToExalted : 1);
  const divineToChaos = divineToExalted / chaosInExalted;
  if (!positive(divineToChaos) || !positive(chaosInExalted)) throw new Error("poecurrency.top 汇率无效");
  const capturedAt = divine.capturedAt < chaos.capturedAt ? divine.capturedAt : chaos.capturedAt;
  const rates = { divineToChaos, divineToExalted, capturedAt, source };
  const prices: Record<string, MarketPrice> = {};
  for (const [id, quote] of Object.entries(quotes.prices)) {
    const multiplier = quote.currency === "divine" ? divineToExalted : quote.currency === "chaos" ? chaosInExalted : 1;
    const amount = quote.amount * multiplier;
    if (positive(amount)) prices[id] = { ...quote, amount, currency: "exalted" };
  }
  if (Object.keys(prices).every((id) => ["exalted-orb", "divine-orb", "chaos-orb"].includes(id))) {
    throw new Error("poecurrency.top 缺少有效物品报价");
  }
  prices["exalted-orb"] = { itemId: "exalted-orb", amount: 1, currency: "exalted", confidence: 1, capturedAt, source };
  return { snapshot: marketSnapshot(input, "tencent", source, { prices, rates }, now), quotes };
}

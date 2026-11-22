import type { ItemDefinition } from "../lib/types";
import { normalizeLeague } from "../lib/profile";
import { NINJA_TYPES, parseExchange } from "./market-adapter.mjs";
import { marketSnapshot, mergeMarketQuotes, type MarketQuotes, type MarketUpdate } from "./market-quotes";

type ExchangeResponse = { body: unknown; quoteTime?: string | null };

function exchangeQuotes(
  payloads: Record<string, ExchangeResponse>, catalog: ItemDefinition[], now: number, legacy = false,
): MarketQuotes {
  let result: MarketQuotes = { prices: {} };
  for (const type of NINJA_TYPES) {
    const response = payloads[type];
    if (legacy && !response) continue;
    const sourceTime = response?.quoteTime ? Date.parse(response.quoteTime) : NaN;
    const time = legacy && !Number.isFinite(sourceTime) ? 0 : sourceTime;
    if (!Number.isFinite(time) || time < 0 || time > now + 300000) {
      throw new Error(`poe.ninja ${type} 缺少有效的报价时间`);
    }
    const resultForType = parseExchange(response.body, catalog, new Date(time).toISOString(), type === "Currency");
    result = mergeMarketQuotes(result, resultForType);
  }
  return result;
}

export function internationalSnapshot(input: {
  league: string;
  payloads: Record<string, ExchangeResponse>;
  previous?: Record<string, ExchangeResponse>;
  previousQuotes?: MarketQuotes;
  lifetime: number;
}, catalog: ItemDefinition[], now = Date.now()): MarketUpdate {
  const cached = input.previousQuotes ?? exchangeQuotes(input.previous ?? {}, catalog, now, true);
  const quotes = mergeMarketQuotes(cached, exchangeQuotes(input.payloads, catalog, now));
  if (!quotes.rates) throw new Error("poe.ninja 未返回完整的 D/C/E 汇率");
  const snapshot = marketSnapshot({ ...input, league: normalizeLeague(input.league) }, "international", "poe.ninja PoE2 exchange (Most Popular)", quotes, now);
  return { snapshot, quotes };
}

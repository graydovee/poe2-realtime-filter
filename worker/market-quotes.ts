import type { GameServer, MarketSnapshot } from "../lib/types";

export type MarketQuotes = Pick<MarketSnapshot, "prices" | "rates">;
export type MarketUpdate = { snapshot: MarketSnapshot; quotes: MarketQuotes };

export function mergeMarketQuotes(cached: MarketQuotes, incoming: MarketQuotes): MarketQuotes {
  const prices = { ...cached.prices };
  for (const [id, quote] of Object.entries(incoming.prices)) {
    const previous = prices[id];
    if (!previous || quote.capturedAt > previous.capturedAt) prices[id] = quote;
  }
  const rates = incoming.rates && (!cached.rates || incoming.rates.capturedAt > cached.rates.capturedAt)
    ? incoming.rates : cached.rates;
  return { prices, rates };
}

export function marketSnapshot(
  input: { league: string; lifetime: number },
  server: GameServer,
  source: string,
  quotes: MarketQuotes,
  now: number,
): MarketSnapshot {
  let capturedAt = quotes.rates?.capturedAt ?? "1970-01-01T00:00:00.000Z";
  for (const price of Object.values(quotes.prices)) {
    if (price.capturedAt > capturedAt) capturedAt = price.capturedAt;
  }
  return {
    ...quotes, server, league: input.league, source, capturedAt,
    // Cache usability is separate from the times reported for individual quotes.
    expiresAt: new Date(now + input.lifetime).toISOString(),
  };
}

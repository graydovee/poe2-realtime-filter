import { generateFilter } from "../lib/filter-engine";
import { inspectBaseStyles } from "../lib/baseline-effects";
import { FALLBACK_SNAPSHOT, ITEM_CATALOG } from "../lib/data";
import { normalizeLeague } from "../lib/profile";
import { validateProfile } from "../lib/profile-validation";
import type { LeagueCatalog, LeagueOption, MarketSnapshot } from "../lib/types";
import { NINJA_TYPES, parseExchange } from "../worker/market-adapter.mjs";

function catalog(input: { economyLeagues?: Array<{ name: string; displayName?: string; hardcore?: boolean; isPrivate?: boolean }> }): LeagueCatalog {
  const leagues = new Map<string, LeagueOption>();
  for (const entry of input.economyLeagues ?? []) {
    if (entry.isPrivate) continue;
    const id = normalizeLeague(entry.name);
    leagues.set(id, { id, label: entry.displayName || id, hardcore: Boolean(entry.hardcore || /^HC\b|^Hardcore$/i.test(id)), permanent: id === "Standard" || id === "Hardcore" });
  }
  if (!leagues.size) throw new Error("poe.ninja 没有返回可用赛季");
  for (const id of ["Standard", "Hardcore"]) {
    if (!leagues.has(id)) leagues.set(id, { id, label: id, hardcore: id === "Hardcore", permanent: true });
  }
  return { leagues: [...leagues.values()], defaultLeague: [...leagues.values()].find((entry) => !entry.hardcore && !entry.permanent)?.id ?? "Standard", capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() };
}

function snapshot(input: { league: string; payloads: Record<string, unknown>; lifetime: number }): MarketSnapshot {
  const now = Date.now();
  const capturedAt = new Date(now).toISOString();
  const currency = parseExchange(input.payloads.Currency, ITEM_CATALOG, capturedAt);
  if (!currency.rates) throw new Error("poe.ninja 未返回完整的 D/C/E 汇率");
  const prices = {};
  for (const type of NINJA_TYPES) {
    if (type !== "Currency") Object.assign(prices, parseExchange(input.payloads[type], ITEM_CATALOG, capturedAt).prices);
  }
  return { league: normalizeLeague(input.league), capturedAt, expiresAt: new Date(now + input.lifetime).toISOString(), source: "poe.ninja PoE2 exchange (Most Popular)", rates: currency.rates, prices: Object.assign(prices, currency.prices) };
}

const api = {
  types: () => NINJA_TYPES,
  catalog,
  snapshot,
  validate: validateProfile,
  baseStyles: (input: string) => inspectBaseStyles(input),
  requiresMarket: (input: unknown) => validateProfile(input).rules.some((rule) => rule.enabled && rule.target.priceEnabled !== false && Boolean(rule.target.range)),
  generate: ({ profile, baseline, baselineName, market }: { profile: unknown; baseline: string | null; baselineName: string | null; market?: MarketSnapshot }) => {
    const valid = validateProfile(profile);
    const quote = market?.league === valid.league && Date.parse(market.expiresAt) >= Date.now() ? market : { ...FALLBACK_SNAPSHOT, league: valid.league };
    return { ...generateFilter(valid, baseline, quote, { includeMarketTimestamp: false, baselineName: baselineName ?? undefined, distinguishCustom: true }), market: quote };
  },
};

export function dispatch(method: keyof typeof api, payload: string): string {
  return JSON.stringify((api[method] as (arg: unknown) => unknown)(JSON.parse(payload)));
}

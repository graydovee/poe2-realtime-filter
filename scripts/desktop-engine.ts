import { currencyPriceTiers, toExalted } from "../lib/pricing";
import { tencentCatalog, tencentSnapshot } from "../worker/tencent-market";
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
  tencentCatalog,
  tencentSnapshot: (input: Parameters<typeof tencentSnapshot>[0]) => tencentSnapshot(input, ITEM_CATALOG),
  validate: validateProfile,
  baseStyles: (input: string) => inspectBaseStyles(input),
  requiresMarket: (input: unknown) => validateProfile(input).rules.some((rule) => rule.enabled && rule.target.priceEnabled !== false && Boolean(rule.target.range)),
  generate: ({ profile, baseline, baselineName, market }: { profile: unknown; baseline: string | null; baselineName: string | null; market?: MarketSnapshot }) => {
    const valid = validateProfile(profile);
    const server = valid.server ?? "international";
    const quote = market?.league === valid.league && (market.server ?? "international") === server && Date.parse(market.expiresAt) >= Date.now()
      ? market : { ...FALLBACK_SNAPSHOT, server, league: valid.league };
    if (server === "tencent") {
      const cutoff = Date.now() - 86400000;
      quote.prices = Object.fromEntries(Object.entries(quote.prices).filter(([, price]) => Date.parse(price.capturedAt) > cutoff));
    }
    const priceRules = valid.rules.filter((rule) => rule.enabled && rule.target.priceEnabled !== false && rule.target.range);
    let marketIssue: string | undefined;
    if (priceRules.length && !quote.rates) marketIssue = "等待当前服务器和赛季的有效行情";
    else if (priceRules.some((rule) => rule.autoRange) && currencyPriceTiers(quote).length !== 4) {
      marketIssue = "价格档所需的锚点通货行情不完整";
    } else {
      for (const rule of priceRules) {
        const bounds = [rule.target.range?.min, rule.target.range?.max];
        if (bounds.some((point) => point && toExalted(point, quote.rates, quote.prices) === undefined)) {
          marketIssue = `「${rule.name}」缺少价格区间所需的报价`;
          break;
        }
        const missing = rule.target.itemEnabled !== false && rule.target.itemIds.find((id) =>
          !valid.skippedItemIds.includes(id) && ITEM_CATALOG.some((item) => item.id === id && item.priceable && !item.ambiguous) && !quote.prices[id]);
        if (missing) {
          marketIssue = `「${rule.name}」缺少 ${ITEM_CATALOG.find((item) => item.id === missing)?.name ?? missing} 的有效报价`;
          break;
        }
      }
    }
    const bundle = generateFilter(valid, baseline, quote, { includeMarketTimestamp: false, baselineName: baselineName ?? undefined, distinguishCustom: true });
    if (marketIssue) bundle.safetyReport.warnings.push(marketIssue);
    return { ...bundle, market: quote, marketIssue };
  },
};

export function dispatch(method: keyof typeof api, payload: string): string {
  return JSON.stringify((api[method] as (arg: unknown) => unknown)(JSON.parse(payload)));
}

import type { Currency, FilterRule, MarketRates, MarketSnapshot, PricePoint } from "./types";

export const CURRENCY_ANCHORS: Record<string, string> = {
  "exalted-orb": "崇高石", "chaos-orb": "混沌石", "orb-of-annulment": "剥离石", "divine-orb": "神圣石",
};
export const CURRENCY_SYMBOLS: Record<Currency, string> = { divine: "D", chaos: "C", exalted: "E" };

export function toDivines(point: PricePoint, rates?: MarketRates, prices?: MarketSnapshot["prices"]): number | undefined {
  if (!Number.isFinite(point.amount) || point.amount < 0) return undefined;
  if (point.referenceItemId) {
    const price = prices?.[point.referenceItemId];
    if (!price || !Number.isFinite(price.amount) || price.amount <= 0) return undefined;
    const value = toDivines({ amount: price.amount, currency: price.currency }, rates);
    return value === undefined ? undefined : point.amount * value;
  }
  if (point.currency === "divine") return point.amount;
  if (!rates) return undefined;
  const rate = point.currency === "chaos" ? rates.divineToChaos : rates.divineToExalted;
  return Number.isFinite(rate) && rate > 0 ? point.amount / rate : undefined;
}

// Convert before sorting or comparing: all price rules use Exalted Orb equivalents.
export function toExalted(point: PricePoint, rates?: MarketRates, prices?: MarketSnapshot["prices"]): number | undefined {
  if (!Number.isFinite(point.amount) || point.amount < 0) return undefined;
  if (point.referenceItemId) {
    const price = prices?.[point.referenceItemId];
    if (!price || !Number.isFinite(price.amount) || price.amount <= 0) return undefined;
    const denomination: Record<string, Currency> = { "exalted-orb": "exalted", "chaos-orb": "chaos", "divine-orb": "divine" };
    const currency = denomination[point.referenceItemId];
    const value = toExalted(currency ? { amount: 1, currency } : { amount: price.amount, currency: price.currency }, rates);
    return value === undefined ? undefined : point.amount * value;
  }
  if (point.currency === "exalted") return point.amount;
  if (!rates || !Number.isFinite(rates.divineToExalted) || rates.divineToExalted <= 0) return undefined;
  if (point.currency === "divine") return point.amount * rates.divineToExalted;
  if (!Number.isFinite(rates.divineToChaos) || rates.divineToChaos <= 0) return undefined;
  return point.amount * (rates.divineToExalted / rates.divineToChaos);
}

export type CurrencyPriceTier = { itemId: string; name: string; exaltedValue: number };

/** 四枚锚点通货当日的 E 价值，缺任意一枚就返回空数组（不做部分降级）。 */
export function currencyPriceTiers(snapshot: MarketSnapshot): CurrencyPriceTier[] {
  const tiers: CurrencyPriceTier[] = [];
  for (const [itemId, name] of Object.entries(CURRENCY_ANCHORS)) {
    const exaltedValue = toExalted({ amount: 1, currency: "exalted", referenceItemId: itemId }, snapshot.rates, snapshot.prices);
    if (exaltedValue === undefined) return [];
    tiers.push({ itemId, name, exaltedValue });
  }
  return tiers.sort((a, b) => a.exaltedValue - b.exaltedValue);
}

/**
 * 把 autoRange 规则的价格区间按当日锚点重排为 [锚点_i, 锚点_{i+1})，最高档无上限。
 * 锚点缺价时该规则置为禁用（返回的数组里 enabled=false），由生成器汇总成 warning。
 * 保持规则原有顺序：区间互不重叠，首个命中即生效，不替用户重排优先级。
 */
export function resolveAutoRanges(rules: FilterRule[], snapshot: MarketSnapshot): FilterRule[] {
  const tiers = currencyPriceTiers(snapshot);
  const complete = tiers.length === Object.keys(CURRENCY_ANCHORS).length;
  const point = (itemId: string): PricePoint => ({ amount: 1, currency: "exalted", referenceItemId: itemId });
  return rules.map((rule) => {
    if (!rule.autoRange) return rule;
    const anchorId = rule.target.range?.min?.referenceItemId;
    if (!complete || !anchorId) return { ...rule, enabled: false };
    const index = tiers.findIndex((tier) => tier.itemId === anchorId);
    if (index < 0) return { ...rule, enabled: false };
    const next = tiers[index + 1];
    return { ...rule, target: { ...rule.target, range: { min: point(anchorId), ...(next ? { max: point(next.itemId) } : {}) } } };
  });
}

export function displayPrice(divines: number, rates?: MarketRates): PricePoint {
  if (divines >= 1 || !rates) return { amount: divines, currency: "divine" };
  if (divines >= 1 / rates.divineToChaos) return { amount: divines * rates.divineToChaos, currency: "chaos" };
  return { amount: divines * rates.divineToExalted, currency: "exalted" };
}

export function formatPrice(point: PricePoint, snapshot?: MarketSnapshot): string {
  if (point.referenceItemId) {
    const name = CURRENCY_ANCHORS[point.referenceItemId] || point.referenceItemId;
    const value = snapshot ? toExalted(point, snapshot.rates, snapshot.prices) : undefined;
    return point.amount + " " + name + (value === undefined ? "（等待行情）" : " ≈ " + formatPrice({ amount: value, currency: "exalted" }));
  }
  return Number(point.amount.toPrecision(6)) + " " + CURRENCY_SYMBOLS[point.currency];
}

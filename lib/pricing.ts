import type { Currency, MarketRates, MarketSnapshot, PriceCurrency, PricePoint } from "./types";

/** 剥离石没有汇率，只能按它自己的行情报价换算；它只作为规则价格区间的单位出现。 */
export const ANNULMENT_ITEM_ID = "orb-of-annulment";
export const CURRENCY_SYMBOLS: Record<Currency, string> = { divine: "D", chaos: "C", exalted: "E" };
/** 规则价格区间可选的单位及其显示名，顺序从低到高。 */
export const PRICE_UNITS: Array<{ value: PriceCurrency; label: string }> = [
  { value: "exalted", label: "E · 崇高石" },
  { value: "chaos", label: "C · 混沌石" },
  { value: "annulment", label: "剥离石" },
  { value: "divine", label: "D · 神圣石" },
];

export function toDivines(point: PricePoint, rates?: MarketRates, prices?: MarketSnapshot["prices"]): number | undefined {
  if (!Number.isFinite(point.amount) || point.amount < 0) return undefined;
  if (point.currency === "annulment") {
    const price = prices?.[ANNULMENT_ITEM_ID];
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
  if (point.currency === "annulment") {
    const price = prices?.[ANNULMENT_ITEM_ID];
    if (!price || !Number.isFinite(price.amount) || price.amount <= 0) return undefined;
    const value = toExalted({ amount: price.amount, currency: price.currency }, rates);
    return value === undefined ? undefined : point.amount * value;
  }
  if (point.currency === "exalted") return point.amount;
  if (!rates || !Number.isFinite(rates.divineToExalted) || rates.divineToExalted <= 0) return undefined;
  if (point.currency === "divine") return point.amount * rates.divineToExalted;
  if (!Number.isFinite(rates.divineToChaos) || rates.divineToChaos <= 0) return undefined;
  return point.amount * (rates.divineToExalted / rates.divineToChaos);
}

export function displayPrice(divines: number, rates?: MarketRates): PricePoint {
  if (divines >= 1 || !rates) return { amount: divines, currency: "divine" };
  if (divines >= 1 / rates.divineToChaos) return { amount: divines * rates.divineToChaos, currency: "chaos" };
  return { amount: divines * rates.divineToExalted, currency: "exalted" };
}

/** 区间端点里用到的锚点通货（没有汇率、需要行情报价才能换算的单位）。 */
export function anchorItemIds(point?: PricePoint): string[] {
  return point?.currency === "annulment" ? [ANNULMENT_ITEM_ID] : [];
}

/** 只写数值和单位，不做行情折算。 */
export function formatUnit(point: PricePoint): string {
  return point.currency === "annulment"
    ? point.amount + " 剥离石"
    : Number(point.amount.toPrecision(6)) + " " + CURRENCY_SYMBOLS[point.currency];
}

export function formatPrice(point: PricePoint, snapshot?: MarketSnapshot): string {
  if (point.currency !== "annulment") return formatUnit(point);
  const value = snapshot ? toExalted(point, snapshot.rates, snapshot.prices) : undefined;
  return formatUnit(point) + (value === undefined ? "（等待行情）" : " ≈ " + formatPrice({ amount: value, currency: "exalted" }));
}

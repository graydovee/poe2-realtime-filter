import type { Currency, MarketRates, MarketSnapshot, PricePoint, VisualPreset } from "./types";

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

export function displayPrice(divines: number, rates?: MarketRates): PricePoint {
  if (divines >= 1 || !rates) return { amount: divines, currency: "divine" };
  if (divines >= 1 / rates.divineToChaos) return { amount: divines * rates.divineToChaos, currency: "chaos" };
  return { amount: divines * rates.divineToExalted, currency: "exalted" };
}

export function formatPrice(point: PricePoint, snapshot?: MarketSnapshot): string {
  if (point.referenceItemId) {
    const name = CURRENCY_ANCHORS[point.referenceItemId] || point.referenceItemId;
    const value = snapshot ? toDivines(point, snapshot.rates, snapshot.prices) : undefined;
    return point.amount + " " + name + (value === undefined ? "（等待行情）" : " ≈ " + formatPrice(displayPrice(value, snapshot?.rates)));
  }
  return Number(point.amount.toPrecision(6)) + " " + CURRENCY_SYMBOLS[point.currency];
}

// Only automatic defaults follow market ordering; manually edited ranges retain their order and values.
export function currencyDefaultRanges(presets: VisualPreset[], snapshot: MarketSnapshot): VisualPreset[] {
  const anchors = Object.keys(CURRENCY_ANCHORS).map((id) => ({ id, value: toDivines({ amount: 1, currency: "divine", referenceItemId: id }, snapshot.rates, snapshot.prices) }));
  if (anchors.some((anchor) => anchor.value === undefined)) return presets;
  anchors.sort((a, b) => a.value! - b.value!);
  const resolved = presets.map((preset) => {
    if (!preset.autoRange || !preset.sourceItemId) return preset;
    const index = anchors.findIndex((anchor) => anchor.id === preset.sourceItemId);
    if (index < 0) return preset;
    const point = (id: string): PricePoint => ({ amount: 1, currency: "divine", referenceItemId: id });
    const next = anchors[index + 1];
    return { ...preset, range: { min: point(preset.sourceItemId), ...(next ? { max: point(next.id) } : {}) } };
  });
  const automatic = resolved.filter((preset) => preset.autoRange && preset.sourceItemId && CURRENCY_ANCHORS[preset.sourceItemId]);
  automatic.sort((a, b) => anchors.findIndex((anchor) => anchor.id === a.sourceItemId) - anchors.findIndex((anchor) => anchor.id === b.sourceItemId));
  return resolved.map((preset) => preset.autoRange && preset.sourceItemId && CURRENCY_ANCHORS[preset.sourceItemId] ? automatic.shift()! : preset);
}

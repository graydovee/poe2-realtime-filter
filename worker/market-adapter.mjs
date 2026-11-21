export const NINJA_TYPES = ["Currency", "Fragments", "Abyss", "UncutGems", "LineageSupportGems", "Essences", "SoulCores", "Idols", "Runes", "Ritual", "Expedition", "Delirium", "Breach", "Verisium"];

const QUOTE_CURRENCIES = new Set(["divine", "chaos", "exalted"]);
const isPositiveRate = (value) => Number.isFinite(value) && value > 0;

export function parseExchange(payload, catalog, capturedAt) {
  if (payload?.core?.primary !== "divine" || !Array.isArray(payload.items) || !Array.isArray(payload.lines)) {
    throw new Error("Unsupported poe.ninja exchange schema or primary currency");
  }
  const itemById = new Map([...payload.items, ...(payload.core.items || [])].map((item) => [item.id, item]));
  const byName = new Map(catalog.filter((item) => item.priceable && !item.ambiguous).map((item) => [item.marketKey.toLowerCase(), item]));
  const prices = {};
  for (const line of payload.lines) {
    const metadata = itemById.get(line.id);
    const item = byName.get(String(metadata?.name || "").toLowerCase());
    if (!item) continue;
    const { maxVolumeCurrency, maxVolumeRate, primaryValue } = line;
    // Most Popular reports item units per one quote currency. Store the price per item.
    const popularAmount = isPositiveRate(maxVolumeRate) ? 1 / maxVolumeRate : undefined;
    const usePopular = QUOTE_CURRENCIES.has(maxVolumeCurrency) && isPositiveRate(popularAmount);
    const amount = usePopular ? popularAmount : primaryValue;
    if (!isPositiveRate(amount)) continue;
    const currency = usePopular ? maxVolumeCurrency : "divine";
    prices[item.id] = { itemId: item.id, amount, currency, confidence: 0.9, capturedAt, source: "poe.ninja" };
  }
  const raw = payload.core.rates;
  let rates;
  if (isPositiveRate(raw?.chaos) && isPositiveRate(raw?.exalted)) {
    rates = { divineToChaos: raw.chaos, divineToExalted: raw.exalted, capturedAt, source: "poe.ninja PoE2 exchange" };
    // Use the same conversion basis for the denominations and threshold anchors.
    for (const [name, amount] of [["Divine Orb", 1], ["Chaos Orb", 1 / raw.chaos], ["Exalted Orb", 1 / raw.exalted]]) {
      const item = byName.get(name.toLowerCase());
      if (item) prices[item.id] = { itemId: item.id, amount, currency: "divine", confidence: 0.9, capturedAt, source: "poe.ninja" };
    }
  }
  return { prices, rates };
}

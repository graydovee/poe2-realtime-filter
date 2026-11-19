export const NINJA_TYPES = ["Currency", "Fragments", "Abyss", "UncutGems", "LineageSupportGems", "Essences", "SoulCores", "Idols", "Runes", "Ritual", "Expedition", "Delirium", "Breach", "Verisium"];

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
    const amount = line.primaryValue;
    if (!item || typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) continue;
    prices[item.id] = { itemId: item.id, amount, currency: "divine", confidence: 0.9, capturedAt, source: "poe.ninja" };
  }
  const raw = payload.core.rates;
  let rates;
  if (Number.isFinite(raw?.chaos) && raw.chaos > 0 && Number.isFinite(raw?.exalted) && raw.exalted > 0) {
    rates = { divineToChaos: raw.chaos, divineToExalted: raw.exalted, capturedAt, source: "poe.ninja PoE2 exchange" };
    // Use the same conversion basis for the denominations and threshold anchors.
    for (const [name, amount] of [["Divine Orb", 1], ["Chaos Orb", 1 / raw.chaos], ["Exalted Orb", 1 / raw.exalted]]) {
      const item = byName.get(name.toLowerCase());
      if (item) prices[item.id] = { itemId: item.id, amount, currency: "divine", confidence: 0.9, capturedAt, source: "poe.ninja" };
    }
  }
  return { prices, rates };
}

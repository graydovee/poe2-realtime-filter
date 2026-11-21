import type { ItemDefinition, MarketSnapshot } from "../lib/types";

export const NINJA_TYPES: readonly string[];
export function parseExchange(payload: unknown, catalog: ItemDefinition[], capturedAt: string): {
  prices: MarketSnapshot["prices"];
  rates?: MarketSnapshot["rates"];
};

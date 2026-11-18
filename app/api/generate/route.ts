import { NextResponse } from "next/server";
import { generateFilter } from "../../../lib/filter-engine";
import { loadMarketSnapshot } from "../../../lib/market";
import type { FilterProfile } from "../../../lib/types";

export const runtime = "nodejs";

const defaultProfile: FilterProfile = {
  strictness: 2,
  style: "default",
  locale: "cn",
  itemLevelMin: 65,
  areaLevelMin: 65,
  hideBelowEnabled: false,
  hideBelowAmount: 0.5,
  hideBelowCurrency: "divine",
  whitelist: [],
  sound: { pack: "neversink", alertLevel: "economy" },
  visuals: {
    showBeams: true,
    showMinimapIcons: true,
    fontSize: 32,
    highValueColor: "255 220 90",
    valuableColor: "80 210 255",
    unknownColor: "255 120 220",
  },
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<FilterProfile>;
    const profile = { ...defaultProfile, ...body } as FilterProfile;
    const snapshot = await loadMarketSnapshot();
    const bundle = generateFilter(profile, snapshot);
    return NextResponse.json({ ...bundle, market: snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法生成过滤器" }, { status: 400 });
  }
}

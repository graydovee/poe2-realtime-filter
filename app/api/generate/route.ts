import { NextResponse } from "next/server";
import { DEFAULT_VISUAL_PRESETS } from "../../../lib/data";
import { DEFAULT_PROFILE } from "../../../lib/default-profile";
import { generateFilter } from "../../../lib/filter-engine";
import { loadMarketSnapshot } from "../../../lib/market";
import type { FilterProfile } from "../../../lib/types";

export const runtime = "nodejs";


export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<FilterProfile>;
    const profile = { ...DEFAULT_PROFILE, ...body, visualPresets: body.visualPresets ?? DEFAULT_VISUAL_PRESETS } as FilterProfile;
    const snapshot = await loadMarketSnapshot();
    const bundle = generateFilter(profile, snapshot);
    return NextResponse.json({ ...bundle, market: snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法生成过滤器" }, { status: 400 });
  }
}

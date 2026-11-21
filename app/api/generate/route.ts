import { NextResponse } from "next/server";
import { generateFilter } from "../../../lib/filter-engine";
import { loadMarketSnapshot } from "../../../lib/market";
import { normalizeProfile } from "../../../lib/profile";

export const runtime = "nodejs";


export async function POST(request: Request) {
  try {
    const profile = normalizeProfile(await request.json());
    const snapshot = await loadMarketSnapshot(profile.league);
    const bundle = generateFilter(profile, snapshot);
    return NextResponse.json({ ...bundle, market: snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法生成过滤器" }, { status: 400 });
  }
}
import { NextResponse } from "next/server";
import { loadMarketSnapshot } from "../../../lib/market";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const league = new URL(request.url).searchParams.get("league") ?? process.env.POE2_LEAGUE ?? "Standard";
    return NextResponse.json(await loadMarketSnapshot(league), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法读取赛季行情" }, { status: 400 });
  }
}

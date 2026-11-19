import { NextResponse } from "next/server";
import { loadMarketSnapshot } from "../../../lib/market";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(await loadMarketSnapshot(), { headers: { "cache-control": "no-store" } });
}

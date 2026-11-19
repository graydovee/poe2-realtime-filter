import { NextResponse } from "next/server";
import { getLeagueCatalog } from "../../../lib/market";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(await getLeagueCatalog(), { headers: { "cache-control": "no-store" } });
}

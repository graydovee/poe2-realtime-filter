import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = { ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg" };

/** 只读转发 vendored 的模板音效，供规则编辑器试听。 */
export async function GET(_request: Request, context: { params: { name: string } }) {
  const name = decodeURIComponent(context.params.name ?? "");
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const extension = path.extname(name).toLowerCase();
  if (!name || safe !== name || !CONTENT_TYPES[extension]) {
    return NextResponse.json({ error: "无效音效" }, { status: 400 });
  }
  try {
    const bytes = await fs.readFile(path.join(process.cwd(), "vendor", "neversink", "(STYLE) CUSTOMSOUNDS", name));
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: { "content-type": CONTENT_TYPES[extension], "cache-control": "public, max-age=86400" },
    });
  } catch {
    return NextResponse.json({ error: "音效不存在" }, { status: 404 });
  }
}

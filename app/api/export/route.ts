import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { DEFAULT_VISUAL_PRESETS } from "../../../lib/data";
import { DEFAULT_PROFILE } from "../../../lib/default-profile";
import { generateFilter } from "../../../lib/filter-engine";
import { loadMarketSnapshot } from "../../../lib/market";
import type { FilterProfile } from "../../../lib/types";

export const runtime = "nodejs";

function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(value: number): Uint8Array { const out = new Uint8Array(2); new DataView(out.buffer).setUint16(0, value, true); return out; }
function u32(value: number): Uint8Array { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value >>> 0, true); return out; }
function concat(...parts: Uint8Array[]): Uint8Array { const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out; }
function zip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const header = concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name, entry.data);
    local.push(header);
    central.push(concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name));
    offset += header.length;
  }
  const centralBytes = central.reduce((sum, part) => sum + part.length, 0);
  const localBytes = local.reduce((sum, part) => sum + part.length, 0);
  return concat(...local, ...central, concat(u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralBytes), u32(localBytes), u16(0)));
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const rawProfile = JSON.parse(String(form.get("profile"))) as Partial<FilterProfile>;
    const profile = { ...DEFAULT_PROFILE, ...rawProfile, visualPresets: rawProfile.visualPresets ?? DEFAULT_VISUAL_PRESETS } as FilterProfile;
    const snapshot = await loadMarketSnapshot();
    const bundle = generateFilter(profile, snapshot);
    const entries: Array<{ name: string; data: Uint8Array }> = [
      { name: bundle.fileName, data: new TextEncoder().encode(bundle.filterFile) },
      { name: "poe2-filter-manifest.json", data: new TextEncoder().encode(JSON.stringify({ generatedAt: new Date().toISOString(), baseline: bundle.baselineFile, market: snapshot, appliedPresets: bundle.appliedPresets, safety: bundle.safetyReport }, null, 2)) },
    ];
    const added = new Set(entries.map((entry) => entry.name));
    for (const [key, value] of form.entries()) {
      if (!key.startsWith("sound:") || !(value instanceof File) || value.size === 0) continue;
      const name = safeName(value.name);
      if (added.has(name)) continue;
      entries.push({ name, data: new Uint8Array(await value.arrayBuffer()) });
      added.add(name);
    }
    for (const soundName of bundle.soundFiles) {
      if (added.has(soundName) || soundName.includes("/") || soundName.includes("\\\\")) continue;
      const soundPath = path.join(process.cwd(), "vendor", "neversink", "(STYLE) CUSTOMSOUNDS", soundName);
      try {
        entries.push({ name: soundName, data: new Uint8Array(await fs.readFile(soundPath)) });
        added.add(soundName);
      } catch {
        // A custom sound is uploaded separately; missing optional vendor sounds remain listed in the manifest.
      }
    }
    const archive = zip(entries);
    return new NextResponse(archive as unknown as BodyInit, { headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="poe2-filter.zip"', "content-length": String(archive.length) } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法导出 ZIP" }, { status: 400 });
  }
}

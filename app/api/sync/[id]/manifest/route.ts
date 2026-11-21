import { NextResponse } from 'next/server';
import { apiError } from '../../../../../lib/auth';
import { syncRow,latestManifest } from '../../../../../lib/profiles';
import { countSubscriptionDevice, digest } from '../../../../../worker/profile-store.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const manifest = await latestManifest(syncRow(params.id, request));
    const row = syncRow(params.id, request);
    // Generation and market timestamps are informational and can change on every check.
    const etag = 'W/"' + digest(JSON.stringify([manifest.revision, manifest.name, manifest.league, manifest.configVersion])) + '"';
    const headers = { etag, 'cache-control': 'private, no-cache', vary: 'Authorization' };
    if (!manifest.stale) {
      countSubscriptionDevice(row.id, row.token_hash, new URL(request.url).searchParams.get('devices'));
      if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    }
    return NextResponse.json(manifest, { headers });
  } catch (error) {
    return apiError(error);
  }
}

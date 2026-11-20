import { NextResponse } from 'next/server';
import { apiError } from '../../../../../lib/auth';
import { syncRow,latestManifest } from '../../../../../lib/profiles';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:{id:string}}){try{const row=syncRow(params.id,request),manifest=await latestManifest(row);syncRow(params.id,request);const etag='"'+manifest.revision+'"';const headers={etag,'cache-control':'private, no-cache','vary':'Authorization'};if(!manifest.stale&&request.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers});return NextResponse.json(manifest,{headers});}catch(e){return apiError(e);}}

import { NextResponse } from 'next/server';
import { requireUser,sameOrigin,apiError } from '../../../lib/auth';
import { db } from '../../../worker/profile-store.mjs';
import { profileInput,saveProfile,resolvedSummary } from '../../../lib/profiles';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){try{const u=requireUser(request);const rows=db().prepare('SELECT * FROM profiles WHERE owner=? AND deleted=0 ORDER BY updated DESC').all(u.owner);return NextResponse.json({profiles:await Promise.all(rows.map(resolvedSummary))},{headers:{'cache-control':'no-store'}});}catch(e){return apiError(e);}}
export async function POST(request:Request){try{sameOrigin(request);const u=requireUser(request);return NextResponse.json(saveProfile(u.owner,await profileInput(request)),{status:201});}catch(e){return apiError(e);}}

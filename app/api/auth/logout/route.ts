import { NextResponse } from 'next/server';
import { sameOrigin,cookie,sessionCookie,apiError } from '../../../../lib/auth';
import { db,digest } from '../../../../worker/profile-store.mjs';
export async function POST(request:Request){try{sameOrigin(request);const token=cookie(request,sessionCookie);if(token)db().prepare('DELETE FROM sessions WHERE hash=?').run(digest(token));const result=NextResponse.json({ok:true});result.cookies.delete(sessionCookie);return result;}catch(e){return apiError(e);}}

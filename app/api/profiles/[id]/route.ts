import { NextResponse } from 'next/server';
import { requireUser,sameOrigin,apiError,ApiError } from '../../../../lib/auth';
import { db,profileRow,summary } from '../../../../worker/profile-store.mjs';
import { profileInput,saveProfile } from '../../../../lib/profiles';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:{id:string}}){try{const u=requireUser(request),row=profileRow(params.id,u.owner);if(!row)throw new ApiError(404,'方案不存在');return NextResponse.json(summary(row),{headers:{'cache-control':'no-store'}});}catch(e){return apiError(e);}}
export async function PUT(request:Request,{params}:{params:{id:string}}){try{sameOrigin(request);const u=requireUser(request);return NextResponse.json(saveProfile(u.owner,await profileInput(request),params.id));}catch(e){return apiError(e);}}
export async function DELETE(request:Request,{params}:{params:{id:string}}){try{sameOrigin(request);const u=requireUser(request);if(!profileRow(params.id,u.owner))throw new ApiError(404,'方案不存在');db().prepare('UPDATE profiles SET deleted=1,enabled=0,token_hash=NULL WHERE id=? AND owner=?').run(params.id,u.owner);return NextResponse.json({ok:true});}catch(e){return apiError(e);}}

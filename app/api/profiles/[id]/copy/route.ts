import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireUser,sameOrigin,apiError,ApiError } from '../../../../../lib/auth';
import { db,profileRow } from '../../../../../worker/profile-store.mjs';
import { resolvedSummary } from '../../../../../lib/profiles';
export async function POST(request:Request,{params}:{params:{id:string}}){try{sameOrigin(request);const u=requireUser(request),row=profileRow(params.id,u.owner);if(!row)throw new ApiError(404,'方案不存在');const id=crypto.randomUUID(),store=db();store.exec('BEGIN IMMEDIATE');try{store.prepare('INSERT INTO profiles(id,owner,name,config,updated) VALUES(?,?,?,?,?)').run(id,u.owner,(row.name+' 副本').slice(0,80),row.config,new Date().toISOString());store.prepare('INSERT INTO sounds SELECT ?,name,hash FROM sounds WHERE profile_id=?').run(id,row.id);store.exec('COMMIT');}catch(e){store.exec('ROLLBACK');throw e;}return NextResponse.json(await resolvedSummary(profileRow(id,u.owner)));}catch(e){return apiError(e);}}

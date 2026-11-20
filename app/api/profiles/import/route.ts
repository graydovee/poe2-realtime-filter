import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireUser,sameOrigin,apiError,ApiError } from '../../../../lib/auth';
import { db,profileRow,authorizeSync } from '../../../../worker/profile-store.mjs';
import { resolvedSummary } from '../../../../lib/profiles';

export const runtime='nodejs';export const dynamic='force-dynamic';

export async function POST(request:Request){
 try{
  sameOrigin(request);const user=requireUser(request);const body=await request.json();const raw=typeof body?.url==='string'?body.url.trim():'';if(!raw||raw.length>2048)throw new ApiError(400,'请输入有效的订阅链接');
  let url:URL;try{url=new URL(raw);}catch{throw new ApiError(400,'订阅链接格式不正确');}
  if(url.origin!==new URL(request.url).origin||!url.pathname.startsWith('/sync/'))throw new ApiError(400,'只能导入本站生成的订阅链接');
  const id=url.pathname.slice('/sync/'.length).split('/')[0];const token=new URLSearchParams(url.hash.slice(1)).get('key')||'';if(!/^[0-9a-f-]{20,80}$/i.test(id)||!token)throw new ApiError(400,'订阅链接缺少密钥');
  const source=authorizeSync(id,token);if(!source)throw new ApiError(410,'订阅已停用、删除或密钥已失效');
  const store=db(),newId=crypto.randomUUID(),name=(typeof body?.name==='string'&&body.name.trim()?body.name.trim():source.name+' 导入').slice(0,80);store.exec('BEGIN IMMEDIATE');try{store.prepare('INSERT INTO profiles(id,owner,name,config,updated) VALUES(?,?,?,?,?)').run(newId,user.owner,name,source.config,new Date().toISOString());store.prepare('INSERT INTO sounds SELECT ?,name,hash FROM sounds WHERE profile_id=?').run(newId,source.id);store.exec('COMMIT');}catch(e){store.exec('ROLLBACK');throw e;}
  return NextResponse.json(await resolvedSummary(profileRow(newId,user.owner)),{status:201});
 }catch(e){return apiError(e);}
}

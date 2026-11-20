import { NextResponse } from 'next/server';
import * as oidc from 'openid-client';
import { createSession, db, digest, secret, sessionUser } from '../worker/profile-store.mjs';
export const sessionCookie='poe2_session';
export function appOrigin(request?:Request){return process.env.PUBLIC_ORIGIN || (request ? new URL(request.url).origin : 'https://poe2-filter.qaer.cn');}
export function cookie(request:Request,name:string){return request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);}
export function user(request:Request){return sessionUser(cookie(request,sessionCookie));}
export function requireUser(request:Request){const result=user(request);if(!result)throw new ApiError(401,'请先登录');return result;}
export class ApiError extends Error {constructor(public status:number,message:string){super(message);}}
export function sameOrigin(request:Request){if(request.headers.get('origin')!==appOrigin(request))throw new ApiError(403,'请求来源不匹配');}
export function apiError(error:unknown){return NextResponse.json({error:error instanceof Error?error.message:'请求失败'},{status:error instanceof ApiError?error.status:400});}
let configuration:Promise<oidc.Configuration>|undefined;
export function provider(){
 if(!process.env.OIDC_CLIENT_ID || !process.env.OIDC_CLIENT_SECRET)throw new ApiError(503,'账号登录尚未配置');
 if(!configuration)configuration=oidc.discovery(new URL(process.env.OIDC_ISSUER || 'https://auth.qaer.io'),process.env.OIDC_CLIENT_ID,process.env.OIDC_CLIENT_SECRET).catch(e=>{configuration=undefined;throw e;});
 return configuration;
}
export async function login(request:Request){
 const config=await provider(),state=secret(),nonce=secret(),verifier=oidc.randomPKCECodeVerifier();
 db().prepare('DELETE FROM oauth WHERE expires<?').run(Date.now());
 db().prepare('INSERT INTO oauth VALUES(?,?,?,?)').run(state,verifier,nonce,Date.now()+600000);
 const url=oidc.buildAuthorizationUrl(config,{redirect_uri:appOrigin(request)+'/api/auth/callback',scope:'openid profile email',state,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256'});
 const result=NextResponse.redirect(url);result.cookies.set('poe2_oauth',state,{httpOnly:true,secure:appOrigin(request).startsWith('https:'),sameSite:'lax',path:'/',maxAge:600});return result;
}
export async function callback(request:Request){
 const url=new URL(request.url),state=url.searchParams.get('state');
 if(!state || cookie(request,'poe2_oauth')!==state)throw new ApiError(400,'登录状态校验失败');
 const transaction=db().prepare('SELECT * FROM oauth WHERE state=? AND expires>?').get(state,Date.now());
 db().prepare('DELETE FROM oauth WHERE state=?').run(state);
 if(!transaction)throw new ApiError(400,'登录已过期');
 const config=await provider();
 const publicUrl=new URL(appOrigin(request)+'/api/auth/callback');publicUrl.search=url.search;
 const tokens=await oidc.authorizationCodeGrant(config,publicUrl,{pkceCodeVerifier:transaction.verifier,expectedState:state,expectedNonce:transaction.nonce,idTokenExpected:true});
 const claims=tokens.claims();if(!claims?.sub || !claims.iss)throw new ApiError(400,'无效的身份信息');
 const token=createSession(digest(claims.iss+'\0'+claims.sub),String(claims.preferred_username || claims.name || claims.sub));
 const result=NextResponse.redirect(appOrigin(request));result.cookies.delete('poe2_oauth');result.cookies.set(sessionCookie,token,{httpOnly:true,secure:appOrigin(request).startsWith('https:'),sameSite:'lax',path:'/',maxAge:7*86400});return result;
}

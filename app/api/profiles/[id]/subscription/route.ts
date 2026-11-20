import { NextResponse } from 'next/server';
import { requireUser,sameOrigin,apiError } from '../../../../../lib/auth';
import { subscription,subscriptionKey } from '../../../../../lib/profiles';
export async function POST(request:Request,{params}:{params:{id:string}}){try{sameOrigin(request);const u=requireUser(request);return NextResponse.json(subscription(u.owner,params.id,(await request.json()).action),{headers:{'cache-control':'no-store'}});}catch(e){return apiError(e);}}

export async function GET(request:Request,{params}:{params:{id:string}}){try{const u=requireUser(request);return NextResponse.json(subscriptionKey(u.owner,params.id),{headers:{'cache-control':'no-store'}});}catch(e){return apiError(e);}}

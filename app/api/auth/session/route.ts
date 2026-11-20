import { NextResponse } from 'next/server';
import { user } from '../../../../lib/auth';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){const account=user(request);return NextResponse.json({user:account?{name:account.name}:null,configured:Boolean(process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET)},{headers:{'cache-control':'no-store'}});}

import { callback,apiError } from '../../../../lib/auth';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){try{return await callback(request);}catch(e){return apiError(e);}}

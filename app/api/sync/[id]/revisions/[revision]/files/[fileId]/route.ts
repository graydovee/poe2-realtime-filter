import { apiError } from '../../../../../../../../lib/auth';
import { syncRow,revisionFile } from '../../../../../../../../lib/profiles';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:{id:string;revision:string;fileId:string}}){try{syncRow(params.id,request);const {file,bytes}=await revisionFile(params.id,params.revision,params.fileId);return new Response(new Uint8Array(bytes),{headers:{'content-type':file.kind==='filter'?'text/plain;charset=utf-8':'application/octet-stream','content-length':String(bytes.length),'cache-control':'private, no-store'}});}catch(e){return apiError(e);}}

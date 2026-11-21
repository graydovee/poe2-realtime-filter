import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { db,digest,secret,summary,profileRow,authorizeSync,putSound,soundBytes,storageRoot,encryptKey,decryptKey } from '../worker/profile-store.mjs';
import { ApiError } from './auth';
import { DEFAULT_PROFILE } from './default-profile';
import { ITEM_CATALOG,STYLE_LABELS } from './data';
import { generateFilter } from './filter-engine';
import { getLeagueCatalog, loadMarketSnapshot } from './market';
import { CURRENCY_ANCHORS } from './pricing';
import { normalizeProfile } from './profile';
import type { FilterProfile,FilterRule,PricePoint } from './types';
const safeName=(value:string)=>value.replace(/[^a-zA-Z0-9._-]/g,'_');
const beamPattern=/^(Red|Orange|Yellow|Green|Blue|Cyan|Purple|Pink|White|Brown|Grey)( Temp)?$/;
const iconPattern=/^[012] (Red|Orange|Yellow|Green|Blue|Cyan|Purple|Pink|White|Brown|Grey) (Circle|Star|Diamond|Square|Pentagon|Hexagon|Triangle|Cross|Kite|UpsideDownHouse)$/;
const colorPattern=/^\d{1,3} \d{1,3} \d{1,3}( \d{1,3})?$/;
const number=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const catalogIds=new Set(ITEM_CATALOG.map(i=>i.id));

function validatePoint(point:PricePoint,label:string){
 if(!point||typeof point!=='object')throw new ApiError(400,label+'无效');
 if(!number(point.amount,0,1e12)||!['divine','chaos','exalted'].includes(point.currency))throw new ApiError(400,label+'无效');
 if(point.referenceItemId&&!Object.prototype.hasOwnProperty.call(CURRENCY_ANCHORS,point.referenceItemId))throw new ApiError(400,label+'参考通货无效');
}

function validateRule(rule:FilterRule,ids:Set<string>){
 if(!rule||typeof rule.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(rule.id)||ids.has(rule.id))throw new ApiError(400,'无效规则');
 ids.add(rule.id);
 if(typeof rule.name!=='string'||!rule.name.trim()||rule.name.length>100||/[\r\n]/.test(rule.name))throw new ApiError(400,'规则名称需要1–100个字符');
 if(typeof rule.enabled!=='boolean'||typeof rule.hidden!=='boolean')throw new ApiError(400,'无效规则');
 if(rule.autoRange!==undefined&&typeof rule.autoRange!=='boolean')throw new ApiError(400,'无效规则');
 if(rule.effectPresetId!==undefined&&(typeof rule.effectPresetId!=='string'||rule.effectPresetId.length>60||!/^[a-zA-Z0-9_-]+$/.test(rule.effectPresetId)))throw new ApiError(400,'无效特效预设');
 if(!rule.target||typeof rule.target!=='object')throw new ApiError(400,'规则缺少适用物品');
 const itemIds=rule.target.itemIds;
 if(!Array.isArray(itemIds)||itemIds.length>2000||itemIds.some(id=>typeof id!=='string'||!catalogIds.has(id)))throw new ApiError(400,'规则物品无效');
 const range=rule.target.range;
 if(range){
  if(typeof range!=='object')throw new ApiError(400,'无效价格区间');
  if(range.min)validatePoint(range.min,'价格下限');
  if(range.max)validatePoint(range.max,'价格上限');
 }
 if(rule.target.itemEnabled!==undefined&&typeof rule.target.itemEnabled!=='boolean')throw new ApiError(400,'无效规则');
 if(rule.target.priceEnabled!==undefined&&typeof rule.target.priceEnabled!=='boolean')throw new ApiError(400,'无效规则');
 if(rule.target.itemEnabled===false&&rule.target.priceEnabled===false)throw new ApiError(400,'规则至少要启用一个条件');
 const useItems=rule.target.itemEnabled!==false&&itemIds.length>0;
 const usePrice=rule.target.priceEnabled!==false&&Boolean(range);
 if(!useItems&&!usePrice)throw new ApiError(400,'规则至少要选择物品或价格区间');
 const effects=rule.effects??{};
 if(effects.beam!==undefined&&!beamPattern.test(effects.beam))throw new ApiError(400,'无效光柱');
 if(effects.icon!==undefined&&!iconPattern.test(effects.icon))throw new ApiError(400,'无效地图图标');
 const font=effects.font;
 if(font){
  if(font.fontSize!==undefined&&(!Number.isInteger(font.fontSize)||!number(font.fontSize,18,45)))throw new ApiError(400,'字体范围为18–45');
  for(const color of [font.textColor,font.borderColor,font.backgroundColor])if(color!==undefined&&(!colorPattern.test(color)||color.split(' ').some(n=>+n>255)))throw new ApiError(400,'无效颜色');
 }
 const sound=effects.sound;
 if(sound&&(sound.type==='builtin'?!Number.isInteger(sound.id)||!number(sound.id,1,16)||!number(sound.volume,0,300):!['custom','neversink'].includes(sound.type)||typeof sound.fileName!=='string'||safeName(sound.fileName)!==sound.fileName||!/^.+\.(mp3|wav|ogg)$/i.test(sound.fileName)))throw new ApiError(400,'无效音效');
}

export function validateProfile(input:unknown):FilterProfile {
 const p=normalizeProfile(input);
 if(!Number.isInteger(p.strictness)||p.strictness<0||p.strictness>6||!Object.prototype.hasOwnProperty.call(STYLE_LABELS,p.style)||!['cn','tw','us'].includes(p.locale))throw new ApiError(400,'无效的基础过滤器');
 if(typeof p.league!=='string'||!p.league.trim()||p.league.length>120||typeof p.originalLeague!=='string'||!p.originalLeague.trim()||p.originalLeague.length>120)throw new ApiError(400,'无效赛季');
 if(!Array.isArray(p.rules)||p.rules.length>100)throw new ApiError(400,'自定义规则过多');
 const ids=new Set<string>();
 for(const rule of p.rules)validateRule(rule,ids);
 if(!Array.isArray(p.skippedItemIds)||p.skippedItemIds.length>5000||p.skippedItemIds.some(id=>typeof id!=='string'||!catalogIds.has(id)))throw new ApiError(400,'跳过名单无效');
 return JSON.parse(JSON.stringify(p));
}

/** Keep the original league for display while moving retired seasons to a permanent league. */
export async function resolveProfileLeague(profile: FilterProfile): Promise<FilterProfile> {
 const originalLeague = profile.originalLeague || profile.league;
 try {
  const catalog = await getLeagueCatalog();
  if (catalog.leagues.some((league) => league.id === profile.league)) return { ...profile, originalLeague };
  const hardcore = originalLeague === 'Hardcore' || /^HC\b/i.test(originalLeague);
  const fallback = hardcore && catalog.leagues.some((league) => league.id === 'Hardcore') ? 'Hardcore' : catalog.leagues.some((league) => league.id === 'Standard') ? 'Standard' : catalog.defaultLeague;
  return { ...profile, league: fallback, originalLeague };
 } catch {
  return { ...profile, originalLeague };
 }
}

export async function resolvedSummary(row:any) {
 const result = summary(row);
 result.profile = await resolveProfileLeague(result.profile);
 return result;
}
export async function profileInput(request:Request){
 if(Number(request.headers.get('content-length')||0)>34*1024*1024)throw new ApiError(413,'方案上传过大');
 const form=await request.formData();const profile=validateProfile(JSON.parse(String(form.get('profile'))));const name=String(form.get('name')||'').trim();
 if(!name||name.length>80)throw new ApiError(400,'方案名称需要1–80个字符');
 const sounds=new Map<string,string>();let total=0;
 for(const [key,value] of form.entries()){
  if(!key.startsWith('sound:')||typeof value==='string'||value.size===0)continue;
  total+=value.size;if(value.size>8*1024*1024||total>32*1024*1024)throw new ApiError(413,'单个音效最多8MB，合计最多32MB');
  const rule=profile.rules.find(r=>r.id===key.slice(6));if(!rule||rule.effects.sound?.type!=='custom')throw new ApiError(400,'音效与规则不匹配');
  if(safeName(value.name)!==rule.effects.sound.fileName)throw new ApiError(400,'音效文件名不匹配');
  const hash=putSound(Buffer.from(await value.arrayBuffer()));
  if(sounds.has(rule.effects.sound.fileName)&&sounds.get(rule.effects.sound.fileName)!==hash)throw new ApiError(400,'不同音效不能重名');sounds.set(rule.effects.sound.fileName,hash);
 }
 return {name,profile,sounds,version:Number(form.get('version')||0)};
}
export function saveProfile(owner:string,input:Awaited<ReturnType<typeof profileInput>>,id?:string){
 const store=db(),existing=id?profileRow(id,owner):undefined;if(id&&!existing)throw new ApiError(404,'方案不存在');
 const profileId=id||crypto.randomUUID();
 const retained=new Map<string,string>((existing?store.prepare('SELECT name,hash FROM sounds WHERE profile_id=?').all(profileId):[]).map((r:any)=>[r.name,r.hash]));
 for(const [name,hash] of input.sounds)retained.set(name,hash);
 for(const rule of input.profile.rules)if(rule.effects.sound?.type==='custom'&&!retained.has(rule.effects.sound.fileName))throw new ApiError(400,'请上传音效：'+rule.effects.sound.fileName);
 store.exec('BEGIN IMMEDIATE');
 try{
  if(existing){if(existing.version!==input.version)throw new ApiError(409,'方案已被其他页面修改，请重新打开');store.prepare('UPDATE profiles SET name=?,config=?,version=version+1,updated=? WHERE id=? AND owner=?').run(input.name,JSON.stringify(input.profile),new Date().toISOString(),profileId,owner);}
  else store.prepare('INSERT INTO profiles(id,owner,name,config,updated) VALUES(?,?,?,?,?)').run(profileId,owner,input.name,JSON.stringify(input.profile),new Date().toISOString());
  for(const [name,hash] of retained)store.prepare('INSERT OR REPLACE INTO sounds VALUES(?,?,?)').run(profileId,name,hash);
  store.exec('COMMIT');
 }catch(e){store.exec('ROLLBACK');throw e;}
 return summary(profileRow(profileId,owner));
}
export function subscription(owner:string,id:string,action:string){
 if(!profileRow(id,owner))throw new ApiError(404,'方案不存在');
 if(action==='disable'){db().prepare('UPDATE profiles SET enabled=0 WHERE id=? AND owner=?').run(id,owner);return {enabled:false};}
 if(!['create','reset'].includes(action))throw new ApiError(400,'无效操作');
 const key=secret();db().prepare('UPDATE profiles SET enabled=1,token_hash=? WHERE id=? AND owner=?').run(digest(key),id,owner);db().prepare('INSERT OR REPLACE INTO subscription_keys VALUES(?,?)').run(id,encryptKey(key));return {enabled:true,key};
}
export function syncRow(id:string,request:Request){
 const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];const row=authorizeSync(id,token||'');if(!row)throw new ApiError(410,'订阅已停用、删除或密钥已失效');return row;
}
const rendering=new Map<string,Promise<any>>();
export async function latestManifest(row:any){
 if(rendering.has(row.id))return rendering.get(row.id);
 const task=renderManifest(row);rendering.set(row.id,task);try{return await task;}finally{rendering.delete(row.id);}
}
async function renderManifest(row:any){
 const store=db();const status=store.prepare('SELECT * FROM sync_status WHERE profile_id=?').get(row.id);
 const previous=status?.latest?store.prepare('SELECT manifest FROM revisions WHERE profile_id=? AND revision=?').get(row.id,status.latest):undefined;
 try{
 const config=await resolveProfileLeague(validateProfile(JSON.parse(row.config)));const market=await loadMarketSnapshot(config.league);
  if(!market.rates||Date.parse(market.expiresAt)<=Date.now())throw new Error('所选赛季行情暂不可用');
  const generated=generateFilter(config,market);if(!generated.safetyReport.passed)throw new Error('生成检查未通过');
  const assets=new Map<string,Buffer>();
  for(const name of generated.soundFiles){
   if(safeName(name)!==name)throw new Error('音效路径无效');
   const saved=store.prepare('SELECT hash FROM sounds WHERE profile_id=? AND name=?').get(row.id,name);
   const bytes=saved?soundBytes(saved.hash):await fs.readFile(path.join(process.cwd(),'vendor/neversink/(STYLE) CUSTOMSOUNDS',name));assets.set(name,bytes);
  }
  const revision=digest(generated.filterFile+JSON.stringify([...assets].map(([n,b])=>[n,digest(b)]))).slice(0,32);
  let text=generated.filterFile;
  for(const name of assets.keys())text=text.split('"'+name+'"').join('"poe2-filter-assets/'+row.id+'/'+revision+'/'+name+'"');
  const files=[{id:'filter',path:'poe2-filter-'+row.id+'.filter',kind:'filter',bytes:Buffer.from(text)},...[...assets].map(([name,bytes],index)=>({id:'sound-'+index,path:'poe2-filter-assets/'+row.id+'/'+revision+'/'+name,kind:'sound',bytes}))];
  const manifest={protocolVersion:1,profileId:row.id,name:row.name,league:config.league,configVersion:row.version,revision,marketCapturedAt:market.capturedAt,generatedAt:new Date().toISOString(),files:files.map(f=>({id:f.id,path:f.path,kind:f.kind,size:f.bytes.length,sha256:digest(f.bytes)}))};
  const dir=path.join(storageRoot(),'revisions',row.id,revision);await fs.mkdir(dir,{recursive:true});
  for(const file of files)await fs.writeFile(path.join(dir,file.id),file.bytes);
  const current=store.prepare('SELECT version,deleted,enabled FROM profiles WHERE id=?').get(row.id);if(!current||current.deleted||!current.enabled||current.version!==row.version)throw new Error('方案已修改，请重试');
  store.exec('BEGIN IMMEDIATE');try{store.prepare('INSERT OR REPLACE INTO revisions VALUES(?,?,?,?,?)').run(row.id,revision,row.version,JSON.stringify(manifest),manifest.generatedAt);store.prepare('INSERT OR REPLACE INTO sync_status VALUES(?,?,NULL,?)').run(row.id,revision,new Date().toISOString());store.exec('COMMIT');}catch(e){store.exec('ROLLBACK');throw e;}
  return manifest;
 }catch(error){
  const message=error instanceof Error?error.message:'生成失败';store.prepare('INSERT INTO sync_status(profile_id,error,checked) VALUES(?,?,?) ON CONFLICT(profile_id) DO UPDATE SET error=excluded.error,checked=excluded.checked').run(row.id,message,new Date().toISOString());
  if(previous)return {...JSON.parse(previous.manifest),stale:true,error:message};throw new ApiError(503,message);
 }
}
export async function revisionFile(profileId:string,revision:string,fileId:string){
 const saved=db().prepare('SELECT manifest FROM revisions WHERE profile_id=? AND revision=?').get(profileId,revision);if(!saved)throw new ApiError(404,'版本不存在');
 const manifest=JSON.parse(saved.manifest),file=manifest.files.find((f:any)=>f.id===fileId);if(!file)throw new ApiError(404,'文件不存在');
 const bytes=await fs.readFile(path.join(storageRoot(),'revisions',profileId,revision,fileId));if(digest(bytes)!==file.sha256)throw new ApiError(503,'文件校验失败');return {file,bytes};
}

export function subscriptionKey(owner:string,id:string){const row=profileRow(id,owner);if(!row)throw new ApiError(404,'方案不存在');const saved=db().prepare('SELECT encrypted FROM subscription_keys WHERE profile_id=?').get(id);return {enabled:Boolean(row.enabled),key:row.enabled&&saved?decryptKey(saved.encrypted):undefined};}
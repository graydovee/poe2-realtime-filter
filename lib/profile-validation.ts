import { DEFAULT_EFFECT_ITEMS } from "./baseline-effects";
import { FILTER_ITEMS_BY_ID, STYLE_LABELS } from "./data";
import { dropConditionsIssue } from "./drop-conditions";
import { CURRENCY_ANCHORS } from "./pricing";
import { normalizeProfile } from "./profile";
import type { BuiltinSound, FilterProfile, FilterRule, PricePoint } from "./types";

const safeName=(value:string)=>value.replace(/[^a-zA-Z0-9._-]/g,'_');
const beamPattern=/^(Red|Orange|Yellow|Green|Blue|Cyan|Purple|Pink|White|Brown|Grey)( Temp)?$/;
const iconPattern=/^[012] (Red|Orange|Yellow|Green|Blue|Cyan|Purple|Pink|White|Brown|Grey) (Circle|Star|Diamond|Square|Pentagon|Hexagon|Triangle|Cross|Kite|UpsideDownHouse|Moon|Raindrop)$/;
const colorPattern=/^\d{1,3} \d{1,3} \d{1,3}( \d{1,3})?$/;
const number=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const validBuiltinSound=(sound:BuiltinSound)=>sound.type==='builtin'&&Number.isInteger(sound.id)&&number(sound.id,1,16)&&number(sound.volume,0,300)&&(sound.positional===undefined||typeof sound.positional==='boolean');


function validatePoint(point:PricePoint,label:string){
 if(!point||typeof point!=='object')throw new Error(label+'无效');
 if(!number(point.amount,0,1e12)||!['divine','chaos','exalted'].includes(point.currency))throw new Error(label+'无效');
 if(point.referenceItemId&&!Object.prototype.hasOwnProperty.call(CURRENCY_ANCHORS,point.referenceItemId))throw new Error(label+'参考通货无效');
}

function validateRule(rule:FilterRule,ids:Set<string>){
 if(!rule||typeof rule.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(rule.id)||ids.has(rule.id))throw new Error('无效规则');
 ids.add(rule.id);
 if(typeof rule.name!=='string'||!rule.name.trim()||rule.name.length>100||/[\r\n]/.test(rule.name))throw new Error('规则名称需要1–100个字符');
 if(typeof rule.enabled!=='boolean'||typeof rule.hidden!=='boolean')throw new Error('无效规则');
 if(rule.followBaseline!==undefined&&(typeof rule.followBaseline!=='boolean'||!Object.prototype.hasOwnProperty.call(DEFAULT_EFFECT_ITEMS,rule.id)))throw new Error('无效的基础特效跟随设置');
 if(rule.autoRange!==undefined&&typeof rule.autoRange!=='boolean')throw new Error('无效规则');
 if(rule.effectPresetId!==undefined&&(typeof rule.effectPresetId!=='string'||rule.effectPresetId.length>60||!/^[a-zA-Z0-9_-]+$/.test(rule.effectPresetId)))throw new Error('无效特效预设');
 if(!rule.target||typeof rule.target!=='object')throw new Error('规则缺少适用物品');
 const itemIds=rule.target.itemIds;
 if(!Array.isArray(itemIds)||itemIds.length>2000||itemIds.some(id=>typeof id!=='string'||!FILTER_ITEMS_BY_ID.has(id)))throw new Error('规则物品无效');
 const range=rule.target.range;
 if(range){
  if(typeof range!=='object')throw new Error('无效价格区间');
  if(range.min)validatePoint(range.min,'价格下限');
  if(range.max)validatePoint(range.max,'价格上限');
 }
 if(rule.target.itemEnabled!==undefined&&typeof rule.target.itemEnabled!=='boolean')throw new Error('无效规则');
 if(rule.target.priceEnabled!==undefined&&typeof rule.target.priceEnabled!=='boolean')throw new Error('无效规则');
 if(rule.target.itemEnabled===false&&rule.target.priceEnabled===false)throw new Error('规则至少要启用一个条件');
 const useItems=rule.target.itemEnabled!==false&&itemIds.length>0;
 const usePrice=rule.target.priceEnabled!==false&&Boolean(range);
 if(rule.enabled&&!useItems&&!usePrice)throw new Error('规则至少要选择物品或价格区间');
 const dropIssue = dropConditionsIssue(rule);
 if (dropIssue) throw new Error(`「${rule.name}」${dropIssue}`);
 const effects=rule.effects??{};
 if(effects.beam!==undefined&&!beamPattern.test(effects.beam))throw new Error('无效光柱');
 if(effects.icon!==undefined&&!iconPattern.test(effects.icon))throw new Error('无效地图图标');
 const font=effects.font;
 if(font){
  if(font.fontSize!==undefined&&(!Number.isInteger(font.fontSize)||!number(font.fontSize,1,45)))throw new Error('字体范围为1–45');
  for(const color of [font.textColor,font.borderColor,font.backgroundColor])if(color!==undefined&&(!colorPattern.test(color)||color.split(' ').some(n=>+n>255)))throw new Error('无效颜色');
 }
 const sound=effects.sound;
 if(sound?.type==='baseline'){
  const name=sound.fileName;
  if(typeof name!=='string'||name.length>1024||name.split(';').some(file=>!/^.+\.(mp3|wav|ogg)$/i.test(file)||file.split('/').some(part=>!part||part==='.'||part==='..'||/[\\:"<>|?*\x00-\x1f]/.test(part))))throw new Error('无效的基础过滤器音效路径');
  if(sound.fallback!==undefined&&(!sound.optional||!sound.fallback||!validBuiltinSound(sound.fallback)))throw new Error('无效的备用音效');
  if(sound.optional!==undefined&&typeof sound.optional!=='boolean'||sound.volume!==undefined&&!number(sound.volume,0,300))throw new Error('无效音效');
 }else if(sound&&(sound.type==='builtin'?!validBuiltinSound(sound):!['custom','neversink'].includes(sound.type)||typeof sound.fileName!=='string'||safeName(sound.fileName)!==sound.fileName||!/^.+\.(mp3|wav|ogg)$/i.test(sound.fileName)))throw new Error('无效音效');
}

export function validateProfile(input:unknown):FilterProfile {
 const p=normalizeProfile(input);
 if(!Number.isInteger(p.strictness)||p.strictness<0||p.strictness>6||!Object.prototype.hasOwnProperty.call(STYLE_LABELS,p.style)||!['cn','tw','us'].includes(p.locale))throw new Error('无效的基础过滤器');
 const base=p.baseFilter;
 const name=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=260&&!/[\x00-\x1f]/.test(value);
 const path=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=32767&&!/[\x00-\x1f]/.test(value);
 if (base !== undefined) {
  const validLocation = base?.kind === 'local' && path(base.path)
   || base?.kind === 'subscribed' && ['online', 'wegame'].includes(base.source) && path(base.directory) && path(base.entry)
   || base?.kind === 'downloaded' && name(base.source) && name(base.version) && path(base.entry);
  if (!validLocation || !name(base.name)) throw new Error('无效的基础过滤器来源');
 }
 if(p.baseFilterHint!==undefined&&!name(p.baseFilterHint))throw new Error('无效的基础过滤器名称');
 if (p.server !== 'tencent' && (!p.league || !p.originalLeague))throw new Error('无效赛季');
 if(!Array.isArray(p.rules)||p.rules.length>100)throw new Error('自定义规则过多');
 const ids=new Set<string>();
 for(const rule of p.rules)validateRule(rule,ids);
 if(!Array.isArray(p.skippedItemIds)||p.skippedItemIds.length>5000||p.skippedItemIds.some(id=>typeof id!=='string'||!FILTER_ITEMS_BY_ID.has(id)))throw new Error('跳过名单无效');
 return JSON.parse(JSON.stringify(p));
}

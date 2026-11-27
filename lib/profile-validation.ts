import { canFollowBaselineItem } from "./baseline-effects";
import { blockKey, conditionLineIssue, MAX_CONDITIONS, MAX_CONDITION_LENGTH, MAX_OVERLAYS } from "./base-overlays";
import { FILTER_ITEMS_BY_ID, STYLE_LABELS } from "./data";
import { dropConditionsIssue } from "./drop-conditions";
import { mapIconShapes } from "./effect-labels";
import { normalizeProfile } from "./profile";
import type { BaseOverlay, BuiltinSound, FilterProfile, FilterRule, PricePoint, RuleEffects } from "./types";

const safeName=(value:string)=>value.replace(/[^a-zA-Z0-9._-]/g,'_');
const beamPattern=/^(Red|Orange|Yellow|Green|Blue|Cyan|Purple|Pink|White|Brown|Grey)( Temp)?$/;
const iconPattern=new RegExp(`^[012] (Red|Orange|Yellow|Green|Blue|Cyan|Purple|Pink|White|Brown|Grey) (${mapIconShapes.join("|")})$`);
const colorPattern=/^\d{1,3} \d{1,3} \d{1,3}( \d{1,3})?$/;
const number=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const validBuiltinSound=(sound:BuiltinSound)=>sound.type==='builtin'&&Number.isInteger(sound.id)&&number(sound.id,1,16)&&number(sound.volume,0,300)&&(sound.positional===undefined||typeof sound.positional==='boolean');


function validatePoint(point:PricePoint,label:string){
 if(!point||typeof point!=='object')throw new Error(label+'无效');
 if(!number(point.amount,0,1e12)||!['divine','chaos','exalted','annulment'].includes(point.currency))throw new Error(label+'无效');
}

function validateRule(rule:FilterRule,ids:Set<string>){
 if(!rule||typeof rule.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(rule.id)||ids.has(rule.id))throw new Error('无效规则');
 ids.add(rule.id);
 if(typeof rule.name!=='string'||!rule.name.trim()||rule.name.length>100||/[\r\n]/.test(rule.name))throw new Error('规则名称需要1–100个字符');
 if(typeof rule.enabled!=='boolean'||typeof rule.hidden!=='boolean')throw new Error('无效规则');
 if(rule.followBaseline!==undefined&&rule.followBaseline!==false)throw new Error('无效的基础特效跟随设置');
 const source=rule.baselineEffectItemId;
 if(source!==undefined&&(typeof source!=='string'||!canFollowBaselineItem(FILTER_ITEMS_BY_ID.get(source))))throw new Error('无效的基础特效参考物品');
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
 validateEffects(rule.effects??{});
}

/** 特效和音效的取值范围。修改可以把光柱设成 `None`，把基础规则原本的光柱去掉。 */
function validateEffects(effects:RuleEffects|undefined,allowNoBeam=false){
 if(!effects)return;
 if(effects.beam!==undefined&&!(allowNoBeam&&effects.beam==='None')&&!beamPattern.test(effects.beam))throw new Error('无效光柱');
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

/** 一处对基础规则的修改。`ids` 和规则共用；`keys` 保证同一条基础规则只有一处修改。 */
function validateOverlay(overlay:BaseOverlay,ids:Set<string>,keys:Set<string>){
 if(!overlay||typeof overlay.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(overlay.id)||ids.has(overlay.id))throw new Error('无效修改');
 ids.add(overlay.id);
 if(typeof overlay.baseName!=='string'||!overlay.baseName.length||overlay.baseName.length>260||/[\x00-\x1f]/.test(overlay.baseName))throw new Error('无效的修改来源');
 if(!Array.isArray(overlay.conditions)||!overlay.conditions.length||overlay.conditions.length>MAX_CONDITIONS||overlay.conditions.some(line=>typeof line!=='string'||!line.trim()||line.length>MAX_CONDITION_LENGTH||/[\r\n]/.test(line)))throw new Error('修改对应的规则条件无效');
 const key=blockKey(overlay.conditions);
 if(keys.has(key))throw new Error('同一条基础规则只能有一处修改');
 keys.add(key);
 if(overlay.hidden!==undefined&&typeof overlay.hidden!=='boolean')throw new Error('无效修改');
 if(typeof overlay.enabled!=='boolean')throw new Error('无效修改');
 if(overlay.conditionLines!==undefined){
  if(!Array.isArray(overlay.conditionLines)||overlay.conditionLines.length>MAX_CONDITIONS)throw new Error('修改的条件无效');
  for(const line of overlay.conditionLines){
   if(typeof line!=='string')throw new Error('修改的条件无效');
   const issue=conditionLineIssue(line);
   if(issue)throw new Error(`修改的条件无效：${issue}`);
  }
 }
 if(!overlay.effects||typeof overlay.effects!=='object')throw new Error('无效修改');
 validateEffects(overlay.effects,true);
}

export function validateProfile(input:unknown):FilterProfile {
 const p=normalizeProfile(input);
 if(!Number.isInteger(p.strictness)||p.strictness<0||p.strictness>6||!Object.prototype.hasOwnProperty.call(STYLE_LABELS,p.style)||!['cn','tw','us'].includes(p.locale))throw new Error('无效的方案设置');
 const base=p.baseFilter;
 const name=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=260&&!/[\x00-\x1f]/.test(value);
 const path=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=32767&&!/[\x00-\x1f]/.test(value);
 if (base !== undefined) {
  const validLocation = base?.kind === 'local' && path(base.path)
   || base?.kind === 'subscribed' && ['online', 'wegame'].includes(base.source) && path(base.directory) && path(base.entry)
   || base?.kind === 'downloaded' && name(base.source) && name(base.version) && path(base.entry)
   || base?.kind === 'imported' && /^[0-9a-f]{32}$/.test(base.id) && path(base.entry);
  if (!validLocation || !name(base.name)) throw new Error('无效的基础过滤器来源');
 }
 if(p.baseFilterHint!==undefined&&!name(p.baseFilterHint))throw new Error('无效的基础过滤器名称');
 if (p.server !== 'tencent' && (!p.league || !p.originalLeague))throw new Error('无效赛季');
 if(!Array.isArray(p.rules)||p.rules.length>100)throw new Error('自定义规则过多');
 const ids=new Set<string>();
 for(const rule of p.rules)validateRule(rule,ids);
 if(!Array.isArray(p.overlays)||p.overlays.length>MAX_OVERLAYS)throw new Error('对基础规则的修改过多');
 if(typeof p.editsEnabled!=='boolean')throw new Error('无效的基础规则修改设置');
 const keys=new Set<string>();
 for(const overlay of p.overlays)validateOverlay(overlay,ids,keys);
 if(!Array.isArray(p.skippedItemIds)||p.skippedItemIds.length>5000||p.skippedItemIds.some(id=>typeof id!=='string'||!FILTER_ITEMS_BY_ID.has(id)))throw new Error('跳过物品无效');
 return JSON.parse(JSON.stringify(p));
}

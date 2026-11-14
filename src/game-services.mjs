// Shared application services: authoring stays on the server; reviews unlock at game end.
import {createHash} from 'node:crypto';
import {scriptForGame,validateScript,name,plots} from './content.mjs';
import {generateWithAi} from './author.mjs';
import {getCuratedScript} from './script-library.mjs';
import {evaluateScriptQuality} from './script-quality.mjs';

export const AUTHOR_BUDGET=.12;
export const FEEDBACK_RATINGS=['interesting','too_easy','too_hard','unclear','repetitive'];
const serviceError=(message,code,status=400)=>Object.assign(Error(message),{code,status});
const serviceRecord=value=>!!value&&typeof value==='object'&&!Array.isArray(value);

export function creationIdentity(body){
 if(body.requestId===undefined)return null;
 if(typeof body.requestId!=='string'||!/^[-a-zA-Z0-9_]{8,80}$/.test(body.requestId))throw serviceError('开局请求标识无效','INVALID_REQUEST_ID');
 const {requestId,...payload}=body;
 return {requestId,requestHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
}

export function checkCreationReceipt(receipt,identity){
 if(receipt.request_hash!==identity.requestHash)throw serviceError('这次开局设置已经变化，请重新发起开局','CREATE_REQUEST_CONFLICT');
 if(receipt.status==='failed'){
  let saved;try{saved=JSON.parse(receipt.error);}catch{}
  throw serviceError(saved?.message||'上次编剧没有完成，请重新发起开局',saved?.code||'AUTHOR_FAILED',saved?.status||400);
 }
 const stale=Date.now()-Date.parse(receipt.created)>600000;
 throw serviceError(stale?'上次开局的结果未能确认，请先检查存档，再重新发起开局。':'这次编剧仍在处理，可稍后继续恢复。',stale?'CREATION_UNKNOWN':'CREATION_PENDING',409);
}

export function creationFailure(error){return JSON.stringify({code:error.code||'AUTHOR_FAILED',message:String(error.message||'开局未完成').slice(0,400),status:error.status||400});}

export async function prepareGameScript(body={},aiOptions={}){
 if(!serviceRecord(body))throw serviceError('开局设置必须是对象','INVALID_SETUP');
 if([body.setup,body.script,body.libraryId].filter(value=>value!==undefined).length>1)throw serviceError('只能选择一种剧本来源','INVALID_SETUP');
 if(body.communication!==undefined&&!['between_loops_only','allowed_during_loop'].includes(body.communication))throw serviceError('请选择主人公何时可以讨论','INVALID_SETUP');
 let script;
 if(body.libraryId!==undefined){
  if(typeof body.libraryId!=='string')throw serviceError('精选剧本编号无效','INVALID_SETUP');
  script=getCuratedScript(body.libraryId);
  if(!script)throw serviceError('找不到这份精选剧本','SCRIPT_NOT_FOUND',404);
 }else if(body.setup!==undefined){
  if(!serviceRecord(body.setup))throw serviceError('生成设置必须是对象','INVALID_SETUP');
  const setup={...body.setup,...(body.communication===undefined?{}:{communication:body.communication})};
  const generation=setup.generation??'random';
  if(!['random','ai'].includes(generation))throw serviceError('请选择快速随机或 AI 编剧','INVALID_SETUP');
  if(generation==='ai')script=await generateWithAi({...setup,incidentVisibility:'public'},{...aiOptions,authorBudget:AUTHOR_BUDGET});
  else script=scriptForGame({...body,setup});
 }else script=scriptForGame(body);
 if(body.communication!==undefined&&serviceRecord(script))script.communication=body.communication;
 const errors=validateScript(script).errors;
 if(errors.length)throw serviceError(errors.map(e=>e.message).join('；'),'INVALID_SCRIPT');
 return structuredClone(script);
}

export function scriptFingerprint(script){
 // Public display never receives this input; the digest groups feedback across retries/branches.
 const {ruleset,days,loops,characters,mainPlot,subPlots,roles,incidents,settings,specialRules}=script;
 return createHash('sha256').update(JSON.stringify({ruleset,days,loops,characters,mainPlot,subPlots,roles,incidents,settings,specialRules})).digest('hex');
}

export function validateFeedback(state,body){
 if(state.phase!=='over')throw serviceError('对局结束后才能评价剧本','GAME_NOT_OVER',403);
 if(!serviceRecord(body)||!FEEDBACK_RATINGS.includes(body.rating))throw serviceError('请选择一个剧本评价','INVALID_FEEDBACK');
 const source=[state.script.source,state.script.generation?.source].find(value=>['random','curated','ai','imported'].includes(value))||'imported';
 return {rating:body.rating,scriptHash:scriptFingerprint(state.script),source,updated:new Date().toISOString()};
}

export function gameReview(state,feedback=null){
 if(state.phase!=='over')throw serviceError('对局结束后才能查看复盘','GAME_NOT_OVER',403);
 const script=state.script,design=script.privateDesign||{},ruleIds=[script.mainPlot,...script.subPlots];
 const ruleEffects=ruleIds.filter(id=>plots[id]).map(id=>({id,name:plots[id].name_zh_working,effect:plots[id].effect_zh}));
 const source=[script.source,script.generation?.source].find(value=>['random','curated','ai','imported'].includes(value))||'imported';
 const list=value=>Array.isArray(value)?value.filter(x=>typeof x==='string'):typeof value==='string'&&value?[value]:[];
 const alternatives=list(design.counterplay);
 if(!alternatives.length)alternatives.push('回看第一次失败之前的计数与位置，比较改变一张行动牌能否阻止这条失败路径。');
 if(script.ruleset!=='FS')alternatives.push('轮回中的生存与最后的战斗是两条获胜途径；复盘时也可检查公开线索是否足以区分尚未确认的配役。');
 return {
  title:script.title,source,ruleEffects,
  summary:`${state.winner==='heroes'?'主人公':'剧作家'}获胜。实际规则：${ruleIds.map(name).join('、')}。`,
  design:Object.keys(design).length?structuredClone(design):{threatPlan:ruleIds.map(id=>`${name(id)}：${plots[id]?.effect_zh||'结合配役与人物能力判断。'}`).join('\n')},
  clues:state.log.filter(e=>['incident','death','reveal','failed','refused','ignored'].includes(e.type)).slice(-30).map(({loop,day,text})=>({loop,day,text})),
  alternatives,quality:evaluateScriptQuality(script,{design}),feedback:feedback?{rating:feedback.rating,updated:feedback.updated}:null,
  note:source==='ai'?'模型说明可能误述规则，请以本场实际规则与速查为准；有限试跑不等于平衡性证明。':'设计说明与筛查结果用于复盘；有限试跑不等于平衡性证明。'
 };
}

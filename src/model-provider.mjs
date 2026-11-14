// Credentials stay in process memory (environment or hidden stdin at startup).
let key=process.env.DEEPSEEK_API_KEY||'';
export function configureKey(value){if(typeof value!=='string'||value.length<10)throw Error('无效密钥');key=value;}
export const model=process.env.DEEPSEEK_MODEL||'deepseek-flash';
const base=(process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com').replace(/\/$/,'');
export const configured=()=>Boolean(key);
export class AiError extends Error{constructor(code,message){super(message);this.code=code;}}
// Conservative application estimate, deliberately above the verified off-peak rate.
// This is not a supplier invoice; tokens and cache hits are recorded separately.
export const rates={input:0.30,cached:0.006,output:1.20,currency:'USD',kind:'conservative_estimate',asOf:'2026-11-08'};
export function estimateUsage(u){const hit=u.prompt_cache_hit_tokens||0,miss=u.prompt_cache_miss_tokens??Math.max(0,(u.prompt_tokens||0)-hit);return (miss*rates.input+hit*rates.cached+(u.completion_tokens||0)*rates.output)/1e6;}
export function reserveFor(messages,maxTokens=1800){return (Buffer.byteLength(JSON.stringify(messages))*rates.input+maxTokens*rates.output)/1e6;}
export async function requestJson(messages,{userId='local',maxTokens=1800,thinking='disabled',reasoningEffort='low',timeoutMs=90000,onReserve=()=>{},onUsage=()=>{},apiKey=key}={}){
 if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>16384||!['enabled','disabled'].includes(thinking)||!['low','high','max'].includes(reasoningEffort)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>90000)throw new AiError('MODEL_OPTIONS','模型推理设置无效');
 if(!apiKey)throw new AiError('NO_KEY','还没有配置 DeepSeek 密钥，可以改用离线机器人。');
 if(new URL(base).origin!=='https://api.deepseek.com')throw new AiError('BASE_URL','只能连接 DeepSeek 的官方地址');
 const reserved=reserveFor(messages,maxTokens);await onReserve(reserved);
 const started=Date.now();let data;
 try{
  const res=await fetch(base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:JSON.stringify({model,messages,response_format:{type:'json_object'},thinking:{type:thinking},...(thinking==='enabled'?{reasoning_effort:reasoningEffort}:{}),max_tokens:maxTokens,stream:false,user_id:userId}),signal:AbortSignal.timeout(timeoutMs)});
  if(!res.ok){await onUsage({status:'rejected',httpStatus:res.status,reserved,estimatedCost:0,latencyMs:Date.now()-started});throw new AiError('PROVIDER_'+res.status,`DeepSeek 返回了错误（HTTP ${res.status}），局面没有变化。`);}
  data=await res.json();
 }catch(e){if(e instanceof AiError)throw e;await onUsage({status:'unknown',reserved,estimatedCost:reserved,latencyMs:Date.now()-started});throw new AiError('NETWORK','DeepSeek 的请求没有完成，可能已经计费，所以没有自动重试。');}
 const usage=data.usage||{},cost=estimateUsage(usage);await onUsage({status:'completed',model:data.model||model,requestId:data.id,thinking,reasoningEffort:thinking==='enabled'?reasoningEffort:undefined,usage,estimatedCost:cost,reserved,latencyMs:Date.now()-started});
 if(data.choices?.[0]?.finish_reason==='length')throw new AiError('TRUNCATED','模型的回答太长被截断了，这一步没有执行。');
 const parsed=parseModelJson(data.choices?.[0]?.message?.content);if(parsed===undefined)throw new AiError('BAD_JSON','模型的回答格式不对，这一步没有执行。');return parsed;
}
// Providers occasionally wrap JSON in fences or emit a broken fragment before the
// real object; accept the last complete object instead of spending a repair call.
export function parseModelJson(text){
 if(typeof text!=='string')return undefined;
 const trimmed=text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1');
 try{const value=JSON.parse(trimmed);if(value&&typeof value==='object'&&!Array.isArray(value))return value;}catch{}
 let found;
 for(let start=trimmed.indexOf('{');start>=0;start=trimmed.indexOf('{',start+1)){
  let depth=0,inString=false,escaped=false;
  for(let i=start;i<trimmed.length;i++){
   const ch=trimmed[i];
   if(inString){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inString=false;continue;}
   if(ch==='"')inString=true;else if(ch==='{')depth++;else if(ch==='}'&&--depth===0){try{const value=JSON.parse(trimmed.slice(start,i+1));if(value&&typeof value==='object'&&!Array.isArray(value))found=value;}catch{}break;}
  }
 }
 return found;
}

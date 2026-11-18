import {createHash} from 'node:crypto';
import {cacheDecisionMessages} from './prompt-cache.mjs';

// Credentials stay in process memory, independently per provider. Worker callers
// pass the selected runtime secret into requestJson; it never becomes public info.
const keys={deepseek:process.env.DEEPSEEK_API_KEY||'',openrouter:process.env.OPENROUTER_API_KEY||''};
export class AiError extends Error{constructor(code,message){super(message);this.code=code;}}
export const model=process.env.DEEPSEEK_MODEL||'deepseek-flash';
const base=(process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com').replace(/\/$/,'');
// DeepSeek keeps the conservative peak estimate for existing saved budgets.
// Sol settles with OpenRouter usage.cost when supplied; these rates only cover
// fallback estimates and reservations, including the observed cache-write price.
export const rates=Object.freeze({input:0.30,cached:0.006,output:1.20,currency:'USD',kind:'conservative_estimate',asOf:'2026-11-08'});
const solRates=Object.freeze({input:2,cached:0.1,cacheWrite:2.5,output:10,currency:'USD',kind:'provider_reported_or_estimate',asOf:'2026-11-18'});
const providerIds=['deepseek','openrouter'];
function checkProvider(provider){if(!providerIds.includes(provider))throw new AiError('MODEL_PROVIDER','请选择 DeepSeek 或 GPT-6.2 Sol。');return provider;}
export function modelFor(provider='deepseek'){
 checkProvider(provider);
 if(provider==='openrouter')return 'openai/gpt-6.2-sol';
 if(!['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp'].includes(model))throw new AiError('MODEL_OPTIONS','当前仅支持 DeepSeek Flash 官方模型。');
 return model;
}
export function providerLabel(provider='deepseek'){return checkProvider(provider)==='openrouter'?'GPT-6.2 Sol':'DeepSeek';}
export function ratesFor(provider='deepseek'){return checkProvider(provider)==='openrouter'?solRates:rates;}
export function configureKey(value,provider='deepseek'){checkProvider(provider);if(typeof value!=='string'||value.length<10)throw new AiError('NO_KEY','无效密钥');keys[provider]=value;}
export const configured=(provider='deepseek')=>Boolean(keys[checkProvider(provider)]);
export function providersInfo(env){return providerIds.map(id=>({id,label:providerLabel(id),model:modelFor(id),configured:env===undefined?configured(id):Boolean(env?.[id==='openrouter'?'OPENROUTER_API_KEY':'DEEPSEEK_API_KEY']),rates:ratesFor(id)}));}
const count=value=>Number.isFinite(value)&&value>=0?value:0;
export function normalizeUsage(usage={}){
 const inputTokens=count(usage.prompt_tokens),outputTokens=count(usage.completion_tokens);
 const cachedInputTokens=Math.min(inputTokens,count(usage.prompt_cache_hit_tokens??usage.prompt_tokens_details?.cached_tokens));
 const cacheWriteTokens=Math.min(Math.max(0,inputTokens-cachedInputTokens),count(usage.prompt_tokens_details?.cache_write_tokens));
 return {inputTokens,cachedInputTokens,cacheWriteTokens,outputTokens,reasoningTokens:Math.min(outputTokens,count(usage.completion_tokens_details?.reasoning_tokens))};
}
export function estimateUsage(usage={},provider='deepseek'){
 const prices=ratesFor(provider),tokens=normalizeUsage(usage);
 const miss=provider==='deepseek'&&Number.isFinite(usage.prompt_cache_miss_tokens)?count(usage.prompt_cache_miss_tokens):Math.max(0,tokens.inputTokens-tokens.cachedInputTokens);
 // If OpenRouter omits write counters along with its invoice cost, reserve the
 // more expensive write rate for misses rather than silently undercount them.
 const writes=provider==='openrouter'&&!Number.isFinite(usage.prompt_tokens_details?.cache_write_tokens)?miss:Math.min(miss,tokens.cacheWriteTokens);
 return ((miss-writes)*prices.input+tokens.cachedInputTokens*prices.cached+writes*(prices.cacheWrite??prices.input)+tokens.outputTokens*prices.output)/1e6;
}
export function reserveFor(messages,maxTokens=1800,provider='deepseek'){
 const prices=ratesFor(provider),bytes=new TextEncoder().encode(JSON.stringify(messages)).length;
 return (bytes*Math.max(prices.input,prices.cacheWrite||0)+maxTokens*prices.output)/1e6;
}
export async function requestJson(messages,{provider='deepseek',userId='local',cacheKey,maxTokens=1800,thinking='disabled',reasoningEffort='low',timeoutMs=90000,onReserve=()=>{},onUsage=()=>{},apiKey,model:requestedModel,cacheLayout='legacy',benchmarkModel}={}){
 const selectedModel=benchmarkModel||modelFor(provider),modelLabel=benchmarkModel==='openai/gpt-6-luna'?'GPT-6 Luna':benchmarkModel==='google/gemini-4-hydrogen'?'Gemini 4 Hydrogen':providerLabel(provider),sol=provider==='openrouter',hydrogen=benchmarkModel==='google/gemini-4-hydrogen';
 if((benchmarkModel!==undefined&&(provider!=='openrouter'||!['openai/gpt-6-luna','google/gemini-4-hydrogen'].includes(benchmarkModel)))||!['legacy','system','history'].includes(cacheLayout))throw new AiError('MODEL_OPTIONS','实验模型或缓存布局无效');
 if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>16384||!['enabled','disabled'].includes(thinking)||!['low','high','max'].includes(reasoningEffort)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>90000||(requestedModel!==undefined&&requestedModel!==selectedModel)||typeof userId!=='string'||(cacheKey!==undefined&&typeof cacheKey!=='string'))throw new AiError('MODEL_OPTIONS','模型推理设置无效');
 const credential=apiKey===undefined?keys[provider]:apiKey;
 if(typeof credential!=='string'||!credential)throw new AiError('NO_KEY',`还没有配置 ${modelLabel} 密钥，可以改用离线机器人。`);
 // Custom endpoints are intentionally unsupported: never send either credential
 // to a redirect service or to the other provider's API.
 if(!sol){let target;try{target=new URL(base);}catch{}if(!target||target.origin!=='https://api.deepseek.com'||!['','/','/v1'].includes(target.pathname)||target.username||target.password||target.search||target.hash)throw new AiError('BASE_URL','只能连接 DeepSeek 的官方地址');}
 const session=createHash('sha256').update(cacheKey||userId).digest('hex');
 let transport=sol?cacheDecisionMessages(messages,cacheLayout):{messages};
 // Hydrogen currently supports implicit caching, not OpenAI explicit markers.
 // Keep identical text/information, and let its own backend manage caching.
 if(hydrogen)transport={messages:transport.messages.map(m=>({...m,...(Array.isArray(m.content)?{content:m.content.map(({type,text})=>({type,text}))}:{})}))};
 const body={model:selectedModel,...transport,response_format:{type:'json_object'},max_tokens:maxTokens,stream:false,...(sol?{
  reasoning:{effort:hydrogen?reasoningEffort:'low',exclude:true},session_id:session,prompt_cache_key:session,
  provider:hydrogen?{only:['google-vertex/global'],allow_fallbacks:false,require_parameters:true,max_price:{prompt:1.5,completion:7.5}}:{only:['openai'],ignore:['openai/flex','openai/fast','openai/ultrafast'],sort:'price',allow_fallbacks:false,require_parameters:true,max_price:{prompt:2,completion:10}}
 }:{thinking:{type:thinking},...(thinking==='enabled'?{reasoning_effort:reasoningEffort}:{}),user_id:cacheKey?session:userId})};
 const reserved=reserveFor(transport.messages,maxTokens,provider);await onReserve(reserved);
 const started=Date.now(),metadata={provider,model:selectedModel,modelLabel,reserved};let response,data;
 try{
  response=await fetch(sol?'https://openrouter.ai/api/v1/chat/completions':base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs),redirect:'manual'});
  if(response.ok)data=await response.json();
 }catch{
  await onUsage({...metadata,status:'unknown',costKind:'reservation_estimate',estimatedCost:reserved,latencyMs:Date.now()-started});
  throw new AiError('NETWORK',`${modelLabel} 的请求没有完成，可能已经计费，所以没有自动重试。`);
 }
 if(!response.ok){await onUsage({...metadata,status:'rejected',httpStatus:response.status,costKind:'rejected',estimatedCost:0,latencyMs:Date.now()-started});throw new AiError('PROVIDER_'+response.status,`${modelLabel} 返回了错误（HTTP ${response.status}），局面没有变化。`);}
 if(!data||typeof data!=='object'||data.error){await onUsage({...metadata,status:'unknown',costKind:'reservation_estimate',estimatedCost:reserved,latencyMs:Date.now()-started});throw new AiError('PROVIDER_RESPONSE',`${modelLabel} 未返回完整结果，可能已经计费，所以没有自动重试。`);}
 const usage=data.usage&&typeof data.usage==='object'?data.usage:{},normalizedUsage=normalizeUsage(usage);
 const actualCost=sol&&Number.isFinite(usage.cost)&&usage.cost>=0?usage.cost:undefined;
 const hasUsage=Number.isFinite(usage.prompt_tokens)&&Number.isFinite(usage.completion_tokens);
 const cost=actualCost??(hasUsage?estimateUsage(usage,provider):reserved),costKind=actualCost!==undefined?'provider_reported':hasUsage?'conservative_estimate':'reservation_estimate';
 await onUsage({...metadata,status:'completed',model:data.model||selectedModel,requestId:data.id,thinking:sol?'enabled':thinking,reasoningEffort:sol?(hydrogen?reasoningEffort:'low'):thinking==='enabled'?reasoningEffort:undefined,usage,normalizedUsage,costKind,...(actualCost===undefined?{}:{actualCost}),estimatedCost:cost,latencyMs:Date.now()-started});
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

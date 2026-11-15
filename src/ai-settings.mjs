// Non-secret model settings shared by local and hosted adapters. Old saves use
// the official DeepSeek provider; a game never switches supplier implicitly.
import {providersInfo,modelFor,ratesFor,providerLabel} from './model-provider.mjs';

const invalid=(message,code='MODEL_PROVIDER')=>Object.assign(Error(message),{code,status:400});
export function selectedProvider(value='deepseek',env,{required=false}={}){
 if(!['deepseek','openrouter'].includes(value))throw invalid('请选择 DeepSeek 或 GPT-6.1 Sol');
 if(required&&!providersInfo(env).find(p=>p.id===value)?.configured)throw invalid(`还没有配置 ${providerLabel(value)} 密钥，可以改用已连接的模型或离线机器人。`,'NO_KEY');
 return value;
}
export const authorBudgetFor=provider=>selectedProvider(provider)==='openrouter'?.50:.12;
export const polishBudgetFor=provider=>selectedProvider(provider)==='openrouter'?.05:.03;
export function runtimeAiInfo(env){
 const providers=providersInfo(env),preferred=providers.find(p=>p.id==='deepseek'&&p.configured)||providers.find(p=>p.configured)||providers[0];
 return {providers,configured:providers.some(p=>p.configured),defaultProvider:preferred.id,model:preferred.model,modelLabel:preferred.label,rates:preferred.rates,
  authorBudget:authorBudgetFor(preferred.id),authorBudgets:Object.fromEntries(providers.map(p=>[p.id,authorBudgetFor(p.id)])),polishBudgets:Object.fromEntries(providers.map(p=>[p.id,polishBudgetFor(p.id)]))};
}
export function creationAiSettings(body,env,{requireConfigured=true}={}){
 if(body.opponent!==undefined&&!['ai','bot'].includes(body.opponent))throw invalid('请选择 AI 或离线机器人作为对手','INVALID_SETUP');
 const aiProvider=selectedProvider(body.aiProvider??'deepseek',env,{required:requireConfigured&&(body.opponent==='ai'||body.aiProvider!==undefined&&body.opponent!=='bot')});
 const authorProvider=selectedProvider(body.authorProvider??'deepseek',env,{required:requireConfigured&&body.setup?.generation==='ai'});
 return {aiProvider,authorProvider,...(body.opponent===undefined?{}:{opponent:body.opponent})};
}
export const withAiSettings=(state,settings)=>({...state,aiProvider:settings.aiProvider,...(settings.opponent===undefined?{}:{opponent:settings.opponent})});
export function gameAiInfo(state,env){
 const provider=selectedProvider(state.aiProvider??'deepseek');
 return {aiProvider:provider,...(state.opponent===undefined?{}:{opponent:state.opponent}),aiConfigured:!!providersInfo(env).find(p=>p.id===provider)?.configured,
  model:modelFor(provider),modelLabel:providerLabel(provider),costKind:provider==='openrouter'?'actual_or_conservative_estimate':'conservative_estimate',rates:ratesFor(provider)};
}
export function providerOptions(provider,env){
 selectedProvider(provider);
 return {provider,...(env?{apiKey:env[provider==='openrouter'?'OPENROUTER_API_KEY':'DEEPSEEK_API_KEY']||''}:{})};
}

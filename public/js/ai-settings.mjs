// Public capabilities contain model labels and availability, never credentials.
export const availableModels=info=>Array.isArray(info?.providers)?info.providers.filter(p=>p.configured):info?.configured?[{id:'deepseek',label:'DeepSeek',model:info.model,configured:true}]:[];
export function authorModel(info,value){
 const models=availableModels(info);
 return models.find(p=>p.id===value)?.id||models.find(p=>p.id==='deepseek')?.id||models[0]?.id||'deepseek';
}
export const authorBudget=(info,provider)=>info?.authorBudgets?.[provider]??(provider==='openrouter'?.50:info?.authorBudget??.12);
export const opponentSettings=value=>({opponent:value==='bot'?'bot':'ai',aiProvider:value==='openrouter'?'openrouter':'deepseek'});

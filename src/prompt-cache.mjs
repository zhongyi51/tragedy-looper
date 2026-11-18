// Transport-only: no summary, history deletion, candidate filtering or seat leak.
// GPT-5.6+ looks up message/block boundaries, not arbitrary common substrings.
const block=(text,cache=false)=>({type:'text',text,...(cache?{prompt_cache_breakpoint:{mode:'explicit'}}:{})});
export function cacheDecisionMessages(messages,mode='history'){
 if(mode==='legacy')return {messages};
 if(!['system','history'].includes(mode))throw new Error('Unknown cache layout');
 if(mode==='system')return {messages:messages.map((m,i)=>i===0?{...m,content:[block(m.content,true)]}:m),prompt_cache_options:{mode:'explicit',ttl:'30m'}};
 // Authoring and unrelated requests retain their existing transport.
 let data;try{data=JSON.parse(messages[2]?.content);}catch{return {messages};}
 if(!Array.isArray(data?.visibleHistory)||!data.observation)return {messages};
 const {visibleHistory,observation,...privateContext}=data,{script,...current}=observation;
 const size=16,full=Math.floor(visibleHistory.length/size),history=[];
 for(let i=0;i<visibleHistory.length;i+=size){
  const end=i+size,index=i/size;
  history.push(block(JSON.stringify({visibleHistorySegment:visibleHistory.slice(i,end)}),end<=visibleHistory.length&&index>=full-2));
 }
 const rules=messages[0].content+'\n【上下文传输】observation.script 单独提供；按顺序拼接所有 visibleHistorySegment 即为完整 visibleHistory，无删节。最后的消息给出本次 seat、secret（仅剧作家）、当前 observation 其余字段及私有记忆；以它为当前局面。';
 return {messages:[{role:'system',content:[block(rules,true)]},{role:'user',content:[block(JSON.stringify({observation:{script}}),true)]},...(history.length?[{role:'user',content:history}]:[]),messages[1],{role:'user',content:JSON.stringify({observation:current,...privateContext})},...messages.slice(3)],prompt_cache_options:{mode:'explicit',ttl:'30m'}};
}

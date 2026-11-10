function apiError(message,{status=0,code='NETWORK',uncertain=false,requiresLogin=false}={}){
 return Object.assign(Error(message),{status,code,uncertain,requiresLogin});
}

// A mutation whose response never arrived may still have been applied (and billed), so it is
// reported as `uncertain` and never retried here; callers re-read the game instead.
export function createApi(fetchImpl=(...args)=>fetch(...args)){
 return async function api(url,data,{timeoutMs=data===undefined?20000:210000}={}){
  const mutation=data!==undefined,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  let res,text;
  try{
   res=await fetchImpl('/api'+url,{
    ...(mutation?{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(data)}:{headers:{Accept:'application/json'}}),
    credentials:'same-origin',signal:controller.signal
   });
   text=await res.text();
  }catch(error){
   const timeout=error?.name==='AbortError';
   throw apiError(timeout?'连接等待超时，请同步局面后再继续。':'连接中断，请检查网络并同步局面。',{code:timeout?'TIMEOUT':'NETWORK',uncertain:mutation});
  }finally{clearTimeout(timer);}
  const type=res.headers.get('content-type')||'',html=/^\s*(?:<!doctype\s+html|<html|<)/i.test(text);
  let value;
  try{if(!html&&(/json/i.test(type)||/^\s*[\[{]/.test(text)))value=JSON.parse(text);}catch{}
  const auth=res.status===401||(res.status===403&&value===undefined)||Boolean(res.redirected&&/(?:login|signin|sign-in|oauth|auth)/i.test(res.url||''));
  if(auth)throw apiError('登录状态或访问权限需要重新确认。请重新连接站点，再打开当前存档。',{status:res.status,code:'AUTH',uncertain:mutation,requiresLogin:true});
  if(value===undefined){
   const message=res.status>=500?'站点网关暂时没有返回游戏数据。请先同步局面；若仍失败，请重新连接。':res.redirected?'请求跳转后未返回游戏数据。请同步局面或重新连接。':'收到网页而非游戏数据。请先同步局面；若仍失败，请重新连接站点。';
   throw apiError(message,{status:res.status,code:'NON_JSON',uncertain:mutation});
  }
  if(!res.ok)throw apiError(typeof value?.error==='string'?value.error:`请求失败（HTTP ${res.status}）。`,{status:res.status,code:value?.code||'HTTP_'+res.status,uncertain:mutation&&(res.status>=500||['NETWORK','TIMEOUT'].includes(value?.code))});
  return value;
 };
}

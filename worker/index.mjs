import {budgetChange} from '../src/game-budget.mjs';
import {catalog,starter,generateScript,validateScript,publicScript,contentHash,scriptForGame} from '../src/content.mjs';
import {createGame,view,hash,VERSION,applyCommand,turn} from '../src/engine.mjs';
import {generateWithAi,polishWithAi,AI_DECISION_VERSION} from '../src/ai.mjs';
import {MODES,STEP_ROUTES,PlayError,project,playStep,stepReport,saveSummary} from '../src/play.mjs';
import {prepareGameScript,gameReview,validateFeedback,creationIdentity,checkCreationReceipt,creationFailure} from '../src/game-services.mjs';
import {listCuratedScripts} from '../src/script-library.mjs';
import {AUTHOR_VERSION} from '../src/author.mjs';
import {runtimeAiInfo,creationAiSettings,withAiSettings,gameAiInfo,providerOptions,selectedProvider,authorBudgetFor,polishBudgetFor} from '../src/ai-settings.mjs';
// Deployed behind the owner-only Sites gate. Identity is supplied by Sites.
const security={'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com",'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...security,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const fail=(status,text,code)=>{throw new PlayError(status,text,code);};
const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
const one=(db,sql,...args)=>statement(db,sql,...args).first();
const run=(db,sql,...args)=>statement(db,sql,...args).run();
const rows=async(db,sql,...args)=>(await statement(db,sql,...args).all()).results;
async function readBody(req){
 if(!req.headers.get('content-type')?.startsWith('application/json'))fail(415,'请求必须是 JSON');
 const reader=req.body?.getReader();if(!reader)return {};let size=0,chunks=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();fail(413,'请求内容超过 1MB');}chunks.push(value);}
 const b=new Uint8Array(size);let at=0;for(const c of chunks){b.set(c,at);at+=c.length;}
 let parsed;try{parsed=JSON.parse(new TextDecoder().decode(b)||'{}');}catch{fail(400,'请求不是有效的 JSON，操作没有执行。','INVALID_JSON');}if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail(400,'请求内容必须是 JSON 对象');return parsed;
}
async function getGame(db,id,owner){const g=await one(db,'SELECT * FROM games WHERE id=? AND owner=?',id,owner);if(!g)fail(404,'对局不存在');return {...g,state:JSON.parse(g.state)};}
const decorate=(g,env,v)=>({...v,id:g.id,mode:g.mode,budget:g.budget,spent:g.state.phase==='over'?g.spent:null,...gameAiInfo(g.state,env),busy:g.locked_until>Date.now()});
const projection=(g,env)=>decorate(g,env,project(g.mode,g.state));
async function createStored(db,owner,mode,state,budget,id=crypto.randomUUID()){await db.batch([
 statement(db,'INSERT INTO games(id,owner,mode,state,budget,created) VALUES(?,?,?,?,?,?)',id,owner,mode,JSON.stringify(state),budget,new Date().toISOString()),
 statement(db,'INSERT INTO frames(game,revision,command,state,hash) VALUES(?,?,?,?,?)',id,0,'null',JSON.stringify(state),hash(state))
]);return getGame(db,id,owner);}
async function exportReplay(db,g,full){const records=await rows(db,'SELECT state,hash FROM frames WHERE game=? ORDER BY revision',g.id);return {format:'tragedy-replay-1',engineVersion:VERSION,contentHash,perspective:full?'M':'public',script:full?g.state.script:publicScript(g.state.script),frames:records.map((r,index)=>({index,view:view(JSON.parse(r.state),full?'M':'public'),...(full?{stateHash:r.hash}:{})})),note:'公开视角的回放：不含密钥。'};}
function usageHooks(db,g,token,diagnostics){let callId;return {
 async onReserve(amount){
  const reserved=await one(db,'UPDATE games SET spent=spent+? WHERE id=? AND owner=? AND lock_token=? AND spent+?<=budget RETURNING id',amount,g.id,g.owner,token,amount);
  if(!reserved)fail(409,'剩余额度不足以预留下一次请求，或操作已过期；并非全部已消费。可调整本局上限后继续，没有发送请求。','BUDGET_RESERVATION');callId=crypto.randomUUID();
  // If ledger insert fails the reservation remains conservatively charged; no API call occurs.
  await run(db,'INSERT INTO calls(id,game,status,data) VALUES(?,?,?,?)',callId,g.id,'reserved',JSON.stringify({reserved:amount,estimatedCost:amount}));
 },
 async onUsage(data){await db.batch([
  statement(db,'UPDATE games SET spent=spent+? WHERE id=? AND owner=?',data.estimatedCost-data.reserved,g.id,g.owner),
  statement(db,'UPDATE calls SET status=?,data=? WHERE id=?',data.status,JSON.stringify(data),callId)
 ]);diagnostics?.push({status:data.status,provider:data.provider,model:data.model,modelLabel:data.modelLabel,costKind:data.costKind,actualCost:data.actualCost,normalizedUsage:data.normalizedUsage,thinking:data.thinking,reasoningEffort:data.reasoningEffort,usage:data.usage,estimatedCost:data.estimatedCost,latencyMs:data.latencyMs});}
};}
export async function handleApi(req,env,owner){
 const db=env.DB;if(!db)fail(503,'云端存储还没准备好');const u=new URL(req.url),p=u.pathname;
 if(p==='/api/info')return reply({version:VERSION,...runtimeAiInfo(env),contentHash,hosted:true,authorVersion:AUTHOR_VERSION,aiVersion:AI_DECISION_VERSION});
 if(p==='/api/catalog')return reply(catalog);
 if(p==='/api/scripts/library')return reply({scripts:listCuratedScripts()});
 if(p==='/api/games'&&req.method==='GET')return reply((await rows(db,'SELECT id,mode,created,state,spent FROM games WHERE owner=? ORDER BY created DESC LIMIT 50',owner)).map(saveSummary));
 if(p==='/api/games'&&req.method==='POST'){
  const b=await readBody(req),budget=Number(b.budget??.5);if(!Number.isFinite(budget)||budget<.01||budget>10)fail(400,'花费上限须在 $0.01–$10 之间');
  const aiSettings=creationAiSettings(b,env,{requireConfigured:false}),identity=creationIdentity(b),id=crypto.randomUUID();
  if(identity){
   const inserted=await one(db,'INSERT INTO game_creation(owner,request_id,request_hash,game,status,created) VALUES(?,?,?,?,?,?) ON CONFLICT(owner,request_id) DO NOTHING RETURNING request_id',owner,identity.requestId,identity.requestHash,id,'processing',new Date().toISOString());
   if(!inserted){const receipt=await one(db,'SELECT * FROM game_creation WHERE owner=? AND request_id=?',owner,identity.requestId);
    if(receipt.request_hash===identity.requestHash&&await one(db,'SELECT id FROM games WHERE id=? AND owner=?',receipt.game,owner))return reply(projection(await getGame(db,receipt.game,owner),env));
    checkCreationReceipt(receipt,identity);
   }
  }
  try{
   creationAiSettings(b,env);
   const script=await prepareGameScript(b,{...providerOptions(aiSettings.authorProvider,env),onUsage:async data=>{await run(db,'INSERT INTO calls(id,game,status,data) VALUES(?,?,?,?)',crypto.randomUUID(),'author:'+owner,data.status,JSON.stringify(data));}});
   const g=await createStored(db,owner,MODES.includes(b.mode)?b.mode:'heroes',withAiSettings(createGame(script),aiSettings),budget,id);
   if(identity)await run(db,"UPDATE game_creation SET status='complete' WHERE owner=? AND request_id=?",owner,identity.requestId);
   return reply(projection(g,env),201);
  }catch(error){if(identity)await run(db,"UPDATE game_creation SET status='failed',error=? WHERE owner=? AND request_id=?",creationFailure(error),owner,identity.requestId);throw error;}
 }
 if(p==='/api/scripts/starter')return reply(starter);
 if(p.startsWith('/api/scripts/')&&req.method==='POST'){
  const b=await readBody(req);
  if(p.endsWith('/validate'))return reply(validateScript(b));
  if(p.endsWith('/generate'))return reply(generateScript(b));
  if(p.endsWith('/ai-generate')||p.endsWith('/ai-polish')){const provider=selectedProvider(b.provider??'deepseek',env,{required:true});let cost=0,actual=true;const script=await (p.endsWith('/ai-polish')?polishWithAi:generateWithAi)(b,{...providerOptions(provider,env),authorBudget:p.endsWith('/ai-polish')?polishBudgetFor(provider):authorBudgetFor(provider),onUsage:async data=>{cost+=data.estimatedCost;actual&&=data.costKind==='provider_reported';await run(db,'INSERT INTO calls(id,game,status,data) VALUES(?,?,?,?)',crypto.randomUUID(),'author:'+owner,data.status,JSON.stringify(data));}});return reply({script,estimatedCost:cost,costKind:actual?'provider_reported':'conservative_estimate',provider});}
 }
 const m=p.match(/^\/api\/games\/([a-f0-9-]+)(?:\/(command|ai-step|bot-step|advance|fixture-step|replay|script|usage|budget|branch|review|feedback))?$/);if(!m)fail(404,'接口不存在');const [,id,route]=m;
 if(route==='fixture-step'&&(owner!==QA_OWNER||env.SITES_QA_ENABLED!=='true'))fail(404,'接口不存在');
 let g=await getGame(db,id,owner);
 if(route==='fixture-step'&&g.mode!=='observe')fail(404,'测试接口不存在');
 if(!route&&req.method==='GET')return reply(projection(g,env));
 if(route==='review'&&req.method==='GET')return reply(gameReview(g.state,await one(db,'SELECT rating,updated FROM script_feedback WHERE game=? AND owner=?',id,owner)));
 if(route==='feedback'&&req.method==='POST'){
  const feedback=validateFeedback(g.state,await readBody(req));
  await run(db,'INSERT INTO script_feedback(game,owner,script_hash,source,rating,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(game) DO UPDATE SET rating=excluded.rating,updated=excluded.updated',id,owner,feedback.scriptHash,feedback.source,feedback.rating,feedback.updated);
  return reply({rating:feedback.rating,updated:feedback.updated});
 }
 if(['replay','script'].includes(route)&&req.method==='GET'){const full=u.searchParams.get('full')==='1';if(full&&g.mode!=='mastermind'&&g.state.phase!=='over')fail(403,'对局结束后才能查看真相');return reply(route==='replay'?await exportReplay(db,g,full):full?g.state.script:publicScript(g.state.script));}
 if(route==='usage'&&req.method==='GET'){if(g.state.phase!=='over')fail(403,'用量明细在对局结束后才能查看');return reply((await rows(db,'SELECT data FROM calls WHERE game=?',id)).map(r=>JSON.parse(r.data)));}
 if(req.method!=='POST')fail(405,'这个接口只接受 POST');const b=await readBody(req);
 if(route==='budget'){
  const {budget,expectedBudget}=budgetChange(b);
  const changed=await one(db,'UPDATE games SET budget=? WHERE id=? AND owner=? AND budget=? AND spent<=? AND locked_until<=? RETURNING id',budget,id,owner,expectedBudget,budget,Date.now());
  if(!changed)fail(409,'正在处理请求、额度已被修改，或新上限低于已结算／预留费用；请同步后再调整。','BUDGET_CONFLICT');
  return reply(projection(await getGame(db,id,owner),env));
 }
 if(route==='branch'){
  if(g.state.phase!=='over'&&g.mode!=='mastermind')fail(403,'对局结束后才能从回放里重玩');
  const f=await one(db,'SELECT state FROM frames WHERE game=? AND revision=?',id,b.revision);if(!f)fail(400,'找不到回放里的这一步');const state=JSON.parse(f.state);state.revision=0;return reply(projection(await createStored(db,owner,g.mode,state,g.budget),env),201);
 }
 if(!STEP_ROUTES.includes(route)&&route!=='fixture-step')fail(404,'接口不存在');
 if(b.commandId!==undefined&&(typeof b.commandId!=='string'||b.commandId.length>100))fail(400,'提交标识无效');
 if(b.commandId&&await one(db,'SELECT revision FROM receipts WHERE game=? AND command_id=?',id,b.commandId))return reply(projection(await getGame(db,id,owner),env));
 if(!Number.isInteger(b.revision))fail(400,'需要局面版本');const token=crypto.randomUUID();
 const locked=await one(db,"UPDATE games SET lock_token=?,locked_until=? WHERE id=? AND owner=? AND locked_until<? AND json_extract(state,'$.revision')=? RETURNING id",token,Date.now()+300000,id,owner,Date.now(),b.revision);
 if(!locked)fail(409,'局面已经变了，或还在处理上一步，请先同步','STATE_CONFLICT');
 try{
  g=await getGame(db,id,owner);
  let outcome;const qaUsage=owner===QA_OWNER&&route==='ai-step'&&env.SITES_QA_ENABLED==='true'?[]:undefined;
  if(b.qaFirstMaxTokens!==undefined&&(!qaUsage||![1,64,128].includes(b.qaFirstMaxTokens)))fail(400,'仅隔离测试可限制首个请求以验证截断恢复','INVALID_QA_LIMIT');
  if(route==='fixture-step'){
   // Isolated QA only: reproduce a bounded legal history atomically, before
   // any model request. Never change ordinary player control permissions.
   if(g.state.script.source==='ai'||g.state.script.generation?.source==='ai'||g.spent>0||await one(db,'SELECT id FROM calls WHERE game=? LIMIT 1',id))fail(409,'已有模型调用的测试对局不能再铺设局面','FIXTURE_ALREADY_PLAYED');
   const commands=b.commands===undefined?[b.command]:b.commands;
   if(!Array.isArray(commands)||commands.length<1||commands.length>80||(b.commands!==undefined&&b.command!==undefined))fail(400,'测试历史须包含 1–80 个合法操作','INVALID_FIXTURE_BATCH');
   let current=g.state;const frames=[];
   for(const command of commands){
    const seat=turn(current);if(!seat)fail(400,'这一局已经结束','GAME_OVER');
    const beats=[];current=applyCommand(current,seat,command,beats);frames.push({seat,command,state:current,beats});
   }
   outcome={seat:frames[0].seat,frames,answer:null};
  }else outcome=await playStep({state:g.state,mode:g.mode,route,command:b.command,ai:{...providerOptions(g.state.aiProvider??'deepseek',env),cacheKey:'game:'+id,...usageHooks(db,g,token,qaUsage),...(qaUsage&&b.qaFirstMaxTokens!==undefined?{maxTokens:b.qaFirstMaxTokens}:{}),userId:'g_'+id.replaceAll('-','')}});
  const {seat,frames,answer}=outcome;
  const next=frames.at(-1)?.state||g.state,state=JSON.stringify(next),queries=frames.map(frame=>statement(db,'INSERT INTO frames(game,revision,command,state,hash) SELECT id,?,?,?,? FROM games WHERE id=? AND lock_token=?',frame.state.revision,JSON.stringify(frame.command),JSON.stringify(frame.state),hash(frame.state),id,token));
  if(b.commandId)queries.push(statement(db,'INSERT INTO receipts(game,command_id,revision) SELECT id,?,? FROM games WHERE id=? AND lock_token=?',b.commandId,next.revision,id,token));
  queries.push(statement(db,'UPDATE games SET state=?,lock_token=NULL,locked_until=0 WHERE id=? AND lock_token=?',state,id,token));
  const results=await db.batch(queries);if(results.at(-1).meta.changes!==1)fail(409,'这一步已经过期，局面没有变化');
  const saved=await getGame(db,id,owner);
  return reply({...projection(saved,env),...stepReport({mode:g.mode,route,seat,answer,initial:g.state,frames,decorate:v=>decorate(g,env,v)}),
   // Only the isolated, temporarily enabled service test namespace can inspect
   // its own fixture decision. Ordinary players never receive these fields.
   ...(qaUsage?{qaDecision:{commands:answer?.commands||[],reason:answer?.reason||'',automatic:!!answer?.automatic,repairAttempts:answer?.repairAttempts||0,repairCauses:answer?.repairCauses||[],repairMode:answer?.repairMode||null,usage:qaUsage,spentEstimate:saved.spent}}:{})});
 }finally{await run(db,'UPDATE games SET lock_token=NULL,locked_until=0 WHERE id=? AND lock_token=?',id,token);}
}
// Temporarily enabled owner-private Sites API verification. Sites consumes the
// bypass credential before this Worker, so these requests have no user identity.
// Keep them in a separate namespace; never impersonate an authenticated owner.
const QA_OWNER='service:sites-qa';
function qaRequest(req){
 const u=new URL(req.url);u.pathname=u.pathname.replace(/^\/api\/qa\//,'/api/');
 const game='/api/games/[a-f0-9-]+';
 const allowed=req.method==='GET'&&(['/api/info','/api/scripts/library'].includes(u.pathname)||new RegExp('^'+game+'(?:/(?:replay|usage|review))?$').test(u.pathname))
  ||req.method==='POST'&&(u.pathname==='/api/games'||new RegExp('^'+game+'/(?:command|ai-step|bot-step|advance|fixture-step|feedback|budget)$').test(u.pathname));
 if(!allowed)fail(404,'测试接口不存在');
 return new Request(u,req);
}
export function createWorker(assets){return {async fetch(req,env){
 const requestId=crypto.randomUUID();let result;
 try{result=await(async()=>{
 const u=new URL(req.url),owner=req.headers.get('oai-authenticated-user-id');
 if(u.pathname.startsWith('/api/qa/')){
  if(env.SITES_QA_ENABLED!=='true')return reply({error:'测试接口未启用',code:'QA_DISABLED'},401);
  if(req.headers.has('origin'))return reply({error:'测试接口不接受浏览器来源请求'},403);
  return await handleApi(qaRequest(req),env,QA_OWNER);
 }
 // Fail closed even if the platform gate is accidentally changed later.
 if(!owner)return reply({error:'请用站点所有者的 ChatGPT 账号登录',code:'AUTH_REQUIRED'},401);
 if(req.headers.get('origin')&&new URL(req.headers.get('origin')).origin!==u.origin)return reply({error:'不接受来自其他网站的请求'},403);
 if(u.pathname.startsWith('/api/'))return await handleApi(req,env,owner);
 if(!['GET','HEAD'].includes(req.method))return reply({error:'不支持这种请求方式'},405);
 const asset=assets[u.pathname];if(!asset)return reply({error:'找不到这个文件'},404);
 return new Response(req.method==='HEAD'?null:Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0)),{headers:{...security,'Content-Type':asset.type,'Cache-Control':u.pathname.startsWith('/assets/')?'private,max-age=86400':'no-cache'}});
 })();}catch(e){result=e.message==='ILLEGAL_ACTION'?reply({error:'这一步现在不能走，操作没有执行。请同步后重新选择。',code:'ILLEGAL_ACTION'},400):reply({error:e instanceof PlayError?e.message:e.code?String(e.message):'请求没有完成，请同步后重试。',code:e.code||'REQUEST_FAILED'},e.status||400);}
 const headers=new Headers(result.headers);headers.set('X-Request-Id',requestId);
 if(result.status>=400&&result.headers.get('content-type')?.includes('application/json')){
  const data=await result.json(),code=data.code||'HTTP_'+result.status;
  // Correlation only: do not log bodies, credentials, user IDs or game IDs.
  console.warn(JSON.stringify({event:'api_error',requestId,status:result.status,code,route:new URL(req.url).pathname.replace(/\/[a-f0-9]{8}-[a-f0-9-]{27,}/g,'/:game')}));
  return new Response(JSON.stringify({...data,code,requestId}),{status:result.status,headers});
 }
 return new Response(result.body,{status:result.status,headers});
}};}

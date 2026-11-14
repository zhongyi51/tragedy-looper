import {catalog,starter,generateScript,validateScript,publicScript,contentHash,scriptForGame} from '../src/content.mjs';
import {createGame,view,hash,VERSION,applyCommand,turn} from '../src/engine.mjs';
import {generateWithAi,polishWithAi,model,rates} from '../src/ai.mjs';
import {MODES,STEP_ROUTES,PlayError,project,playStep,stepReport,saveSummary} from '../src/play.mjs';
import {AUTHOR_BUDGET,prepareGameScript,gameReview,validateFeedback,creationIdentity,checkCreationReceipt,creationFailure} from '../src/game-services.mjs';
import {listCuratedScripts} from '../src/script-library.mjs';
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
const decorate=(g,env,v)=>({...v,id:g.id,mode:g.mode,budget:g.budget,spent:g.state.phase==='over'?g.spent:null,aiConfigured:!!env.DEEPSEEK_API_KEY,model,busy:g.locked_until>Date.now()});
const projection=(g,env)=>decorate(g,env,project(g.mode,g.state));
async function createStored(db,owner,mode,state,budget,id=crypto.randomUUID()){await db.batch([
 statement(db,'INSERT INTO games(id,owner,mode,state,budget,created) VALUES(?,?,?,?,?,?)',id,owner,mode,JSON.stringify(state),budget,new Date().toISOString()),
 statement(db,'INSERT INTO frames(game,revision,command,state,hash) VALUES(?,?,?,?,?)',id,0,'null',JSON.stringify(state),hash(state))
]);return getGame(db,id,owner);}
async function exportReplay(db,g,full){const records=await rows(db,'SELECT state,hash FROM frames WHERE game=? ORDER BY revision',g.id);return {format:'tragedy-replay-1',engineVersion:VERSION,contentHash,perspective:full?'M':'public',script:full?g.state.script:publicScript(g.state.script),frames:records.map((r,index)=>({index,view:view(JSON.parse(r.state),full?'M':'public'),...(full?{stateHash:r.hash}:{})})),note:'公开视角的回放：不含密钥。'};}
function usageHooks(db,g,token){let callId;return {
 async onReserve(amount){
  const reserved=await one(db,'UPDATE games SET spent=spent+? WHERE id=? AND owner=? AND lock_token=? AND spent+?<=budget RETURNING id',amount,g.id,g.owner,token,amount);
  if(!reserved)fail(409,'AI 花费已到上限，或这一步已经过期；没有发送请求。');callId=crypto.randomUUID();
  // If ledger insert fails the reservation remains conservatively charged; no API call occurs.
  await run(db,'INSERT INTO calls(id,game,status,data) VALUES(?,?,?,?)',callId,g.id,'reserved',JSON.stringify({reserved:amount,estimatedCost:amount}));
 },
 async onUsage(data){await db.batch([
  statement(db,'UPDATE games SET spent=spent+? WHERE id=? AND owner=?',data.estimatedCost-data.reserved,g.id,g.owner),
  statement(db,'UPDATE calls SET status=?,data=? WHERE id=?',data.status,JSON.stringify(data),callId)
 ]);}
};}
export async function handleApi(req,env,owner){
 const db=env.DB;if(!db)fail(503,'云端存储还没准备好');const u=new URL(req.url),p=u.pathname;
 if(p==='/api/info')return reply({version:VERSION,configured:!!env.DEEPSEEK_API_KEY,model,rates,contentHash,hosted:true,authorBudget:AUTHOR_BUDGET});
 if(p==='/api/catalog')return reply(catalog);
 if(p==='/api/scripts/library')return reply({scripts:listCuratedScripts()});
 if(p==='/api/games'&&req.method==='GET')return reply((await rows(db,'SELECT id,mode,created,state,spent FROM games WHERE owner=? ORDER BY created DESC LIMIT 50',owner)).map(saveSummary));
 if(p==='/api/games'&&req.method==='POST'){
  const b=await readBody(req),budget=Number(b.budget??.5);if(!Number.isFinite(budget)||budget<.01||budget>10)fail(400,'花费上限须在 $0.01–$10 之间');
  const identity=creationIdentity(b),id=crypto.randomUUID();
  if(identity){
   const inserted=await one(db,'INSERT INTO game_creation(owner,request_id,request_hash,game,status,created) VALUES(?,?,?,?,?,?) ON CONFLICT(owner,request_id) DO NOTHING RETURNING request_id',owner,identity.requestId,identity.requestHash,id,'processing',new Date().toISOString());
   if(!inserted){const receipt=await one(db,'SELECT * FROM game_creation WHERE owner=? AND request_id=?',owner,identity.requestId);
    if(receipt.request_hash===identity.requestHash&&await one(db,'SELECT id FROM games WHERE id=? AND owner=?',receipt.game,owner))return reply(projection(await getGame(db,receipt.game,owner),env));
    checkCreationReceipt(receipt,identity);
   }
  }
  try{
   const script=await prepareGameScript(b,{apiKey:env.DEEPSEEK_API_KEY,onUsage:async data=>{await run(db,'INSERT INTO calls(id,game,status,data) VALUES(?,?,?,?)',crypto.randomUUID(),'author:'+owner,data.status,JSON.stringify(data));}});
   const g=await createStored(db,owner,MODES.includes(b.mode)?b.mode:'heroes',createGame(script),budget,id);
   if(identity)await run(db,"UPDATE game_creation SET status='complete' WHERE owner=? AND request_id=?",owner,identity.requestId);
   return reply(projection(g,env),201);
  }catch(error){if(identity)await run(db,"UPDATE game_creation SET status='failed',error=? WHERE owner=? AND request_id=?",creationFailure(error),owner,identity.requestId);throw error;}
 }
 if(p==='/api/scripts/starter')return reply(starter);
 if(p.startsWith('/api/scripts/')&&req.method==='POST'){
  const b=await readBody(req);
  if(p.endsWith('/validate'))return reply(validateScript(b));
  if(p.endsWith('/generate'))return reply(generateScript(b));
  if(p.endsWith('/ai-generate')||p.endsWith('/ai-polish')){let cost=0;const script=await (p.endsWith('/ai-polish')?polishWithAi:generateWithAi)(b,{apiKey:env.DEEPSEEK_API_KEY,authorBudget:AUTHOR_BUDGET,onUsage:async data=>{cost+=data.estimatedCost;await run(db,'INSERT INTO calls(id,game,status,data) VALUES(?,?,?,?)',crypto.randomUUID(),'author:'+owner,data.status,JSON.stringify(data));}});return reply({script,estimatedCost:cost});}
 }
 const m=p.match(/^\/api\/games\/([a-f0-9-]+)(?:\/(command|ai-step|bot-step|advance|fixture-step|replay|script|usage|branch|review|feedback))?$/);if(!m)fail(404,'接口不存在');const [,id,route]=m;
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
  let outcome;
  if(route==='fixture-step'){
   // Isolated QA only: reproduce a legal fixture one command at a time, before
   // any model request. Never change ordinary player control permissions.
   if(g.state.script.source==='ai'||g.state.script.generation?.source==='ai'||g.spent>0||await one(db,'SELECT id FROM calls WHERE game=? LIMIT 1',id))fail(409,'已有模型调用的测试对局不能再铺设局面','FIXTURE_ALREADY_PLAYED');
   const seat=turn(g.state);if(!seat)fail(400,'这一局已经结束','GAME_OVER');
   const beats=[],next=applyCommand(g.state,seat,b.command,beats);
   outcome={seat,frames:[{seat,command:b.command,state:next,beats}],answer:null};
  }else outcome=await playStep({state:g.state,mode:g.mode,route,command:b.command,ai:{apiKey:env.DEEPSEEK_API_KEY,...usageHooks(db,g,token),userId:'g_'+id.replaceAll('-','')}});
  const {seat,frames,answer}=outcome;
  const next=frames.at(-1)?.state||g.state,state=JSON.stringify(next),queries=frames.map(frame=>statement(db,'INSERT INTO frames(game,revision,command,state,hash) SELECT id,?,?,?,? FROM games WHERE id=? AND lock_token=?',frame.state.revision,JSON.stringify(frame.command),JSON.stringify(frame.state),hash(frame.state),id,token));
  if(b.commandId)queries.push(statement(db,'INSERT INTO receipts(game,command_id,revision) SELECT id,?,? FROM games WHERE id=? AND lock_token=?',b.commandId,next.revision,id,token));
  queries.push(statement(db,'UPDATE games SET state=?,lock_token=NULL,locked_until=0 WHERE id=? AND lock_token=?',state,id,token));
  const results=await db.batch(queries);if(results.at(-1).meta.changes!==1)fail(409,'这一步已经过期，局面没有变化');
  return reply({...projection(await getGame(db,id,owner),env),...stepReport({mode:g.mode,route,seat,answer,initial:g.state,frames,decorate:v=>decorate(g,env,v)})});
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
  ||req.method==='POST'&&(u.pathname==='/api/games'||new RegExp('^'+game+'/(?:command|ai-step|bot-step|advance|fixture-step|feedback)$').test(u.pathname));
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

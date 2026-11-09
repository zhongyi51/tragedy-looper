import http from 'node:http';
import {readFileSync,existsSync,mkdirSync,createReadStream,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {catalog,starter,generateScript,validateScript,publicScript,contentHash} from './content.mjs';
import {createGame,applyCommand,view,turn,botCommand,hash,VERSION,advanceAutomatic,transitionFrames} from './engine.mjs';
import {configureKey,configured,decide,generateWithAi,model,rates,decisionSummary} from './ai.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),runtime=process.env.TL_RUNTIME||path.join(root,'runtime');mkdirSync(runtime,{recursive:true});
const db=new DatabaseSync(path.join(runtime,'games.sqlite'));db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY, owner TEXT, mode TEXT, state TEXT, budget REAL, spent REAL DEFAULT 0, created TEXT); CREATE TABLE IF NOT EXISTS frames(game TEXT, revision INTEGER, command TEXT, state TEXT, hash TEXT, PRIMARY KEY(game,revision)); CREATE TABLE IF NOT EXISTS receipts(game TEXT, commandId TEXT, revision INTEGER, PRIMARY KEY(game,commandId)); CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, game TEXT, status TEXT, data TEXT);');
const busy=new Set();
const json=(res,status,data)=>{
 if(status>=400){data={...data,code:data.code||'HTTP_'+status,requestId:res.getHeader('X-Request-Id')};console.warn(JSON.stringify({event:'api_error',requestId:data.requestId,status,code:data.code}));}
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));
};
const body=async req=>{let b='';for await(const chunk of req){b+=chunk;if(Buffer.byteLength(b)>1024*1024)throw Error('请求超过1MB');}let parsed;try{parsed=b?JSON.parse(b):{};}catch{throw Object.assign(Error('请求不是有效 JSON，未执行操作。'),{code:'INVALID_JSON'});}if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Object.assign(Error('需要 JSON 对象'),{code:'INVALID_BODY'});return parsed;};
const session=(req,res)=>{let id=req.headers.cookie?.match(/(?:^|; )tl_session=([a-f0-9]{64})(?:;|$)/)?.[1];if(!id||!db.prepare('SELECT id FROM sessions WHERE id=?').get(id)){id=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?)').run(id);res.setHeader('Set-Cookie',`tl_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);}return id;};
function getGame(id,owner){const row=db.prepare('SELECT * FROM games WHERE id=? AND owner=?').get(id,owner);if(!row)throw Error('对局不存在');return {...row,state:JSON.parse(row.state)};}
function seatFor(g){return g.mode==='mastermind'?'M':g.mode==='observe'?'public':turn(g.state)!=='M'&&turn(g.state)?turn(g.state):'A';}
function response(g){return {...view(g.state,seatFor(g)),id:g.id,mode:g.mode,budget:g.budget,spent:g.state.phase==='over'?g.spent:null,aiConfigured:configured(),model,busy:busy.has(g.id)};}
function persist(g,frames,commandId){
 const next=frames.at(-1)?.state||g.state;
 db.exec('BEGIN IMMEDIATE');try{
  db.prepare('UPDATE games SET state=? WHERE id=?').run(JSON.stringify(next),g.id);
  for(const frame of frames)db.prepare('INSERT INTO frames VALUES(?,?,?,?,?)').run(g.id,frame.state.revision,JSON.stringify(frame.command),JSON.stringify(frame.state),hash(frame.state));
  if(commandId)db.prepare('INSERT INTO receipts VALUES(?,?,?)').run(g.id,commandId,next.revision);
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
function usageHooks(g){let callId;return {onReserve:async amount=>{const current=getGame(g.id,g.owner);if(current.spent+amount>current.budget)throw Error('本局预算不足，未发送请求。');callId=randomUUID();db.exec('BEGIN');try{db.prepare('UPDATE games SET spent=spent+? WHERE id=?').run(amount,g.id);db.prepare('INSERT INTO calls VALUES(?,?,?,?)').run(callId,g.id,'reserved',JSON.stringify({reserved:amount,estimatedCost:amount}));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}},onUsage:async data=>{db.exec('BEGIN');try{db.prepare('UPDATE games SET spent=spent+? WHERE id=?').run(data.estimatedCost-data.reserved,g.id);db.prepare('UPDATE calls SET status=?,data=? WHERE id=?').run(data.status,JSON.stringify(data),callId);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}};}
function replay(g,full=false){const seat=full?'M':'public';return {format:'tragedy-replay-1',engineVersion:VERSION,contentHash,perspective:seat,script:full?g.state.script:publicScript(g.state.script),frames:db.prepare('SELECT state,hash FROM frames WHERE game=? ORDER BY revision').all(g.id).map((r,i)=>({index:i,view:view(JSON.parse(r.state),seat),...(full?{stateHash:r.hash}:{})})),note:'离线快照回放；不重新调用模型。不含API凭证或模型原始推理。'};}
async function api(req,res,u,owner){const p=u.pathname;
 if(p==='/api/info')return json(res,200,{version:VERSION,configured:configured(),model,rates,contentHash});
 if(p==='/api/catalog')return json(res,200,catalog);
 if(p==='/api/games'&&req.method==='GET')return json(res,200,db.prepare('SELECT id,mode,created,state,spent FROM games WHERE owner=? ORDER BY created DESC LIMIT 50').all(owner).map(g=>({id:g.id,mode:g.mode,created:g.created,title:JSON.parse(g.state).script.title,phase:JSON.parse(g.state).phase,spent:JSON.parse(g.state).phase==='over'?g.spent:null})));
 if(p==='/api/games'&&req.method==='POST'){
  const b=await body(req),script=b.script||starter,mode=['heroes','mastermind','observe'].includes(b.mode)?b.mode:'heroes',budget=Number(b.budget??.50);if(!Number.isFinite(budget)||budget<.01||budget>10)throw Error('预算范围 $0.01–$10');
  const state=createGame(script),id=randomUUID();db.exec('BEGIN');try{db.prepare('INSERT INTO games(id,owner,mode,state,budget,created) VALUES(?,?,?,?,?,?)').run(id,owner,mode,JSON.stringify(state),budget,new Date().toISOString());db.prepare('INSERT INTO frames VALUES(?,?,?,?,?)').run(id,0,'null',JSON.stringify(state),hash(state));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return json(res,201,response(getGame(id,owner)));
 }
 if(p==='/api/scripts/starter')return json(res,200,starter);
 if(p==='/api/scripts/validate'&&req.method==='POST')return json(res,200,validateScript(await body(req)));
 if(p==='/api/scripts/generate'&&req.method==='POST'){const b=await body(req);return json(res,200,generateScript(b));}
 if(p==='/api/scripts/ai-generate'&&req.method==='POST'){
  const b=await body(req);let cost=0;const s=await generateWithAi(b,{onReserve:amount=>{if(amount>.03)throw Error('生成预算超过$0.03');},onUsage:data=>{cost+=data.estimatedCost;db.prepare('INSERT INTO calls VALUES(?,?,?,?)').run(randomUUID(),'author:'+owner,data.status,JSON.stringify(data));}});return json(res,200,{script:s,estimatedCost:cost});
 }
 const match=p.match(/^\/api\/games\/([a-f0-9-]+)(?:\/(command|ai-step|bot-step|advance|replay|script|usage|branch))?$/);if(!match)return json(res,404,{error:'接口不存在'});const id=match[1],route=match[2];let g=getGame(id,owner);
 if(!route)return json(res,200,response(g));
 if(route==='usage'){if(g.state.phase!=='over')return json(res,403,{error:'为避免用调用数量推断隐藏能力，用量明细在终局开放'});return json(res,200,db.prepare('SELECT status,data FROM calls WHERE game=?').all(id).map(r=>JSON.parse(r.data)));}
 if(route==='replay'){const full=u.searchParams.get('full')==='1';if(full&&g.mode!=='mastermind'&&g.state.phase!=='over')return json(res,403,{error:'对局结束前主人公不能获取全知回放'});return json(res,200,replay(g,full));}
 if(route==='script'){const full=u.searchParams.get('full')==='1';if(full&&g.mode!=='mastermind'&&g.state.phase!=='over')return json(res,403,{error:'私密剧本不可访问'});return json(res,200,full?g.state.script:publicScript(g.state.script));}
 if(req.method!=='POST')return json(res,405,{error:'需要POST'});
 if(busy.has(id))return json(res,409,{error:'此对局正在处理一个决策'});
 const b=await body(req);g=getGame(id,owner);
 if(busy.has(id))return json(res,409,{error:'此对局正在处理一个决策'});
 if(b.commandId!==undefined&&(typeof b.commandId!=='string'||b.commandId.length>100))throw Error('无效提交标识');
 if(route==='branch'){
  if(g.state.phase!=='over'&&g.mode!=='mastermind')return json(res,403,{error:'对局结束后可以创建反事实分支'});
  const f=db.prepare('SELECT state FROM frames WHERE game=? AND revision=?').get(id,b.revision);if(!f)throw Error('回放位置不存在');const state=JSON.parse(f.state);state.revision=0;const newId=randomUUID();db.prepare('INSERT INTO games(id,owner,mode,state,budget,created) VALUES(?,?,?,?,?,?)').run(newId,owner,g.mode,JSON.stringify(state),g.budget,new Date().toISOString());db.prepare('INSERT INTO frames VALUES(?,?,?,?,?)').run(newId,0,JSON.stringify({branchFrom:id,revision:b.revision}),JSON.stringify(state),hash(state));return json(res,201,response(getGame(newId,owner)));
 }
 if(b.commandId&&db.prepare('SELECT revision FROM receipts WHERE game=? AND commandId=?').get(id,b.commandId))return json(res,200,response(g));
 if(b.revision!==g.state.revision)return json(res,409,{error:'局面已变化，请刷新',code:'STATE_CONFLICT'});
 const seat=turn(g.state);if(!seat)throw Error('本局已结束');
 const human=g.mode==='heroes'?seat!=='M':g.mode==='mastermind'?seat==='M':false;
 if(route==='command'&&!human)return json(res,403,{error:'当前由对手控制'});
 if(route==='ai-step'&&human)return json(res,403,{error:'当前为你的行动，可使用明确标识的练习机器人托管'});
 busy.add(id);
 try{
  let command=b.command,answer,frames=[];
  if(route==='advance')frames=advanceAutomatic(g.state,{includeBetween:g.mode!=='heroes'}).steps;
  else{
   if(route==='ai-step')answer=await decide(g.state,seat,{...usageHooks(g),userId:'g_'+id.replaceAll('-','')}),command=answer.command;
   if(route==='bot-step')command=botCommand(g.state,seat);
   const first=applyCommand(g.state,seat,command);if(answer)first.notes[seat]=answer.note||first.notes[seat];
   frames=[{seat,command,state:first},...advanceAutomatic(first,{includeBetween:g.mode!=='heroes'}).steps];
  }
  persist(g,frames,b.commandId);
  return json(res,200,{...response(getGame(id,owner)),busy:false,transitionFrames:transitionFrames(state=>response({...g,state}),g.state,frames.map(f=>f.state)),decision:decisionSummary(route,seat,answer)});
 }finally{busy.delete(id);}
}
const assetsRoot=path.resolve(root,'assets');
const allowAssets=new Set(catalog.characters.flatMap(c=>[c.portrait,c.card]).map(p=>'/'+p));for(const n of ['click_001','drop_001','confirmation_001','error_001','glitch_001','bong_001','open_001'])allowAssets.add('/assets/audio/Audio/'+n+'.ogg');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ogg':'audio/ogg','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{res.setHeader('X-Request-Id',randomUUID());try{
 const u=new URL(req.url,'http://localhost');const host=req.headers.host||'';
 if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))return json(res,403,{error:'仅允许本机访问'});
 if(req.headers.origin&&new URL(req.headers.origin).host!==host)return json(res,403,{error:'拒绝跨站请求'});
 res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
 if(u.pathname.startsWith('/api/'))return await api(req,res,u,session(req,res));
 let f;if(allowAssets.has(u.pathname))f=path.join(assetsRoot,u.pathname.slice('/assets/'.length));else{const allowed={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/replay-validation.mjs':'replay-validation.mjs'};if(!allowed[u.pathname])return json(res,404,{error:'文件不存在'});f=path.join(root,'public',allowed[u.pathname]);}
 if(!existsSync(f))return json(res,404,{error:'素材不存在，请检查 assets 目录是否完整'});res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream','Content-Length':statSync(f).size,'Cache-Control':u.pathname.startsWith('/assets/')?'public,max-age=86400':'no-cache'});createReadStream(f).pipe(res);
 }catch(e){json(res,400,e.message==='ILLEGAL_ACTION'?{error:'该操作不适用于当前局面，未执行。请刷新后重新选择合法行动。',code:'ILLEGAL_ACTION'}:{error:String(e.message).slice(0,400),code:e.code});}});
if(process.argv.includes('--stdin-key')){
 // Raw TTY mode prevents credential echo; no credential value is written to disk or logs.
 if(process.stdin.isTTY)process.stdin.setRawMode(true);
 process.stdin.resume();console.log('Waiting for credential JSON on stdin (input hidden).');
 await new Promise(resolve=>{let b='';const receive=chunk=>{b+=chunk.toString();if(/[\r\n]/.test(b)){try{const v=JSON.parse(b.trim());configureKey(v.key);b='';process.stdin.off('data',receive);if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();console.log('DeepSeek credential configured in memory.');resolve();}catch{b='';console.log('Invalid credential input.');}}};process.stdin.on('data',receive);});
}
// Managed preview passes --port; keep the listener loopback-only even when --host is supplied.
const portOption=process.argv.indexOf('--port'),port=Number(portOption>=0?process.argv[portOption+1]:process.env.PORT||4317);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('需要有效端口（1–65535）');
server.listen(port,'127.0.0.1',()=>console.log(`Tragedy Looper ready at http://127.0.0.1:${port} · AI ${configured()?'configured':'offline'} · ${model}`));
process.on('SIGINT',()=>server.close(()=>{db.close();process.exit(0);}));

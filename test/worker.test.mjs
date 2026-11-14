import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorker} from '../worker/index.mjs';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_initial.sql',import.meta.url),'utf8'));
 const wrap=(query,args=[])=>({bind(...values){return wrap(query,values);},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}});
 const DB={prepare:q=>wrap(q),async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const worker=createWorker({'/':{type:'text/html',data:Buffer.from('<h1>Game</h1>').toString('base64')}});
 const env={DB};
 const request=async(path,body,owner='owner-1',extra={})=>{const req=new Request('https://game.test'+path,{method:body===undefined?'GET':'POST',headers:{...(owner?{'oai-authenticated-user-id':owner}:{}),'Content-Type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});const res=await worker.fetch(req,env);return {status:res.status,data:res.headers.get('content-type').includes('json')?await res.json():await res.text()};};
 return {sql,DB,request,worker,env};
}
test('hosted identity required for UI, assets and every API; cross-origin rejected',async()=>{const {request}=fixture();for(const p of ['/','/js/main.mjs','/api/info','/api/games'])assert.equal((await request(p,undefined,null)).status,401);assert.equal((await request('/')).status,200);assert.equal((await request('/api/games',{},'owner-1',{Origin:'https://evil.test'})).status,403);});
test('cloud storage ownership, public exports and forbidden source downloads',async()=>{const {request}=fixture();const g=(await request('/api/games',{mode:'mastermind'})).data;assert.ok(g.secret);assert.equal((await request('/api/games/'+g.id,undefined,'owner-2')).status,404);const r=(await request('/api/games/'+g.id+'/replay')).data;assert.equal(r.frames[0].view.secret,undefined);for(const p of ['/src/ai.mjs','/.env','/.openai/hosting.json','/runtime/games.sqlite'])assert.equal((await request(p)).status,404);});
test('cloud revision compare-and-swap rejects concurrent duplicate advances',async()=>{const {request}=fixture();const g=(await request('/api/games',{})).data;const results=await Promise.all(Array.from({length:8},(_,i)=>request('/api/games/'+g.id+'/bot-step',{revision:0,commandId:'c'+i})));assert.equal(results.filter(r=>r.status===200).length,1);assert.equal((await request('/api/games/'+g.id)).data.revision,1);});
test('cloud receipt retry preserves revision; illegal actions release lock',async()=>{const {request}=fixture();let g=(await request('/api/games',{mode:'mastermind'})).data;assert.equal((await request('/api/games/'+g.id+'/command',{revision:0,command:{type:'bad'}})).status,400);const a=await request('/api/games/'+g.id+'/bot-step',{revision:0,commandId:'same'});assert.equal(a.status,200);assert.equal((await request('/api/games/'+g.id+'/bot-step',{revision:0,commandId:'same'})).data.revision,1);});
test('cloud complete bot game, full replay, persistent branch and no model use',async()=>{const {request}=fixture();let g=(await request('/api/games',{mode:'observe'})).data;for(let n=0;n<300&&!g.winner;n++){const r=await request('/api/games/'+g.id+'/bot-step',{revision:g.revision,commandId:'step'+n});assert.equal(r.status,200);g=r.data;}assert.ok(g.winner);const r=(await request('/api/games/'+g.id+'/replay?full=1')).data;assert.equal(r.frames.at(-1).view.winner,g.winner);const b=await request('/api/games/'+g.id+'/branch',{revision:1});assert.equal(b.status,201);assert.equal(b.data.revision,0);assert.deepEqual((await request('/api/games/'+g.id+'/usage')).data,[]);});
test('cloud AI missing key preserves state, releases lease and does not charge',async()=>{const {request}=fixture();const g=(await request('/api/games',{mode:'heroes'})).data;const r=await request('/api/games/'+g.id+'/ai-step',{revision:0});assert.equal(r.status,400);const after=(await request('/api/games/'+g.id)).data;assert.equal(after.revision,0);assert.equal(after.busy,false);assert.equal((await request('/api/games/'+g.id+'/bot-step',{revision:0})).status,200);});
test('cloud concurrent AI requests use one provider call and settle budget once',async t=>{
 const {request,env,sql}=fixture();env.DEEPSEEK_API_KEY='unit_test_not_a_real_secret';let resolve,started;const ready=new Promise(r=>started=r),gate=new Promise(r=>resolve=r);let calls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.headers.Authorization,'Bearer '+env.DEEPSEEK_API_KEY);started();await gate;return new Response(JSON.stringify({usage:{prompt_tokens:100,prompt_cache_hit_tokens:40,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:'{"choice":0,"note":"tested"}'}}]}),{status:200});});
 const g=(await request('/api/games',{mode:'heroes',budget:.5})).data;
 const first=request('/api/games/'+g.id+'/ai-step',{revision:0,commandId:'ai-one'});await ready;
 assert.equal((await request('/api/games/'+g.id+'/ai-step',{revision:0,commandId:'ai-two'})).status,409);resolve();assert.equal((await first).status,200);assert.equal(calls,1);
 assert.equal(sql.prepare('SELECT revision FROM frames WHERE game=? ORDER BY revision DESC').get(g.id).revision,1);
 const row=sql.prepare('SELECT spent,locked_until FROM games WHERE id=?').get(g.id);assert.ok(Math.abs(row.spent-.00003024)<1e-10);assert.equal(row.locked_until,0);
 assert.equal((await request('/api/games/'+g.id+'/ai-step',{revision:0,commandId:'ai-one'})).status,200);assert.equal(calls,1);
});
test('cloud provider uncertainty keeps reservation, does not retry, and can recover with bot',async t=>{
 const {request,env,sql}=fixture();env.DEEPSEEK_API_KEY='unit_test_not_a_real_secret';let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('timeout');});
 const g=(await request('/api/games',{})).data;const result=await request('/api/games/'+g.id+'/ai-step',{revision:0});assert.equal(result.data.code,'NETWORK');assert.equal(calls,1);
 const row=sql.prepare('SELECT state,spent,locked_until FROM games WHERE id=?').get(g.id);assert.ok(row.spent>0);assert.equal(row.locked_until,0);assert.equal(JSON.parse(row.state).revision,0);assert.equal((await request('/api/games/'+g.id+'/bot-step',{revision:0})).status,200);
});

test('cloud standard schedules show names while explicit hidden schedules and all secret answers stay concealed',async()=>{
 const {request}=fixture();
 for(const visibility of [undefined,'hidden'])for(const mode of ['heroes','observe','mastermind']){
  const g=(await request('/api/games',{mode,...(visibility?{incidentVisibility:visibility}:{})})).data;
  const schedule=visibility==='hidden'?[{day:3}]:[{day:3,type:'suicide'}];
  if(mode==='mastermind')assert.equal(g.secret.incidents[0].type,'suicide');
  else assert.equal(g.secret,undefined);
  assert.deepEqual(g.script.incidents,mode==='mastermind'?[{day:3,type:'suicide'}]:schedule);assert.equal(g.script.roles,undefined);assert.equal(g.script.mainPlot,undefined);
  const script=(await request('/api/games/'+g.id+'/script')).data;
  assert.deepEqual(script.incidents,schedule);assert.equal(script.roles,undefined);
  const replay=(await request('/api/games/'+g.id+'/replay')).data;
  assert.deepEqual(replay.script.incidents,schedule);assert.equal(replay.script.roles,undefined);
  for(const frame of replay.frames){assert.deepEqual(frame.view.script.incidents,schedule);assert.equal(frame.view.secret,undefined);assert.equal(frame.view.script.roles,undefined);}
 }
});

test('cloud location movement bluffs resolve and invalid actions do not strand the game',async()=>{
 const {request}=fixture();let g=(await request('/api/games',{mode:'mastermind'})).data;
 const bad=await request('/api/games/'+g.id+'/command',{revision:0,command:{type:'place',card:'move_h#0',target:'no-such-location'}});
 assert.equal(bad.status,400);assert.equal(bad.data.code,'ILLEGAL_ACTION');
 assert.equal((await request('/api/games/'+g.id)).data.busy,false);
 for(const target of ['hospital','shrine','city']){
  const option=g.actions.find(a=>a.command.type==='place'&&a.command.target===target&&a.command.card.startsWith('move_'));
  assert.ok(option,'location movement is a legal bluff');
  const next=await request('/api/games/'+g.id+'/command',{revision:g.revision,command:option.command});assert.equal(next.status,200);g=next.data;
 }
 assert.equal(g.phaseId,'hero_cards');
 for(let n=0;n<40&&g.day===1&&!g.winner;n++){
  const next=await request('/api/games/'+g.id+'/bot-step',{revision:g.revision});assert.equal(next.status,200);g=next.data;assert.equal(g.busy,false);
 }
 assert.ok(g.day>1||g.winner,'the entire first day advances after location bluffs');
 const replay=(await request('/api/games/'+g.id+'/replay')).data;
 assert.ok(replay.frames.some(f=>f.view.revealedCards.filter(p=>['hospital','shrine','city'].includes(p.target)&&p.card.startsWith('move_')).length>=3));
});

test('cloud expired lease can be recovered while an active lease prevents duplicate execution',async()=>{
 const {request,sql}=fixture();const g=(await request('/api/games',{mode:'observe'})).data;
 sql.prepare('UPDATE games SET lock_token=?,locked_until=? WHERE id=?').run('abandoned-worker',Date.now()+30000,g.id);
 assert.equal((await request('/api/games/'+g.id)).data.busy,true);
 assert.equal((await request('/api/games/'+g.id+'/bot-step',{revision:0})).status,409);
 sql.prepare('UPDATE games SET locked_until=? WHERE id=?').run(Date.now()-1,g.id);
 const resumed=await request('/api/games/'+g.id+'/bot-step',{revision:0});assert.equal(resumed.status,200);assert.equal(resumed.data.revision,1);assert.equal(resumed.data.busy,false);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM frames WHERE game=?').get(g.id).n,2);
});

test('cloud QA prefix is disabled by default and never relaxes normal API authentication',async()=>{
 const {request,env}=fixture();
 assert.equal((await request('/api/qa/info',undefined,null)).status,401);
 assert.equal((await request('/api/qa/games',{},null)).status,401);
 env.SITES_QA_ENABLED='false';assert.equal((await request('/api/qa/info',undefined,null)).status,401);
 env.SITES_QA_ENABLED=true;assert.equal((await request('/api/qa/info',undefined,null)).status,401);
 env.SITES_QA_ENABLED='true';assert.equal((await request('/api/qa/info',undefined,null)).status,200);
 for(const path of ['/','/api/info','/api/games'])assert.equal((await request(path,undefined,null)).status,401);
 assert.equal((await request('/api/games',{},null)).status,401);
});

test('cloud QA API uses isolated records and rejects browser origins and unlisted routes',async()=>{
 const {request,env,sql}=fixture();env.SITES_QA_ENABLED='true';
 const owner=(await request('/api/games',{mode:'mastermind'})).data;
 const created=await request('/api/qa/games',{mode:'observe'},null);assert.equal(created.status,201);const qa=created.data;
 assert.notEqual(sql.prepare('SELECT owner FROM games WHERE id=?').get(owner.id).owner,sql.prepare('SELECT owner FROM games WHERE id=?').get(qa.id).owner);
 assert.equal((await request('/api/qa/games/'+owner.id,undefined,null)).status,404);
 assert.equal((await request('/api/games/'+qa.id)).status,404);
 assert.equal((await request('/api/qa/games/'+qa.id,undefined,null)).status,200);
 assert.equal((await request('/api/qa/games/'+qa.id+'/bot-step',{revision:0},null)).status,200);
 assert.equal((await request('/api/qa/games/'+qa.id+'/replay',undefined,null)).status,200);
 for(const origin of ['https://game.test','https://evil.test','null',''])assert.equal((await request('/api/qa/info',undefined,null,{Origin:origin})).status,403);
 assert.equal((await request('/api/qa/games',undefined,null)).status,404);
 assert.equal((await request('/api/qa/scripts/starter',undefined,null)).status,404);
 assert.equal((await request('/api/qa/scripts/generate',{},null)).status,404);
 assert.equal((await request('/api/qa/games/'+qa.id+'/branch',{revision:0},null)).status,404);
 assert.equal((await request('/api/qa/games/'+qa.id+'/script',undefined,null)).status,404);
 env.SITES_QA_ENABLED='false';assert.equal((await request('/api/qa/games/'+qa.id,undefined,null)).status,401);
});

test('cloud AI persistence never restores legacy protagonist notes after visibility migration',async t=>{
 const {request,env,sql}=fixture();env.DEEPSEEK_API_KEY='unit_test_not_a_real_secret';
 let g=(await request('/api/games',{mode:'mastermind'})).data;
 for(let i=0;i<3;i++)g=(await request('/api/games/'+g.id+'/bot-step',{revision:g.revision})).data;
 assert.equal(g.phaseId,'hero_cards');
 const legacy=JSON.parse(sql.prepare('SELECT state FROM games WHERE id=?').get(g.id).state);
 delete legacy.visibilityPolicy;legacy.notes={A:'legacy hidden culprit A',B:'legacy hidden culprit B',C:'legacy hidden culprit C',M:'mastermind private evidence'};
 sql.prepare('UPDATE games SET state=? WHERE id=?').run(JSON.stringify(legacy),g.id);
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.ok(!options.body.includes('legacy hidden culprit'));
  return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:'{"choice":0,"reason":"test","note":""}'}}]}),{status:200});
 });
 const next=await request('/api/games/'+g.id+'/ai-step',{revision:g.revision});assert.equal(next.status,200);
 const persisted=JSON.parse(sql.prepare('SELECT state FROM games WHERE id=?').get(g.id).state);
 assert.deepEqual(persisted.notes,{A:'',B:'',C:'',M:'mastermind private evidence'});
 assert.equal(persisted.visibilityPolicy,'hidden_incident_names_v1');
});

test('cloud errors are JSON with stable codes and request identifiers matching response headers',async t=>{
 const {worker,env,sql}=fixture();const logs=[];t.mock.method(console,'warn',line=>logs.push(JSON.parse(line)));
 const missing=await worker.fetch(new Request('https://game.test/api/info'),env),auth=await missing.json();
 assert.equal(missing.status,401);assert.equal(auth.code,'AUTH_REQUIRED');assert.equal(auth.requestId,missing.headers.get('x-request-id'));
 const bad=await worker.fetch(new Request('https://game.test/api/games',{method:'POST',headers:{'oai-authenticated-user-id':'sensitive-user-identifier','Content-Type':'application/json'},body:'<!DOCTYPE html><h1>Not JSON</h1>'}),env),data=await bad.json();
 assert.equal(bad.status,400);assert.equal(data.code,'INVALID_JSON');assert.equal(data.requestId,bad.headers.get('x-request-id'));assert.notEqual(data.requestId,auth.requestId);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM games').get().n,0);
 assert.equal(logs.length,2);for(const entry of logs){assert.equal(entry.event,'api_error');assert.ok(entry.requestId);assert.ok(!JSON.stringify(entry).includes('sensitive-user-identifier'));assert.ok(!JSON.stringify(entry).includes('Not JSON'));}
 const ok=await worker.fetch(new Request('https://game.test/api/info',{headers:{'oai-authenticated-user-id':'owner-1'}}),env);assert.equal(ok.status,200);assert.ok(ok.headers.get('x-request-id'));
});

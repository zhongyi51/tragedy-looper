import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorker} from '../worker/index.mjs';
function fixture(){
 const sql=new DatabaseSync(':memory:');for(const migration of ['0000_initial.sql','0001_script_feedback.sql'])sql.exec(readFileSync(new URL('../drizzle/'+migration,import.meta.url),'utf8'));
 const wrap=(query,args=[])=>({bind(...values){return wrap(query,values);},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}});
 const DB={prepare:q=>wrap(q),async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const worker=createWorker({'/':{type:'text/html',data:Buffer.from('<h1>Game</h1>').toString('base64')}});
 const env={DB};
 const request=async(path,body,owner='owner-1',extra={})=>{const req=new Request('https://game.test'+path,{method:body===undefined?'GET':'POST',headers:{...(owner?{'oai-authenticated-user-id':owner}:{}),'Content-Type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});const res=await worker.fetch(req,env);return {status:res.status,data:res.headers.get('content-type').includes('json')?await res.json():await res.text()};};
 return {sql,DB,request,worker,env};
}
test('hosted identity required for UI, assets and every API; cross-origin rejected',async()=>{const {request}=fixture();for(const p of ['/','/js/main.mjs','/api/info','/api/games'])assert.equal((await request(p,undefined,null)).status,401);assert.equal((await request('/')).status,200);assert.equal((await request('/api/games',{},'owner-1',{Origin:'https://evil.test'})).status,403);});
test('budget changes preserve play and ledger, reject stale, overspent, invalid and other-owner writes',async()=>{
 const {request,sql}=fixture();const g=(await request('/api/games',{budget:.5})).data,path='/api/games/'+g.id+'/budget';
 const before=sql.prepare('SELECT state FROM games WHERE id=?').get(g.id).state;
 sql.prepare('UPDATE games SET spent=.2 WHERE id=?').run(g.id);
 const changed=await request(path,{budget:1,expectedBudget:.5});assert.equal(changed.status,200);assert.equal(changed.data.budget,1);assert.equal(changed.data.spent,null);assert.equal(changed.data.revision,0);
 assert.equal((await request(path,{budget:2,expectedBudget:.5})).status,409);
 assert.equal((await request(path,{budget:.1,expectedBudget:1})).status,409);
 for(const budget of [null,'2',0,11])assert.equal((await request(path,{budget,expectedBudget:1})).status,400);
 assert.equal((await request(path,{budget:2,expectedBudget:1},'owner-2')).status,404);
 assert.equal((await request(path,{budget:.3,expectedBudget:1})).status,200);
 assert.deepEqual(sql.prepare('SELECT state,spent,budget FROM games WHERE id=?').get(g.id),Object.assign(Object.create(null),{state:before,spent:.2,budget:.3}));
 assert.equal(sql.prepare('SELECT count(*) n FROM frames WHERE game=?').get(g.id).n,1);
 sql.prepare('UPDATE games SET locked_until=? WHERE id=?').run(Date.now()+100000,g.id);
 assert.equal((await request(path,{budget:1,expectedBudget:.3})).status,409);
});
test('exhausted reservation can resume after increasing budget without resetting costs',async t=>{
 const {request,sql,env}=fixture();env.OPENROUTER_API_KEY='test_only_not_a_secret';let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:20,cost:.005},choices:[{finish_reason:'stop',message:{content:'{"choice":0}'}}]}));});
 const g=(await request('/api/games',{mode:'heroes',opponent:'ai',aiProvider:'openrouter',budget:.01})).data,path='/api/games/'+g.id;
 const blocked=await request(path+'/ai-step',{revision:0});assert.equal(blocked.data.code,'BUDGET_RESERVATION');assert.equal(calls,0);
 assert.equal(sql.prepare('SELECT spent FROM games WHERE id=?').get(g.id).spent,0);
 assert.equal((await request(path+'/budget',{budget:1,expectedBudget:.01})).status,200);
 const advanced=await request(path+'/ai-step',{revision:0});assert.equal(advanced.status,200);assert.equal(advanced.data.revision,1);assert.equal(calls,1);
 assert.equal(sql.prepare('SELECT count(*) n FROM calls WHERE game=?').get(g.id).n,1);
 assert.ok(Math.abs(sql.prepare('SELECT spent FROM games WHERE id=?').get(g.id).spent-.005)<1e-9);
});
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

test('disconnected HTTP requests retain the same in-flight operation in waitUntil',async t=>{
 const {request,worker,env,sql}=fixture();env.DEEPSEEK_API_KEY='unit-test-only';
 let ready,finish,calls=0;const started=new Promise(r=>ready=r),gate=new Promise(r=>finish=r),background=[];
 t.mock.method(globalThis,'fetch',async()=>{calls++;ready();await gate;return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:'{"choice":0}'}}]}));});
 const g=(await request('/api/games',{mode:'heroes'})).data,controller=new AbortController();
 const pending=worker.fetch(new Request('https://game.test/api/games/'+g.id+'/ai-step',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','oai-authenticated-user-id':'owner-1'},body:JSON.stringify({revision:0,commandId:'disconnected'})}),env,{waitUntil:p=>background.push(p)});
 await started;assert.equal(background.length,1);controller.abort();
 assert.equal((await request('/api/games/'+g.id)).data.busy,true);
 finish();assert.equal((await pending).status,200);await Promise.all(background);
 const latest=(await request('/api/games/'+g.id)).data;assert.equal(latest.revision,1);assert.equal(latest.busy,false);assert.equal(calls,1);
 assert.equal(sql.prepare('SELECT count(*) n FROM receipts WHERE game=?').get(g.id).n,1);
});
test('a model repair renews its two-minute lease rather than inheriting an almost-expired one',async t=>{
 const {request,env,sql}=fixture();env.DEEPSEEK_API_KEY='unit-test-only';let now=Date.now(),calls=0;
 t.mock.method(Date,'now',()=>now);
 const g=(await request('/api/games',{mode:'heroes'})).data;
 t.mock.method(globalThis,'fetch',async()=>{
  calls++;assert.equal(sql.prepare('SELECT locked_until FROM games WHERE id=?').get(g.id).locked_until,now+120000);
  now+=80000;
  return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:10},choices:[{finish_reason:calls===1?'length':'stop',message:{content:calls===1?'':'{"plan":0}'}}]}));
 });
 const result=await request('/api/games/'+g.id+'/ai-step',{revision:0});assert.equal(result.status,200);assert.equal(calls,2);assert.equal(result.data.busy,false);
});
test('expired work cannot commit frames or receipts, even before a replacement starts',async t=>{
 const {request,env,sql}=fixture();env.DEEPSEEK_API_KEY='unit-test-only';const g=(await request('/api/games',{mode:'heroes'})).data;
 t.mock.method(globalThis,'fetch',async()=>{
  sql.prepare('UPDATE games SET locked_until=? WHERE id=?').run(Date.now()-1,g.id);
  return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:'{"choice":0}'}}]}));
 });
 assert.equal((await request('/api/games/'+g.id+'/ai-step',{revision:0,commandId:'expired'})).status,409);
 assert.equal((await request('/api/games/'+g.id)).data.revision,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM frames WHERE game=?').get(g.id).n,1);
 assert.equal(sql.prepare('SELECT count(*) n FROM receipts WHERE game=?').get(g.id).n,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM calls WHERE game=? AND status=?').get(g.id,'completed').n,1);
});
test('late canceled work cannot overwrite or unlock its replacement and each bill settles once',async t=>{
 const {request,env,sql}=fixture();env.DEEPSEEK_API_KEY='unit-test-only';const g=(await request('/api/games',{mode:'heroes'})).data;
 const gates=[],starts=[];let calls=0;
 for(let i=0;i<2;i++){let ready,finish;const started=new Promise(r=>ready=r),gate=new Promise(r=>finish=r);gates.push({gate,finish,ready});starts.push(started);}
 t.mock.method(globalThis,'fetch',async()=>{const entry=gates[calls++];entry.ready();await entry.gate;return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:'{"choice":0}'}}]}));});
 const old=request('/api/games/'+g.id+'/ai-step',{revision:0,commandId:'old'});await starts[0];
 sql.prepare('UPDATE games SET locked_until=? WHERE id=?').run(Date.now()-1,g.id);
 const next=request('/api/games/'+g.id+'/ai-step',{revision:0,commandId:'new'});await starts[1];
 const token=sql.prepare('SELECT lock_token FROM games WHERE id=?').get(g.id).lock_token;
 gates[0].finish();assert.equal((await old).status,409);assert.equal((await request('/api/games/'+g.id)).data.busy,true);
 assert.equal(sql.prepare('SELECT lock_token FROM games WHERE id=?').get(g.id).lock_token,token);
 gates[1].finish();assert.equal((await next).status,200);assert.equal((await request('/api/games/'+g.id)).data.revision,1);
 assert.deepEqual(sql.prepare('SELECT command_id FROM receipts WHERE game=?').all(g.id).map(r=>r.command_id),['new']);
 const ledger=sql.prepare('SELECT data FROM calls WHERE game=?').all(g.id).map(r=>JSON.parse(r.data));assert.equal(ledger.length,2);assert.equal(calls,2);
 assert.ok(Math.abs(sql.prepare('SELECT spent FROM games WHERE id=?').get(g.id).spent-ledger.reduce((s,r)=>s+r.estimatedCost,0))<1e-9);
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
 assert.equal(persisted.visibilityPolicy,'failure_timing_v2');
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

test('cloud advertises both model providers without disclosing credentials',async()=>{
 const {request,env}=fixture();env.DEEPSEEK_API_KEY='unit-deepseek-secret';env.OPENROUTER_API_KEY='unit-openrouter-secret';
 const r=await request('/api/info');assert.equal(r.status,200);
 assert.equal(r.data.defaultProvider,'deepseek');assert.equal(r.data.providers.length,2);
 assert.deepEqual(r.data.providers.map(p=>[p.id,p.configured]),[['deepseek',true],['openrouter',true]]);
 assert.equal(r.data.providers.find(p=>p.id==='openrouter').model,'openai/gpt-6.1-sol');
 assert.equal(r.data.authorBudgets.deepseek,.12);assert.equal(r.data.authorBudgets.openrouter,.50);
 assert.doesNotMatch(JSON.stringify(r.data),/unit-deepseek-secret|unit-openrouter-secret|API_KEY/);
 delete env.DEEPSEEK_API_KEY;const onlySol=(await request('/api/info')).data;assert.equal(onlySol.configured,true);assert.equal(onlySol.defaultProvider,'openrouter');
});

test('cloud rejects unsupported or unconfigured explicit models before creating or charging',async()=>{
 const {request,sql}=fixture();
 for(const input of [{aiProvider:'anything',opponent:'ai'},{aiProvider:'openrouter',opponent:'ai'},{opponent:'anything'},{authorProvider:'anything'}]){
  const r=await request('/api/games',input);assert.equal(r.status,400);assert.ok(['MODEL_PROVIDER','NO_KEY','INVALID_SETUP'].includes(r.data.code));
 }
 assert.equal(sql.prepare('SELECT count(*) AS n FROM games').get().n,0);assert.equal(sql.prepare('SELECT count(*) AS n FROM calls').get().n,0);
 const author=await request('/api/scripts/ai-generate',{provider:'openrouter'});assert.equal(author.data.code,'NO_KEY');
});

test('cloud saves Sol choice through reload and branch and settles actual provider cost once',async t=>{
 const {request,env,sql}=fixture();env.DEEPSEEK_API_KEY='unit-deepseek-secret';env.OPENROUTER_API_KEY='unit-openrouter-secret';let calls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls++;assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer '+env.OPENROUTER_API_KEY);
  const body=JSON.parse(options.body);assert.equal(body.model,'openai/gpt-6.1-sol');assert.equal(body.reasoning.effort,'low');assert.ok(body.session_id||body.prompt_cache_key);
  return new Response(JSON.stringify({id:'provider-test',model:body.model,usage:{prompt_tokens:1000,completion_tokens:100,cost:.012345,prompt_tokens_details:{cached_tokens:800,cache_write_tokens:100},completion_tokens_details:{reasoning_tokens:40}},choices:[{finish_reason:'stop',message:{content:'{"choice":0,"reason":"选择合法行动"}'}}]}));
 });
 const created=await request('/api/games',{mode:'mastermind',aiProvider:'openrouter',opponent:'ai',budget:1});assert.equal(created.status,201);let g=created.data;
 assert.equal(g.aiProvider,'openrouter');assert.equal(g.opponent,'ai');assert.equal(g.modelLabel,'GPT-6.1 Sol');
 for(let n=0;n<3;n++)g=(await request('/api/games/'+g.id+'/bot-step',{revision:g.revision})).data;
 assert.equal(g.phaseId,'hero_cards');
 const requestBody={revision:g.revision,commandId:'sol-once'};const step=await request('/api/games/'+g.id+'/ai-step',requestBody);assert.equal(step.status,200);assert.equal(step.data.decision.controller,'GPT-6.1 Sol');assert.equal(calls,1);
 assert.equal((await request('/api/games/'+g.id+'/ai-step',requestBody)).status,200);assert.equal(calls,1);
 const saved=sql.prepare('SELECT spent,state FROM games WHERE id=?').get(g.id);assert.ok(Math.abs(saved.spent-.012345)<1e-10);
 const ledger=JSON.parse(sql.prepare('SELECT data FROM calls WHERE game=?').get(g.id).data);assert.equal(ledger.costKind,'provider_reported');assert.equal(ledger.actualCost,.012345);assert.equal(ledger.normalizedUsage.cachedInputTokens,800);
 const reload=(await request('/api/games/'+g.id)).data;assert.equal(reload.aiProvider,'openrouter');assert.equal(reload.opponent,'ai');
 const branch=await request('/api/games/'+g.id+'/branch',{revision:0});assert.equal(branch.status,201);assert.equal(branch.data.aiProvider,'openrouter');assert.equal(branch.data.opponent,'ai');
 delete env.OPENROUTER_API_KEY;const resumed=(await request('/api/games/'+g.id)).data;assert.equal(resumed.aiProvider,'openrouter');assert.equal(resumed.aiConfigured,false);
 const failed=await request('/api/games/'+g.id+'/ai-step',{revision:resumed.revision});assert.equal(failed.data.code,'NO_KEY');assert.equal(calls,1);
});

test('cloud author endpoints route the independently selected provider and label reported cost',async t=>{
 const {request,env}=fixture();env.OPENROUTER_API_KEY='unit-openrouter-secret';let calls=0;
 const script=(await request('/api/scripts/starter')).data;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls++;assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer '+env.OPENROUTER_API_KEY);
  return new Response(JSON.stringify({usage:{prompt_tokens:500,completion_tokens:40,cost:.0015},choices:[{finish_reason:'stop',message:{content:'{"title":"雨夜灯火","intro":"灯火映着雨幕，钟声再次响起。"}'}}]}));
 });
 const result=await request('/api/scripts/ai-polish',{provider:'openrouter',script,theme:'雨夜'});
 assert.equal(result.status,200);assert.equal(result.data.provider,'openrouter');assert.equal(result.data.costKind,'provider_reported');assert.equal(result.data.estimatedCost,.0015);assert.equal(result.data.script.title,'雨夜灯火');assert.equal(calls,1);
 const missing=await request('/api/scripts/ai-polish',{provider:'deepseek',script,theme:'雨夜'});assert.equal(missing.data.code,'NO_KEY');assert.equal(calls,1);
});


test('completed creation recovery does not require the former model credential or create another game',async()=>{
 const {request,env,sql}=fixture();env.OPENROUTER_API_KEY='unit-openrouter-secret';
 const input={requestId:'completed-model-recovery',aiProvider:'openrouter',opponent:'ai'};
 const first=await request('/api/games',input);assert.equal(first.status,201);delete env.OPENROUTER_API_KEY;
 const recovered=await request('/api/games',input);assert.equal(recovered.status,200);assert.equal(recovered.data.id,first.data.id);assert.equal(recovered.data.aiConfigured,false);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM games').get().n,1);assert.equal(sql.prepare('SELECT count(*) AS n FROM calls').get().n,0);
 const fresh=await request('/api/games',{...input,requestId:'another-model-recovery'});assert.equal(fresh.data.code,'NO_KEY');
});

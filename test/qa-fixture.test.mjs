import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorker} from '../worker/index.mjs';
import {tacticalFixtures,silverBulletFixture} from './fixtures/tactics.mjs';
import {hash,createGame,applyCommand} from '../src/engine.mjs';
import {withAiSettings} from '../src/ai-settings.mjs';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const name of ['0000_initial.sql','0001_script_feedback.sql'])sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 const wrap=(query,args=[])=>({bind(...values){return wrap(query,values);},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}});
 const DB={prepare:q=>wrap(q),async batch(items){sql.exec('BEGIN');try{const result=[];for(const item of items)result.push(await item.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB,SITES_QA_ENABLED:'true'},worker=createWorker({});
 const request=async(path,body,{owner,origin}={})=>{
  const response=await worker.fetch(new Request('https://qa.test'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(owner?{'oai-authenticated-user-id':owner}:{}),...(origin?{Origin:origin}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  return {status:response.status,data:await response.json()};
 };
 return {sql,env,request};
}
function configuredFixture(spec){
 const state=spec.commands.reduce((s,{seat,command})=>applyCommand(s,seat,command),withAiSettings(createGame(spec.script),{aiProvider:'deepseek'}));
 assert.deepEqual(state,{...spec.state,aiProvider:'deepseek'});return state;
}
function publicOnly(game){assert.equal(game.secret,undefined);assert.equal(game.pending,undefined);for(const k of ['roles','mainPlot','subPlots','privateDesign','seed'])assert.equal(game.script[k],undefined);for(const e of game.script.incidents)assert.equal(e.culprit,undefined);}

test('QA fixture steps reproduce both tactical positions exactly without automatic or model steps',async t=>{
 const f=fixture();t.after(()=>f.sql.close());
 for(const spec of tacticalFixtures()){
  let response=await f.request('/api/qa/games',{mode:'observe',script:spec.script}),game=response.data;assert.equal(response.status,201);
  for(const [i,{command}] of spec.commands.entries()){
   response=await f.request('/api/qa/games/'+game.id+'/fixture-step',{revision:game.revision,commandId:spec.id+'-'+i,command});
   assert.equal(response.status,200,JSON.stringify(response.data));game=response.data;assert.equal(game.revision,i+1);assert.equal(game.busy,false);publicOnly(game);
   for(const frame of game.transitionFrames||[])publicOnly(frame);
  }
  const stored=JSON.parse(f.sql.prepare('SELECT state FROM games WHERE id=?').get(game.id).state);
  assert.equal(hash(stored),hash(configuredFixture(spec)));
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM calls WHERE game=?').get(game.id).n,0);
 }
});

test('fixture permission never extends to ordinary owners, normal player modes, origins, or disabled QA',async t=>{
 const f=fixture();t.after(()=>f.sql.close());const spec=silverBulletFixture(),body={revision:0,command:spec.commands[0].command};
 const normal=(await f.request('/api/games',{mode:'observe',script:spec.script},{owner:'owner-1'})).data;
 assert.equal((await f.request('/api/games/'+normal.id+'/fixture-step',body,{owner:'owner-1'})).status,404);
 assert.equal((await f.request('/api/qa/games/'+normal.id+'/fixture-step',body)).status,404);
 for(const mode of ['heroes','mastermind']){
  const game=(await f.request('/api/qa/games',{mode,script:spec.script})).data;
  assert.equal((await f.request('/api/qa/games/'+game.id+'/fixture-step',body)).status,404);
 }
 const game=(await f.request('/api/qa/games',{mode:'observe',script:spec.script})).data;
 assert.equal((await f.request('/api/qa/games/'+game.id+'/fixture-step',body,{origin:'https://qa.test'})).status,403);
 // The old command permission is unchanged even on an isolated observe game.
 assert.equal((await f.request('/api/qa/games/'+game.id+'/command',body)).data.code,'NOT_YOUR_TURN');
 f.env.SITES_QA_ENABLED='false';assert.equal((await f.request('/api/qa/games/'+game.id+'/fixture-step',body)).status,401);
});

test('fixture replay uses normal revision locking, receipts, legal actions, and lease release',async t=>{
 const f=fixture();t.after(()=>f.sql.close());const spec=silverBulletFixture();
 const game=(await f.request('/api/qa/games',{mode:'observe',script:spec.script})).data,path='/api/qa/games/'+game.id+'/fixture-step';
 const bad=await f.request(path,{revision:0,command:{type:'place',card:'move_h#0',target:'invented'}});assert.equal(bad.data.code,'ILLEGAL_ACTION');
 assert.equal((await f.request('/api/qa/games/'+game.id)).data.busy,false);
 const body={revision:0,commandId:'same-fixture-step',command:spec.commands[0].command};
 assert.equal((await f.request(path,body)).data.revision,1);
 assert.equal((await f.request(path,body)).data.revision,1);
 assert.equal((await f.request(path,{revision:0,command:spec.commands[1].command})).status,409);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM frames WHERE game=?').get(game.id).n,2);
});

test('fixture editing closes for AI-authored scripts, model ledger entries, and reservations',async t=>{
 const f=fixture();t.after(()=>f.sql.close());const spec=silverBulletFixture();
 for(const block of ['ledger','spent','author-source','author-generation']){
  const script={...spec.script,...(block==='author-source'?{source:'ai'}:block==='author-generation'?{generation:{source:'ai'}}:{})};
  const game=(await f.request('/api/qa/games',{mode:'observe',script})).data;
  if(block==='ledger')f.sql.prepare('INSERT INTO calls(id,game,status,data) VALUES(?,?,?,?)').run('fixture-call-'+block,game.id,'rejected','{"estimatedCost":0}');
  else if(block==='spent')f.sql.prepare('UPDATE games SET spent=? WHERE id=?').run(.001,game.id);
  const response=await f.request('/api/qa/games/'+game.id+'/fixture-step',{revision:0,command:spec.commands[0].command});
  assert.equal(response.status,409);assert.equal(response.data.code,'FIXTURE_ALREADY_PLAYED');
  const state=(await f.request('/api/qa/games/'+game.id)).data;assert.equal(state.revision,0);assert.equal(state.busy,false);
 }
});

test('bounded fixture batches preserve exact history and reject an invalid suffix atomically',async t=>{
 const f=fixture();t.after(()=>f.sql.close());const spec=silverBulletFixture();
 const game=(await f.request('/api/qa/games',{mode:'observe',script:spec.script})).data,path='/api/qa/games/'+game.id+'/fixture-step';
 const commands=spec.commands.map(x=>x.command);
 const failed=await f.request(path,{revision:0,commands:[...commands,{type:'invented'}]});
 assert.equal(failed.status,400);assert.equal((await f.request('/api/qa/games/'+game.id)).data.revision,0);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM frames WHERE game=?').get(game.id).n,1);
 for(const invalid of [[],Array(81).fill(commands[0])])assert.equal((await f.request(path,{revision:0,commands:invalid})).data.code,'INVALID_FIXTURE_BATCH');
 assert.equal((await f.request(path,{revision:0,command:commands[0],commands})).data.code,'INVALID_FIXTURE_BATCH');
 const body={revision:0,commandId:'complete-fixture',commands};
 const done=await f.request(path,body);assert.equal(done.status,200);assert.equal(done.data.revision,commands.length);
 assert.equal((await f.request(path,body)).data.revision,commands.length);
 assert.equal(hash(JSON.parse(f.sql.prepare('SELECT state FROM games WHERE id=?').get(game.id).state)),hash(configuredFixture(spec)));
});

test('decision diagnostics are restricted to isolated service QA games',async t=>{
 const f=fixture();t.after(()=>f.sql.close());f.env.DEEPSEEK_API_KEY='unit-test-not-real';
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:20},choices:[{finish_reason:'stop',message:{content:JSON.stringify({choice:0,reason:'Test choice'})}}]})));
 for(const qa of [false,true]){
  const path=qa?'/api/qa/games':'/api/games',owner=qa?{}:{owner:'owner-1'};
  const opened=(await f.request(path,{mode:'observe'},owner)).data;
  const played=await f.request(path+'/'+opened.id+'/ai-step',{revision:0,commandId:'diagnostic-check'},owner);
  assert.equal(played.status,200);
  if(qa){assert.equal(played.data.qaDecision.commands.length,1);assert.equal(played.data.qaDecision.reason,'Test choice');assert.ok(played.data.qaDecision.spentEstimate>0);assert.equal(played.data.qaDecision.usage.length,1);assert.equal(played.data.qaDecision.usage[0].usage.completion_tokens,20);assert.deepEqual(played.data.qaDecision.repairCauses,[]);}
  else assert.equal(played.data.qaDecision,undefined);
 }
});

test('only isolated QA can force first-request truncation, then use one model-selected intact plan',async t=>{
 const f=fixture();t.after(()=>f.sql.close());f.env.DEEPSEEK_API_KEY='unit-test-not-real';const requests=[];
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  const body=JSON.parse(init.body);requests.push(body);assert.match(JSON.stringify(body.messages),/json/i);
  return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:body.max_tokens===1?1:30},choices:[{finish_reason:body.max_tokens===1?'length':'stop',message:{content:body.max_tokens===1?'':JSON.stringify({plan:0,reason:'完整方案'})}}]}));
 });
 const normal=(await f.request('/api/games',{mode:'observe'},{owner:'normal-owner'})).data;
 const denied=await f.request('/api/games/'+normal.id+'/ai-step',{revision:0,qaFirstMaxTokens:1},{owner:'normal-owner'});
 assert.equal(denied.data.code,'INVALID_QA_LIMIT');assert.equal(requests.length,0);
 const game=(await f.request('/api/qa/games',{mode:'observe'})).data,path='/api/qa/games/'+game.id+'/ai-step';
 assert.equal((await f.request(path,{revision:0,qaFirstMaxTokens:999})).data.code,'INVALID_QA_LIMIT');
 const done=await f.request(path,{revision:0,commandId:'forced-truncation',qaFirstMaxTokens:1});
 assert.equal(done.status,200);assert.equal(requests.length,2);assert.deepEqual(requests.map(r=>r.max_tokens),[1,1200]);
 assert.equal(done.data.qaDecision.repairMode,'compiled-plan');assert.deepEqual(done.data.qaDecision.repairCauses,['TRUNCATED']);assert.equal(done.data.qaDecision.commands.length,3);
 assert.equal(done.data.qaDecision.usage.length,2);assert.equal(f.sql.prepare('SELECT count(*) n FROM calls WHERE game=?').get(game.id).n,2);
});

test('paired model probes use only isolated historical frames, settle invoices and preserve state',async t=>{
 const f=fixture();t.after(()=>f.sql.close());f.env.OPENROUTER_API_KEY='fake-test-key';
 const requests=[];t.mock.method(globalThis,'fetch',async(url,init)=>{const b=JSON.parse(init.body);requests.push(b);return new Response(JSON.stringify({model:b.model,id:'test-probe',usage:{prompt_tokens:100,completion_tokens:5,cost:.0001},choices:[{message:{content:'{"choice":0}'}}]}));});
 const spec=silverBulletFixture();let game=(await f.request('/api/qa/games',{mode:'observe',aiProvider:'openrouter',opponent:'ai',script:spec.script})).data;
 game=(await f.request('/api/qa/games/'+game.id+'/fixture-step',{revision:0,commands:spec.commands.map(x=>x.command)})).data;
 const before=f.sql.prepare('SELECT state FROM games WHERE id=?').get(game.id).state;
 const r=await f.request('/api/qa/games/'+game.id+'/ai-step',{revision:game.revision,qaProbeRevision:game.revision,qaProfile:'luna-history'});
 assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.qaDecision.usage[0].model,'openai/gpt-6-luna');assert.equal(requests[0].model,'openai/gpt-6-luna');
 assert.deepEqual(requests[0].prompt_cache_options,{mode:'explicit',ttl:'30m'});
 assert.equal(f.sql.prepare('SELECT state FROM games WHERE id=?').get(game.id).state,before);assert.ok(f.sql.prepare('SELECT spent FROM games WHERE id=?').get(game.id).spent>0);
 for(const qaProfile of ['arbitrary-model','http://elsewhere'])assert.equal((await f.request('/api/qa/games/'+game.id+'/ai-step',{revision:game.revision,qaProfile,qaProbeRevision:0})).data.code,'INVALID_QA_PROFILE');
 const normal=(await f.request('/api/games',{mode:'observe',aiProvider:'openrouter',opponent:'ai',script:spec.script},{owner:'normal'})).data;
 assert.equal((await f.request('/api/games/'+normal.id+'/ai-step',{revision:0,qaProfile:'luna-history'},{owner:'normal'})).data.code,'INVALID_QA_PROFILE');
 f.env.SITES_QA_ENABLED='false';assert.equal((await f.request('/api/qa/games/'+game.id+'/ai-step',{revision:game.revision,qaProfile:'luna-history'})).status,401);
});

test('only enabled isolated QA may reconcile a nonterminal invoice after transport uncertainty',async t=>{
 const f=fixture();t.after(()=>f.sql.close());
 const own=(await f.request('/api/games',{mode:'observe'},{owner:'normal'})).data;
 assert.equal((await f.request('/api/games/'+own.id+'/usage',undefined,{owner:'normal'})).status,403);
 const qa=(await f.request('/api/qa/games',{mode:'observe'})).data;
 f.sql.prepare('INSERT INTO calls(id,game,status,data) VALUES(?,?,?,?)').run('uncertain-call',qa.id,'completed',JSON.stringify({status:'completed',estimatedCost:.001}));
 const receipt=await f.request('/api/qa/games/'+qa.id+'/usage');assert.equal(receipt.status,200);assert.equal(receipt.data[0].estimatedCost,.001);
 assert.equal((await f.request('/api/qa/games/'+own.id+'/usage')).status,404);
 f.env.SITES_QA_ENABLED='false';assert.equal((await f.request('/api/qa/games/'+qa.id+'/usage')).status,401);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createWorker} from '../worker/index.mjs';
import {getCuratedScript} from '../src/script-library.mjs';
import {createGame} from '../src/engine.mjs';
import {plots} from '../src/content.mjs';
import {creationIdentity,checkCreationReceipt,prepareGameScript} from '../src/game-services.mjs';

function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const wrap=(query,args=[])=>({bind(...values){return wrap(query,values);},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}});
 const DB={prepare:q=>wrap(q),async batch(items){sql.exec('BEGIN');try{const result=[];for(const item of items)result.push(await item.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB},worker=createWorker({});
 const request=async(path,body,owner='test-owner')=>{
  const result=await worker.fetch(new Request('https://game.test'+path,{method:body===undefined?'GET':'POST',headers:{'oai-authenticated-user-id':owner,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  return {status:result.status,data:await result.json()};
 };
 return {sql,env,request};
}

test('curated library has safe summaries for every supported set and blind opening',async t=>{
 const {request}=fixture(t),library=(await request('/api/scripts/library')).data.scripts;
 for(const set of ['FS','BTX','MZ','MC'])assert.ok(library.some(s=>s.ruleset===set));
 for(const summary of library){
  for(const key of ['roles','mainPlot','subPlots','privateDesign','seed'])assert.equal(summary[key],undefined);
  const result=await request('/api/games',{libraryId:summary.id,mode:'heroes'});assert.equal(result.status,201,JSON.stringify(result.data));
  const game=result.data;assert.equal(game.script.title,summary.title);assert.equal(game.script.privateDesign,undefined);assert.equal(game.secret,undefined);
  assert.ok(game.script.incidents.every(e=>e.type&&!e.culprit));assert.equal(game.script.seed,undefined);
 }
});

test('opening communication selection persists for curated, generated, imported, and starter scripts',async t=>{
 const {request,sql}=fixture(t),original=getCuratedScript('curated-last-ward');
 for(const body of [{libraryId:original.id},{setup:{ruleset:'FS',seed:14,communication:'between_loops_only'}},{script:original},{}]){
  const result=await request('/api/games',{...body,communication:'allowed_during_loop'});
  assert.equal(result.status,201,JSON.stringify(result.data));
  const game=result.data;
  assert.equal(game.script.communication,'allowed_during_loop');
  assert.equal(JSON.parse(sql.prepare('SELECT state FROM games WHERE id=?').get(game.id).state).script.communication,'allowed_during_loop');
  assert.equal((await request('/api/games/'+game.id)).data.script.communication,'allowed_during_loop');
 }
 assert.equal(original.communication,'between_loops_only');
 assert.equal((await request('/api/games',{libraryId:original.id})).data.script.communication,'between_loops_only');
});

test('invalid communication is rejected before an AI author call or game creation',async t=>{
 const {request,env,sql}=fixture(t);env.DEEPSEEK_API_KEY='unit-test-not-real';let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('must validate before provider');});
 for(const communication of ['unknown',null,[]]){
  const result=await request('/api/games',{setup:{ruleset:'FS',generation:'ai'},communication});
  assert.equal(result.status,400);assert.equal(result.data.code,'INVALID_SETUP');
 }
 assert.equal(calls,0);assert.equal(sql.prepare('SELECT count(*) n FROM games').get().n,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM calls').get().n,0);
});

test('default starter and random openings expose incident names but never culprits or design',async t=>{
 const {request}=fixture(t);
 for(const body of [{},{setup:{ruleset:'MC',seed:20261114,includeAI:true}}]){
  const game=(await request('/api/games',body)).data;
  assert.ok(game.script.incidents.every(e=>e.type&&!e.culprit));
  for(const field of ['roles','mainPlot','subPlots','privateDesign'])assert.equal(game.script[field],undefined);
  const replay=(await request('/api/games/'+game.id+'/replay')).data;
  assert.ok(replay.script.incidents.every(e=>e.type&&!e.culprit));
  assert.equal((await request('/api/games/'+game.id+'/review')).status,403);
  assert.equal((await request('/api/games/'+game.id+'/feedback',{rating:'interesting'})).status,403);
 }
});

test('review and feedback require ownership and terminal state; feedback never changes replay state',async t=>{
 const {request,sql}=fixture(t),library=(await request('/api/scripts/library')).data.scripts;
 const game=(await request('/api/games',{libraryId:library[0].id})).data;
 const state=JSON.parse(sql.prepare('SELECT state FROM games WHERE id=?').get(game.id).state);state.phase='over';state.winner='heroes';
 sql.prepare('UPDATE games SET state=? WHERE id=?').run(JSON.stringify(state),game.id);
 assert.equal((await request('/api/games/'+game.id+'/review',undefined,'other-owner')).status,404);
 const review=await request('/api/games/'+game.id+'/review');assert.equal(review.status,200);assert.ok(review.data.design);assert.ok(review.data.alternatives.length);
 const before=sql.prepare('SELECT state FROM games WHERE id=?').get(game.id).state;
 assert.equal((await request('/api/games/'+game.id+'/feedback',{rating:'made_up'})).status,400);
 assert.equal((await request('/api/games/'+game.id+'/feedback',{rating:'interesting'})).status,200);
 assert.equal((await request('/api/games/'+game.id+'/feedback',{rating:'unclear'})).status,200);
 assert.equal((await request('/api/games/'+game.id+'/review')).data.feedback.rating,'unclear');
 assert.equal(sql.prepare('SELECT count(*) n FROM script_feedback').get().n,1);
 assert.equal(sql.prepare('SELECT state FROM games WHERE id=?').get(game.id).state,before);
});

test('terminal review takes selected rule effects from the catalog, never AI design prose',async t=>{
 const {request,sql}=fixture(t);
 const opened=await request('/api/games',{setup:{ruleset:'BTX',mainPlot:'contract',seed:27}});
 assert.equal(opened.status,201,JSON.stringify(opened.data));
 const id=opened.data.id;
 assert.equal((await request('/api/games/'+id+'/review')).status,403);
 const state=JSON.parse(sql.prepare('SELECT state FROM games WHERE id=?').get(id).state);
 const wrongEffect='错误设想：降低神社的暗跃就能阻止契约失败';
 state.phase='over';state.winner='heroes';state.script.source='ai';
 state.script.privateDesign={threatPlan:wrongEffect,counterplay:wrongEffect,ruleEffects:[{id:'contract',name:'伪造名称',effect:wrongEffect}],note:'完全可信'};
 state.script.ruleEffects=state.script.privateDesign.ruleEffects;
 sql.prepare('UPDATE games SET state=? WHERE id=?').run(JSON.stringify(state),id);
 const reviewed=await request('/api/games/'+id+'/review');assert.equal(reviewed.status,200);
 assert.deepEqual(reviewed.data.ruleEffects,[state.script.mainPlot,...state.script.subPlots].map(id=>({id,name:plots[id].name_zh_working,effect:plots[id].effect_zh})));
 assert.match(reviewed.data.ruleEffects[0].effect,/她的暗跃达到 2/);
 assert.doesNotMatch(JSON.stringify(reviewed.data.ruleEffects),/神社|错误设想|伪造/);
 assert.equal(reviewed.data.design.threatPlan,wrongEffect);
 assert.equal(reviewed.data.source,'ai');assert.match(reviewed.data.note,/模型说明可能误述规则.*实际规则与速查/);
});

test('feedback records current and legacy script sources with a bounded imported fallback',async t=>{
 const {request,sql}=fixture(t),base=getCuratedScript('curated-last-ward');delete base.source;
 const cases=[
  [{libraryId:base.id},'curated'],
  [{setup:{ruleset:'FS',seed:21}},'random'],
  [{script:base},'imported'],
  [{script:{...base,source:'ai',generation:{source:'random'}}},'ai'],
  [{script:{...base,generation:{source:'ai'}}},'ai'],
  [{script:{...base,source:'untrusted-source',generation:{source:'unknown'}}},'imported']
 ];
 for(const [body,expected] of cases){
  const opened=await request('/api/games',body);assert.equal(opened.status,201,JSON.stringify(opened.data));
  const id=opened.data.id,state=JSON.parse(sql.prepare('SELECT state FROM games WHERE id=?').get(id).state);state.phase='over';state.winner='heroes';
  sql.prepare('UPDATE games SET state=? WHERE id=?').run(JSON.stringify(state),id);
  assert.equal((await request('/api/games/'+id+'/feedback',{rating:'interesting'})).status,200);
  assert.equal(sql.prepare('SELECT source FROM script_feedback WHERE game=?').get(id).source,expected);
 }
});

test('same creation request recovers one game and rejects changed payload',async t=>{
 const {request,sql}=fixture(t),body={requestId:'creation-test-0001',setup:{ruleset:'MC',seed:44},mode:'heroes'};
 const first=await request('/api/games',body),retry=await request('/api/games',body);
 assert.equal(first.status,201);assert.equal(retry.status,200);assert.equal(first.data.id,retry.data.id);
 assert.equal(sql.prepare('SELECT count(*) n FROM games').get().n,1);
 assert.equal((await request('/api/games',{...body,mode:'observe'})).data.code,'CREATE_REQUEST_CONFLICT');
 assert.equal((await request('/api/games',body,'other-owner')).status,201);
});

test('failed author creation is accounted once and the same request never bills again',async t=>{
 const {request,env,sql}=fixture(t);env.DEEPSEEK_API_KEY='unit-test-not-real';let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('unknown provider result');});
 const body={requestId:'author-test-unknown',setup:{ruleset:'FS',generation:'ai'}};
 const first=await request('/api/games',body);assert.equal(first.data.code,'NETWORK');
 const second=await request('/api/games',body);assert.equal(second.data.code,'NETWORK');assert.equal(calls,1);
 assert.equal(sql.prepare('SELECT count(*) n FROM games').get().n,0);assert.equal(sql.prepare('SELECT count(*) n FROM calls').get().n,1);
});

test('in-flight creation refuses a duplicate while first model call is running',async t=>{
 const {request,env}=fixture(t);env.DEEPSEEK_API_KEY='unit-test-not-real';let release,start,calls=0;
 const waiting=new Promise(r=>release=r),ready=new Promise(r=>start=r);
 t.mock.method(globalThis,'fetch',async()=>{calls++;start();await waiting;throw Error('stop after concurrency check');});
 const body={requestId:'author-concurrent-1',setup:{ruleset:'FS',generation:'ai'}};
 const first=request('/api/games',body);await ready;
 assert.equal((await request('/api/games',body)).data.code,'CREATION_PENDING');assert.equal(calls,1);release();await first;
});

test('expired creation remains non-retryable and invalid sources fail before a model request',async()=>{
 const identity=creationIdentity({requestId:'request-expired-1',setup:{ruleset:'FS'}});
 assert.throws(()=>checkCreationReceipt({request_hash:identity.requestHash,status:'processing',created:'2000-01-01T00:00:00.000Z'},identity),e=>e.code==='CREATION_UNKNOWN');
 for(const body of [{setup:[],script:{}},{libraryId:'missing',setup:{}},{setup:{generation:'unknown'}}])await assert.rejects(prepareGameScript(body));
});

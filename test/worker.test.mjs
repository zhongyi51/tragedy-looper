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
test('hosted identity required for UI, assets and every API; cross-origin rejected',async()=>{const {request}=fixture();for(const p of ['/','/app.js','/api/info','/api/games'])assert.equal((await request(p,undefined,null)).status,401);assert.equal((await request('/')).status,200);assert.equal((await request('/api/games',{},'owner-1',{Origin:'https://evil.test'})).status,403);});
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

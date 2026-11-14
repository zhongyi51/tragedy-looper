import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorker} from '../worker/index.mjs';
import {tacticalFixtures,silverBulletFixture} from './fixtures/tactics.mjs';
import {hash} from '../src/engine.mjs';

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
  assert.equal(hash(stored),hash(spec.state));
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

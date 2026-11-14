import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorker} from '../worker/index.mjs';
import {catalog} from '../src/content.mjs';
import {validateReplay} from '../public/replay-validation.mjs';

function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_initial.sql',import.meta.url),'utf8'));
 const wrap=(query,args=[])=>({bind(...values){return wrap(query,values);},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}});
 const DB={prepare:q=>wrap(q),async batch(items){sql.exec('BEGIN');try{const rows=[];for(const s of items)rows.push(await s.run());sql.exec('COMMIT');return rows;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 let worker=createWorker({});
 const request=async(path,body,owner='mc-owner')=>{
  const response=await worker.fetch(new Request('https://game.test'+path,{method:body===undefined?'GET':'POST',headers:{'oai-authenticated-user-id':owner,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB});
  return {status:response.status,data:await response.json()};
 };
 return {sql,request,restart(){worker=createWorker({});}};
}

function publicOnly(v,visibility){
 assert.equal(v.secret,undefined);assert.equal(v.pending,undefined);
 for(const key of ['roles','mainPlot','subPlots'])assert.equal(v.script[key],undefined);
 assert.ok(Number.isInteger(v.extraGauge)&&v.extraGauge>=0);
 for(const event of v.script.incidents){assert.equal(event.culprit,undefined);assert.equal('type' in event,visibility==='public');}
}

for(const visibility of ['hidden','public'])test(`MC Worker survives restarts and receipt retries, then exports a valid ${visibility} replay`,async t=>{
 const f=fixture();t.after(()=>f.sql.close());
 const created=await f.request('/api/games',{mode:'observe',setup:{ruleset:'MC',seed:271114,days:3,loops:2,incidentCount:3,includeAI:true,characterPool:'all',incidentVisibility:visibility}});
 assert.equal(created.status,201,JSON.stringify(created.data));let g=created.data;assert.ok(g.script.characters.includes('ai_character'));
 const replayBefore=await f.request('/api/games/'+g.id+'/replay?full=1');assert.equal(replayBefore.status,403);
 let steps=0;
 while(!g.winner&&steps<350){
  publicOnly(g,visibility);const initial=g,body={revision:g.revision,commandId:'mc-step-'+steps};
  const response=await f.request('/api/games/'+g.id+'/bot-step',body);assert.equal(response.status,200,JSON.stringify(response.data));g=response.data;
  assert.ok(g.revision>initial.revision);assert.equal(g.busy,false);
  for(const frame of g.transitionFrames||[])publicOnly(frame,visibility);
  if(steps%7===0){
   f.restart();const retry=await f.request('/api/games/'+g.id+'/bot-step',body);
   assert.equal(retry.status,200);assert.equal(retry.data.revision,g.revision);assert.deepEqual(retry.data.board,g.board);assert.equal(retry.data.extraGauge,g.extraGauge);
   const reload=await f.request('/api/games/'+g.id);assert.equal(reload.data.revision,g.revision);assert.equal(reload.data.extraGauge,g.extraGauge);
  }
  steps++;
 }
 assert.ok(g.winner,'MC stalled before a terminal outcome');publicOnly(g,visibility);
 const replay=await f.request('/api/games/'+g.id+'/replay');assert.equal(replay.status,200);assert.doesNotThrow(()=>validateReplay(replay.data,catalog));
 for(const frame of replay.data.frames)publicOnly(frame.view,visibility);
 assert.equal(replay.data.frames.at(-1).view.winner,g.winner);
 const full=await f.request('/api/games/'+g.id+'/replay?full=1');assert.equal(full.status,200);assert.ok(full.data.frames.every(f=>f.view.secret&&f.stateHash));
 assert.deepEqual((await f.request('/api/games/'+g.id+'/usage')).data,[]);
 assert.equal((await f.request('/api/games/'+g.id,undefined,'another-owner')).status,404);
 const saved=JSON.parse(f.sql.prepare('SELECT state FROM games WHERE id=?').get(g.id).state);assert.equal(saved.extraGauge,g.extraGauge);
});

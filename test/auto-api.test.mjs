import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorker} from '../worker/index.mjs';
import {createGame,applyCommand,turn,legalActions,hash,view} from '../src/engine.mjs';
import {starter,generateScript} from '../src/content.mjs';

function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_initial.sql',import.meta.url),'utf8'));
 const wrap=(query,args=[])=>({bind(...values){return wrap(query,values);},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}});
 const DB={prepare:q=>wrap(q),async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const worker=createWorker({}),env={DB,DEEPSEEK_API_KEY:'unit_test_not_a_real_secret'};
 const request=async(path,body)=>{const res=await worker.fetch(new Request('https://game.test'+path,{method:body===undefined?'GET':'POST',headers:{'oai-authenticated-user-id':'owner-1','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);return {status:res.status,data:await res.json()};};
 const store=async(state,mode='heroes')=>{
  const result=await request('/api/games',{mode,script:state.script});assert.equal(result.status,201);const id=result.data.id;
  state=structuredClone(state);state.revision=0;
  sql.prepare('UPDATE games SET state=? WHERE id=?').run(JSON.stringify(state),id);
  sql.prepare('UPDATE frames SET state=?,hash=? WHERE game=? AND revision=0').run(JSON.stringify(state),hash(state),id);
  return {id,state};
 };
 return {sql,env,request,store};
}
function noProvider(t){let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('deterministic rule attempted provider call');});return ()=>calls;}
function pendingEnd(){const s=createGame(starter);s.phase='hero_ability';return s;}
function fiveCards(){let s=createGame(starter);for(const [card,target] of [['move_h#0','hospital'],['move_v#0','shrine'],['move_d#0','city'],['goodwill_1#0','boy_student'],['goodwill_1#0','girl_student']])s=applyCommand(s,turn(s),{type:'place',card,target});return s;}
function publicFrame(v){assert.equal(v.secret,undefined);assert.equal(v.pending,undefined);assert.ok(v.script.incidents.every(e=>!('type'in e)&&!('culprit'in e)));assert.notEqual(v.seat,'M');}

test('advance drains forced phases without provider calls and persists each sanitized frame',async t=>{
 const calls=noProvider(t),{sql,request,store}=fixture(),{id}=await store(pendingEnd());
 const advanced=await request('/api/games/'+id+'/advance',{revision:0,commandId:'forced-chain'});
 assert.equal(advanced.status,200);const g=advanced.data;assert.equal(g.phaseId,'mm_cards');assert.equal(g.day,2);assert.ok(g.revision>=3);assert.equal(g.busy,false);assert.equal(calls(),0);
 assert.ok(g.transitionFrames.length>=1);for(const frame of g.transitionFrames)publicFrame(frame);
 const stored=sql.prepare('SELECT revision,state FROM frames WHERE game=? ORDER BY revision').all(id);
 assert.deepEqual(stored.map(f=>f.revision),Array.from({length:g.revision+1},(_,i)=>i));
 const replay=(await request('/api/games/'+id+'/replay')).data;
 assert.equal(replay.frames.length,stored.length);for(let i=0;i<stored.length;i++){publicFrame(replay.frames[i].view);assert.deepEqual(replay.frames[i].view,view(JSON.parse(stored[i].state),'public'));}
 assert.equal(sql.prepare('SELECT count(*) AS n FROM calls WHERE game=?').get(id).n,0);
 assert.equal(sql.prepare('SELECT spent FROM games WHERE id=?').get(id).spent,0);
 const retry=await request('/api/games/'+id+'/advance',{revision:0,commandId:'forced-chain'});assert.equal(retry.status,200);assert.equal(retry.data.revision,g.revision);assert.equal(calls(),0);
});

test('observe-mode automatic snapshots never project through the acting mastermind seat',async t=>{
 const calls=noProvider(t),{request,store}=fixture(),{id}=await store(pendingEnd(),'observe');
 const result=await request('/api/games/'+id+'/advance',{revision:0});assert.equal(result.status,200);assert.equal(calls(),0);
 assert.ok(result.data.transitionFrames.length>=1);for(const frame of result.data.transitionFrames){publicFrame(frame);assert.equal(frame.seat,'public');assert.equal(frame.actions,undefined);assert.equal(frame.hand,undefined);}
});

for(const phase of ['cultist','refusal','incident'])test(`advance preserves substantive ${phase} choices without calling the provider`,async t=>{
 const calls=noProvider(t),{sql,request,store}=fixture();let s=createGame(phase==='cultist'?generateScript({ruleset:'BTX',seed:21}):starter);s.phase=phase;
 if(phase==='cultist'){
  s.cultists=['idol'];s.ignoredAreas=[];s.board.idol.location='city';
  s.placements=[{seat:'M',card:'intrigue_1#0',target:'city'},{seat:'M',card:'move_h#0',target:'school'},{seat:'M',card:'paranoia_1#0',target:'teacher'},{seat:'A',card:'forbid_intrigue#0',target:'city'},{seat:'B',card:'goodwill_1#0',target:'doctor'},{seat:'C',card:'goodwill_1#0',target:'nurse'}];
 }else if(phase==='refusal'){
  s.board.doctor.goodwill=2;s.board.office_worker.location='hospital';s.pending={action:{type:'goodwill',actor:'doctor',index:0,target:'office_worker',amount:1}};
 }else s.pending={incident:'unease',culprit:'girl_student',chooser:'M',simulated:false};
 assert.ok(legalActions(s).length>1);const {id,state}=await store(s);
 const result=await request('/api/games/'+id+'/advance',{revision:0,commandId:'not-forced'});
 assert.equal(result.status,200);assert.deepEqual(result.data.transitionFrames,[]);assert.equal(result.data.revision,0);assert.equal(calls(),0);
 assert.deepEqual(JSON.parse(sql.prepare('SELECT state FROM games WHERE id=?').get(id).state),state);
 assert.equal((await request('/api/games/'+id)).data.busy,false);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM receipts WHERE game=?').get(id).n,1);
});

test('a paid last-card choice and its forced aftermath share one idempotent commit',async t=>{
 const {request,store,sql}=fixture(),{id}=await store(fiveCards(),'observe');let calls=0;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{calls++;const messages=JSON.parse(init.body).messages,observation=JSON.parse(messages[2].content).observation;assert.equal(observation.phaseId,'hero_cards');const choice=observation.actions.find(a=>a.command.card==='goodwill_1#0'&&a.command.target==='doctor').choice;return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify({choice,note:'仅当前公开证据'})}}]}),{status:200});});
 const body={revision:0,commandId:'paid-choice-and-settlement'};
 // Treat this response as lost: recover by GET and a same-receipt retry.
 const first=await request('/api/games/'+id+'/ai-step',body);assert.equal(first.status,200);assert.ok(first.data.revision>=2);assert.equal(first.data.phaseId,'mm_ability');assert.equal(calls,1);
 for(const frame of first.data.transitionFrames){publicFrame(frame);assert.equal(frame.seat,'public');}
 const recovered=await request('/api/games/'+id);assert.equal(recovered.data.revision,first.data.revision);
 const retry=await request('/api/games/'+id+'/ai-step',body);assert.equal(retry.status,200);assert.equal(retry.data.revision,first.data.revision);assert.equal(calls,1);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM calls WHERE game=?').get(id).n,1);assert.equal(sql.prepare('SELECT count(*) AS n FROM receipts WHERE game=?').get(id).n,1);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM frames WHERE game=?').get(id).n,first.data.revision+1);
});

test('a failed automatic-chain transaction cannot partially persist frames or receipts',async t=>{
 const calls=noProvider(t),{request,store,sql}=fixture(),{id,state}=await store(pendingEnd());
 sql.exec("CREATE TRIGGER reject_second_frame BEFORE INSERT ON frames WHEN NEW.revision=2 BEGIN SELECT RAISE(ABORT,'test transaction failure'); END;");
 const result=await request('/api/games/'+id+'/advance',{revision:0,commandId:'failed-chain'});assert.equal(result.status,400);assert.equal(calls(),0);
 assert.deepEqual(JSON.parse(sql.prepare('SELECT state FROM games WHERE id=?').get(id).state),state);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM frames WHERE game=?').get(id).n,1);assert.equal(sql.prepare('SELECT count(*) AS n FROM receipts WHERE game=?').get(id).n,0);assert.equal((await request('/api/games/'+id)).data.busy,false);
});

test('hosted goodwill choice settles once and preserves the next human ability',async t=>{
 const calls=noProvider(t),{request,store,sql}=fixture();const s=createGame(starter);s.phase='hero_ability';
 s.board.boy_student.goodwill=2;s.board.girl_student.goodwill=2;s.board.girl_student.paranoia=1;
 const {id}=await store(s);const first=(await request('/api/games/'+id)).data;
 const action=first.actions.find(a=>a.command.actor==='boy_student').command;
 const body={revision:0,commandId:'goodwill-feedback',command:action};
 const result=await request('/api/games/'+id+'/command',body);assert.equal(result.status,200);
 assert.equal(result.data.board.girl_student.paranoia,0);assert.equal(result.data.phaseId,'hero_ability');
 assert.ok(result.data.actions.some(a=>a.command.actor==='girl_student'));
 assert.ok(result.data.log.some(e=>/友好能力 1 开始结算/.test(e.text)));
 assert.equal(calls(),0);assert.equal(sql.prepare('SELECT count(*) AS n FROM calls WHERE game=?').get(id).n,0);
 const retry=await request('/api/games/'+id+'/command',body);assert.equal(retry.data.revision,result.data.revision);
 const reloaded=(await request('/api/games/'+id)).data;assert.deepEqual(reloaded.log,result.data.log);
 for(const frame of result.data.transitionFrames)publicFrame(frame);
});

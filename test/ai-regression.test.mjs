import test from 'node:test';
import assert from 'node:assert/strict';
import {configureKey,decide} from '../src/ai.mjs';
import {createGame,legalActions,applyCommand,turn,view} from '../src/engine.mjs';
import {starter,name} from '../src/content.mjs';

configureKey('unit_test_not_a_real_secret');
const response=answer=>new Response(JSON.stringify({model:'test-model',id:'test-request',choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}],usage:{prompt_tokens:20,completion_tokens:10}}),{status:200});
async function withFetch(mock,run){const original=globalThis.fetch;globalThis.fetch=mock;try{return await run();}finally{globalThis.fetch=original;}}

const invalidAnswers=[null,[],0,'choice: 0',{choice:'0'},{choice:-1},{choice:0.5},{choice:1e9},{choice:0,reason:{}},{choice:0,note:[]},{choice:0,reason:'x'.repeat(241)},{choice:0,note:'x'.repeat(2401)}];
for(const [i,invalid] of invalidAnswers.entries())test(`invalid model schema ${i+1} gets one repair without mutating state`,async()=>{
 const s=createGame(starter),before=structuredClone(s);let sent=0,accounted=0;
 await withFetch(async()=>response(++sent===1?invalid:{choice:0,reason:'选择合法候选',note:'只记录公开证据'}),async()=>{
  const answer=await decide(s,'M',{onUsage:()=>accounted++});
  assert.equal(answer.repairAttempts,1);assert.deepEqual(answer.command,legalActions(s,'M')[0].command);
 });
 assert.equal(sent,2);assert.equal(accounted,2);assert.deepEqual(s,before);
});

test('model command injection is rejected even when it duplicates a legal command',async()=>{
 const s=createGame(starter),before=structuredClone(s);let requests=0;
 await withFetch(async()=>{requests++;return response({command:legalActions(s,'M')[0].command});},async()=>{
  await assert.rejects(decide(s,'M'),e=>e.code==='ILLEGAL_MODEL_ACTION');
 });
 assert.equal(requests,2);assert.deepEqual(s,before);
});

test('extra model fields cannot override an otherwise valid candidate',async()=>{
 const s=createGame(starter);let requests=0;
 await withFetch(async()=>{requests++;return response({choice:0,command:{type:'place',card:'fake',target:'school'}});},async()=>{
  await assert.rejects(decide(s,'M'),e=>e.code==='ILLEGAL_MODEL_ACTION');
 });
 assert.equal(requests,2);assert.equal(s.revision,0);
});

test('changed revision during model request never executes a stale candidate or retries',async()=>{
 const s=createGame(starter);let requests=0;
 await withFetch(async()=>{requests++;s.revision++;return response({choice:0});},async()=>{
  await assert.rejects(decide(s,'M'),e=>e.code==='STALE_MODEL_ACTION');
 });
 assert.equal(requests,1);assert.deepEqual(s.placements,[]);
});

test('candidate is revalidated even if the state changed without a revision increment',async()=>{
 const s=createGame(starter),first=legalActions(s,'M')[0].command;
 await withFetch(async()=>{s.placements.push({seat:'M',card:first.card,target:first.target});return response({choice:0});},async()=>{
  await assert.rejects(decide(s,'M'),e=>e.code==='STALE_MODEL_ACTION');
 });
 assert.equal(s.placements.length,1);
});

test('AI receives explicit location bluff rules and can legally select a location movement card',async()=>{
 const s=createGame(starter),choice=legalActions(s,'M').findIndex(a=>a.command.card==='move_h#0'&&a.command.target==='school');assert.ok(choice>=0);
 let payload;
 await withFetch(async(_url,init)=>{payload=JSON.parse(init.body);return response({choice,reason:'以无效果佯动隐藏意图',note:'地点不会移动'});},async()=>{
  const answer=await decide(s,'M');const next=applyCommand(s,'M',answer.command);
  assert.equal(next.revision,1);assert.deepEqual(next.locations,s.locations);assert.equal(next.placements[0].target,'school');
 });
 const context=JSON.parse(payload.messages[2].content);
 assert.match(context.observation.actions[choice].effectHint,/合法佯动/);
 assert.match(payload.messages[0].content,/地点本身永远不移动/);
 assert.ok(payload.messages[0].content.includes('actionDeckEntries'));
 assert.equal(payload.user_id,'local_M');
});

test('AI history is precisely the seat projection rather than raw stored history',async()=>{
 let s=createGame({...starter,settings:{...starter.settings,incidentVisibility:'hidden'}});
 for(const [card,target]of [['move_h#0','girl_student'],['intrigue_1#0','office_worker'],['paranoia_1#0','doctor']])s=applyCommand(s,turn(s),{type:'place',card,target});
 s.log.push({n:s.log.length+1,loop:1,day:1,type:'incident',text:`预告的「${name(starter.incidents[0].type)}」没有发生。`});
 let payload;
 await withFetch(async(_url,init)=>{payload=JSON.parse(init.body);return response({choice:0});},async()=>{await decide(s,'A');});
 const context=JSON.parse(payload.messages[2].content);
 assert.deepEqual(context.visibleHistory,view(s,'A').log);
 assert.notDeepEqual(context.visibleHistory,s.log);
 assert.ok(!context.visibleHistory.at(-1).text.includes(name(starter.incidents[0].type)));
 assert.ok(context.observation.script.incidents.every(e=>e.type===undefined));
 assert.ok(!context.observation.secret);
});

function protagonistTurn(seat='A'){
 let s=createGame(starter);
 for(const [card,target]of [['move_h#0','girl_student'],['intrigue_1#0','office_worker'],['paranoia_1#0','doctor']])s=applyCommand(s,turn(s),{type:'place',card,target});
 s.leader=['A','B','C'].indexOf(seat);
 return s;
}
for(const seat of ['A','B','C'])test(`legacy ${seat} private notes cannot reintroduce future incident names`,async()=>{
 const s=protagonistTurn(seat);delete s.visibilityPolicy;
 s.notes={A:'LEGACY_A_SECRET_FUTURE_INCIDENT',B:'LEGACY_B_SECRET_FUTURE_INCIDENT',C:'LEGACY_C_SECRET_FUTURE_INCIDENT',M:'MASTER_SECRET'};
 const before=structuredClone(s);let payload;
 await withFetch(async(_url,init)=>{payload=JSON.parse(init.body);return response({choice:0,note:'从当前公开局面重新记录'});},async()=>{
  const result=await decide(s,seat);
  assert.equal(result.note,'从当前公开局面重新记录');
 });
 const context=JSON.parse(payload.messages[2].content);
 assert.equal(context.privateNote,'');assert.ok(!JSON.stringify(payload.messages).includes('LEGACY_'));
 assert.deepEqual(s,before);
});

test('legacy forced protagonist actions return no contaminated private note and make no model call',async()=>{
 const s=protagonistTurn();delete s.visibilityPolicy;s.phase='hero_ability';s.placements=[];s.notes.A='LEGACY_SECRET_FUTURE_INCIDENT';
 assert.equal(legalActions(s,'A').length,1);let sent=0;
 await withFetch(async()=>{sent++;throw Error('unexpected model call');},async()=>{
  const result=await decide(s,'A');assert.equal(result.automatic,true);assert.equal(result.note,'');
 });
 assert.equal(sent,0);
});

test('current-policy protagonist notes and legacy mastermind notes remain usable',async()=>{
 const protagonist=protagonistTurn(),mastermind=createGame(starter);delete mastermind.visibilityPolicy;
 protagonist.notes.A='CURRENT_PUBLIC_EVIDENCE';mastermind.notes.M='MASTER_KNOWN_SCRIPT';
 for(const [s,seat,expected]of [[protagonist,'A','CURRENT_PUBLIC_EVIDENCE'],[mastermind,'M','MASTER_KNOWN_SCRIPT']]){
  let payload;
  await withFetch(async(_url,init)=>{payload=JSON.parse(init.body);return response({choice:0});},async()=>{await decide(s,seat);});
  assert.equal(JSON.parse(payload.messages[2].content).privateNote,expected);
 }
});

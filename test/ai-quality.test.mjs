import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,starter,generateScript} from '../src/content.mjs';
import {createGame,applyCommand,turn,view,VISIBILITY_POLICY,legalActions} from '../src/engine.mjs';
import {AI_MEMORY_VERSION,decisionContext,rulesForDecision,decisionProfile,decide,rememberDecision,requestJson} from '../src/ai.mjs';

const response=answer=>new Response(JSON.stringify({model:'test-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer),reasoning_content:'PRIVATE_PROVIDER_REASONING'}}],usage:{prompt_tokens:100,completion_tokens:80}}));
const memory=(claim='已公开的信息仍不足以确认犯人',evidence=[1])=>({hypotheses:[{claim,evidence,confidence:evidence.length?'medium':'low'}],goals:['观察下一次揭牌'],questions:['谁是不安来源？']});
const saved=(data,loop=1)=>({version:AI_MEMORY_VERSION,policy:VISIBILITY_POLICY,loop,day:1,revision:1,data});
function heroState(){
 let s=createGame(starter);
 for(const [card,target]of [['move_h#0','girl_student'],['intrigue_1#0','office_worker'],['paranoia_1#0','doctor']])s=applyCommand(s,turn(s),{type:'place',card,target});
 return s;
}

for(const set of ['FS','BTX','MZ','MC'])test(`${set} model dictionary contains the entire selected set and only its cast`,()=>{
 const s=createGame(generateScript({ruleset:set,seed:142126})),r=rulesForDecision(s);
 assert.deepEqual(r.sets.map(x=>x.id),[set]);
 assert.deepEqual(r.plots.map(x=>x.id),catalog.plots.filter(x=>x.sets.includes(set)).map(x=>x.id));
 assert.deepEqual(r.roles.map(x=>x.id),catalog.roles.filter(x=>x.sets.includes(set)).map(x=>x.id));
 assert.deepEqual(new Set(r.characters.map(x=>x.id)),new Set(s.script.characters));
 const other=structuredClone(s);other.script.mainPlot='SECRET_DIFFERENT_Y';other.script.subPlots=['SECRET_X'];other.script.roles={};
 assert.deepEqual(rulesForDecision(other),r);
});

test('default protagonist observation includes official incident names but never culprit identities',()=>{
 const s=heroState(),payload=decisionContext(s,'A').payload;
 assert.ok(payload.observation.script.incidents.every(e=>typeof e.type==='string'&&e.culprit===undefined));
 assert.equal(payload.observation.script.roles,undefined);assert.equal(payload.observation.script.mainPlot,undefined);assert.equal(payload.observation.script.subPlots,undefined);
});

test('model context leaves current-loop private memories and hidden cards isolated',()=>{
 const s=heroState();s.notes.M='MASTER_NOTE_SECRET';s.notes.B='B_RAW_PRIVATE_NOTE';s.aiMemory={A:saved(memory('A_PUBLIC_GUESS')),B:saved(memory('B_CURRENT_GUESS')),M:saved(memory('MASTER_HIDDEN_TRUTH'))};
 const {messages,payload}=decisionContext(s,'A');
 assert.equal(payload.privateMemory.hypotheses[0].claim,'A_PUBLIC_GUESS');
 assert.deepEqual(payload.permittedDiscussion.participants,[]);
 const text=JSON.stringify(messages);
 for(const secret of ['MASTER_NOTE_SECRET','B_RAW_PRIVATE_NOTE','B_CURRENT_GUESS','MASTER_HIDDEN_TRUTH'])assert.ok(!text.includes(secret));
 assert.ok(payload.observation.placements.every(p=>p.card===undefined));
 assert.ok(payload.observation.actions.length===legalActions(s,'A').length);
 assert.equal(payload.observation.suggestion.guaranteed,false);
 assert.ok(payload.observation.tacticalOptions.every(x=>x.choice>=0&&x.choice<payload.observation.actions.length));
});

test('structured hypotheses survive loops, freeze discussion and keep new private reasoning separate',()=>{
 const s=heroState();s.loop=2;s.aiMemory={A:saved(memory('A_LOOP_ONE')),B:saved(memory('B_LOOP_ONE')),C:saved(memory('C_LOOP_ONE'))};
 const first=decisionContext(s,'A');
 assert.deepEqual(first.payload.permittedDiscussion.participants.map(x=>x.hypotheses[0].claim).sort(),['B_LOOP_ONE','C_LOOP_ONE']);
 rememberDecision(s,'A',{memory:memory('A_LOOP_TWO'),discussion:first.discussion,memoryContext:{loop:2,day:1,revision:8}});
 const second=decisionContext(s,'B');
 assert.deepEqual(second.payload.permittedDiscussion.participants.map(x=>x.hypotheses[0].claim).sort(),['A_LOOP_ONE','C_LOOP_ONE']);
 assert.ok(!JSON.stringify(second.payload).includes('A_LOOP_TWO'));
 for(const seat of ['A','B','C','public','M']){const v=view(s,seat);assert.equal(v.aiMemory,undefined);assert.equal(v.heroDiscussion,undefined);}
});

test('unrestricted discussion shares structured public evidence but not other raw private notes',()=>{
 const s=heroState();s.script.communication='allowed_during_loop';s.notes.B='PRIVATE_B_NOTE';s.aiMemory={B:saved(memory('B_PUBLIC_HYPOTHESIS'))};
 const {payload}=decisionContext(s,'A');
 assert.equal(payload.permittedDiscussion.mode,'allowed_during_loop');assert.equal(payload.permittedDiscussion.participants[0].hypotheses[0].claim,'B_PUBLIC_HYPOTHESIS');
 assert.ok(!JSON.stringify(payload).includes('PRIVATE_B_NOTE'));
});

test('legacy visibility policy discards structured memories and discussions too',()=>{
 const s=heroState();delete s.visibilityPolicy;s.aiMemory={A:saved(memory('OLD_A')),M:saved(memory('OLD_M'))};s.heroDiscussion={participants:{B:{...saved(memory('OLD_B')),seat:'B'}}};
 const before=structuredClone(s),context=decisionContext(s,'A');
 assert.deepEqual(context.payload.privateMemory,{hypotheses:[],goals:[],questions:[]});assert.equal(context.payload.permittedDiscussion,null);
 assert.ok(!JSON.stringify(context.messages).includes('OLD_'));assert.deepEqual(s,before);
 rememberDecision(s,'A',{resetHeroMemory:true});assert.deepEqual(Object.keys(s.aiMemory),['M']);assert.equal(s.heroDiscussion,undefined);
});

test('MZ evidence marks an identity as a declaration rather than confirmed truth',()=>{
 const s=createGame(generateScript({ruleset:'MZ',seed:147126}));s.knownRoles[s.script.characters[0]]='brain';
 const {payload}=decisionContext(s,'M');assert.equal(payload.observation.evidence.roles[0].status,'declared_may_be_disguised');
});

test('memory cannot invent a public log citation or inject fact/command fields',async t=>{
 const s=heroState(),before=structuredClone(s);let calls=0;
 t.mock.method(globalThis,'fetch',async()=>response(++calls===1?{choice:0,memory:memory('伪造证据',[999999])}:{choice:0,memory:memory('修正后的假说',[1])}));
 const answer=await decide(s,'A',{apiKey:'unit_test_not_a_real_key'});
 assert.equal(calls,2);assert.equal(answer.repairAttempts,1);assert.equal(answer.memory.hypotheses[0].claim,'修正后的假说');assert.deepEqual(s,before);
});

test('new facts remain engine-owned instead of accepting model authored truths',async t=>{
 const s=heroState();let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return response({choice:0,memory:{...memory(),facts:{girl_student:'killer'}}});});
 await assert.rejects(decide(s,'A',{apiKey:'unit_test_not_a_real_key'}),e=>e.code==='ILLEGAL_MODEL_ACTION');assert.equal(calls,2);
});

test('stored memory stamps describe the observed loop, even when its action starts the next',()=>{
 const s=heroState();s.loop=2;
 rememberDecision(s,'A',{memory:memory(),memoryContext:{loop:1,day:3,revision:32}});
 assert.equal(s.aiMemory.A.loop,1);assert.equal(s.aiMemory.A.day,3);
});

test('critical plans use bounded thinking while simple decisions retain fast mode',()=>{
 const s=createGame(starter),actions=legalActions(s,'M');
 assert.deepEqual(decisionProfile(s,actions,3),{thinking:'enabled',reasoningEffort:'low',maxTokens:4096});
 assert.deepEqual(decisionProfile({...s,phase:'guess'},actions,0),{thinking:'enabled',reasoningEffort:'low',maxTokens:4096});
 assert.deepEqual(decisionProfile({...s,phase:'refusal'},actions.slice(0,2),0),{thinking:'disabled',maxTokens:1800});
});

test('a truncated critical decision repairs in fast mode, accounts both calls, and leaves the state unchanged',async t=>{
 const s=createGame(starter),before=structuredClone(s),requests=[],reservations=[],usage=[];
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  requests.push(JSON.parse(init.body));
  if(requests.length===1)return new Response(JSON.stringify({model:'test-model',choices:[{finish_reason:'length',message:{content:'',reasoning_content:'PRIVATE_TRUNCATED_REASONING'}}],usage:{prompt_tokens:100,completion_tokens:4096}}));
  return response({choice:0,reason:'重新选择合法候选'});
 });
 const answer=await decide(s,'M',{apiKey:'unit_test_not_a_real_key',onReserve:x=>reservations.push(x),onUsage:x=>usage.push(x)});
 assert.equal(requests.length,2);assert.equal(answer.repairAttempts,1);
 assert.equal(requests[0].thinking.type,'enabled');assert.equal(requests[0].max_tokens,4096);
 assert.equal(requests[1].thinking.type,'disabled');assert.equal(requests[1].max_tokens,1800);assert.equal(requests[1].reasoning_effort,undefined);
 assert.deepEqual(requests[1].messages.slice(0,3),requests[0].messages);assert.match(requests[1].messages.at(-1).content,/省略memory和note/);
 assert.deepEqual(usage.map(x=>x.status),['completed','completed']);assert.deepEqual(usage.map(x=>x.thinking),['enabled','disabled']);
 assert.deepEqual(usage.map(x=>x.reserved),reservations);assert.equal(usage[0].estimatedCost,(100*.3+4096*1.2)/1e6);assert.equal(usage[1].estimatedCost,(100*.3+80*1.2)/1e6);
 assert.ok(!JSON.stringify(requests.concat(usage)).includes('PRIVATE_TRUNCATED_REASONING'));
 assert.deepEqual(answer.command,legalActions(s,'M')[0].command);assert.deepEqual(s,before);
});

for(const invalid of ['not JSON',{choice:-1}])test(`a ${typeof invalid==='string'?'JSON':'candidate'} repair overrides explicit thinking options with a short fast response`,async t=>{
 const s=createGame(starter),before=structuredClone(s),requests=[];
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  requests.push(JSON.parse(init.body));
  if(requests.length===1&&typeof invalid==='string')return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:invalid}}],usage:{prompt_tokens:100,completion_tokens:10}}));
  return response(requests.length===1?invalid:{choice:0});
 });
 const answer=await decide(s,'M',{apiKey:'unit_test_not_a_real_key',thinking:'enabled',reasoningEffort:'high',maxTokens:8192});
 assert.equal(answer.repairAttempts,1);assert.equal(requests.length,2);
 assert.equal(requests[0].thinking.type,'enabled');assert.equal(requests[0].max_tokens,8192);assert.equal(requests[0].reasoning_effort,'high');
 assert.equal(requests[1].thinking.type,'disabled');assert.equal(requests[1].max_tokens,1800);assert.equal(requests[1].reasoning_effort,undefined);
 assert.deepEqual(answer.command,legalActions(s,'M')[0].command);assert.deepEqual(s,before);
});

test('a second truncation ends the repair without applying a partial decision',async t=>{
 const s=createGame(starter),before=structuredClone(s),usage=[];let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{"choice":0}'}}],usage:{prompt_tokens:100,completion_tokens:1800}}));});
 await assert.rejects(decide(s,'M',{apiKey:'unit_test_not_a_real_key',onUsage:x=>usage.push(x)}),e=>e.code==='TRUNCATED');
 assert.equal(calls,2);assert.equal(usage.length,2);assert.ok(usage.every(x=>x.status==='completed'&&x.estimatedCost>0));assert.deepEqual(s,before);
});

test('decision network uncertainty is charged to its reservation and never retried',async t=>{
 const s=createGame(starter),before=structuredClone(s),usage=[],reservations=[];let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('connection lost');});
 await assert.rejects(decide(s,'M',{apiKey:'unit_test_not_a_real_key',onReserve:x=>reservations.push(x),onUsage:x=>usage.push(x)}),e=>e.code==='NETWORK');
 assert.equal(calls,1);assert.equal(usage.length,1);assert.equal(reservations.length,1);assert.equal(usage[0].status,'unknown');assert.equal(usage[0].estimatedCost,reservations[0]);assert.deepEqual(s,before);
});

test('a bounded provider timeout aborts the request, keeps its reservation, and never retries the decision',async t=>{
 const s=createGame(starter),before=structuredClone(s),usage=[],reservations=[];let calls=0,signal;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  calls++;signal=init.signal;
  return new Promise((resolve,reject)=>{
   // Keep the mock network request alive until the real abort signal fires.
   const watchdog=setTimeout(()=>reject(Error('mock request did not abort')),1000);
   signal.addEventListener('abort',()=>{clearTimeout(watchdog);reject(signal.reason);},{once:true});
  });
 });
 await assert.rejects(decide(s,'M',{apiKey:'unit_test_not_a_real_key',timeoutMs:10,onReserve:x=>reservations.push(x),onUsage:x=>usage.push(x)}),e=>e.code==='NETWORK');
 assert.equal(signal.aborted,true);assert.equal(signal.reason.name,'TimeoutError');assert.equal(calls,1);
 assert.equal(usage.length,1);assert.equal(reservations.length,1);assert.equal(usage[0].status,'unknown');assert.equal(usage[0].reserved,reservations[0]);assert.equal(usage[0].estimatedCost,reservations[0]);assert.deepEqual(s,before);
});

test('provider supports bounded thinking JSON without storing private reasoning',async t=>{
 let sent,usage;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{sent=JSON.parse(init.body);return response({choice:0});});
 const result=await requestJson([{role:'user',content:'JSON'}],{apiKey:'unit_test_not_a_real_key',thinking:'enabled',reasoningEffort:'low',maxTokens:4096,onUsage:x=>usage=x});
 assert.equal(sent.thinking.type,'enabled');assert.equal(sent.reasoning_effort,'low');assert.equal(sent.response_format.type,'json_object');assert.deepEqual(result,{choice:0});
 assert.ok(!JSON.stringify(usage).includes('PRIVATE_PROVIDER_REASONING'));
});

test('invalid model budget/options fail before any request or reservation',async t=>{
 let calls=0,reservations=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return response({choice:0});});
 for(const options of [{maxTokens:0},{maxTokens:16385},{thinking:'sometimes'},{reasoningEffort:'unbounded'},...[0,90001,1.5,NaN,'10',null].map(timeoutMs=>({timeoutMs}))])await assert.rejects(requestJson([],{...options,apiKey:'unit_test_not_a_real_key',onReserve:()=>reservations++}),e=>e.code==='MODEL_OPTIONS');
 assert.equal(calls,0);assert.equal(reservations,0);
});


test('author writing plans never enter either side’s decision inputs and remain available in the stored script',()=>{
 const s=heroState(),withoutDesign=structuredClone(s);
 s.script.privateDesign={premise:'PRIVATE_DESIGN_ONLY',threatPlan:'UNVERIFIED_PLAN_ONLY',counterplay:'UNVERIFIED_COUNTERPLAY_ONLY',cluePlan:'UNVERIFIED_CLUE_ONLY',loopPlan:'UNVERIFIED_LOOP_PLAN_ONLY'};
 const before=structuredClone(s);
 for(const seat of ['A','B','C','M']){
  const context=decisionContext(s,seat);
  assert.deepEqual(context.messages,decisionContext(withoutDesign,seat).messages);
  assert.ok(!JSON.stringify(context.messages).includes('directorNotes'));
  const first=JSON.parse(context.messages[1].content);
  if(seat==='M'){
   assert.deepEqual(first.secret.roles,s.script.roles);assert.equal(first.secret.mainPlot,s.script.mainPlot);
   assert.deepEqual(first.secret.subPlots,s.script.subPlots);assert.deepEqual(first.secret.incidents,s.script.incidents);
  }else assert.equal(first.secret,undefined);
 }
 assert.deepEqual(s,before);
});

test('changing hidden roles and culprits cannot change protagonist prompts or tactical references',()=>{
 const s=heroState(),other=structuredClone(s);
 other.script.mainPlot='sealed_item';other.script.subPlots=['unsettling_rumor'];
 for(const id of other.script.characters)other.script.roles[id]='person';
 for(const e of other.script.incidents)e.culprit='doctor';
 assert.deepEqual(decisionContext(s,'A').messages,decisionContext(other,'A').messages);
});

test('a human command migrates and clears structured protagonist memory before later model requests',()=>{
 const s=heroState();delete s.visibilityPolicy;
 s.aiMemory={A:saved(memory('LEGACY_STRUCTURED_SECRET')),M:saved(memory('MASTER_PRIVATE_MEMORY'))};s.heroDiscussion={participants:{B:{...saved(memory('LEGACY_TEAM_SECRET')),seat:'B'}}};
 const next=applyCommand(s,'A',legalActions(s,'A')[0].command);
 assert.equal(next.aiMemory.A,undefined);assert.ok(next.aiMemory.M);assert.equal(next.heroDiscussion,undefined);
 assert.ok(!JSON.stringify(decisionContext(next,turn(next)).messages).includes('LEGACY_'));
});

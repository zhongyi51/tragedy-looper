import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,starter,generateScript} from '../src/content.mjs';
import {createGame,applyCommand,turn,legalActions,sameCommand,view,publicRuleBeliefs} from '../src/engine.mjs';
import {AI_DECISION_VERSION,decisionContext,decisionProfile,rulesForDecision,decide} from '../src/ai.mjs';
import {rescueMovementFixture} from './fixtures/tactics.mjs';
import {strategyFixtures} from './fixtures/strategy-v2.mjs';

const response=answer=>new Response(JSON.stringify({model:'test-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}],usage:{prompt_tokens:100,completion_tokens:80}}));
const options={apiKey:'unit_test_not_a_real_key'};
function indexedPlan(s){
 const actions=legalActions(s,'M'),indexes=[];let current=s;
 for(let n=0;n<3;n++){
  const action=legalActions(current,'M')[0];
  indexes.push(actions.findIndex(candidate=>sameCommand(candidate.command,action.command)));
  current=applyCommand(current,'M',action.command);
 }
 return indexes;
}
function invalidPlan(s,duplicate){
 const actions=legalActions(s,'M'),first=actions[0].command;
 const second=actions.findIndex(({command:c})=>duplicate==='card'?c.card===first.card&&c.target!==first.target:c.card!==first.card&&c.target===first.target);
 assert.ok(second>0);
 return [0,second];
}

test('large protagonist rescue decisions enable bounded thinking in the actual request',async t=>{
 const {state:s,targetSeat:seat}=rescueMovementFixture(),actions=legalActions(s,seat),requests=[];
 assert.equal(s.phase,'hero_cards');assert.ok(actions.length>50);
 assert.equal(AI_DECISION_VERSION,'decision-6');
 assert.deepEqual(decisionProfile(s,actions,0),{thinking:'enabled',reasoningEffort:'low',maxTokens:8192});
 t.mock.method(globalThis,'fetch',async(_url,init)=>{requests.push(JSON.parse(init.body));return response({choice:0});});
 await decide(s,seat,options);
 assert.equal(requests.length,1);assert.deepEqual(requests[0].thinking,{type:'enabled'});
 assert.equal(requests[0].reasoning_effort,'low');assert.equal(requests[0].max_tokens,8192);
});

test('four-target MC therapy decisions reason through event and loop-end outcomes',async t=>{
 const fixtures=strategyFixtures().filter(f=>f.id==='mc-mastermind-therapy-low'||f.id==='mc-mastermind-therapy-high'),requests=[];
 let chosen;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{requests.push(JSON.parse(init.body));return response({choice:chosen,reason:'核对计数、事件与本方轮回末目标'});});
 for(const {state:s,id}of fixtures){
  const before=structuredClone(s),actions=legalActions(s,'M');assert.equal(actions.length,4);
  assert.deepEqual(decisionProfile(s,actions,0),{thinking:'enabled',reasoningEffort:'low',maxTokens:8192});
  const urgency=decisionContext(s,'M').payload.observation.urgency;
  assert.equal(urgency.timing.cardsRemainingToday,0);assert.equal(urgency.timing.fullCardDaysRemaining,0);
  assert.equal(urgency.incidents.today.type,'portent');
  chosen=actions.findIndex(a=>a.command.target===(id.endsWith('-low')?'police':'idol'));
  const answer=await decide(s,'M',options);
  assert.equal(answer.commands.length,1);assert.equal(answer.repairAttempts,0);assert.deepEqual(answer.repairCauses,[]);assert.equal(answer.memory,undefined);assert.deepEqual(s,before);
 }
 assert.equal(requests.length,2);assert.ok(requests.every(r=>r.thinking.type==='enabled'&&r.max_tokens===8192&&r.reasoning_effort==='low'));
 assert.match(requests[0].messages[0].content,/memory 非必填/);
});

test('an immediate final ability keeps fast mode when no cross-phase forecast is needed',async t=>{
 const {state:s}=strategyFixtures().find(f=>f.id==='fs-mastermind-kill-heroes'),requests=[];
 t.mock.method(globalThis,'fetch',async(_url,init)=>{requests.push(JSON.parse(init.body));return response({choice:0});});
 await decide(s,'M',options);
 assert.equal(requests.length,1);assert.equal(requests[0].thinking.type,'disabled');assert.equal(requests[0].max_tokens,1800);
});

test('a critical repair still reserves its cost before a second network call',async t=>{
 const {state:s,targetSeat:seat}=rescueMovementFixture(),before=structuredClone(s),usage=[];let calls=0,reservations=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:''}}],usage:{prompt_tokens:100,completion_tokens:8192}}));});
 await assert.rejects(decide(s,seat,{...options,onReserve:()=>{if(++reservations===2)throw Error('budget limit');},onUsage:u=>usage.push(u)}),/budget limit/);
 assert.equal(calls,1);assert.equal(reservations,2);assert.equal(usage.length,1);assert.equal(usage[0].thinking,'enabled');assert.ok(usage[0].estimatedCost>0);assert.deepEqual(s,before);
});

for(const duplicate of ['card','target'])test(`a mastermind batch with a duplicate ${duplicate} is rejected whole and repaired`,async t=>{
 const s=createGame(starter),before=structuredClone(s),bad=invalidPlan(s,duplicate),requests=[];
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  requests.push(JSON.parse(init.body));
  return response(requests.length===1?{choices:bad,reason:'不能执行的联合计划',memory:{hypotheses:[],goals:['REJECTED_PLAN_MEMORY'],questions:[]}}:{plan:0,reason:'修复后的完整计划'});
 });
 const answer=await decide(s,'M',options);
 assert.equal(requests.length,2);assert.equal(answer.repairAttempts,1);assert.equal(answer.commands.length,3);
 assert.equal(answer.memory,undefined);assert.equal(answer.repairMode,'compiled-plan');
 assert.equal(requests[1].thinking.type,'disabled');assert.equal(requests[1].max_tokens,1200);assert.deepEqual(answer.repairCauses,['INVALID_BATCH']);
 assert.deepEqual(answer.commands,JSON.parse(requests[1].messages.at(-1).content.split('\n').at(-1)).plans[0].commands);
 assert.ok(!JSON.stringify(requests[1]).includes('REJECTED_PLAN_MEMORY'));
 let simulated=s;for(const command of answer.commands){assert.ok(legalActions(simulated,'M').some(a=>sameCommand(a.command,command)));simulated=applyCommand(simulated,'M',command);}
 assert.equal(simulated.phase,'hero_cards');assert.deepEqual(s,before);
});

test('two individually indexed but jointly illegal batches return no partial decision',async t=>{
 const s=createGame(starter),before=structuredClone(s);let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return response({choices:invalidPlan(s,calls===1?'card':'target')});});
 await assert.rejects(decide(s,'M',options),error=>error.code==='ILLEGAL_MODEL_ACTION');
 assert.equal(calls,2);assert.deepEqual(s,before);assert.equal(s.placements.length,0);
});

test('a valid three-card mastermind plan remains intact without repair',async t=>{
 const s=createGame(starter),before=structuredClone(s),choices=indexedPlan(s);let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return response({choices});});
 const answer=await decide(s,'M',options);
 assert.equal(calls,1);assert.equal(answer.repairAttempts,0);assert.equal(answer.commands.length,3);
 assert.deepEqual(answer.command,answer.commands[0]);assert.deepEqual(s,before);
});

for(const cause of ['TRUNCATED','BAD_JSON'])test(`${cause} mastermind repair preserves full context and selects an intact compiled plan`,async t=>{
 const s=createGame(starter),requests=[];s.notes.A='PRIVATE_HERO_NOTE';s.notes.M='OLD_M_NOTE';const before=structuredClone(s);
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  requests.push(JSON.parse(init.body));
  if(requests.length===1)return new Response(JSON.stringify({choices:[{finish_reason:cause==='TRUNCATED'?'length':'stop',message:{content:'INVALID_PRIOR_TEXT'}}],usage:{prompt_tokens:100,completion_tokens:8192}}));
  return response({plan:1,reason:'选择第二个整组方案'});
 });
 const answer=await decide(s,'M',options),repair=requests[1],input=JSON.parse(repair.messages.at(-1).content.split('\n').at(-1)),identity=JSON.parse(repair.messages[1].content),context=JSON.parse(repair.messages[2].content);
 assert.equal(requests.length,2);assert.equal(answer.repairAttempts,1);assert.deepEqual(answer.repairCauses,[cause]);assert.equal(answer.repairMode,'compiled-plan');
 assert.equal(repair.thinking.type,'disabled');assert.equal(repair.max_tokens,1200);assert.equal(repair.reasoning_effort,undefined);
 assert.equal(repair.messages.length,4);assert.deepEqual(repair.messages.slice(0,3),requests[0].messages);assert.ok(repair.messages.every(m=>m.role!=='assistant'));
 assert.ok(input.plans.length>=2&&input.plans.length<=3);assert.deepEqual(identity.secret,view(s,'M').secret);assert.equal(context.observation.secret,undefined);
 assert.deepEqual(context.visibleHistory,decisionContext(s,'M').payload.visibleHistory);assert.equal(context.observation.actions.length,legalActions(s,'M').length);assert.equal(context.privateNote,'OLD_M_NOTE');
 for(const marker of ['INVALID_PRIOR_TEXT','PRIVATE_HERO_NOTE'])assert.ok(!JSON.stringify(repair).includes(marker));
 assert.deepEqual(answer.commands,input.plans[1].commands);assert.equal(answer.commands.length,3);assert.equal(answer.memory,undefined);
 let current=s;for(const command of answer.commands)current=applyCommand(current,'M',command);assert.equal(current.phase,'hero_cards');assert.deepEqual(s,before);
});

for(const invalid of [{plan:-1},{plan:99},{plan:'0'},{plan:0,choices:[0,1,2]},{plan:0,memory:{hypotheses:[],goals:[],questions:[]}}])test(`invalid compiled-plan answer ${JSON.stringify(invalid)} fails without a third call or partial move`,async t=>{
 const s=createGame(starter),before=structuredClone(s);let calls=0;
 t.mock.method(globalThis,'fetch',async()=>++calls===1?new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:''}}],usage:{prompt_tokens:100,completion_tokens:8192}})):response(invalid));
 await assert.rejects(decide(s,'M',options),error=>error.code==='ILLEGAL_MODEL_ACTION');
 assert.equal(calls,2);assert.deepEqual(s,before);assert.equal(s.placements.length,0);
});

test('compiled-plan selection is revalidated if the state changes during its request',async t=>{
 const s=createGame(starter);let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{
  if(++calls===1)return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:''}}],usage:{prompt_tokens:100,completion_tokens:8192}}));
  s.revision++;return response({plan:0});
 });
 await assert.rejects(decide(s,'M',options),error=>error.code==='STALE_MODEL_ACTION');
 assert.equal(calls,2);assert.equal(s.placements.length,0);
});

test('every primary and repair decision prompt satisfies the provider JSON-mode contract',async t=>{
 const hero=rescueMovementFixture();
 const cases=[{state:createGame(starter),seat:'M',first:'truncated',final:{plan:0}},{state:createGame(starter),seat:'M',first:'invalid',final:{choice:0}},{state:hero.state,seat:hero.targetSeat,first:'truncated',final:{choice:0}}];
 for(const c of cases){
  const requests=[];
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
   const body=JSON.parse(init.body);requests.push(body);
   assert.equal(body.response_format.type,'json_object');
   const prompt=body.messages.map(message=>message.content).join('\n');
   assert.match(prompt,/json/i,'DeepSeek JSON mode requires the word JSON in the prompt');
   assert.match(prompt,/\{"(?:choice|choices|plan)":/,'each response format includes a concrete JSON example');
   if(requests.length===1)return c.first==='truncated'?new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:''}}],usage:{prompt_tokens:100,completion_tokens:8192}})):response({choice:-1});
   return response(c.final);
  });
  const answer=await decide(c.state,c.seat,options);
  assert.equal(requests.length,2);assert.equal(answer.repairAttempts,1);
 }
});

for(const ruleset of ['FS','BTX','MZ','MC'])test(`${ruleset} compact rules preserve public character traits and every possible protagonist rule`,()=>{
 const s=createGame(generateScript({ruleset,seed:70311})),rules=rulesForDecision(s,'A');
 for(const character of rules.characters){
  const full=catalog.characters.find(x=>x.id===character.id);
  for(const key of ['start','tags','abilities','traits_zh','paranoiaLimit','forbiddenLocations'])assert.deepEqual(character[key],full[key],`${character.id}.${key}`);
 }
 for(const [section,fields] of [['roles',['maxCount','goodwillRefusal','effects_zh','castingConstraints']],['plots',['kind','addedRoles','effect_zh','castingConstraints']],['incidents',['effect_zh','defaultChooser','repeatCulprit','triggerCounter','allowsPublicType','paranoiaLimitModifier','extraGaugeIncrement']]]){
  const full=catalog[section].filter(x=>x.sets.includes(ruleset));
  assert.deepEqual(rules[section].map(x=>x.id),full.map(x=>x.id));
  for(const entry of rules[section])for(const key of fields)assert.deepEqual(entry[key],full.find(x=>x.id===entry.id)[key],`${entry.id}.${key}`);
 }
 const mastermind=rulesForDecision(s,'M');
 assert.deepEqual(mastermind.plots,rules.plots);
 assert.deepEqual(mastermind.roles,rules.roles);assert.deepEqual(mastermind.incidents,rules.incidents);
 assert.ok(!JSON.stringify(rules).includes('sourceRef'));assert.ok(!JSON.stringify(rules).includes('officialAssetNumber'));
});

test('the model receives script and mastermind secret only once without losing their meaning',()=>{
 const s=createGame(starter),{messages,payload}=decisionContext(s,'M');
 assert.equal(messages.length,3);
 const identity=JSON.parse(messages[1].content),dynamic=JSON.parse(messages[2].content);
 assert.equal(identity.seat,'M');assert.equal(identity.script,undefined);
 assert.deepEqual(identity.secret,view(s,'M').secret);assert.equal(dynamic.observation.secret,undefined);
 assert.deepEqual(dynamic.observation.script,view(s,'M').script);
 assert.deepEqual(payload.observation.secret,identity.secret);
});

test('mastermind references contain complete legal plans and explicitly bounded opponent samples',()=>{
 const s=createGame(starter),before=structuredClone(s),observation=decisionContext(s,'M').payload.observation;
 assert.ok(observation.strategyPlans.length>0&&observation.strategyPlans.length<=3);
 for(const plan of observation.strategyPlans){
  assert.equal(plan.kind,'bounded_simulation');assert.equal(plan.guaranteed,false);assert.equal(plan.choices.length,3);
  let current=s;
  for(const choice of plan.choices){const command=observation.actions[choice].command;assert.ok(legalActions(current,'M').some(a=>sameCommand(a.command,command)));current=applyCommand(current,'M',command);}
  assert.equal(current.phase,'hero_cards');assert.equal(plan.observedOutcomes.length,2);
  assert.ok(plan.budget.commandsApplied<=plan.budget.maxCommands);assert.equal(plan.budget.maxCommands,384);
 }
 assert.deepEqual(s,before);
});

test('protagonist rule references expose public constraints rather than selected secret plots',()=>{
 const {state:s,targetSeat:seat}=rescueMovementFixture(),v=view(s,seat),expected=publicRuleBeliefs(v),actual=decisionContext(s,seat).payload.observation;
 assert.equal(actual.ruleBeliefs.candidateCount,expected.candidates.length);
 assert.deepEqual(actual.ruleBeliefs.possible,expected.possible);assert.deepEqual(actual.ruleBeliefs.certain,expected.certain);
 assert.equal(actual.strategyPlans,undefined);assert.equal(actual.secret,undefined);
 if(expected.candidates.length<=12)assert.deepEqual(actual.ruleBeliefs.candidates,expected.candidates);
 else assert.equal(actual.ruleBeliefs.candidates,undefined);
 const serial=actual.evidence.roles.find(x=>x.character==='office_worker');
 assert.equal(serial.role,'serial_killer');assert.equal(serial.status,'revealed_role_may_be_transformed');
 assert.equal(actual.urgency.incidents.today,null);assert.deepEqual(actual.urgency.incidents.remaining,[]);
 assert.ok(actual.urgency.immediateThreats.some(x=>x.actor==='office_worker'&&x.target==='idol'&&x.conditional));
});

test('protagonist context remains identical under a different hidden truth and marks old plans as untrusted',()=>{
 const {state:s,targetSeat:seat}=rescueMovementFixture(),other=structuredClone(s);
 s.notes[seat]='旧假说：学校一定安全';other.notes[seat]=s.notes[seat];
 other.script.mainPlot='sealed_item';other.script.subPlots=['unsettling_rumor'];
 for(const id of other.script.characters)other.script.roles[id]='person';
 for(const event of other.script.incidents)event.culprit='doctor';
 assert.deepEqual(decisionContext(s,seat).messages,decisionContext(other,seat).messages);
 assert.match(decisionContext(s,seat).messages[0].content,/旧计划都不是规则事实/);
 assert.match(decisionContext(s,seat).messages[0].content,/标题与简介只是氛围文案/);
});

test('a legally revealed virus transformation is not promoted to an original-role fact after counters reset',()=>{
 let s=createGame({...structuredClone(starter),ruleset:'BTX',days:2,loops:2,mainPlot:'sealed_item',subPlots:['paranoia_virus','threads_fate'],incidents:[],roles:{boy_student:'brain',girl_student:'cultist',shrine_maiden:'person',office_worker:'person',idol:'misleader',doctor:'person'}});
 const send=command=>{s=applyCommand(s,turn(s),command);};
 const place=(card,target)=>send({type:'place',card:card+'#0',target});
 for(const [card,target]of [['move_v','doctor'],['paranoia_1','office_worker'],['intrigue_2','shrine'],['goodwill_2','office_worker'],['goodwill_2','doctor'],['goodwill_1','idol']])place(card,target);
 send({type:'cultist',mask:0});send({type:'mm',actor:'idol',ability:'misleader',target:'office_worker'});
 send({type:'pass'});send({type:'pass'});send({type:'end_area',territory:false});send({type:'pass'});
 for(const [card,target]of [['paranoia_1','office_worker'],['move_h','hospital'],['move_v','school'],['goodwill_1','office_worker'],['goodwill_1','shrine'],['goodwill_1','school']])place(card,target);
 send({type:'cultist',mask:0});send({type:'pass'});send({type:'goodwill',actor:'office_worker',index:0,target:'office_worker'});send({type:'refusal',refuse:false});
 assert.equal(s.board.office_worker.paranoia,3);assert.equal(s.knownRoles.office_worker,'serial_killer');
 send({type:'goodwill',actor:'doctor',index:0,target:'office_worker',amount:-1});send({type:'refusal',refuse:false});
 assert.equal(s.board.office_worker.paranoia,2);assert.equal(s.knownRoles.office_worker,'serial_killer');
 send({type:'pass'});send({type:'end_area',territory:false});send({type:'pass'});send({type:'final_battle'});
 assert.equal(s.board.office_worker.paranoia,0);
 const context=decisionContext(s,turn(s));
 assert.equal(context.payload.observation.evidence.roles.find(x=>x.character==='office_worker').status,'revealed_role_may_be_transformed');
 send({type:'guess',character:'office_worker',role:'person'});
 assert.equal(s.guessed.office_worker,'person');assert.notEqual(s.winner,'mastermind');
 assert.equal(decisionContext(s,turn(s)).payload.observation.evidence.correctGuesses.office_worker,'person');
});

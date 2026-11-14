import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,applyCommand,turn,legalActions,view,botCommand,botPlan,tacticalOptions,strategicBriefing,publicRuleBeliefs,publicUrgency,strategyPlans,STRATEGY_PLAN_LIMITS,sameCommand} from '../src/engine.mjs';
import {starter,generateScript} from '../src/content.mjs';
import {strategyFixtures,evaluateStrategy,quietCommand} from './fixtures/strategy-v2.mjs';

function lowExSilver(){
 const script={id:'public-tightrope-regression',title:'銀の糸',author:'回归测试',ruleset:'MC',days:4,loops:3,communication:'between_loops_only',characters:['office_worker','doctor','informer','ai_character'],mainPlot:'tightrope_plan',subPlots:['absolute_will','smell_gunpowder'],roles:{office_worker:'killer',doctor:'brain',informer:'obstinate',ai_character:'serial_killer'},incidents:[{day:4,type:'silver_bullet',culprit:'informer'}],settings:{incidentVisibility:'public'},specialRules:[]};
 let state=createGame(script);const history=[];
 const send=command=>{const seat=turn(state);history.push({seat,command});state=applyCommand(state,seat,command);};
 const quiet=()=>send(quietCommand(state));
 for(let day=1;day<=2;day++){
  for(const [card,target]of [['move_h','hospital'],['move_v','shrine'],['forbid_goodwill','school']])send({type:'place',card:card+'#0',target});
  send({type:'place',card:day===1?'goodwill_2#0':'goodwill_1#0',target:'office_worker'});
  send({type:'place',card:day===1?'goodwill_2#0':'goodwill_1#0',target:'ai_character'});
  quiet();while(state.phase!=='hero_ability')quiet();
  if(day===1)while(state.day===day)quiet();
 }
 send(legalActions(state).find(a=>a.command.actor==='office_worker').command);quiet();
 assert.equal(state.phase,'hero_ability');assert.equal(state.knownRoles.office_worker,'killer');
 return {script,history,state};
}

test('a legally revealed Killer plus four-person MC casting identifies tightrope without revealing Y',()=>{
 const f=lowExSilver();let replay=createGame(f.script);for(const {seat,command}of f.history)replay=applyCommand(replay,seat,command);assert.deepEqual(replay,f.state);
 assert.deepEqual(f.state.knownPlots,[]);
 const beliefs=publicRuleBeliefs(view(f.state,turn(f.state)));
 assert.deepEqual(beliefs.possible.filter(id=>['murder_plan','tightrope_plan','strychnine','quilt_incidents','black_school'].includes(id)),['tightrope_plan']);
 assert.ok(beliefs.certain.includes('tightrope_plan'));assert.equal(beliefs.contradiction,false);
});

test('inferred low-EX failure prevents the A.I. from ending a winnable loop prematurely',()=>{
 const {state}=lowExSilver(),options=legalActions(state),silver=options.find(a=>a.command.actor==='ai_character'&&a.command.day===4);
 assert.ok(silver);assert.equal(state.extraGauge,0);
 assert.notEqual(botCommand(state).actor,'ai_character');
 let bad=applyCommand(state,turn(state),silver.command);for(let n=0;n<10&&!['between','over','guess'].includes(bad.phase);n++)bad=applyCommand(bad,turn(bad),quietCommand(bad));
 assert.equal(bad.phase,'between');
});

test('public rule beliefs update by contradiction and never inspect changed hidden truth',()=>{
 const {state}=lowExSilver(),observation=view(state,turn(state)),before=structuredClone(observation);delete before.knownRoles.office_worker;
 assert.ok(publicRuleBeliefs(before).possible.includes('black_school'));
 assert.equal(publicRuleBeliefs(observation).possible.includes('black_school'),false);
 const other=structuredClone(state);other.script.mainPlot='black_school';other.script.subPlots=['dance_fools','hidden_freak'];for(const c of other.script.characters)other.script.roles[c]='person';other.script.incidents[0].culprit='doctor';
 assert.deepEqual(view(other,turn(other)),observation);
 assert.deepEqual(publicRuleBeliefs(view(other,turn(other))),publicRuleBeliefs(observation));
 assert.deepEqual(botCommand(other),botCommand(state));assert.deepEqual(tacticalOptions(other),tacticalOptions(state));
});

test('legal generated casts are not excluded by public role and culprit constraints',()=>{
 for(const ruleset of ['FS','BTX','MZ','MC'])for(let seed=1;seed<=12;seed++){
  const s=createGame(generateScript({ruleset,seed})),v=view(s,'A');
  // An isolated inference test supplies correct answers, as final battle does.
  v.guessed={...s.script.roles};v.knownCulprits=Object.fromEntries(s.script.incidents.map(e=>[e.day,e.culprit]));
  const candidates=publicRuleBeliefs(v).candidates;
  assert.ok(candidates.some(c=>c.y===s.script.mainPlot&&s.script.subPlots.every(id=>c.xs.includes(id))),`${ruleset} ${seed}`);
 }
});

test('MZ declarations remain uncertain; an impossible original casting never becomes a certainty',()=>{
 const v=view(createGame(generateScript({ruleset:'MZ',seed:7})),'A'),before=publicRuleBeliefs(v);v.knownRoles[v.script.characters[0]]='killer';
 assert.deepEqual(publicRuleBeliefs(v),before);
 const mc=view(createGame(generateScript({ruleset:'MC',seed:7})),'A');mc.guessed=Object.fromEntries(mc.script.characters.map(id=>[id,'killer']));
 const invalid=publicRuleBeliefs(mc);assert.equal(invalid.contradiction,true);assert.deepEqual(invalid.certain,[]);
});

test('non-leader emergency blocking answers a lethal hospital event using public evidence',()=>{
 let s=createGame({...structuredClone(starter),incidents:[{day:1,type:'hospital_incident',culprit:'office_worker'}]});
 for(const [card,target]of [['intrigue_2#0','hospital'],['paranoia_1#0','office_worker'],['move_h#0','shrine']])s=applyCommand(s,'M',{type:'place',card,target});
 s=applyCommand(s,'A',{type:'place',card:'paranoia_1#0',target:'office_worker'});
 assert.equal(turn(s),'B');assert.equal(view(s,'B').placements.find(p=>p.seat==='A').card,undefined);
 const command=botCommand(s);assert.deepEqual(command,{type:'place',card:'forbid_intrigue#0',target:'hospital'});
 const finish=initial=>{let end=initial;for(let n=0;n<30&&end.day===1&&!['between','over'].includes(end.phase);n++)end=applyCommand(end,turn(end),quietCommand(end));return end;};
 assert.equal(finish(applyCommand(s,'B',command)).day,2);
 assert.equal(finish(applyCommand(s,'B',{type:'place',card:'goodwill_1#0',target:'school'})).phase,'between');
 assert.match(tacticalOptions(s)[0].summary,/队友暗牌未知/);
});

test('another teammate covering a public urgent target preserves the single-Forbid convention',()=>{
 let s=createGame({...structuredClone(starter),incidents:[{day:1,type:'hospital_incident',culprit:'idol'}]});
 for(const [card,target]of [['intrigue_2#0','hospital'],['intrigue_1#0','office_worker'],['move_h#0','shrine']])s=applyCommand(s,'M',{type:'place',card,target});
 s=applyCommand(s,'A',{type:'place',card:'forbid_intrigue#0',target:'hospital'});
 // Public-projection unit test: a known Killer with two Intrigue is a second
 // urgent target. We do not claim this injected evidence is a legal history.
 s.knownRoles.office_worker='killer';s.board.office_worker.intrigue=2;
 assert.notEqual(botCommand(s).card,'forbid_intrigue#0');
 const other=structuredClone(s);other.placements.find(p=>p.seat==='A').card='goodwill_1#0';assert.deepEqual(botCommand(s),botCommand(other));
});

test('mastermind plans keep the full legal trio and report bounded sampled defenses',()=>{
 const f=strategyFixtures().find(f=>f.criterion==='resilient_cards'),before=structuredClone(f.state),plans=strategyPlans(f.state,'M',99);
 assert.equal(plans.length,3);assert.deepEqual(botPlan(f.state,'M',3),plans[0].commands);
 const applied=plans.reduce((sum,p)=>sum+p.observedOutcomes.reduce((n,o)=>n+o.commandsApplied,0),0);
 for(const p of plans){
  assert.equal(p.commands.length,3);assert.equal(new Set(p.commands.map(c=>c.card)).size,3);assert.equal(new Set(p.commands.map(c=>c.target)).size,3);
  let current=f.state;for(const c of p.commands){assert.ok(legalActions(current).some(o=>sameCommand(c,o.command)));current=applyCommand(current,'M',c);}assert.equal(current.phase,'hero_cards');
  assert.deepEqual(p.observedOutcomes.map(o=>o.defense),['balanced','block_intrigue']);
  assert.ok(p.observedOutcomes.every(o=>o.commandsApplied<=STRATEGY_PLAN_LIMITS.commandsPerResponse));assert.equal(p.budget.commandsApplied,applied);assert.ok(applied<=STRATEGY_PLAN_LIMITS.maxCommands);
 }
 let current=f.state;const sequential=[];for(let n=0;n<3;n++){const command=botCommand(current);sequential.push(command);current=applyCommand(current,'M',command);}
 assert.deepEqual(sequential,plans[0].commands);assert.deepEqual(f.state,before);assert.equal(evaluateStrategy(f,sequential).passed,true);
 assert.deepEqual(strategyPlans(current,turn(current)),[]);
});

test('tactical references include different action effects instead of three equivalent targets',()=>{
 const f=strategyFixtures().find(f=>f.id==='btx-rescue-movement'),refs=tacticalOptions(f.state,turn(f.state),3),categories=refs.map(r=>r.command.card?.startsWith('move_')?'movement':r.command.card?.split('#')[0].replace(/_[12]$/,''));
 assert.equal(new Set(categories).size,3);assert.equal(categories[0],'movement');
});

test('BTX briefing distinguishes a historical reveal from a current or original role',()=>{
 const f=strategyFixtures().find(f=>f.id==='btx-rescue-movement'),briefing=strategicBriefing(f.state,turn(f.state)).join('\n');
 assert.equal(f.state.knownRoles.office_worker,'serial_killer');
 assert.match(briefing,/曾公开角色（妄想扩大病毒可能暂时改变普通人，须区分当前角色与原始配役）：/);
 assert.doesNotMatch(briefing,/已确认角色：/);
});

test('planning caches distinguish public leaders and their different once-per-loop hands',()=>{
 const original=createGame(generateScript({ruleset:'FS',seed:1}));original.usedCards.A=['goodwill_2#0','paranoia_minus_1#0'];
 strategyPlans(original,'M');
 // Cache regression uses isolated observations: only the public leader changes.
 // A fresh script identifier bypasses the memo without changing any mechanics.
 const changed=structuredClone(original);changed.leader=1;const fresh=structuredClone(changed);fresh.script.id+='-fresh-cache';
 assert.deepEqual(strategyPlans(changed,'M'),strategyPlans(fresh,'M'));
});

test('therapist briefing states exact arithmetic and opposite EX consequences',()=>{
 const fixtures=strategyFixtures(),high=fixtures.find(f=>f.id==='mc-mastermind-therapy-high'),low=fixtures.find(f=>f.id==='mc-mastermind-therapy-low');
 const highLine=strategicBriefing(high.state,'M').find(s=>s.startsWith('治疗师候选 警察'));
 assert.match(highLine,/不安 2→1/);assert.match(highLine,/不会发生/);assert.match(highLine,/EX 2→2/);assert.match(highLine,/败北条件不成立/);
 const lowLine=strategicBriefing(low.state,'M').find(s=>s.startsWith('治疗师候选 警察'));assert.match(lowLine,/EX 1→1/);assert.match(lowLine,/败北条件成立/);
 assert.match(lowLine,/主人公败北条件成立（对剧作家有利）/);
});

test('remaining cards follow each seat through legal placements and stay zero after final-day abilities',()=>{
 const f=strategyFixtures().find(f=>f.id==='mc-mastermind-therapy-high');let s=createGame(f.script),sawHeroTurnAfterMastermind=false;
 for(const {seat,command}of f.commands){
  if(['mm_cards','hero_cards'].includes(s.phase)){
   const timing=publicUrgency(view(s,seat)).timing;
   assert.ok(legalActions(s,seat).some(o=>o.command.type==='place'));assert.ok(timing.cardsRemainingToday>0);
   if(s.phase==='hero_cards'){sawHeroTurnAfterMastermind=true;assert.equal(publicUrgency(view(s,'M')).timing.cardsRemainingToday,0);assert.equal(legalActions(s,'M').length,0);}
  }
  s=applyCommand(s,seat,command);
 }
 assert.ok(sawHeroTurnAfterMastermind);assert.equal(s.day,s.script.days);assert.equal(s.phase,'mm_ability');
 for(const seat of ['M','A','B','C'])assert.deepEqual(publicUrgency(view(s,seat)).timing,{cardsRemainingToday:0,fullCardDaysRemaining:0,todayCardStageOpen:false});
 assert.match(strategicBriefing(s,'M')[0],/今日出牌已结束，之后没有新的出牌机会/);
 s=applyCommand(s,'M',legalActions(s).find(o=>o.command.target==='police').command);
 for(let n=0;n<30&&!['over','between','guess'].includes(s.phase);n++){
  assert.ok(legalActions(s).every(o=>o.command.type!=='place'));
  s=applyCommand(s,turn(s),quietCommand(s));
 }
 assert.equal(s.winner,'heroes');
});

test('an untriggered incident is no longer pending once its phase has passed',()=>{
 let s=strategyFixtures().find(f=>f.id==='mc-mastermind-therapy-high').state;
 assert.equal(publicUrgency(view(s,'M')).incidents.remaining.length,1);
 s=applyCommand(s,'M',legalActions(s).find(o=>o.command.target==='police').command);
 for(let n=0;n<25&&!['end_area','end_forced','end'].includes(s.phase);n++)s=applyCommand(s,turn(s),quietCommand(s));
 assert.ok(['end_area','end_forced','end'].includes(s.phase));assert.ok(!s.occurred.includes(s.day));
 const urgency=publicUrgency(view(s,turn(s)));assert.deepEqual(urgency.incidents.remaining,[]);assert.equal(urgency.incidents.today.pending,false);
 while(!['over','between','guess'].includes(s.phase))s=applyCommand(s,turn(s),quietCommand(s));
 const closed=publicUrgency(view(s,'A'));assert.equal(closed.timing.fullCardDaysRemaining,0);assert.deepEqual(closed.incidents.remaining,[]);
});

test('public rescue urgency separates a conditional day-end death from an exhausted event schedule',()=>{
 const f=strategyFixtures().find(f=>f.id==='btx-rescue-movement'),v=view(f.state,turn(f.state)),u=publicUrgency(v);
 assert.equal(u.incidents.today,null);assert.deepEqual(u.incidents.remaining,[]);
 assert.equal(u.immediateThreats.length,1);const threat=u.immediateThreats[0];
 assert.deepEqual([threat.actor,threat.target,threat.location,threat.deadline,threat.conditional],['office_worker','idol','city','day_end',true]);
 assert.equal(threat.roleEvidence,'revealed_role_may_have_changed');assert.doesNotMatch(JSON.stringify(u),/key_person/);
 const other=structuredClone(f.state);other.script.roles.idol='person';other.script.roles.office_worker='person';assert.deepEqual(publicUrgency(view(other,turn(other))),u);
 const refs=tacticalOptions(f.state,turn(f.state),5),cleanup=refs.find(r=>r.command.card==='paranoia_minus_1#0');assert.ok(cleanup.score<=1.01);
 assert.equal(refs[0].command.target,'idol');assert.equal(evaluateStrategy(f,[botCommand(f.state)]).passed,true);
 const guarded=structuredClone(v);guarded.board.idol.guard=1;assert.deepEqual(publicUrgency(guarded).immediateThreats,[]);
});

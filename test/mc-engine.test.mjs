import test from 'node:test';
import assert from 'node:assert/strict';
import {starter,generateScript,name} from '../src/content.mjs';
import {createGame,applyCommand,legalActions,turn,view,advanceAutomatic} from '../src/engine.mjs';

// Controlled boards exercise expansion behavior independently of script generation.
const fresh=()=>{
 const s=createGame(starter);s.script.ruleset='MC';s.script.mainPlot='murder_plan';s.script.subPlots=[];
 for(const id of s.script.characters)s.script.roles[id]='person';
 s.script.incidents=[];s.script.days=5;s.script.loops=3;s.script.settings.incidentVisibility='public';s.extraGauge=0;
 return s;
};
const act=(s,command)=>applyCommand(s,turn(s),command);
const choose=(s,predicate)=>{
 const choice=legalActions(s).find(o=>predicate(o.command,o));
 assert.ok(choice,`Expected legal choice in ${s.phase}: ${JSON.stringify(legalActions(s).map(o=>o.command))}`);
 return act(s,choice.command);
};
const add=(s,id,role,location='city')=>{
 if(!s.script.characters.includes(id))s.script.characters.push(id);s.script.roles[id]=role;
 s.board[id]={id,initial:location,location,present:true,alive:true,goodwill:0,paranoia:0,intrigue:0,guard:0};return s;
};
const incident=(s,type,culprit='boy_student')=>{
 s.phase='hero_ability';s.script.incidents=[{day:s.day,type,culprit}];
 return act(s,{type:'pass'});
};
const finish=s=>{s.phase='end';s.day=s.script.days;return act(s,{type:'pass'});};
const nextLoop=s=>{s.phase='between';return act(s,{type:'next_loop'});};
const simulate=(s,type,predicate=()=>true)=>{
 add(s,'ai_character','brain','city');s.board.ai_character.goodwill=3;s.phase='hero_ability';s.script.incidents=[{day:3,type,culprit:'boy_student'}];
 s=choose(s,(a,o)=>a.type==='goodwill'&&a.actor==='ai_character'&&predicate(a,o));
 return act(s,{type:'refusal',refuse:false});
};

test('MC a scheduled incident increases the public Extra gauge exactly once',()=>{
 const s=fresh();s.board.boy_student.paranoia=2;
 let result=incident(s,'serial_murder');assert.equal(result.extraGauge,1);assert.deepEqual(result.occurred,[1]);
 result=choose(result,a=>a.target==='girl_student');assert.equal(result.extraGauge,1);assert.equal(result.board.girl_student.alive,false);
 assert.equal(view(result,'A').extraGauge,1);assert.equal(view(result,'public').extraGauge,1);
});

test('MC a prevented incident does not increase the Extra gauge',()=>{
 const s=fresh();s.board.boy_student.paranoia=1;
 const result=incident(s,'serial_murder');assert.equal(result.extraGauge,0);assert.deepEqual(result.occurred,[]);
});

test('MC black cat incidents count even though their effects are nullified',()=>{
 const s=fresh();add(s,'black_cat','person','shrine');
 const result=incident(s,'terrorism','black_cat');assert.equal(result.extraGauge,1);assert.deepEqual(result.occurred,[1]);
 assert.equal(result.board.office_worker.alive,true);
});

test('MC Extra gauge resets between loops and at the final battle',()=>{
 let s=fresh();s.extraGauge=4;s=nextLoop(s);assert.equal(s.extraGauge,0);
 s.extraGauge=4;s.phase='between';s=act(s,{type:'final_battle'});assert.equal(s.extraGauge,0);
});

test('MC Portent has a threshold one below the culprit printed paranoia limit',()=>{
 for(const [paranoia,happens] of [[0,false],[1,true]]){
  const s=fresh();s.board.boy_student.paranoia=paranoia;const result=incident(s,'portent');
  assert.equal(result.occurred.length===1,happens);
 }
});

test('MC Portent adds paranoia only to a character in the culprit location',()=>{
 let s=fresh();s.board.boy_student.paranoia=1;s=incident(s,'portent');
 const targets=legalActions(s).map(o=>o.command.target);assert.ok(targets.includes('boy_student'));assert.ok(targets.includes('girl_student'));assert.ok(!targets.includes('doctor'));
 s=choose(s,a=>a.target==='girl_student');assert.equal(s.board.girl_student.paranoia,1);
});

test('MC Bestial Murder requires one more paranoia than the printed limit',()=>{
 for(const [paranoia,happens] of [[2,false],[3,true]]){
  const s=fresh();s.board.boy_student.paranoia=paranoia;const result=incident(s,'bestial_murder');
  assert.equal(result.occurred.length===1,happens);
 }
});

test('MC Terrorism kills City occupants at one intrigue and protagonists at two',()=>{
 const s=fresh();s.board.boy_student.paranoia=2;s.locations.city=1;
 const result=incident(s,'terrorism');assert.equal(result.board.office_worker.alive,false);assert.equal(result.board.idol.alive,false);assert.equal(result.board.doctor.alive,true);assert.notEqual(result.phase,'between');
 const t=fresh();t.board.boy_student.paranoia=2;t.locations.city=2;
 assert.equal(incident(t,'terrorism').phase,'between');
});

test('MC Twin resolves a local murder from the diagonal location without moving',()=>{
 let s=fresh();s.script.roles.boy_student='twin';s.board.boy_student.paranoia=2;
 s=incident(s,'serial_murder');assert.equal(s.board.boy_student.location,'school');
 const targets=legalActions(s).map(o=>o.command.target);assert.ok(targets.includes('doctor'));assert.ok(!targets.includes('girl_student'));
 s=choose(s,a=>a.target==='doctor');assert.equal(s.board.doctor.alive,false);assert.equal(s.board.boy_student.location,'school');
});

test('MC Private Investigator is immortal and does not consume a guard counter',()=>{
 let s=fresh();s.script.roles.girl_student='private_investigator';s.board.girl_student.guard=1;s.board.boy_student.paranoia=2;
 s=incident(s,'serial_murder');s=choose(s,a=>a.target==='girl_student');
 assert.equal(s.board.girl_student.alive,true);assert.equal(s.board.girl_student.guard,1);
});

test('MC Private Investigator forces same-location incidents only while Extra gauge is zero',()=>{
 for(const [gauge,happens] of [[0,true],[1,false]]){
  const s=fresh();s.script.roles.girl_student='private_investigator';s.extraGauge=gauge;
  const result=incident(s,'serial_murder');assert.equal(result.occurred.length===1,happens);
 }
});

test('MC Private Investigator cannot force a dead or absent culprit incident',()=>{
 for(const flag of ['alive','present']){
  const s=fresh();s.script.roles.girl_student='private_investigator';s.board.boy_student[flag]=false;
  const result=incident(s,'serial_murder');assert.deepEqual(result.occurred,[]);assert.equal(result.extraGauge,0);
 }
});

test('MC Obstinate bypasses paranoia modifiers but not suppression',()=>{
 const s=fresh();s.script.roles.boy_student='obstinate';
 assert.deepEqual(incident(structuredClone(s),'bestial_murder').occurred,[1]);
 s.suppressed.push('boy_student');assert.deepEqual(incident(s,'bestial_murder').occurred,[]);
});

test('MC Paranoiac can add paranoia or intrigue to itself once each day',()=>{
 let s=fresh();s.script.roles.boy_student='paranoiac';s.phase='mm_ability';
 const actions=legalActions(s).filter(o=>o.command.actor==='boy_student');assert.equal(actions.length,2);assert.ok(actions.every(o=>o.command.target==='boy_student'));
 s=act(s,actions[0].command);assert.equal(s.board.boy_student.paranoia+s.board.boy_student.intrigue,1);
 assert.ok(!legalActions(s).some(o=>o.command.actor==='boy_student'));
 s.day++;assert.equal(legalActions(s).filter(o=>o.command.actor==='boy_student').length,2);
});

test('MC A.I. simulation does not count as a scheduled incident',()=>{
 const s=fresh();const result=simulate(s,'unease',a=>a.effectTarget==='boy_student'&&a.effectTo==='girl_student');
 assert.deepEqual(result.occurred,[]);assert.equal(result.extraGauge,0);assert.equal(result.phase,'hero_ability');assert.equal(result.board.boy_student.paranoia,2);
});

test('MC Tightrope Plan loses at zero or one Extra and survives at two',()=>{
 for(const [gauge,loss] of [[0,true],[1,true],[2,false]]){
  const s=fresh();s.script.mainPlot='tightrope_plan';s.extraGauge=gauge;
  const result=finish(s);assert.equal(result.phase==='between',loss);if(!loss)assert.equal(result.winner,'heroes');
 }
});

test('MC A Quilt of Incidents loses at three Extra but not two',()=>{
 for(const [gauge,loss] of [[2,false],[3,true]]){
  const s=fresh();s.script.mainPlot='quilt_incidents';s.extraGauge=gauge;
  const result=finish(s);assert.equal(result.phase==='between',loss);
 }
});

test('MC Black School follows the original threshold of current loop minus one',()=>{
 for(const [loop,intrigue,loss] of [[1,0,true],[2,0,false],[2,1,true],[3,1,false],[3,2,true]]){
  const s=fresh();s.script.mainPlot='black_school';s.loop=loop;s.script.loops=4;s.locations.school=intrigue;
  assert.equal(finish(s).phase==='between',loss);
 }
});

test('MC Smell of Gunpowder counts paranoia only on living present characters',()=>{
 const s=fresh();s.script.subPlots=['smell_gunpowder'];s.board.boy_student.paranoia=11;s.board.doctor.paranoia=99;s.board.doctor.alive=false;
 assert.equal(finish(structuredClone(s)).winner,'heroes');
 s.board.girl_student.paranoia=1;assert.equal(finish(s).phase,'between');
});

test('MC Strychnine adds intrigue to Serial Murder and Suicide trigger checks only',()=>{
 for(const type of ['serial_murder','suicide','portent','unease']){
  const s=fresh();s.script.mainPlot='strychnine';s.board.boy_student.intrigue=2;s.board.boy_student.paranoia=0;
  const result=incident(s,type);assert.equal(result.occurred.length===1,['serial_murder','suicide'].includes(type));
 }
});

test('MC Isolated Institution Psycho carries at most one Extra into the next loop',()=>{
 for(const [previous,expected] of [[0,1],[1,1],[2,1],[3,0],[5,0]]){
  const s=fresh();s.script.subPlots=['isolated_psycho'];s.extraGauge=previous;
  assert.equal(nextLoop(s).extraGauge,expected);
 }
});

test('MC Therapist must act before optional mastermind abilities when Extra is positive',()=>{
 const s=fresh();s.extraGauge=1;s.phase='mm_ability';s.script.roles.boy_student='therapist';s.script.roles.doctor='brain';s.board.girl_student.paranoia=2;
 const actions=legalActions(s).map(o=>o.command);assert.ok(actions.length>0);assert.ok(actions.every(a=>a.type==='mm'&&a.ability==='therapist'));
 assert.ok(actions.some(a=>a.target==='girl_student'));assert.ok(!actions.some(a=>a.target==='boy_student'));
 const result=choose(s,a=>a.target==='girl_student');assert.equal(result.board.girl_student.paranoia,1);
 assert.ok(legalActions(result).some(o=>o.command.type==='pass'));assert.ok(!legalActions(result).some(o=>o.command.ability==='therapist'));
});

test('MC Therapist cannot reduce itself and is inactive at zero Extra or without another character',()=>{
 const s=fresh();s.script.roles.boy_student='therapist';s.phase='mm_ability';s.board.boy_student.paranoia=2;
 assert.ok(legalActions(s).some(o=>o.command.type==='pass'));assert.ok(!legalActions(s).some(o=>o.command.ability==='therapist'));
 s.extraGauge=1;s.board.girl_student.location='city';
 assert.ok(!legalActions(s).some(o=>o.command.ability==='therapist'));assert.ok(legalActions(s).some(o=>o.command.type==='pass'));
});

test('MC Therapist may choose another character with zero paranoia',()=>{
 let s=fresh();s.script.roles.boy_student='therapist';s.phase='mm_ability';s.extraGauge=1;
 s=choose(s,a=>a.ability==='therapist'&&a.target==='girl_student');assert.equal(s.board.girl_student.paranoia,0);
 assert.ok(legalActions(s).some(o=>o.command.type==='pass'));
});

test('MC faked suicide places EX and forbids every protagonist action on EX characters',()=>{
 let s=fresh();s.board.boy_student.paranoia=2;s=incident(s,'faked_suicide');assert.equal(s.board.boy_student.extra,true);
 s.phase='hero_cards';assert.ok(!legalActions(s).some(o=>o.command.target==='boy_student'));assert.ok(legalActions(s).some(o=>o.command.target==='school'));
 s.phase='mm_cards';assert.ok(legalActions(s).some(o=>o.command.target==='boy_student'));
});

test('MC faked suicide restrictions and EX cards reset on the next loop',()=>{
 let s=fresh();s.board.boy_student.paranoia=2;s=incident(s,'faked_suicide');s=nextLoop(s);
 assert.ok(!s.board.boy_student.extra);s.phase='hero_cards';assert.ok(legalActions(s).some(o=>o.command.target==='boy_student'));
});

test('MC Silver Bullet ends the loop early without increasing Extra or running day-end killing',()=>{
 let s=fresh();s.board.boy_student.paranoia=2;s.extraGauge=2;s.script.roles.boy_student='serial_killer';
 s=incident(s,'silver_bullet');assert.equal(s.winner,'heroes');assert.equal(s.day,1);assert.equal(s.extraGauge,2);assert.equal(s.board.girl_student.alive,true);
});

test('MC Silver Bullet still checks loop-loss conditions',()=>{
 const s=fresh();s.script.mainPlot='tightrope_plan';s.board.boy_student.paranoia=2;s.extraGauge=1;
 const result=incident(s,'silver_bullet');assert.equal(result.phase,'between');assert.equal(result.extraGauge,1);assert.equal(result.winner,null);
});

const movementCards=(s,target,card='move_v#0')=>{
 s.phase='mm_cards';s.placements=[];
 for(const command of [
  {type:'place',card:'move_h#0',target:'hospital'},
  {type:'place',card:'move_v#0',target:'shrine'},
  {type:'place',card:'paranoia_1#0',target:'city'},
  {type:'place',card:'goodwill_1#0',target:'hospital'},
  {type:'place',card:'goodwill_1#0',target:'shrine'},
  {type:'place',card,target}
 ])s=act(s,command);
 return s;
};

test('MC Suspicious Letter locks a moved character only during the following day',()=>{
 let s=fresh();s.board.boy_student.paranoia=2;s=incident(s,'suspicious_letter');
 s=choose(s,a=>a.target==='girl_student'&&a.to==='shrine');assert.equal(s.board.girl_student.location,'shrine');
 assert.equal(s.board.girl_student.movementLockedDay,2);
 let today=movementCards(structuredClone(s),'girl_student');assert.equal(today.board.girl_student.location,'school');
 let tomorrow=structuredClone(s);tomorrow.day=2;tomorrow=movementCards(tomorrow,'girl_student');assert.equal(tomorrow.board.girl_student.location,'shrine');
 let after=structuredClone(s);after.day=3;after=movementCards(after,'girl_student');assert.equal(after.board.girl_student.location,'school');
});

test('MC Suspicious Letter selecting the current location does not create a movement lock',()=>{
 let s=fresh();s.board.boy_student.paranoia=2;s=incident(s,'suspicious_letter');
 s=choose(s,a=>a.target==='girl_student'&&a.to==='school');assert.equal(s.board.girl_student.location,'school');assert.ok(!s.board.girl_student.movementLockedDay);
});

test('MC Closed Circle prevents movement both into and out of its location for three days',()=>{
 let s=fresh();s.board.boy_student.paranoia=2;s=incident(s,'closed_circle');assert.equal(s.closedLocations.school,3);
 for(const day of [1,2,3]){
  let out=structuredClone(s);out.day=day;out=movementCards(out,'girl_student');assert.equal(out.board.girl_student.location,'school');
  let into=structuredClone(s);into.day=day;into.board.doctor.location='shrine';into=movementCards(into,'doctor');assert.equal(into.board.doctor.location,'shrine');
 }
 let expired=structuredClone(s);expired.day=4;expired=movementCards(expired,'girl_student');assert.equal(expired.board.girl_student.location,'shrine');
});

test('MC Closed Circle reveals only a location, never the culprit identity',()=>{
 const s=fresh();s.board.boy_student.paranoia=2;
 const result=incident(s,'closed_circle');assert.equal(view(result,'A').closedLocations.school,3);assert.deepEqual(view(result,'A').knownCulprits,{});
 const logs=JSON.stringify(view(result,'A').log.filter(e=>e.type!=='day'&&e.type!=='loop'));assert.ok(!logs.includes('男子学生'));assert.ok(!logs.includes('boy_student'));
});

test('MC Twin Closed Circle seals the diagonal location without physically moving the culprit',()=>{
 const s=fresh();s.script.roles.boy_student='twin';s.board.boy_student.paranoia=2;
 const result=incident(s,'closed_circle');assert.equal(result.closedLocations.hospital,3);assert.equal(result.closedLocations.school,undefined);assert.equal(result.board.boy_student.location,'school');
});

test('MC movement restrictions clear when a new loop or final battle starts',()=>{
 const s=fresh();s.closedLocations={school:3};s.board.girl_student.movementLockedDay=2;
 const loop=nextLoop(structuredClone(s));assert.deepEqual(loop.closedLocations,{});assert.ok(!loop.board.girl_student.movementLockedDay);
 s.phase='between';const battle=act(s,{type:'final_battle'});assert.deepEqual(battle.closedLocations,{});assert.ok(!battle.board.girl_student.movementLockedDay);
});

test('MC Fool removes paranoia after its own Portent effect resolves',()=>{
 let s=fresh();s.script.roles.boy_student='fool';s.board.boy_student.paranoia=1;
 s=incident(s,'portent');s=choose(s,a=>a.target==='boy_student');assert.equal(s.board.boy_student.paranoia,0);
});

test('MC Fool removes corpse paranoia after its own Suicide',()=>{
 const s=fresh();s.script.roles.boy_student='fool';s.board.boy_student.paranoia=3;
 const result=incident(s,'suicide');assert.equal(result.board.boy_student.alive,false);assert.equal(result.board.boy_student.paranoia,0);
});

test('MC Fool retains paranoia when its incident was prevented',()=>{
 const s=fresh();s.script.roles.boy_student='fool';s.board.boy_student.paranoia=1;
 const result=incident(s,'suicide');assert.equal(result.board.boy_student.paranoia,1);assert.deepEqual(result.occurred,[]);
});

test('MC A.I. Silver Bullet ends the current ability phase rather than an immediate loop',()=>{
 let s=fresh();s.board.office_worker.goodwill=3;s=simulate(s,'silver_bullet');
 assert.equal(s.phase,'hero_ability');assert.equal(s.winner,null);assert.equal(s.extraGauge,0);assert.deepEqual(s.occurred,[]);
 assert.ok(legalActions(s).some(o=>o.command.actor==='office_worker'));
 s=act(s,{type:'pass'});assert.equal(s.winner,'heroes');assert.equal(s.extraGauge,0);
});

test('MC Private Investigator checks Twin actual location before an incident triggers',()=>{
 for(const [detective,expected] of [['girl_student',true],['doctor',false]]){
  const s=fresh();s.script.roles.boy_student='twin';s.script.roles[detective]='private_investigator';
  const result=incident(s,'serial_murder');assert.equal(result.occurred.length===1,expected);
 }
});

test('MC Twin is itself treated as present in the virtual location for Portent targets',()=>{
 let s=fresh();s.script.roles.boy_student='twin';s.board.boy_student.paranoia=1;s=incident(s,'portent');
 const targets=legalActions(s).map(o=>o.command.target);assert.ok(targets.includes('boy_student'));assert.ok(targets.includes('doctor'));assert.ok(!targets.includes('girl_student'));
 s=choose(s,a=>a.target==='boy_student');assert.equal(s.board.boy_student.paranoia,2);assert.equal(s.board.boy_student.location,'school');
});

test('MC Twin is included in virtual-location global casualties during its own Terrorism',()=>{
 const s=fresh();s.script.roles.boy_student='twin';s.board.boy_student.location='shrine';s.board.boy_student.paranoia=2;s.locations.city=1;
 const result=incident(s,'terrorism');assert.equal(result.board.boy_student.alive,false);assert.equal(result.board.boy_student.location,'shrine');assert.equal(result.board.shrine_maiden.alive,true);
});

test('MC Bestial Murder adds two Extra immediately and resolves murder before unease',()=>{
 let s=fresh();s.board.boy_student.paranoia=3;s=incident(s,'bestial_murder');assert.equal(s.extraGauge,2);
 s=choose(s,a=>a.murderTarget==='girl_student');assert.equal(s.board.girl_student.alive,false);
 assert.equal(s.board.doctor.paranoia,0);assert.equal(s.phase,'incident');
 s=choose(s,a=>a.target==='doctor'&&a.to==='office_worker');assert.equal(s.board.doctor.paranoia,2);assert.equal(s.board.office_worker.intrigue,1);assert.equal(s.extraGauge,2);
});

test('MC Bestial Murder keeps its two Extra when a Key Person death interrupts further effects',()=>{
 let s=fresh();s.board.boy_student.paranoia=3;s.script.roles.girl_student='key_person';s=incident(s,'bestial_murder');
 s=choose(s,a=>a.murderTarget==='girl_student');assert.equal(s.phase,'between');assert.equal(s.extraGauge,2);assert.equal(s.board.doctor.paranoia,0);
});

test('MC black cat Bestial Murder ignores threshold modification and counts only one Extra',()=>{
 const s=fresh();add(s,'black_cat','person','shrine');
 const result=incident(s,'bestial_murder','black_cat');assert.deepEqual(result.occurred,[1]);assert.equal(result.extraGauge,1);assert.ok(Object.values(result.board).every(c=>c.alive));
});

const endForced=s=>{s.phase='end_area';return act(s,{type:'end_area',territory:false});};

test('MC Poisoner forced target selection precedes all optional day-end abilities',()=>{
 let s=fresh();s.extraGauge=2;s.script.roles.boy_student='poisoner';s.script.roles.office_worker='killer';s.script.roles.idol='key_person';s.board.idol.intrigue=2;
 s=endForced(s);assert.equal(s.phase,'end_forced');assert.ok(legalActions(s).some(o=>o.command.target==='girl_student'));
 assert.ok(legalActions(s).every(o=>o.command.type==='end_forced'));assert.ok(!legalActions(s).some(o=>o.command.type==='pass'));
 s=choose(s,a=>a.target==='girl_student');assert.equal(s.board.girl_student.alive,false);
});

test('MC Poisoner may choose itself or an immortal target and spends its loop-limited kill',()=>{
 let s=fresh();s.extraGauge=2;s.script.roles.boy_student='poisoner';s.script.roles.girl_student='private_investigator';
 s=endForced(s);assert.ok(legalActions(s).some(o=>o.command.target==='boy_student'));
 s=choose(s,a=>a.target==='girl_student');assert.equal(s.board.girl_student.alive,true);
 s.day=2;s=endForced(s);assert.ok(!legalActions(s).some(o=>o.command.target));
});

test('MC Poisoner forced protagonist death remains pending when its earlier forced kill kills itself',()=>{
 let s=fresh();s.extraGauge=4;s.script.roles.boy_student='poisoner';s=endForced(s);
 s=choose(s,a=>a.target==='boy_student');assert.equal(s.board.boy_student.alive,false);assert.equal(s.winner,null);
 s=choose(s,a=>a.type==='end_forced'&&!a.target);assert.equal(s.phase,'between');
 assert.ok(s.log.some(e=>e.type==='death'&&e.text==='主人公死亡。'));
});

test('MC Poisoner does not run its once-per-loop kill below two Extra',()=>{
 const s=fresh();s.extraGauge=1;s.script.roles.boy_student='poisoner';const result=endForced(s);
 assert.ok(!legalActions(result).some(o=>o.command.target));assert.ok(Object.values(result.board).every(c=>c.alive));
});

test('MC Poisoner loop-limited kill becomes available after resetting the loop',()=>{
 let s=fresh();s.extraGauge=2;s.script.roles.boy_student='poisoner';s=endForced(s);s=choose(s,a=>a.target==='girl_student');
 s=nextLoop(s);s.extraGauge=2;s=endForced(s);assert.ok(legalActions(s).some(o=>o.command.target==='girl_student'));
});

test('MC serial killing and poison are all collected before either forced effect resolves',()=>{
 let s=fresh();s.extraGauge=4;s.script.roles.boy_student='poisoner';s.script.roles.girl_student='serial_killer';s=endForced(s);
 // The serial killer has only the Poisoner beside it. Killing that source must
 // not silently discard the Poisoner's already-triggered protagonists death.
 const serial=legalActions(s).find(o=>o.command.type==='end_forced'&&!o.command.target&&o.label.startsWith('结算死亡'));
 assert.ok(serial,'forced serial-killer effect is selectable');s=act(s,serial.command);assert.equal(s.board.boy_student.alive,false);
 for(let step=0;s.phase==='end_forced'&&step<12;step++){
  const action=legalActions(s).find(o=>!o.command.target)||legalActions(s)[0];assert.ok(action);s=act(s,action.command);
 }
 assert.equal(s.phase,'between');assert.ok(s.log.some(e=>e.type==='death'&&e.text==='主人公死亡。'));
});


test('MC Isolated Institution Psycho starts the first loop at zero Extra',()=>{
 const script=generateScript({ruleset:'MC',seed:719,mainPlot:'murder_plan',subPlots:['isolated_psycho','hidden_freak']});
 const s=createGame(script);assert.equal(s.loop,1);assert.equal(s.extraGauge,0);
});

const declareBestial=(s,{hidden=false,murderTarget='office_worker',target='boy_student',to='girl_student'}={})=>{
 add(s,'ai_character','brain','city');s.board.ai_character.goodwill=3;s.phase='hero_ability';s.script.settings.incidentVisibility=hidden?'hidden':'public';
 s.script.incidents=[{day:3,type:'bestial_murder',culprit:'boy_student'}];
 s=choose(s,a=>a.type==='goodwill'&&a.actor==='ai_character');assert.equal(s.phase,'ai_target');
 s=choose(s,a=>a.type==='ai_target'&&a.murderTarget===murderTarget);assert.equal(s.phase,'ai_target');
 s=choose(s,a=>a.type==='ai_target'&&a.target===target&&a.to===to);assert.equal(s.phase,'refusal');
 return s;
};

test('MC A.I. declares both Bestial Murder effects before refusal and simulation adds no Extra',()=>{
 for(const hidden of [false,true]){
  let s=declareBestial(fresh(),{hidden});assert.equal(s.board.office_worker.alive,true);assert.equal(s.board.boy_student.paranoia,0);
  s=act(s,{type:'refusal',refuse:false});assert.equal(s.board.office_worker.alive,false);assert.equal(s.board.boy_student.paranoia,2);assert.equal(s.board.girl_student.intrigue,1);
  assert.equal(s.extraGauge,0);assert.deepEqual(s.occurred,[]);assert.equal(s.phase,'hero_ability');
 }
});

test('MC refusing A.I. Bestial Murder executes neither predeclared effect',()=>{
 let s=declareBestial(fresh());s=act(s,{type:'refusal',refuse:true});
 assert.equal(s.board.office_worker.alive,true);assert.equal(s.board.boy_student.paranoia,0);assert.equal(s.board.girl_student.intrigue,0);assert.equal(s.extraGauge,0);
 assert.ok(!legalActions(s).some(o=>o.command.actor==='ai_character'));
});

test('MC hidden A.I. menus do not reveal whether an unselected day is Bestial Murder',()=>{
 const s=fresh();add(s,'ai_character','brain','city');s.board.ai_character.goodwill=3;s.phase='hero_ability';s.script.settings.incidentVisibility='hidden';
 s.script.incidents=[{day:3,type:'bestial_murder',culprit:'boy_student'}];
 const t=structuredClone(s);t.script.incidents[0].type='portent';
 assert.deepEqual(view(s,'A'),view(t,'A'));
});

test('MC Fool cleanup survives an immediate Key Person loss during Bestial Murder',()=>{
 let s=fresh();s.script.roles.boy_student='fool';s.script.roles.girl_student='key_person';s.board.boy_student.paranoia=3;
 s=incident(s,'bestial_murder');s=choose(s,a=>a.murderTarget==='girl_student');
 assert.equal(s.phase,'between');assert.equal(s.board.boy_student.paranoia,0);assert.equal(s.extraGauge,2);
});

test('MC A.I. with Fool role does not clear paranoia after merely simulating an incident',()=>{
 let s=fresh();add(s,'ai_character','fool','city');s.board.ai_character.goodwill=3;s.board.ai_character.paranoia=2;s.phase='hero_ability';
 s.script.incidents=[{day:3,type:'unease',culprit:'boy_student'}];
 s=choose(s,a=>a.actor==='ai_character'&&a.effectTarget==='ai_character'&&a.effectTo==='girl_student');s=act(s,{type:'refusal',refuse:false});
 assert.equal(s.board.ai_character.paranoia,4);assert.equal(s.extraGauge,0);assert.deepEqual(s.occurred,[]);
});

test('MC A.I. with Twin role simulates from its actual location without triggering the Twin ability',()=>{
 let s=fresh();add(s,'ai_character','twin','city');s.board.ai_character.goodwill=3;s.phase='hero_ability';
 s.script.incidents=[{day:3,type:'serial_murder',culprit:'boy_student'}];
 const choices=legalActions(s).filter(o=>o.command.actor==='ai_character');assert.ok(choices.some(o=>o.command.effectTarget==='office_worker'));assert.ok(!choices.some(o=>o.command.effectTarget==='shrine_maiden'));
 s=choose(s,a=>a.actor==='ai_character'&&a.effectTarget==='office_worker');s=act(s,{type:'refusal',refuse:false});assert.equal(s.board.office_worker.alive,false);assert.equal(s.board.shrine_maiden.alive,true);
});

test('MC black cat Silver Bullet does not end the loop and still increases ordinary Extra',()=>{
 const s=fresh();add(s,'black_cat','person','shrine');const result=incident(s,'silver_bullet','black_cat');
 assert.equal(result.extraGauge,1);assert.equal(result.phase,'end_area');assert.equal(result.winner,null);
});

test('MC Boss Private Investigator can use its territory for the zero-Extra forced trigger',()=>{
 const s=fresh();add(s,'boss','private_investigator','city');s.script.settings.bossTerritory='school';
 const check=incident(s,'serial_murder');assert.equal(check.phase,'incident_check');
 const actual=act(structuredClone(check),{type:'incident_check',territory:false});assert.deepEqual(actual.occurred,[]);
 const territory=act(structuredClone(check),{type:'incident_check',territory:true});assert.deepEqual(territory.occurred,[1]);assert.equal(territory.board.boss.location,'city');
});

test('MC Boss Therapist can remove paranoia in its territory without moving',()=>{
 let s=fresh();add(s,'boss','therapist','city');s.script.settings.bossTerritory='school';s.extraGauge=1;s.phase='mm_ability';s.board.girl_student.paranoia=2;
 s=choose(s,a=>a.actor==='boss'&&a.ability==='therapist'&&a.target==='girl_student');assert.equal(s.board.girl_student.paranoia,1);assert.equal(s.board.boss.location,'city');
});

test('MC a Suspicious Letter blocked by Closed Circle does not impose a new next-day lock',()=>{
 let s=fresh();s.closedLocations={school:3};s.board.boy_student.paranoia=2;s=incident(s,'suspicious_letter');
 const before=s.log.length;
 s=choose(s,a=>a.target==='girl_student'&&a.to==='shrine');assert.equal(s.board.girl_student.location,'school');assert.ok(!s.board.girl_student.movementLockedDay);
 assert.equal(s.log.slice(before).some(e=>e.who==='girl_student'||e.text.includes(name('girl_student'))),false,'failed secret movement does not identify its target');
});

test('MC Strychnine does not count A.I. intrigue twice when checking an incident',()=>{
 const s=fresh();s.script.mainPlot='strychnine';add(s,'ai_character','brain','city');s.board.ai_character.goodwill=1;s.board.ai_character.intrigue=2;
 const result=incident(s,'suicide','ai_character');assert.deepEqual(result.occurred,[]);assert.equal(result.board.ai_character.alive,true);
});

test('MC Boss Twin chooses actual location or territory before taking its diagonal incident location',()=>{
 const s=fresh();add(s,'boss','twin','city');s.script.settings.bossTerritory='school';s.board.boss.paranoia=4;
 const check=incident(s,'serial_murder','boss');assert.equal(check.phase,'incident_check');
 const actual=act(structuredClone(check),{type:'incident_check',territory:false});
 const territory=act(structuredClone(check),{type:'incident_check',territory:true});
 assert.deepEqual(legalActions(actual).map(o=>o.command.target),['shrine_maiden']);
 assert.deepEqual(legalActions(territory).map(o=>o.command.target),['doctor']);
 assert.equal(actual.board.boss.location,'city');assert.equal(territory.board.boss.location,'city');
 for(const state of [check,actual,territory])for(const seat of ['A','public']){
  const projected=view(state,seat);assert.equal(projected.pending,undefined);assert.equal(projected.origin,undefined);assert.equal(projected.board.boss.location,'city');
 }
});

test('MC Boss Twin Closed Circle seals the diagonal of the chosen territory',()=>{
 const s=fresh();add(s,'boss','twin','city');s.script.settings.bossTerritory='school';s.board.boss.paranoia=4;
 const check=incident(s,'closed_circle','boss');
 const actual=act(structuredClone(check),{type:'incident_check',territory:false});
 const territory=act(structuredClone(check),{type:'incident_check',territory:true});
 assert.deepEqual(actual.closedLocations,{shrine:3});assert.deepEqual(territory.closedLocations,{hospital:3});
 assert.equal(territory.board.boss.location,'city');assert.deepEqual(view(territory,'public').knownCulprits,{});
});

test('MC simultaneous forced deaths all finish even when the first death is a Key Person',()=>{
 let s=fresh();s.script.roles.boy_student='serial_killer';s.script.roles.girl_student='key_person';s.script.roles.doctor='serial_killer';s.board.office_worker.location='hospital';
 s=endForced(s);s=choose(s,(a,o)=>a.type==='end_forced'&&o.label.includes(name('girl_student')));
 assert.equal(s.board.girl_student.alive,false);assert.equal(s.phase,'end_forced');assert.equal(s.board.office_worker.alive,true);
 s=choose(s,(a,o)=>a.type==='end_forced'&&o.label.includes(name('office_worker')));
 assert.equal(s.board.office_worker.alive,false);assert.equal(s.phase,'between');
});

test('MC Poisoner alone has a mandatory self-kill when its loop-limited poison triggers',()=>{
 let s=fresh();s.extraGauge=2;s.script.roles.boy_student='poisoner';s.board.girl_student.location='city';s=endForced(s);
 const targets=legalActions(s).map(o=>o.command.target);assert.deepEqual(targets,['boy_student']);
 s=choose(s,a=>a.target==='boy_student');assert.equal(s.board.boy_student.alive,false);assert.equal(s.winner,null);
});


test('MC Unease applies its first part with only one living character',()=>{
 let s=fresh();for(const c of Object.values(s.board))c.alive=c.id==='boy_student';s.board.boy_student.paranoia=2;
 s=incident(s,'unease');s=choose(s,a=>a.target==='boy_student'&&a.to==='');
 assert.equal(s.board.boy_student.paranoia,4);assert.equal(s.board.boy_student.intrigue,0);assert.equal(s.extraGauge,1);
});

test('MC Bestial Murder applies remaining Unease after reducing the cast to one survivor',()=>{
 let s=fresh();for(const c of Object.values(s.board))c.alive=['boy_student','girl_student'].includes(c.id);s.board.boy_student.paranoia=3;
 s=incident(s,'bestial_murder');s=choose(s,a=>a.murderTarget==='girl_student');
 assert.equal(s.phase,'incident');s=choose(s,a=>a.target==='boy_student'&&a.to==='');
 assert.equal(s.board.boy_student.paranoia,5);assert.equal(s.board.girl_student.alive,false);assert.equal(s.extraGauge,2);
});

test('MC A.I. alone can predeclare and simulate the available Bestial Murder effect',()=>{
 let s=fresh();for(const c of Object.values(s.board))c.alive=false;add(s,'ai_character','brain','city');s.board.ai_character.goodwill=3;
 s.phase='hero_ability';s.script.incidents=[{day:3,type:'bestial_murder',culprit:'boy_student'}];
 s=choose(s,a=>a.type==='goodwill'&&a.actor==='ai_character');
 s=choose(s,a=>a.murderTarget==='');s=choose(s,a=>a.target==='ai_character'&&a.to==='');
 assert.equal(s.phase,'refusal');s=act(s,{type:'refusal',refuse:false});
 assert.equal(s.board.ai_character.paranoia,2);assert.equal(s.extraGauge,0);assert.deepEqual(s.occurred,[]);assert.equal(s.phase,'hero_ability');
});

test('MC a zero-effect Therapist preserves the same public reveal and pass boundaries as a Person',()=>{
 const initial=fresh();initial.extraGauge=1;initial.board.office_worker.goodwill=3;
 const personState=movementCards(initial,'doctor','move_h#0');
 const therapistState=structuredClone(personState);therapistState.script.roles.boy_student='therapist';
 const projectStep=step=>({seat:step.seat,command:step.command,beats:step.beats,state:view(step.state,'A')});
 const personReveal=advanceAutomatic(personState,{trace:true});
 const therapistReveal=advanceAutomatic(therapistState,{trace:true});
 assert.equal(personReveal.state.phase,'mm_ability');assert.equal(therapistReveal.state.phase,'mm_ability');
 assert.equal(personReveal.reason,'boundary');assert.equal(therapistReveal.reason,'boundary');
 assert.deepEqual(therapistReveal.steps.map(projectStep),personReveal.steps.map(projectStep));
 assert.deepEqual(view(therapistReveal.state,'A'),view(personReveal.state,'A'));
 assert.ok(!legalActions(therapistReveal.state).some(o=>o.command.ability==='therapist'));
 const personBeats=[],therapistBeats=[];
 const personPassed=applyCommand(personReveal.state,'M',{type:'pass'},personBeats);
 const therapistPassed=applyCommand(therapistReveal.state,'M',{type:'pass'},therapistBeats);
 assert.deepEqual(therapistBeats,personBeats);assert.equal(therapistPassed.revision,personPassed.revision);
 const personAfter=advanceAutomatic(personPassed,{trace:true});
 const therapistAfter=advanceAutomatic(therapistPassed,{trace:true});
 assert.equal(personAfter.state.phase,'hero_ability');assert.equal(therapistAfter.state.phase,'hero_ability');
 assert.deepEqual(therapistAfter.steps.map(projectStep),personAfter.steps.map(projectStep));
 assert.deepEqual(view(therapistAfter.state,'A'),view(personAfter.state,'A'));
});

test('MC a silently consumed Therapist does not reactivate after a Misleader adds paranoia',()=>{
 let s=fresh();s.extraGauge=1;s.script.roles.boy_student='therapist';s.script.roles.girl_student='misleader';
 s=advanceAutomatic(movementCards(s,'doctor','move_h#0')).state;
 assert.equal(s.phase,'mm_ability');assert.ok(!legalActions(s).some(o=>o.command.ability==='therapist'));
 s=choose(s,a=>a.ability==='misleader'&&a.actor==='girl_student'&&a.target==='girl_student');
 assert.equal(s.board.girl_student.paranoia,1);
 assert.ok(!legalActions(s).some(o=>o.command.ability==='therapist'));
 assert.ok(legalActions(s).some(o=>o.command.type==='pass'));
});

test('MC resolving the only positive paranoia silently consumes remaining zero-effect Therapists',()=>{
 let s=fresh();s.extraGauge=1;s.script.roles.boy_student='therapist';s.script.roles.girl_student='therapist';
 s.board.doctor.location='school';s.board.doctor.paranoia=1;
 s=advanceAutomatic(movementCards(s,'office_worker','move_h#0')).state;
 assert.deepEqual(new Set(legalActions(s).map(o=>o.command.actor)),new Set(['boy_student','girl_student']));
 const before=s.log.length;
 s=choose(s,a=>a.ability==='therapist'&&a.actor==='boy_student'&&a.target==='doctor');
 assert.equal(s.board.doctor.paranoia,0);assert.ok(!legalActions(s).some(o=>o.command.ability==='therapist'));
 assert.deepEqual(s.log.slice(before).map(e=>({type:e.type,who:e.who})),[{type:'counter',who:'doctor'}]);
 assert.ok(legalActions(s).some(o=>o.command.type==='pass'));
});

test('MC an ineffective fixed Serial Killer does not add a response before a Poisoner choice',()=>{
 const initial=fresh();initial.extraGauge=2;initial.script.roles.boy_student='serial_killer';
 initial.script.roles.girl_student='private_investigator';initial.script.roles.doctor='poisoner';
 const withoutKiller=structuredClone(initial);withoutKiller.script.roles.boy_student='person';
 const killerState=endForced(initial),personState=endForced(withoutKiller);
 assert.equal(killerState.phase,'end_forced');assert.deepEqual(view(killerState,'A'),view(personState,'A'));
 assert.ok(legalActions(killerState).every(o=>o.command.target==='doctor'),'only the still-meaningful poison choice remains');
 const killerAfter=choose(killerState,a=>a.target==='doctor');
 const personAfter=choose(personState,a=>a.target==='doctor');
 assert.equal(killerAfter.board.doctor.alive,false);assert.equal(killerAfter.board.girl_student.alive,true);
 assert.equal(killerAfter.revision,personAfter.revision);assert.equal(killerAfter.phase,personAfter.phase);
 assert.deepEqual(killerAfter.log,personAfter.log);assert.deepEqual(view(killerAfter,'A'),view(personAfter,'A'));
});

test('MC a Serial Killer with only an immortal victim retains one empty public end boundary',()=>{
 for(const role of ['private_investigator','time_traveler','immortal']){
  const initial=fresh();initial.script.roles.boy_student='serial_killer';initial.script.roles.girl_student=role;
  const withoutKiller=structuredClone(initial);withoutKiller.script.roles.boy_student='person';
  const killerState=endForced(initial),personState=endForced(withoutKiller);
  assert.equal(killerState.phase,'end_forced');assert.deepEqual(legalActions(killerState).map(o=>o.command),[{type:'end_forced',index:-1}]);
  assert.equal(advanceAutomatic(killerState).reason,'boundary');assert.deepEqual(view(killerState,'public'),view(personState,'public'));
  const result=act(killerState,{type:'end_forced',index:-1});assert.equal(result.phase,'end');assert.equal(result.board.girl_student.alive,true);
  assert.deepEqual(result.log,personState.log);
 }
});

test('MC a fixed Serial Killer must resolve and publicly consume a living victim guard',()=>{
 const initial=fresh();initial.script.roles.boy_student='serial_killer';initial.board.girl_student.guard=1;
 const before=initial.log.length;let s=endForced(initial);
 const choices=legalActions(s);assert.equal(choices.length,1);assert.notEqual(choices[0].command.index,-1);
 assert.equal(s.board.girl_student.guard,1);s=act(s,choices[0].command);
 assert.equal(s.board.girl_student.alive,true);assert.equal(s.board.girl_student.guard,0);assert.equal(s.phase,'end');
 assert.ok(s.log.slice(before).some(e=>e.type==='counter'&&e.who==='girl_student'&&e.text.includes('护卫')));
});

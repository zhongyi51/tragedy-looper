import test from 'node:test';
import assert from 'node:assert/strict';
import {starter} from '../src/content.mjs';
import {createGame,applyCommand,automaticCommand,advanceAutomatic,legalActions,turn,hash} from '../src/engine.mjs';
import {decide} from '../src/ai.mjs';

const fresh=()=>createGame(starter);
const allPeople=s=>{for(const id of s.script.characters)s.script.roles[id]='person';return s;};
function resolution(){
 let s=allPeople(fresh());
 for(const [card,target]of [['move_h','hospital'],['move_v','shrine'],['forbid_goodwill','school'],['move_h','hospital'],['move_v','shrine'],['paranoia_1','school']]){
  s=applyCommand(s,turn(s),{type:'place',card:card+'#0',target});
 }
 return s;
}
function cultist(){
 const s=allPeople(fresh());s.phase='cultist';s.cultists=['doctor'];s.ignoredAreas=[];s.script.roles.doctor='cultist';
 s.placements=[{seat:'M',card:'intrigue_1#0',target:'doctor'},{seat:'A',card:'forbid_intrigue#0',target:'doctor'}];
 return s;
}
function bossEnd(territory){
 const s=allPeople(fresh());s.phase='end_area';s.script.characters.push('boss');s.script.roles.boss='serial_killer';s.script.settings.bossTerritory=territory;
 s.board.boss={id:'boss',initial:'city',location:'city',alive:true,present:true,goodwill:0,paranoia:0,intrigue:0,guard:0};return s;
}

test('deterministic resolution crosses counters, empty abilities and day end without model or extra request',()=>{
 const s=resolution(),before=hash(s),result=advanceAutomatic(s);
 assert.equal(result.reason,'boundary');assert.equal(result.state.phase,'mm_cards');assert.equal(result.state.day,2);
 assert.deepEqual(result.steps.map(step=>step.command.type),['cultist','pass','pass','end_area','pass']);
 assert.equal(result.state.revision,s.revision+5);assert.equal(hash(s),before);
 let replay=s;
 for(const step of result.steps){replay=applyCommand(replay,step.seat,step.command);assert.equal(hash(replay),hash(step.state));}
 assert.equal(hash(replay),hash(result.state));
 assert.equal(result.steps[0].state.dayRevealed.length,6);
 assert.equal(result.state.dayRevealed.length,0);
});

test('automatic chains stop before actual ability, card, guessing and loop-transition choices',()=>{
 const s=resolution();s.script.roles.doctor='brain';
 const result=advanceAutomatic(s);assert.equal(result.steps.length,1);assert.equal(result.reason,'decision');assert.equal(result.state.phase,'mm_ability');
 const human=allPeople(fresh());human.phase='hero_ability';human.board.idol.goodwill=4;
 assert.equal(advanceAutomatic(human).steps.length,0);
 for(const phase of ['mm_cards','hero_cards','setup','between','guess']){
  const state=fresh();state.phase=phase;
  const stopped=advanceAutomatic(state);assert.equal(stopped.reason,'boundary');assert.equal(stopped.steps.length,0);
 }
});

test('cultist retains genuine Intrigue-block choices and skips only irrelevant alternatives',()=>{
 const meaningful=cultist();assert.equal(legalActions(meaningful).length,2);assert.equal(automaticCommand(meaningful),null);
 const blocked=applyCommand(meaningful,'M',{type:'cultist',mask:0}),ignored=applyCommand(meaningful,'M',{type:'cultist',mask:1});
 assert.equal(blocked.board.doctor.intrigue,0);assert.equal(ignored.board.doctor.intrigue,1);
 const noAddition=cultist();noAddition.placements[0].card='move_h#0';
 assert.deepEqual(automaticCommand(noAddition),{type:'cultist',mask:0});
 const otherArea=cultist();for(const p of otherArea.placements)p.target='school';
 assert.deepEqual(automaticCommand(otherArea),{type:'cultist',mask:0});
 const multiple=cultist();multiple.placements.push({seat:'B',card:'forbid_intrigue#0',target:'school'});
 assert.deepEqual(automaticCommand(multiple),{type:'cultist',mask:0});
 const location=cultist();for(const p of location.placements)p.target='hospital';
 assert.equal(automaticCommand(location),null);
});

test('boss territory is included when deciding whether a cultist choice can change resolution',()=>{
 const s=bossEnd('hospital');s.phase='cultist';s.script.roles.boss='cultist';s.cultists=['boss'];s.ignoredAreas=[];
 s.placements=[{seat:'M',card:'intrigue_1#0',target:'doctor'},{seat:'A',card:'forbid_intrigue#0',target:'doctor'}];
 assert.equal(automaticCommand(s),null);
 assert.equal(applyCommand(s,'M',{type:'cultist',mask:1,bossArea:'territory'}).board.doctor.intrigue,1);
});

test('day-end territory choices are skipped only when complete resulting states agree',()=>{
 const equivalent=bossEnd('school');assert.equal(legalActions(equivalent).length,2);
 assert.deepEqual(automaticCommand(equivalent),{type:'end_area',territory:false});
 const meaningful=bossEnd('hospital');assert.equal(automaticCommand(meaningful),null);
 assert.equal(applyCommand(meaningful,'M',{type:'end_area',territory:false}).board.doctor.alive,true);
 assert.equal(applyCommand(meaningful,'M',{type:'end_area',territory:true}).board.doctor.alive,false);
});

test('forced refusal is automatic while optional refusal and multiple incident targets remain decisions',()=>{
 const s=fresh();s.phase='refusal';s.pending={action:{type:'goodwill',actor:'doctor',index:0,target:'idol',amount:-1}};
 s.script.roles.doctor='person';assert.deepEqual(automaticCommand(s),{type:'refusal',refuse:false});
 s.script.roles.doctor='cultist';assert.deepEqual(automaticCommand(s),{type:'refusal',refuse:true});
 s.script.roles.doctor='killer';assert.equal(automaticCommand(s),null);
 const incident=fresh();incident.phase='incident';incident.pending={incident:'murder',culprit:'boy_student',chooser:'M',simulated:false};
 assert.equal(legalActions(incident).length,1);assert.deepEqual(automaticCommand(incident),{type:'incident',target:'girl_student'});
 incident.board.idol.location='school';assert.equal(automaticCommand(incident),null);
});

test('automatic work is bounded, resumable, immutable and can respect an adapter boundary',()=>{
 const s=resolution(),before=hash(s),first=advanceAutomatic(s,{maxSteps:2});
 assert.equal(first.reason,'limit');assert.equal(first.steps.length,2);assert.equal(hash(s),before);
 const rest=advanceAutomatic(first.state);assert.equal(hash(rest.state),hash(advanceAutomatic(s).state));
 const stopped=advanceAutomatic(s,{stopBefore:state=>state.phase==='hero_ability'});assert.equal(stopped.reason,'boundary');assert.equal(stopped.state.phase,'hero_ability');
 assert.equal(advanceAutomatic(s,{maxSteps:0}).steps.length,0);
 for(const maxSteps of [-1,1.5,129])assert.throws(()=>advanceAutomatic(s,{maxSteps}),/INVALID_AUTOMATIC_LIMIT/);
});

test('automatic final-day chain stops at winner or between-loops without starting another loop',()=>{
 const winning=resolution();winning.day=winning.script.days;winning.script.incidents=[];
 const result=advanceAutomatic(winning);assert.equal(result.reason,'terminal');assert.equal(result.state.winner,'heroes');
 const failed=resolution();failed.day=failed.script.days;failed.script.incidents=[];failed.loopFailed=true;
 const next=advanceAutomatic(failed);assert.equal(next.reason,'boundary');assert.equal(next.state.phase,'between');assert.equal(next.state.loop,1);
});

test('adapters can advance a forced AI loop start while preserving human discussion and BTX surrender choices',()=>{
 const fs=allPeople(fresh());fs.phase='between';
 assert.equal(advanceAutomatic(fs).steps.length,0);
 const automatic=advanceAutomatic(fs,{includeBetween:true});
 assert.equal(automatic.steps.length,1);assert.equal(automatic.state.loop,2);assert.equal(automatic.state.phase,'mm_cards');
 const btx=allPeople(fresh());btx.script.ruleset='BTX';btx.phase='between';
 const choice=advanceAutomatic(btx,{includeBetween:true});
 assert.equal(choice.reason,'decision');assert.equal(choice.steps.length,0);assert.equal(choice.state.phase,'between');
});

test('AI entry point bypasses model, key and budget for semantically forced alternatives',async()=>{
 const original=globalThis.fetch;let calls=0,reservations=0;
 globalThis.fetch=async()=>{calls++;throw Error('model must not be called');};
 try{
  const s=cultist();s.placements[0].card='move_h#0';
  const answer=await decide(s,'M',{apiKey:'',onReserve:()=>reservations++});
  assert.equal(answer.automatic,true);assert.deepEqual(answer.command,{type:'cultist',mask:0});
  const end=await decide(bossEnd('school'),'M',{apiKey:'',onReserve:()=>reservations++});
  assert.equal(end.automatic,true);assert.equal(calls,0);assert.equal(reservations,0);
 }finally{globalThis.fetch=original;}
});

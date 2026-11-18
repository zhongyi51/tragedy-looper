import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,applyCommand,turn,legalActions,automaticCommand,view} from '../src/engine.mjs';
import {validateScript} from '../src/content.mjs';
import {strategyFixtures,evaluateStrategy,serializeStrategyFixture} from './fixtures/strategy-v2.mjs';

const witnesses={
 'mc-silver-bullet':[{type:'goodwill',actor:'ai_character',index:0,target:'',day:3}],
 'btx-rescue-movement':[{type:'place',card:'move_v#0',target:'police'}],
 'fs-hero-shrine-cleanup':[{type:'goodwill',actor:'shrine_maiden',index:0,target:'shrine'}],
 'btx-hero-final-role-quota':[{type:'guess',character:'girl_student',role:'killer'}],
 'fs-mastermind-kill-heroes':[{type:'end_ability',actor:'office_worker',ability:'heroes'}],
 'fs-mastermind-kill-key':[{type:'end_ability',actor:'boy_student',ability:'kill',target:'girl_student'}],
 'fs-mastermind-location-finish':[{type:'mm',actor:'doctor',ability:'brain',target:'hospital'}],
 'mc-mastermind-therapy-low':[{type:'mm',actor:'ai_character',ability:'therapist',target:'police'}],
 'mc-mastermind-therapy-high':[{type:'mm',actor:'ai_character',ability:'therapist',target:'informer'}],
 'fs-mastermind-resilient-three-cards':[{type:'place',card:'intrigue_1#0',target:'boy_student'},{type:'place',card:'intrigue_2#0',target:'girl_student'},{type:'place',card:'move_h#0',target:'doctor'}]
};
const mistakes={
 'mc-silver-bullet':[{type:'pass'}],
 'btx-rescue-movement':[{type:'place',card:'goodwill_1#0',target:'hospital'}],
 'fs-hero-shrine-cleanup':[{type:'pass'}],
 'btx-hero-final-role-quota':[{type:'guess',character:'girl_student',role:'person'}],
 'fs-mastermind-kill-heroes':[{type:'pass'}],
 'fs-mastermind-kill-key':[{type:'pass'}],
 'fs-mastermind-location-finish':[{type:'mm',actor:'doctor',ability:'brain',target:'doctor'}],
 'mc-mastermind-therapy-low':[{type:'mm',actor:'ai_character',ability:'therapist',target:'informer'}],
 'mc-mastermind-therapy-high':[{type:'mm',actor:'ai_character',ability:'therapist',target:'police'}],
 'fs-mastermind-resilient-three-cards':[{type:'place',card:'paranoia_1#0',target:'boy_student'},{type:'place',card:'intrigue_2#0',target:'girl_student'},{type:'place',card:'move_h#0',target:'doctor'}]
};

test('all ten strategy positions replay from validated scripts and complete legal histories',()=>{
 const fixtures=strategyFixtures();assert.equal(fixtures.length,10);assert.equal(fixtures.filter(f=>f.targetSeat==='M').length,6);
 for(const f of fixtures){
  assert.deepEqual(validateScript(f.script).errors,[]);let s=createGame(f.script);
  for(const {seat,command}of f.commands){assert.equal(turn(s),seat);s=applyCommand(s,seat,command);}
  assert.deepEqual(s,f.state,f.id);assert.equal(turn(s),f.targetSeat);assert.equal(automaticCommand(s),null,f.id);
  assert.ok(f.commands.length<=80);assert.ok(legalActions(s).length>=2);
  const publicView=view(s,'public');assert.equal(publicView.secret,undefined);assert.equal(publicView.script.roles,undefined);
  const serialized=serializeStrategyFixture(f);assert.equal(serialized.state,undefined);assert.equal(serialized.target.revision,f.commands.length);
 }
});

test('every strategy benchmark has an independently specified successful decision and a legal failure',()=>{
 for(const f of strategyFixtures()){
  const before=structuredClone(f.state),good=evaluateStrategy(f,witnesses[f.id]),bad=evaluateStrategy(f,mistakes[f.id]);
  assert.equal(good.legal,true,f.id);assert.equal(good.passed,true,f.id+JSON.stringify(good));
  assert.equal(bad.legal,true,f.id);assert.equal(bad.passed,false,f.id+JSON.stringify(bad));assert.deepEqual(f.state,before);
 }
});

test('rescue equivalence classes accept different movement solutions and reject location bluffs',()=>{
 const f=strategyFixtures().find(f=>f.criterion==='rescue');
 for(const command of [{type:'place',card:'move_v#0',target:'idol'},{type:'place',card:'move_h#0',target:'boy_student'}])assert.equal(evaluateStrategy(f,[command]).passed,true);
 assert.equal(evaluateStrategy(f,[{type:'place',card:'move_v#0',target:'hospital'}]).passed,false);
});

test('EX benchmarks require opposite therapy choices and the card benchmark covers all legal single replies',()=>{
 const fixtures=strategyFixtures(),low=fixtures.find(f=>f.id.endsWith('therapy-low')),high=fixtures.find(f=>f.id.endsWith('therapy-high'));
 assert.equal(low.state.extraGauge,1);assert.equal(high.state.extraGauge,2);
 assert.equal(evaluateStrategy(low,witnesses[low.id]).extraGauge,1);assert.equal(evaluateStrategy(high,witnesses[high.id]).extraGauge,3);
 const cards=fixtures.find(f=>f.criterion==='resilient_cards'),result=evaluateStrategy(cards,witnesses[cards.id]);
 assert.equal(result.responseCount,80);assert.equal(result.winningResponses,80);
 assert.equal(evaluateStrategy(cards,witnesses[cards.id].slice(0,2)).passed,false);
 assert.equal(evaluateStrategy(cards,[{type:'place',card:'intrigue_1#0',target:'no_character'}]).legal,false);
});

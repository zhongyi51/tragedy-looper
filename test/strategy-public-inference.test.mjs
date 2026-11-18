import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,applyCommand,turn,view,automaticCommand} from '../src/engine.mjs';
import {catalog} from '../src/content.mjs';
import {publicInferenceFixture,evaluatePublicInference} from './fixtures/strategy-public-inference.mjs';

test('held-out MC inference position has a complete legal history and public proof of Y',()=>{
 const f=publicInferenceFixture();let replay=createGame(f.script);
 for(const {seat,command}of f.commands){assert.equal(turn(replay),seat);replay=applyCommand(replay,seat,command);}
 assert.deepEqual(replay,f.state);assert.ok(f.commands.length<=80);assert.equal(automaticCommand(f.state),null);
 const v=view(f.state,f.targetSeat);assert.equal(v.knownRoles.office_worker,'killer');assert.deepEqual(v.knownPlots,['isolated_psycho']);assert.equal(v.script.characters.length,6);
 assert.equal(v.extraGauge,1);assert.equal(v.board.ai_character.goodwill,3);assert.equal(v.script.roles,undefined);
 // Independent public proof, not strategyPlans/publicRuleBeliefs: only two MC
 // Y plots add Killer, no X does. Murder requires Key Person + Brain + Killer;
 // revealed Isolated Psycho requires 3 more distinct roles, and a second X
 // always adds >=1 distinct role. Thus Murder needs >=7 people. Tightrope fits6.
 const ys=catalog.plots.filter(p=>p.kind==='Y'&&p.sets.includes('MC')&&p.addedRoles.killer);
 assert.deepEqual(ys.map(p=>p.id).sort(),['murder_plan','tightrope_plan']);
 assert.ok(catalog.plots.filter(p=>p.kind==='X'&&p.sets.includes('MC')).every(p=>!p.addedRoles.killer));
 assert.deepEqual(catalog.plots.find(p=>p.id==='isolated_psycho').addedRoles,{paranoiac:1,therapist:1,misleader:1});
 assert.ok(v.log.some(e=>e.type==='reveal'&&e.text.includes('杀手')));assert.ok(v.log.some(e=>e.type==='reveal'&&e.text.includes('隔离')));
});

test('continuing is safe but Silver Bullet causes exactly the inferable EX defeat',()=>{
 const f=publicInferenceFixture(),good=evaluatePublicInference(f,[{type:'pass'}]),bad=evaluatePublicInference(f,[{type:'goodwill',actor:'ai_character',index:0,target:'',day:6}]);
 assert.equal(good.passed,true);assert.equal(good.day,5);assert.equal(good.extraGauge,1);
 assert.equal(bad.legal,true);assert.equal(bad.passed,false);assert.equal(bad.phase,'between');assert.equal(bad.extraGauge,1);
});

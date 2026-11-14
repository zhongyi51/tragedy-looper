import test from 'node:test';
import assert from 'node:assert/strict';
import {starter} from '../src/content.mjs';
import {createGame,advanceAutomatic,view} from '../src/engine.mjs';
import {playStep,stepReport} from '../src/play.mjs';

function revealing(role){
 const s=createGame(starter);s.script.ruleset='MZ';s.script.roles.office_worker=role;
 s.phase='reveal_role';s.pending={character:'office_worker',resume:'hero_ability',simulated:false};return s;
}
test('MZ true reveals and Ninja disguises stop at the same public response boundary',()=>{
 const trueState=revealing('brain'),ninjaState=revealing('ninja');
 for(const s of [trueState,ninjaState]){
  const result=advanceAutomatic(s);
  assert.equal(result.reason,'boundary');assert.equal(result.steps.length,0);
 }
 assert.deepEqual(view(trueState,'A'),view(ninjaState,'A'));
});
test('a mandatory MZ reveal still avoids a model call, and its public metadata conceals that shortcut',async()=>{
 const initial=revealing('brain');
 // No key: this would fail if the single legal reveal required a provider call.
 const result=await playStep({state:initial,mode:'heroes',route:'ai-step',ai:{apiKey:''}});
 assert.equal(result.answer.automatic,true);
 const base={initial,route:'ai-step',seat:'M',frames:result.frames};
 const mandatory=stepReport({...base,mode:'heroes',answer:result.answer});
 const optional=stepReport({...base,mode:'heroes',answer:{automatic:false,reason:'private disguise choice'}});
 assert.deepEqual(mandatory.decision,{controller:'剧作家',seat:'M'});
 assert.deepEqual(optional.decision,mandatory.decision);
 assert.equal(stepReport({...base,mode:'mastermind',answer:result.answer}).decision.automatic,true);
});

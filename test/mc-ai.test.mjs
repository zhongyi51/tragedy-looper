import test from 'node:test';
import assert from 'node:assert/strict';
import {generateScript} from '../src/content.mjs';
import {createGame,applyCommand,turn,legalActions} from '../src/engine.mjs';
import {decide} from '../src/ai.mjs';

test('MC protagonist decisions receive public EX state without the hidden script or mastermind choices',async t=>{
 let state=createGame(generateScript({ruleset:'MC',seed:81126,incidentCount:3,includeAI:true,characterPool:'all',incidentVisibility:'hidden'}));
 for(let n=0;n<20&&state.phase!=='hero_cards';n++)state=applyCommand(state,turn(state),legalActions(state)[0].command);
 assert.equal(state.phase,'hero_cards');state.extraGauge=3;state.notes.M='MC_SECRET_MASTER_NOTE';
 let sent;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{sent=JSON.parse(init.body);return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:'{"choice":0,"reason":"保护当前人物"}'}}]}));});
 const seat=turn(state),answer=await decide(state,seat,{apiKey:'mc_test_not_a_real_secret'});
 assert.ok(legalActions(state,seat).some(a=>JSON.stringify(a.command)===JSON.stringify(answer.command)));
 assert.match(sent.messages[0].content,/Mystery Circle/);
 const payload=JSON.parse(sent.messages[2].content),v=payload.observation;
 assert.equal(v.extraGauge,3);assert.equal(v.secret,undefined);assert.equal(v.pending,undefined);
 assert.equal(v.script.roles,undefined);assert.equal(v.script.mainPlot,undefined);assert.equal(v.script.subPlots,undefined);
 assert.ok(v.script.incidents.every(e=>e.type===undefined&&e.culprit===undefined));
 assert.ok(v.placements.every(p=>p.card===undefined));
 assert.ok(!JSON.stringify(sent.messages.slice(1)).includes('MC_SECRET_MASTER_NOTE'));
});

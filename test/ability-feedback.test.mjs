import test from 'node:test';
import assert from 'node:assert/strict';
import {starter} from '../src/content.mjs';
import {createGame,applyCommand,advanceAutomatic,view,legalActions} from '../src/engine.mjs';

test('available goodwill choices survive automatic resolution, including after use',()=>{
 const s=createGame(starter);s.phase='hero_ability';s.board.boy_student.goodwill=2;s.board.girl_student.goodwill=2;s.board.girl_student.paranoia=1;
 const before=advanceAutomatic(s);assert.equal(before.steps.length,0);
 const action=legalActions(s).find(a=>a.command.actor==='boy_student').command;
 const result=advanceAutomatic(applyCommand(s,'A',action));
 assert.equal(result.state.phase,'hero_ability');assert.equal(result.state.board.girl_student.paranoia,0);
 assert.ok(legalActions(result.state).some(a=>a.command.actor==='girl_student'));
 assert.ok(result.state.log.some(e=>e.type==='ability'&&/友好能力 1 开始结算/.test(e.text)));
});

test('empty ability phases leave public completion records without exposing hidden options',()=>{
 const s=createGame(starter);s.phase='hero_ability';
 const result=advanceAutomatic(s);
 assert.equal(result.state.day,2);
 assert.ok(view(result.state,'A').log.some(e=>e.type==='phase'&&/没有可用的友好能力/.test(e.text)));
 const m=createGame(starter);m.phase='mm_ability';
 const done=applyCommand(m,'M',{type:'pass'});
 assert.equal(done.log.at(-1).text,'剧作家能力阶段结束。');
});

test('mastermind ability announcement names neither its secret role nor source',()=>{
 const s=createGame(starter);s.phase='mm_ability';
 const action=legalActions(s).find(a=>a.command.type==='mm').command;
 const next=applyCommand(s,'M',action),events=view(next,'A').log.slice(s.log.length);
 assert.equal(events[0].type,'ability');assert.equal(events[0].text,'剧作家发动能力。');
 assert.equal(events[0].actor,undefined);assert.equal(events[0].ability,undefined);
 assert.ok(events.some(e=>e.type==='counter'));
});

test('optional refusal remains a mastermind decision and refusal is recorded',()=>{
 const s=createGame(starter);s.phase='hero_ability';s.board.doctor.goodwill=2;s.board.idol.location='hospital';s.script.roles.doctor='killer';
 const action=legalActions(s).find(a=>a.command.actor==='doctor').command;
 const requested=advanceAutomatic(applyCommand(s,'A',action));
 assert.equal(requested.state.phase,'refusal');assert.equal(requested.steps.length,0);
 const refused=applyCommand(requested.state,'M',{type:'refusal',refuse:true});
 assert.equal(refused.log.at(-1).type,'refused');
});

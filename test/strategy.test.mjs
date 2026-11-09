import test from 'node:test';import assert from 'node:assert/strict';
import {parseModelJson,decisionSummary} from '../src/ai.mjs';
import {createGame,applyCommand,turn,botCommand,strategicBriefing,legalActions} from '../src/engine.mjs';
import {starter,generateScript,name} from '../src/content.mjs';

test('model JSON parser tolerates fences and leading noise but never invents an object',()=>{
 assert.deepEqual(parseModelJson('{"choice":2}'),{choice:2});
 assert.deepEqual(parseModelJson('```json\n{"choice":1,"reason":"x"}\n```'),{choice:1,reason:'x'});
 assert.deepEqual(parseModelJson('{"ok":Skip to content\n{"ok":1}'),{ok:1});
 assert.deepEqual(parseModelJson('前言 {"reason":"含 } 与 { 的字符串","choice":0} 结尾'),{reason:'含 } 与 { 的字符串',choice:0});
 for(const bad of ['not json','{"choice":','[1,2]','']) assert.equal(parseModelJson(bad),undefined);
});

test('decision summary exposes protagonist reasons but never mastermind reasons',()=>{
 assert.deepEqual(decisionSummary('ai-step','A',{reason:'挡住暗跃'}),{controller:'DeepSeek',automatic:false,seat:'A',reason:'挡住暗跃'});
 assert.equal(decisionSummary('ai-step','M',{reason:'女学生是关键人物'}).reason,undefined);
 assert.equal(decisionSummary('ai-step','B',{automatic:true,reason:'forced'}).reason,undefined);
 assert.deepEqual(decisionSummary('advance','A',null),{controller:'规则引擎'});
 assert.equal(decisionSummary('ai-step','A',null),null);
});

const disguise=s=>{const d=structuredClone(s);for(const c of Object.keys(d.script.roles))d.script.roles[c]='person';d.script.mainPlot='decoy';d.script.subPlots=[];d.script.incidents=d.script.incidents.map(e=>({...e,type:'decoy',culprit:d.script.characters[0]}));return d;};

test('protagonist briefing depends only on public information',()=>{
 for(let i=0;i<40;i++){
  let s=createGame(i===0?starter:generateScript({ruleset:i%2?'BTX':'FS',seed:i})),n=0;
  while(s.phase!=='over'&&n++<300){
   const seat=turn(s);
   if(['A','B','C'].includes(seat)&&!s.knownPlots.length&&!Object.keys(s.knownRoles).length)assert.deepEqual(strategicBriefing(s,seat),strategicBriefing(disguise(s),seat),`seed ${i} ${s.phase}`);
   s=applyCommand(s,seat,botCommand(s,seat));
  }
 }
});

test('mastermind briefing names the key person and the scheduled culprit',()=>{
 const text=strategicBriefing(createGame(starter),'M').join('\n');
 assert.match(text,new RegExp(name('girl_student')));
 assert.match(text,new RegExp(name('suicide')));
});

test('practice bots always choose legal commands and both sides can win',()=>{
 const wins={heroes:0,mastermind:0};
 for(let i=0;i<60;i++){
  let s=createGame(i===0?starter:generateScript({ruleset:i%2?'BTX':'FS',seed:i})),n=0;
  while(s.phase!=='over'&&n++<800){
   const seat=turn(s),cmd=botCommand(s,seat);
   if(cmd.type!=='place')assert.ok(legalActions(s,seat).some(a=>JSON.stringify(a.command)===JSON.stringify(cmd)),`seed ${i}: illegal ${JSON.stringify(cmd)} in ${s.phase}`);
   s=applyCommand(s,seat,cmd);
  }
  assert.equal(s.phase,'over',`seed ${i} did not finish`);wins[s.winner]++;
 }
 assert.ok(wins.heroes>=5,JSON.stringify(wins));assert.ok(wins.mastermind>=5,JSON.stringify(wins));
});

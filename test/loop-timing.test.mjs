import test from 'node:test';
import assert from 'node:assert/strict';
import {starter} from '../src/content.mjs';
import {createGame,applyCommand,legalActions,turn,view,VISIBILITY_POLICY} from '../src/engine.mjs';
import {normalizeFailureLog} from '../public/failure-timing.mjs';

// Controlled boards isolate each rules timing from script generation and AI.
const fresh=(ruleset='FS')=>{
 const s=createGame(starter);s.script.ruleset=ruleset;s.script.mainPlot='murder_plan';s.script.subPlots=[];s.script.incidents=[];s.script.days=3;s.script.loops=3;
 for(const id of s.script.characters)s.script.roles[id]='person';
 s.extraGauge=0;return s;
};
const act=(s,a,trace)=>applyCommand(s,turn(s),a,trace);
const failure=s=>s.log.findLast(e=>e.type==='failed');
const finish=s=>{s.phase='end';s.day=s.script.days;return act(s,{type:'pass'});};
const addAi=s=>{
 s.script.characters.push('ai_character');s.script.roles.ai_character='person';
 s.board.ai_character={id:'ai_character',initial:'city',location:'city',alive:true,present:true,goodwill:3,paranoia:0,intrigue:0,guard:0};
};

test('last-day location loss is a loop-end check after the day completes',()=>{
 let s=fresh();s.script.mainPlot='protect_place';s.locations.school=2;s.phase='end';s.day=3;
 const beats=[];s=act(s,{type:'pass'},beats);
 assert.deepEqual(s.log.slice(-2).map(e=>[e.type,e.phase,e.when]),[['dayend','end',undefined],['failed','loop_end','loop_end']]);
 assert.match(failure(s).text,/轮回结束时/);assert.equal(beats.at(-1).phase,'loop_end');assert.equal(s.phase,'between');
 assert.deepEqual(failure(view(s,'A')),failure(s));
});

test('Time Traveler loss belongs to the last day end and does not complete the day first',()=>{
 let s=fresh('BTX');s.script.roles.doctor='time_traveler';s.phase='end';s.day=3;
 const beats=[];s=act(s,{type:'end_ability',actor:'doctor',ability:'travel'},beats);
 assert.equal(failure(s).when,'day_end');assert.equal(failure(s).phase,'end');assert.match(failure(s).text,/日结束时/);
 assert.ok(!s.log.some(e=>e.type==='dayend'));assert.equal(beats.at(-1).phase,'end');
 assert.equal(failure(s).dead,undefined);assert.doesNotMatch(failure(s).text,/旅行者|医生/);
});

test('Time Traveler loss is absent on earlier days and optional on the last',()=>{
 const s=fresh('BTX');s.script.roles.doctor='time_traveler';s.phase='end';
 assert.ok(!legalActions(s).some(o=>o.command.ability==='travel'));
 s.day=3;assert.ok(legalActions(s).some(o=>o.command.ability==='travel'));
 const win=act(s,{type:'pass'});assert.equal(win.winner,'heroes');assert.equal(win.log.at(-1).phase,'loop_end');
});

test('ordinary day-end killing keeps its timing without disclosing a hidden loss role',()=>{
 let s=fresh();s.phase='end';s.script.roles.office_worker='killer';s.board.office_worker.intrigue=4;
 s=act(s,{type:'end_ability',actor:'office_worker',ability:'heroes'});
 assert.equal(s.day,1);assert.equal(failure(s).when,'day_end');assert.equal(failure(s).phase,'end');
 assert.ok(s.log.some(e=>e.type==='death'&&e.text==='主人公死亡。'));
 assert.doesNotMatch(failure(s).text,/最后一天|杀手|主人公死亡/);
});

test('day-end Key Person death and ordinary death followed by Time Traveler share public failure clues',()=>{
 const s=fresh('BTX');s.day=3;s.phase='end_area';s.script.roles.boy_student='serial_killer';s.script.roles.doctor='time_traveler';
 for(const c of Object.values(s.board))c.location=['boy_student','girl_student'].includes(c.id)?'school':'city';
 const key=structuredClone(s),ordinary=structuredClone(s);key.script.roles.girl_student='key_person';ordinary.script.roles.idol='key_person';
 const keyBeats=[],ordinaryBeats=[];
 const keyResult=act(key,{type:'end_area',territory:false},keyBeats);
 let ordinaryResult=act(ordinary,{type:'end_area',territory:false},ordinaryBeats);
 ordinaryResult=act(ordinaryResult,{type:'end_ability',actor:'doctor',ability:'travel'},ordinaryBeats);
 assert.deepEqual(view(keyResult,'A').log,view(ordinaryResult,'A').log);
 assert.deepEqual(keyBeats.map(b=>[b.phase,b.log,b.board]),ordinaryBeats.map(b=>[b.phase,b.log,b.board]));
 assert.equal(failure(keyResult).when,'day_end');assert.equal(failure(keyResult).dead,undefined);
});

test('Silver Bullet on day one checks loop-end loss without executing day-end abilities',()=>{
 let s=fresh('MC');s.script.mainPlot='tightrope_plan';s.extraGauge=1;s.phase='hero_ability';
 s.script.incidents=[{day:1,type:'silver_bullet',culprit:'boy_student'}];s.board.boy_student.paranoia=2;s.script.roles.boy_student='serial_killer';
 const beats=[];s=act(s,{type:'pass'},beats);
 assert.equal(s.phase,'between');assert.equal(s.board.girl_student.alive,true);assert.equal(s.day,1);
 assert.equal(failure(s).when,'loop_end');assert.equal(failure(s).phase,'loop_end');assert.equal(beats.at(-1).phase,'loop_end');
 assert.ok(!s.log.some(e=>e.type==='dayend'));assert.doesNotMatch(failure(s).text,/最后一天/);
});

test('A.I. Silver Bullet waits for ability phase completion then records loop-end loss',()=>{
 let s=fresh('MC');addAi(s);s.script.mainPlot='tightrope_plan';s.extraGauge=1;s.phase='hero_ability';s.script.settings.incidentVisibility='public';
 s.script.incidents=[{day:3,type:'silver_bullet',culprit:'boy_student'}];
 const command=legalActions(s).find(o=>o.command.type==='goodwill'&&o.command.actor==='ai_character').command;
 s=act(s,command);s=act(s,{type:'refusal',refuse:false});
 assert.equal(s.phase,'hero_ability');assert.equal(failure(s),undefined);
 s=act(s,{type:'pass'});assert.equal(s.phase,'between');assert.equal(s.day,1);assert.equal(failure(s).phase,'loop_end');assert.equal(failure(s).when,'loop_end');
 assert.ok(!s.log.some(e=>e.type==='dayend'));
});

test('dead Friend is revealed at loop end before its loop-end failure',()=>{
 const s=fresh('BTX');s.script.roles.doctor='friend';s.board.doctor.alive=false;
 const result=finish(s),last=result.log.slice(-2);
 assert.deepEqual(last.map(e=>[e.type,e.phase]),[['reveal','loop_end'],['failed','loop_end']]);assert.equal(result.knownRoles.doctor,'friend');
});

test('mandatory Friend reveal does not relabel an earlier event failure',()=>{
 let s=fresh('BTX');s.script.roles.doctor='friend';s.board.doctor.alive=false;s.script.roles.girl_student='key_person';s.phase='hero_ability';
 s.script.incidents=[{day:1,type:'suicide',culprit:'girl_student'}];s.board.girl_student.paranoia=3;
 s=act(s,{type:'pass'});
 assert.deepEqual(s.log.slice(-3).map(e=>[e.type,e.phase]),[['death','incident'],['failed','incident'],['reveal','loop_end']]);
 assert.equal(failure(s).when,'death');assert.deepEqual(failure(s).dead,['girl_student']);assert.equal(s.knownRoles.doctor,'friend');
});

test('mandatory Friend reveal follows a day-end failure without changing its timing',()=>{
 let s=fresh('BTX');s.script.roles.doctor='friend';s.board.doctor.alive=false;s.script.roles.office_worker='killer';s.board.office_worker.intrigue=4;s.phase='end';
 s=act(s,{type:'end_ability',actor:'office_worker',ability:'heroes'});
 assert.deepEqual(s.log.slice(-3).map(e=>[e.type,e.phase]),[['death','end'],['failed','end'],['reveal','loop_end']]);
 assert.equal(failure(s).when,'day_end');assert.equal(s.knownRoles.doctor,'friend');
});

test('ordinary and early successful endings record victory at loop end',()=>{
 const ordinary=finish(fresh());assert.equal(ordinary.log.at(-1).phase,'loop_end');
 let early=fresh('MC');early.phase='hero_ability';early.script.incidents=[{day:1,type:'silver_bullet',culprit:'boy_student'}];early.board.boy_student.paranoia=2;
 const beats=[];early=act(early,{type:'pass'},beats);assert.equal(early.winner,'heroes');assert.equal(early.log.at(-1).phase,'loop_end');assert.equal(beats.at(-1).phase,'loop_end');
});

test('legacy ambiguous endings are marked unknown instead of guessed from the calendar',()=>{
 for(const day of [1,3]){
  const entry={type:'failed',loop:1,day,when:'end',phase:day===1?'incident':'end',text:'第 1 轮回失败：最后一天结束时，失败条件成立。',intrigue:{school:2}};
  const normalized=normalizeFailureLog(entry);assert.equal(normalized.when,'legacy_end');assert.equal(normalized.phase,'legacy_end');assert.match(normalized.text,/旧记录未区分/);assert.equal(entry.when,'end');
  const s=fresh();s.log.push(entry);assert.deepEqual(view(s,'A').log.at(-1),normalized);assert.deepEqual(view(s,'M').log.at(-1),normalized);
 }
});

test('legacy day-end deaths do not assert a hidden loss cause in public views',()=>{
 const s=fresh();s.log.push({type:'death',loop:1,day:3,phase:'end',who:'girl_student',text:'女学生死亡。'},{type:'failed',loop:1,day:3,phase:'end',when:'death',dead:['girl_student'],text:'女学生死亡，轮回立即结束。'});
 const logs=view(s,'A').log;assert.equal(logs.at(-2).who,'girl_student');assert.equal(logs.at(-1).when,'day_end');assert.equal(logs.at(-1).dead,undefined);assert.doesNotMatch(logs.at(-1).text,/女学生/);
});

test('failure timing privacy migration clears protagonist memories only once',()=>{
 const s=fresh();s.visibilityPolicy='hidden_incident_names_v1';s.notes={A:'old cause',B:'old cause',C:'old cause',M:'secret plan'};s.aiMemory={A:{x:1},B:{x:1},C:{x:1},M:{x:2}};s.heroDiscussion={text:'old cause'};
 let next=act(s,legalActions(s)[0].command);assert.equal(next.visibilityPolicy,VISIBILITY_POLICY);assert.deepEqual(next.notes,{A:'',B:'',C:'',M:'secret plan'});assert.deepEqual(next.aiMemory,{M:{x:2}});assert.equal(next.heroDiscussion,undefined);
 next.notes.A='new public timing';next=act(next,legalActions(next)[0].command);assert.equal(next.notes.A,'new public timing');
});

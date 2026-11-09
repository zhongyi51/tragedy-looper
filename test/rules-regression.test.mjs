import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,starter,generateScript,publicScript,locs,name} from '../src/content.mjs';
import {createGame,applyCommand,legalActions,view,turn,hash,VERSION,VISIBILITY_POLICY} from '../src/engine.mjs';

const fresh=()=>createGame(starter);
const act=(s,a)=>applyCommand(s,turn(s),a);
const place=(s,card,target)=>act(s,{type:'place',card:card+'#0',target});

test('new games identify the hidden-incident visibility policy and preserve current notes',()=>{
 let s=fresh();assert.equal(s.visibilityPolicy,VISIBILITY_POLICY);
 s.notes={A:'observed A',B:'observed B',C:'observed C',M:'secret M'};
 const next=place(s,'move_h','hospital');
 assert.deepEqual(next.notes,s.notes);
});

test('old saves discard contaminated protagonist AI notes exactly once on a legal action',()=>{
 let s=fresh();delete s.visibilityPolicy;s.version='0.2.0';
 s.notes={A:'旧的事件名称 A',B:'旧的事件名称 B',C:'旧的事件名称 C',M:'保留剧作家秘密'};
 const original=structuredClone(s),before=hash(s);
 assert.throws(()=>place(s,'invalid','hospital'),/ILLEGAL_ACTION/);
 assert.equal(hash(s),before);
 let next=place(s,'move_h','hospital');
 assert.equal(hash(s),before);
 assert.equal(next.visibilityPolicy,VISIBILITY_POLICY);
 assert.equal(next.version,VERSION);
 assert.deepEqual(next.notes,{A:'',B:'',C:'',M:'保留剧作家秘密'});
 assert.deepEqual(next.board,original.board);
 assert.deepEqual(next.script,original.script);
 assert.deepEqual(next.knownRoles,original.knownRoles);
 assert.equal(next.revision,original.revision+1);
 next.notes.A='迁移后根据已观察信息形成的笔记';
 next=place(next,'move_v','shrine');
 assert.equal(next.notes.A,'迁移后根据已观察信息形成的笔记');
 assert.equal(next.notes.M,'保留剧作家秘密');
});

test('incident names are absent from every protagonist/public schedule but retained for mastermind',()=>{
 const s=fresh();
 for(const seat of ['A','B','C','public']){
  const v=view(s,seat);
  assert.deepEqual(v.script.incidents,[{day:3}]);
  assert.equal(v.secret,undefined);
 }
 assert.deepEqual(publicScript(s.script).incidents,[{day:3}]);
 assert.deepEqual(view(s,'M').script.incidents,[{day:3,type:'suicide'}]);
 assert.deepEqual(view(s,'M').secret.incidents,s.script.incidents);
 const t=fresh();t.script.incidents[0].type='murder';
 assert.deepEqual(view(s,'A'),view(t,'A'));
});

test('public script projections do not retain mutable references into secret state',()=>{
 const s=fresh(),before=hash(s),v=publicScript(s.script);
 v.characters.pop();v.settings.example=true;v.incidents[0].day=1;
 assert.equal(hash(s),before);
});

test('an untriggered incident does not disclose its name, including old saved replay logs',()=>{
 let s=fresh();s.phase='hero_ability';s.day=3;
 s=act(s,{type:'pass'});
 assert.equal(s.phase,'end_area');
 assert.match(view(s,'A').log.at(-1).text,/没有发生/);
 assert.ok(!JSON.stringify(view(s,'A')).includes(name('suicide')));
 s.log.push({n:s.log.length+1,loop:1,day:3,type:'incident',text:'预告的「自杀」没有发生。'});
 const before=hash(s);
 assert.equal(view(s,'public').log.at(-1).text,'第 3 日预告的事件没有发生。');
 assert.equal(view(s,'M').log.at(-1).text,'预告的「自杀」没有发生。');
 assert.equal(hash(s),before);
});

test('an occurred incident exposes its observed result without revealing future schedule names',()=>{
 let s=fresh();s.phase='hero_ability';s.day=3;s.board.girl_student.paranoia=3;
 s=act(s,{type:'pass'});
 const v=view(s,'A');
 assert.ok(v.log.some(e=>e.text===`「${name('suicide')}」发生。`));
 assert.deepEqual(v.script.incidents,[{day:3}]);
 assert.equal(v.board.girl_student.alive,false);
});

test('six movement/bluff cards on locations reveal, resolve and return play to ability phase',()=>{
 let s=fresh();const original=structuredClone(s.board);
 const cards=[['move_h','hospital'],['move_v','shrine'],['move_d','city'],['move_h','hospital'],['move_v','shrine'],['forbid_move','city']];
 for(const [card,target]of cards){
  const candidate=legalActions(s).find(o=>o.command.card===card+'#0'&&o.command.target===target);
  assert.match(candidate.label,/佯动：地点上无效果/);
  s=act(s,candidate.command);
 }
 assert.equal(s.phase,'cultist');
 assert.equal(s.dayRevealed.length,6);
 assert.deepEqual(s.board,original);
 assert.equal(s.log.filter(e=>e.type==='card_effect').length,6);
 s=act(s,{type:'cultist',mask:0});
 assert.equal(s.phase,'mm_ability');
 assert.deepEqual(s.board,original);
 assert.deepEqual(s.locations,Object.fromEntries(locs.map(l=>[l,0])));
 assert.deepEqual(s.placements,[]);
 assert.ok(s.usedCards.M.includes('move_d#0'));
 assert.ok(s.usedCards.C.includes('forbid_move#0'));
 assert.ok(legalActions(s).length>0);
});

test('every action card can legally be bluffed on any location and resolution cannot deadlock',()=>{
 for(const def of catalog.actionDeckEntries)for(const location of locs){
  let s=fresh();const seat=def.side==='mastermind'?'M':'A';
  if(seat==='A')for(let i=0;i<3;i++)s=act(s,legalActions(s).find(o=>!locs.includes(o.command.target)).command);
  const candidate=legalActions(s).find(o=>o.command.card===def.actionType+'#0'&&o.command.target===location);
  assert.ok(candidate,`${def.id} on ${location}`);
  s=act(s,candidate.command);
  while(['mm_cards','hero_cards'].includes(s.phase))s=act(s,legalActions(s)[0].command);
  assert.equal(s.phase,'cultist');
  s=act(s,{type:'cultist',mask:0});
  assert.equal(s.phase,'mm_ability');
  assert.ok(legalActions(s).length>0);
 }
});

test('illegal card ids, dead targets, repeated side targets and wrong seats never mutate state',()=>{
 let s=fresh();s.board.doctor.alive=false;
 for(const [seat,command]of [
  ['M',{type:'place',card:'teleport#0',target:'hospital'}],
  ['M',{type:'place',card:'move_h#0',target:'doctor'}],
  ['A',{type:'place',card:'move_h#0',target:'hospital'}],
  ['M',{type:'place',card:'move_h#0',target:'nowhere'}]
 ]){const before=hash(s);assert.throws(()=>applyCommand(s,seat,command),/ILLEGAL_ACTION/);assert.equal(hash(s),before);}
 s=place(s,'move_h','hospital');const before=hash(s);
 assert.throws(()=>place(s,'move_v','hospital'),/ILLEGAL_ACTION/);assert.equal(hash(s),before);
});

test('random FS and BTX legal actions including location bluffs finish without empty turns',()=>{
 let seed=1791;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<100;i++){
  let s=createGame(generateScript({ruleset:i%2?'BTX':'FS',seed:i+7000})),steps=0;
  while(s.phase!=='over'&&steps++<600){
   const actions=legalActions(s);assert.ok(actions.length,`empty ${s.phase} in case ${i}`);
   const a=actions[Math.floor(rand()*actions.length)].command;
   s=act(s,a);
  }
  assert.equal(s.phase,'over',`case ${i} exceeded step cap`);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {starter,publicScript} from '../src/content.mjs';
import {createGame,view,applyCommand,turn} from '../src/engine.mjs';
import {sanitizePublicReplay} from '../public/replay-validation.mjs';

const script=visibility=>({...structuredClone(starter),settings:{incidentVisibility:visibility}});

test('official public schedule exposes incident types without revealing culprits or plots',()=>{
 const s=createGame(script('public'));
 for(const seat of ['A','B','C','public']){
  const v=view(s,seat);
  assert.deepEqual(v.script.incidents,[{day:3,type:'suicide'}]);
  assert.equal(v.secret,undefined);
  assert.equal(v.script.roles,undefined);
  assert.equal(v.script.mainPlot,undefined);
  assert.deepEqual(v.knownCulprits,{});
 }
 assert.equal(view(s,'M').secret.incidents[0].culprit,'girl_student');
 assert.deepEqual(publicScript(s.script).incidents,[{day:3,type:'suicide'}]);
});

test('legacy and hidden schedules retain dates only before the event occurs',()=>{
 for(const sc of [starter,script('hidden')]){
  const s=createGame(sc);
  for(const seat of ['A','B','C','public'])assert.deepEqual(view(s,seat).script.incidents,[{day:3}]);
  assert.deepEqual(view(s,'M').script.incidents,[{day:3,type:'suicide'}]);
 }
});

test('ordinary occurred incident names are public, but failed incident names stay hidden',()=>{
 for(const happens of [true,false]){
  let s=createGame(script('hidden'));s.phase='hero_ability';s.day=3;
  s.board.girl_student.paranoia=happens?99:0;
  s=applyCommand(s,turn(s),{type:'pass'});
  const v=view(s,'public'),log=v.log.filter(e=>e.type==='incident');
  assert.equal(log.some(e=>e.text.includes('自杀')),happens);
  assert.equal(v.secret,undefined);
  assert.deepEqual(v.knownCulprits,{});
  assert.deepEqual(v.script.incidents,[{day:3}]);
 }
});

test('replay sanitation respects public schedules but always removes culprit fields',()=>{
 for(const visibility of ['public','hidden']){
  const s=createGame(script(visibility)),v=view(s,'public');
  v.script.incidents=structuredClone(starter.incidents);
  v.secret={roles:starter.roles};
  const clean=sanitizePublicReplay({perspective:'public',script:v.script,frames:[{view:v}]});
  const expected=visibility==='public'?[{day:3,type:'suicide'}]:[{day:3}];
  assert.deepEqual(clean.script.incidents,expected);
  assert.deepEqual(clean.frames[0].view.script.incidents,expected);
  assert.equal(clean.frames[0].view.secret,undefined);
 }
});

test('public replay of an imported MZ secret script retains only its disguised public event',()=>{
 const raw=script('public');raw.ruleset='MZ';raw.incidents=[{day:2,type:'fake_incident',publicType:'suicide',culprit:'doctor'}];
 const clean=sanitizePublicReplay({perspective:'public',script:raw,frames:[]});
 assert.deepEqual(clean.script.incidents,[{day:2,type:'suicide'}]);
 for(const key of ['roles','mainPlot','subPlots'])assert.equal(clean.script[key],undefined);
 assert.ok(!JSON.stringify(clean).includes('fake_incident'));
});

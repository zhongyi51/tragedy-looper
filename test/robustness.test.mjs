import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,starter,generateScript,validateScript} from '../src/content.mjs';
import {createGame,applyCommand,legalActions,turn,view,hash} from '../src/engine.mjs';
import {validateReplay} from '../public/replay-validation.mjs';

test('malformed script fields return validation errors rather than throw',()=>{
 for(const value of [null,[],{},'x',1,false])for(const field of ['characters','subPlots','incidents','roles','settings','specialRules']){
  const s=structuredClone(starter);s[field]=value;assert.doesNotThrow(()=>validateScript(s));
 }
 for(const incident of [null,[],1,'x']){const s=structuredClone(starter);s.incidents=[incident];assert.ok(validateScript(s).errors.length);}
 for(const id of ['__proto__','constructor','toString']){const s=structuredClone(starter);s.characters[0]=id;assert.ok(validateScript(s).errors.length);s.characters=starter.characters;s.roles.doctor=id;assert.ok(validateScript(s).errors.length);}
});
test('public and full replay roundtrips accept real snapshots and reject corrupt render fields',()=>{
 const s=createGame(starter),build=seat=>({format:'tragedy-replay-1',frames:[{view:view(s,seat)}]});
 for(const seat of ['public','M','A'])assert.doesNotThrow(()=>validateReplay(build(seat),catalog));
 for(const mutate of [v=>v.script.incidents[0].type='<img>',v=>v.board.doctor.id='unknown',v=>v.locations.school='0',v=>v.leader='<img>',v=>v.knownRoles.doctor='bad',v=>v.log[0].day='<svg>',v=>v.placements=[{seat:'M',target:'doctor',card:'<img>'}],v=>v.secret.roles.doctor='bad',v=>delete v.script]){
  const r=build('M');mutate(r.frames[0].view);assert.throws(()=>validateReplay(r,catalog));
 }
});
for(const ruleset of ['FS','BTX'])test(`${ruleset}: 200 seeded random legal-action games preserve invariants and terminate`,()=>{
 let decisions=0;const phases=new Set();
 for(let seed=1;seed<=200;seed++){
  let random=seed,s=createGame(generateScript({ruleset,seed:seed*7919}));
  for(let i=0;i<1500&&s.phase!=='over';i++){
   phases.add(s.phase);const seat=turn(s),actions=legalActions(s,seat);assert.ok(actions.length,`stuck ${seed} ${s.phase}`);
   random=(Math.imul(random,1664525)+1013904223)>>>0;const a=actions[random%actions.length],before=hash(s);const next=applyCommand(s,seat,a.command);assert.equal(hash(s),before);assert.equal(next.revision,s.revision+1);
   for(const c of Object.values(next.board))for(const key of ['goodwill','paranoia','intrigue','guard'])assert.ok(Number.isInteger(c[key])&&c[key]>=0,`${seed} ${key}`);
   for(const v of Object.values(next.locations))assert.ok(Number.isInteger(v)&&v>=0);
   const publicView=view(next,'public');assert.equal(publicView.secret,undefined);assert.ok(publicView.placements.every(p=>p.card===undefined));
   if(i%25===0)validateReplay({format:'tragedy-replay-1',frames:[{view:publicView}]},catalog);
   s=next;decisions++;
  }
  assert.equal(s.phase,'over',`seed ${seed} did not finish`);assert.ok(['heroes','mastermind'].includes(s.winner));
 }
 console.log(JSON.stringify({ruleset,games:200,decisions,phases:[...phases].sort()}));
});

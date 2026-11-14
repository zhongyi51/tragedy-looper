import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const repo=process.argv[2]||fileURLToPath(new URL('..',import.meta.url));
const out=process.argv[3]||resolve(repo,'reports/mz-audit.json');
const C=await import(pathToFileURL(repo+'/src/content.mjs'));
const E=await import(pathToFileURL(repo+'/src/engine.mjs'));
const ys=C.catalog.plots.filter(p=>p.kind==='Y'&&p.sets.includes('MZ'));
const xs=C.catalog.plots.filter(p=>p.kind==='X'&&p.sets.includes('MZ'));
const allCharacters=C.catalog.characters.filter(c=>c.scope==='base5').map(c=>c.id);
const combos=[];for(const y of ys)for(let i=0;i<xs.length;i++)for(let j=i+1;j<xs.length;j++)combos.push({mainPlot:y.id,subPlots:[xs[i].id,xs[j].id]});
const report={combos:combos.length,games:0,steps:0,winners:{},phases:{},characters:{},events:{},failures:[],maxSteps:0};
const randFor=seed=>{let x=seed>>>0;return ()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/2**32;};};
const checkPublic=(v,s)=>{
 for(const key of ['secret','pending'])assert.ok(!Object.hasOwn(v,key),'public '+key+' leaked');
 for(const key of ['roles','mainPlot','subPlots'])assert.ok(!Object.hasOwn(v.script,key),'script '+key+' leaked');
 for(const event of v.script.incidents){
  assert.ok(!Object.hasOwn(event,'culprit'),'culprit leaked');
  assert.ok(!Object.hasOwn(event,'publicType'),'raw publicType leaked');
  const secret=s.script.incidents.find(e=>e.day===event.day);
  if(s.script.settings?.incidentVisibility==='public')assert.equal(event.type,secret.type==='fake_incident'?(secret.publicType||secret.type):secret.type,'public incident schedule missing or incorrect');
  else assert.ok(!Object.hasOwn(event,'type'),'hidden schedule type leaked');
  if(secret.type==='fake_incident'&&secret.publicType&&secret.publicType!=='fake_incident')assert.notEqual(event.type,'fake_incident','real fake event leaked');
 }
 for(const [day,type] of Object.entries(v.knownIncidentTypes||{})){
  const event=s.script.incidents.find(e=>e.day===Number(day));assert.ok(event,'known event has no schedule entry');
  assert.equal(type,event.type==='fake_incident'?(event.publicType||event.type):event.type,'known event leaked true disguised type');
 }
};
for(let mode=0;mode<4;mode++)for(const [index,combo] of combos.entries()){
 const seed=202611140+mode*1000+index,rand=randFor(seed),trace=[];
 const args={ruleset:'MZ',...combo,seed,days:5,loops:3,incidentCount:4,includeAI:mode>0,characterPool:mode>0?'all':'standard',incidentVisibility:mode%2?'public':'hidden',...(mode===3?{characters:allCharacters}:{}),settings:{godlyLoop:2,transferDay:2,bossTerritory:'shrine'}};
 let phase='generation';
 try{
  const script=C.generateScript(args);assert.equal(C.validateScript(script).errors.length,0);
  for(const id of script.characters)report.characters[id]=(report.characters[id]||0)+1;
  for(const e of script.incidents)report.events[e.type]=(report.events[e.type]||0)+1;
  let state=E.createGame(script),initial=structuredClone(state),steps=0;
  while(state.phase!=='over'){
   phase=state.phase;report.phases[phase]=(report.phases[phase]||0)+1;
   assert.ok(steps<2500,'runaway game');
   const seat=E.turn(state),actions=E.legalActions(state,seat);
   assert.ok(actions.length>0,'no legal action in '+phase);
   checkPublic(E.view(state,'public'),state);
   for(const hero of ['A','B','C'])checkPublic(E.view(state,hero),state);
   let choices=actions;
   if(phase==='between')choices=actions.filter(a=>a.command.type==='next_loop');
   // Guess correctly in half the games to reach all final-guess positions.
   if(phase==='guess'&&mode%2===0)choices=actions.filter(a=>a.command.role===state.script.roles[a.command.character]);
   // Exercise abilities, while still passing frequently enough to finish days.
   if(['mm_ability','hero_ability','end'].includes(phase)&&rand()<0.45){const pass=actions.filter(a=>a.command.type==='pass');if(pass.length)choices=pass;}
   const command=choices[Math.floor(rand()*choices.length)].command,before=state,beats=[];
   state=E.applyCommand(state,seat,command,beats);trace.push({seat,command});
   assert.equal(state.revision,before.revision+1,'revision failed to advance');
   for(const b of Object.values(state.board))for(const k of ['goodwill','paranoia','intrigue','guard'])assert.ok(Number.isFinite(b[k])&&b[k]>=0,'invalid '+k+' on '+b.id);
   for(const count of Object.values(state.locations))assert.ok(Number.isFinite(count)&&count>=0,'invalid location counter');
   if(steps%13===0){
    const frames=E.transitionFrames(s=>E.view(s,'public'),before,[{seat,command,state,beats}]);
    for(const frame of frames)checkPublic(frame,state);
    assert.equal(E.hash(JSON.parse(JSON.stringify(state))),E.hash(state),'save round trip changed state');
    state=JSON.parse(JSON.stringify(state));
   }
   steps++;
  }
  assert.ok(['heroes','mastermind'].includes(state.winner),'terminal winner missing');
  assert.equal(E.turn(state),null);assert.equal(E.legalActions(state).length,0);
  let replay=initial;for(const {seat,command} of trace)replay=E.applyCommand(replay,seat,command);
  assert.equal(E.hash(replay),E.hash(state),'replay diverged');
  report.games++;report.steps+=steps;report.maxSteps=Math.max(report.maxSteps,steps);report.winners[state.winner]=(report.winners[state.winner]||0)+1;
 }catch(error){report.failures.push({mode,index,seed,combo,phase,error:error.stack,traceTail:trace.slice(-5)});}
 if(index===combos.length-1){writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({mode,games:report.games,steps:report.steps,failures:report.failures.length}));}
}
writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.failures.length?1:0;

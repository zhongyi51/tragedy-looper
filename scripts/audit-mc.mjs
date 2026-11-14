import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

// A reproducible legal-play audit, not a balance or AI-strength evaluation.
// Run: node scripts/audit-mc.mjs [repository-directory] [report-path]
const repo=process.argv[2]||fileURLToPath(new URL('..',import.meta.url));
const out=process.argv[3]||resolve(repo,'reports/mc-audit.json');
const C=await import(pathToFileURL(repo+'/src/content.mjs'));
const E=await import(pathToFileURL(repo+'/src/engine.mjs'));
const ys=C.catalog.plots.filter(p=>p.kind==='Y'&&p.sets.includes('MC'));
const xs=C.catalog.plots.filter(p=>p.kind==='X'&&p.sets.includes('MC'));
assert.equal(ys.length,5,'MC must contain all five rules Y');
assert.equal(xs.length,7,'MC must contain all seven rules X');
const allCharacters=C.catalog.characters.filter(c=>c.scope==='base5').map(c=>c.id);
const combos=[];for(const y of ys)for(let i=0;i<xs.length;i++)for(let j=i+1;j<xs.length;j++)combos.push({mainPlot:y.id,subPlots:[xs[i].id,xs[j].id]});
const sourceHashes=Object.fromEntries(['src/engine.mjs','src/content.mjs','data/catalog.json','scripts/audit-mc.mjs'].map(path=>[path,createHash('sha256').update(readFileSync(resolve(repo,path))).digest('hex')]));
const report={engineVersion:E.VERSION,contentHash:C.contentHash,sourceHashes,seedBase:2026111400,
 combinations:combos.length,configurations:6,expectedGames:combos.length*6,games:0,steps:0,
 winners:{},phases:{},commands:{},assignedCharacters:{},assignedRoles:{},scheduledEvents:{},
 occurredEvents:{},loopsReached:{},finalBattleGames:0,highestExtraGauge:0,
 serializationChecks:0,transitionChecks:0,replayChecks:0,failures:[],maxSteps:0,
 note:'Random/legal and mastermind-heuristic play checks execution and information boundaries; coverage counts distinguish assigned content from executed events. It does not measure balance or AI strength.'};
const bump=(map,key)=>{map[key]=(map[key]||0)+1;};
const randFor=seed=>{let x=seed>>>0;return ()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/2**32;};};
const publicType=e=>e.type==='fake_incident'?(e.publicType||e.type):e.type;
function checkPublic(v,s){
 for(const key of ['secret','pending','notes','usage'])assert.ok(!Object.hasOwn(v,key),'public '+key+' leaked');
 for(const key of ['roles','mainPlot','subPlots'])assert.ok(!Object.hasOwn(v.script,key),'script '+key+' leaked');
 assert.equal(v.script.ruleset,'MC');
 for(const e of v.script.incidents){
  assert.ok(!Object.hasOwn(e,'culprit'),'scheduled culprit leaked');
  assert.ok(!Object.hasOwn(e,'publicType'),'raw publicType leaked');
  const source=s.script.incidents.find(x=>x.day===e.day);assert.ok(source,'unknown event day');
  if(s.script.settings.incidentVisibility==='public')assert.equal(e.type,publicType(source));
  else assert.ok(!Object.hasOwn(e,'type'),'hidden scheduled event leaked');
 }
 for(const [day,type] of Object.entries(v.knownIncidentTypes||{}))assert.equal(type,publicType(s.script.incidents.find(e=>e.day===Number(day))));
 for(const board of Object.values(v.board))for(const key of ['role','trueRole','secretRole'])assert.ok(!Object.hasOwn(board,key),'board role leaked');
 if(v.seat==='public'){
  assert.ok(!v.actions?.length,'spectator received legal options');
  assert.ok(!v.hand?.length,'spectator received a hand');
  assert.ok(v.placements.every(p=>!Object.hasOwn(p,'card')),'spectator received covered cards');
 }
}
function invariants(state){
 assert.ok(Number.isInteger(state.extraGauge)&&state.extraGauge>=0,'invalid MC Extra Gauge');
 report.highestExtraGauge=Math.max(report.highestExtraGauge,state.extraGauge);
 for(const b of Object.values(state.board))for(const k of ['goodwill','paranoia','intrigue','guard'])assert.ok(Number.isFinite(b[k])&&b[k]>=0,'invalid '+k+' on '+b.id);
 for(const count of Object.values(state.locations))assert.ok(Number.isFinite(count)&&count>=0,'invalid location counter');
}
mkdirSync(dirname(out),{recursive:true});
for(let mode=0;mode<6;mode++)for(const [index,combo] of combos.entries()){
 const seed=report.seedBase+mode*1000+index,rand=randFor(seed),trace=[],seenEvents=new Set(),seenLoops=new Set();
 const args={ruleset:'MC',...combo,seed,days:5,loops:3,incidentCount:4,
  includeAI:mode>=2,characterPool:mode>=2?'all':'standard',incidentVisibility:mode%2?'public':'hidden',
  ...(mode>=4?{characters:allCharacters}:{}),settings:{godlyLoop:2,transferDay:2,bossTerritory:'shrine'}};
 let phase='generation';
 try{
  const script=C.generateScript(args);assert.deepEqual(C.validateScript(script).errors,[]);
  for(const id of script.characters)bump(report.assignedCharacters,id);
  for(const id of Object.values(script.roles))bump(report.assignedRoles,id);
  for(const e of script.incidents)bump(report.scheduledEvents,e.type);
  let state=E.createGame(script),initial=structuredClone(state),steps=0,guessed=false;
  while(state.phase!=='over'){
   phase=state.phase;bump(report.phases,phase);seenLoops.add(state.loop);
   assert.ok(steps<3500,'runaway game');invariants(state);
   const seat=E.turn(state),actions=E.legalActions(state,seat);assert.ok(actions.length,'no legal actions in '+phase);
   checkPublic(E.view(state,'public'),state);for(const hero of ['A','B','C'])checkPublic(E.view(state,hero),state);
   let choices=actions;
   if(phase==='between')choices=actions.filter(a=>a.command.type==='next_loop');
   if(phase==='guess'){
    guessed=true;
    // Four configurations finish every final-battle position with correct guesses.
    if(mode>=2)choices=actions.filter(a=>a.command.role===state.script.roles[a.command.character]);
   }
   if(['mm_ability','hero_ability','end'].includes(phase)&&rand()<0.35){const pass=actions.filter(a=>a.command.type==='pass');if(pass.length)choices=pass;}
   let command=choices[Math.floor(rand()*choices.length)]?.command;assert.ok(command,'empty filtered choices');
   // Alternate fully stochastic games with the engine's mastermind heuristic.
   if(mode%2&&seat==='M'&&phase==='mm_cards')command=E.botCommand(state,seat);
   assert.ok(actions.some(a=>E.sameCommand(a.command,command)),'heuristic selected an illegal command');
   const before=state,beats=[];
   state=E.applyCommand(state,seat,command,beats);trace.push({seat,command});bump(report.commands,command.type+(command.ability?':'+command.ability:''));
   assert.equal(state.revision,before.revision+1,'revision failed to advance');invariants(state);
   for(const day of state.occurred||[]){const key=state.loop+':'+day;if(!seenEvents.has(key)){seenEvents.add(key);bump(report.occurredEvents,script.incidents.find(e=>e.day===day)?.type||'unmapped');}}
   if(steps%13===0){
    const frames=E.transitionFrames(s=>E.view(s,'public'),before,[{seat,command,state,beats}]);
    for(const frame of frames){checkPublic(frame,state);report.transitionChecks++;}
    const restored=JSON.parse(JSON.stringify(state));assert.equal(E.hash(restored),E.hash(state),'save round trip changed state');
    assert.deepEqual(E.legalActions(restored),E.legalActions(state),'save round trip changed legal options');
    state=restored;report.serializationChecks++;
   }
   steps++;
  }
  assert.ok(['heroes','mastermind'].includes(state.winner));assert.equal(E.turn(state),null);assert.equal(E.legalActions(state).length,0);
  checkPublic(E.view(state,'public'),state);
  let replay=initial;for(const {seat,command} of trace)replay=E.applyCommand(replay,seat,command);
  assert.equal(E.hash(replay),E.hash(state),'full replay diverged');report.replayChecks++;
  for(const loop of seenLoops)bump(report.loopsReached,loop);if(guessed)report.finalBattleGames++;
  report.games++;report.steps+=steps;report.maxSteps=Math.max(report.maxSteps,steps);bump(report.winners,state.winner);
 }catch(error){report.failures.push({mode,index,seed,combo,phase,error:error.stack,traceTail:trace.slice(-8)});}
 if(index===combos.length-1){writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({mode,games:report.games,steps:report.steps,failures:report.failures.length}));}
}
writeFileSync(out,JSON.stringify(report,null,2));
console.log(JSON.stringify({games:report.games,expected:report.expectedGames,steps:report.steps,failures:report.failures.length,phases:report.phases,occurredEvents:report.occurredEvents,loopsReached:report.loopsReached,highestExtraGauge:report.highestExtraGauge}));
process.exitCode=report.failures.length?1:0;

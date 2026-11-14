import test from 'node:test';
import assert from 'node:assert/strict';
import {generateScript,generationLength,publicScript,starter,validateScript} from '../src/content.mjs';
import {evaluateScriptQuality} from '../src/script-quality.mjs';
import {getCuratedScript,listCuratedScripts,validateCuratedLibrary} from '../src/script-library.mjs';
import {createGame,applyCommand,legalActions,turn} from '../src/engine.mjs';

test('normal generation publishes the official schedule while keeping every secret server-side',t=>{
 let entropy=100;t.mock.method(globalThis.crypto,'getRandomValues',values=>{values[0]=++entropy;return values;});
 const a=generateScript(),b=generateScript();assert.equal(a.seed,101);assert.equal(b.seed,102);
 const script=generateScript({ruleset:'MZ',seed:87422});
 script.privateDesign={threatPlan:'PRIVATE_PLAN'};script.settings.secret='PRIVATE_SETTING';
 const publicView=publicScript(script),json=JSON.stringify(publicView);
 assert.equal(script.settings.incidentVisibility,'public');
 assert.ok(publicView.incidents.every(e=>typeof e.type==='string'&&!('culprit' in e)));
 for(const key of ['roles','mainPlot','subPlots','privateDesign','seed','generatorVersion'])assert.equal(publicView[key],undefined);
 assert.equal(publicView.id,'generated');assert.doesNotMatch(json,/87422|PRIVATE_PLAN|PRIVATE_SETTING/);
 const official=structuredClone(starter);delete official.settings.incidentVisibility;
 assert.equal(publicScript(official).settings.incidentVisibility,'public');
 assert.equal(publicScript(official).incidents[0].type,'suicide');
 official.settings.incidentVisibility='hidden';assert.equal(publicScript(official).incidents[0].type,undefined);
});

test('seeded names, length and schedules are reproducible and genuinely vary',()=>{
 for(const ruleset of ['FS','BTX','MZ','MC']){
  const dates=new Set(),names=new Set(),lengths=new Set();
  for(let seed=1;seed<=120;seed++){
   const options={ruleset,seed,incidentCount:2};
   const a=generateScript(options),b=generateScript(options);
   assert.deepEqual(a,b);assert.deepEqual(validateScript(a).errors,[]);
   dates.add(a.days+':'+a.incidents.map(e=>e.day).join(','));names.add(a.title);lengths.add(a.days);
  }
  assert.ok(dates.size>=6,ruleset+' must not always use day 2 and final day');
  assert.ok(names.size>=60,ruleset+' must not use a fixed title');
  assert.ok(lengths.size>=2,ruleset+' standard lengths vary');
 }
});

test('length presets respect explicit choices and dense schedules retain every day',()=>{
 for(const ruleset of ['FS','BTX','MZ','MC'])for(const lengthPreset of ['quick','standard','long']){
  const options={ruleset,lengthPreset,seed:49113};
  const a=generateScript(options),length=generationLength(ruleset,lengthPreset,49113);
  assert.equal(a.days,length.days);assert.equal(a.loops,length.loops);assert.equal(a.incidents.length,length.incidentCount);
  const b=generateScript({...options,days:8,loops:6,incidentCount:5,title:'明确指定的标题'});
  assert.equal(b.days,8);assert.equal(b.loops,6);assert.equal(b.incidents.length,5);assert.equal(b.title,'明确指定的标题');
 }
 const allDays=generateScript({ruleset:'MC',seed:74,days:5,incidentCount:5});
 assert.deepEqual(allDays.incidents.map(e=>e.day),[1,2,3,4,5]);
 for(const options of [{lengthPreset:'missing'},{days:null},{loops:null},{title:null},{incidentCount:null}])assert.throws(()=>generateScript(options),e=>e.code==='INVALID_SETUP');
});

test('quality reports reject invalid structure and expose concrete design risks without pretending to prove balance',()=>{
 const good=getCuratedScript('curated-last-ward');
 assert.equal(evaluateScriptQuality(good).accepted,true);
 const broken=structuredClone(good);broken.roles.doctor='missing';
 assert.equal(evaluateScriptQuality(broken).accepted,false);
 const inert=structuredClone(good);inert.characters.push('transfer_student');inert.roles.transfer_student='person';inert.settings.transferDay=4;inert.incidents=[{day:1,type:'suicide',culprit:'transfer_student'}];
 assert.deepEqual(validateScript(inert).errors,[]);
 const q=evaluateScriptQuality(inert);assert.equal(q.accepted,false);assert.equal(q.metrics.inactiveIncidents,1);assert.ok(q.issues.some(i=>i.code==='CULPRIT_NOT_PRESENT'));
 const finalGuess=getCuratedScript('curated-second-chime');finalGuess.incidents=[];
 const limited=evaluateScriptQuality(finalGuess);assert.ok(limited.issues.some(i=>i.code==='FORCED_FINAL_GUESS'));
 assert.equal(limited.metrics.forcedFinalGuess,true);assert.equal(limited.review,'static');
 // A deliberate MC black-cat event still contributes EX, so it is not rejected
 // as a universally useless effect or as an impossible event.
 const cat=getCuratedScript('curated-second-chime');cat.characters.push('black_cat');cat.roles.black_cat='person';cat.incidents[0].culprit='black_cat';
 const catQ=evaluateScriptQuality(cat);assert.equal(catQ.accepted,true);assert.ok(catQ.metrics.maximumScheduledEX>=3);
});

test('curated catalogue has independent fixed designs for every set and never lists their answers',()=>{
 const summaries=listCuratedScripts();assert.deepEqual(summaries.map(s=>s.ruleset),['FS','BTX','MZ','MC']);
 for(const m of summaries){const full=getCuratedScript(m.id),shown=publicScript(full);assert.deepEqual(validateScript(full).errors,[]);assert.ok(full.privateDesign.counterplay.length>30);assert.ok(full.privateDesign.cluePlan.length>30);assert.equal(m.privateDesign,undefined);assert.equal(shown.privateDesign,undefined);assert.equal(shown.source,'curated');assert.equal(shown.intro,m.description);assert.equal(shown.seed,undefined);full.roles={};assert.ok(Object.keys(getCuratedScript(m.id).roles).length>0);}
 assert.ok(validateCuratedLibrary().every(q=>q.accepted));
 assert.throws(()=>getCuratedScript('missing'),e=>e.code==='INVALID_SETUP');
});

const qualityLocations=['hospital','shrine','city','school'];
// Scripted witnesses check that the designed pressure and its elementary
// countermeasure actually work in the engine. They do not assume optimal play.
function witnessAction(s,counterplay){
 const seat=turn(s),all=legalActions(s,seat),pick=f=>all.find(x=>f(x.command))?.command;
 const place=(card,target)=>pick(a=>a.type==='place'&&a.card.split('#')[0]===card&&a.target===target),mc=s.script.ruleset==='MC';
 if(all[0]?.command.type==='place'){
  if(seat==='M'&&!mc){const target=s.script.ruleset==='FS'?'hospital':'shrine',p=place('intrigue_2',target)||place('intrigue_1',target);if(p)return p;}
  if(seat!=='M'&&counterplay){
   if(mc){for(const target of ['boy_student','office_worker']){const p=place('paranoia_1',target);if(p)return p;}}
   else{const p=place('forbid_intrigue',s.script.ruleset==='FS'?'hospital':'shrine');if(p)return p;}
  }
  for(const card of ['move_h','move_v','forbid_goodwill','goodwill_1'])for(const target of qualityLocations){const p=place(card,target);if(p)return p;}
 }
 if(s.phase==='guess')return pick(a=>a.role==='person')||all[0].command;
 return pick(a=>a.type==='pass')||all[0].command;
}

test('each curated design has executable pressure and an executable counterplay witness',()=>{
 for(const meta of listCuratedScripts())for(const counterplay of [false,true]){
  let s=createGame(getCuratedScript(meta.id)),commands=0;
  while(!s.winner&&commands++<500){const seat=turn(s),command=witnessAction(s,counterplay);assert.ok(legalActions(s,seat).some(a=>JSON.stringify(a.command)===JSON.stringify(command)));s=applyCommand(s,seat,command);}
  assert.equal(s.winner,counterplay?'heroes':'mastermind',meta.id+' counterplay='+counterplay);
  if(meta.ruleset==='MC'&&counterplay)assert.ok(s.extraGauge>=2,'MC counterplay deliberately lets events happen');
 }
});

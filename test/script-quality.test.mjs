import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateScriptQuality} from '../src/script-quality.mjs';
import {generateScript,validateScript} from '../src/content.mjs';
import {authorPrompt,buildAuthorCandidates,authoredScriptHash} from '../src/author.mjs';

// Real DeepSeek MC-2 regression: the former quality score was 100 even though
// this script has no way to make the protagonists fail its first loop.
const fixture=JSON.parse(readFileSync(new URL('./fixtures/quilt-no-first-loop-failure.json',import.meta.url),'utf8'));
const fresh=()=>structuredClone(fixture);
const noFailure=q=>q.issues.some(issue=>issue.code==='NO_FIRST_LOOP_FAILURE');
const quality=s=>{assert.deepEqual(validateScript(s).errors,[]);return evaluateScriptQuality(s);};
function replaceCharacter(s,from,to){s.characters[s.characters.indexOf(from)]=to;s.roles[to]=s.roles[from];delete s.roles[from];for(const event of s.incidents)if(event.culprit===from)event.culprit=to;return s;}
function compiled(subPlots){return generateScript({ruleset:'MC',mainPlot:'quilt_incidents',subPlots,characters:fixture.characters,days:3,loops:3,incidentCount:3,includeAI:true,seed:371});}

test('real quilt sample is rejected by a first-loop upper bound, without relying on probe outcomes',()=>{
 const script=fresh(),before=structuredClone(script),q=quality(script);
 assert.equal(q.accepted,false);assert.equal(q.metrics.maximumFirstLoopEX,2);assert.equal(q.metrics.maximumScheduledEX,2);
 assert.equal(q.issues.find(issue=>issue.code==='NO_FIRST_LOOP_FAILURE').severity,'error');
 assert.match(q.issues.find(issue=>issue.code==='NO_FIRST_LOOP_FAILURE').message,/首轮.*上界.*2/);
 assert.deepEqual(script,before);assert.equal(script.generation,undefined);
});

test('A.I. simulations and Silver Bullet do not manufacture actual-incident EX',()=>{
 const script=fresh();script.incidents.forEach(event=>event.type='silver_bullet');
 const q=quality(script);assert.equal(q.metrics.maximumFirstLoopEX,0);assert.equal(q.accepted,false);assert.ok(noFailure(q));
 const withoutAI=replaceCharacter(fresh(),'ai_character','office_worker');
 assert.equal(quality(withoutAI).metrics.maximumFirstLoopEX,2);assert.ok(noFailure(quality(withoutAI)));
});

test('later Isolated Psycho EX cannot rescue a first loop that already always succeeds',()=>{
 const script=compiled(['absolute_will','isolated_psycho']);
 script.incidents=Object.entries(script.roles).filter(([,role])=>['fool','obstinate'].includes(role)).map(([culprit],index)=>({day:index+1,type:'portent',culprit}));
 const q=quality(script);assert.equal(q.metrics.maximumFirstLoopEX,2);assert.equal(q.metrics.maximumScheduledEX,3);assert.ok(noFailure(q));assert.equal(q.accepted,false);
});

test('real Black Cat incidents and Bestial Murder retain their distinct EX increments',()=>{
 const cat=replaceCharacter(fresh(),'ai_character','black_cat'),catQ=quality(cat);
 assert.equal(catQ.metrics.maximumFirstLoopEX,3);assert.equal(noFailure(catQ),false);assert.equal(catQ.accepted,true);
 const bestial=fresh();bestial.incidents[2].type='bestial_murder';const q=quality(bestial);
 assert.equal(q.metrics.maximumFirstLoopEX,3);assert.equal(noFailure(q),false);assert.equal(q.accepted,true);
 const regular=fresh();regular.incidents[1].type='faked_suicide';assert.equal(quality(regular).metrics.maximumFirstLoopEX,3);assert.equal(noFailure(quality(regular)),false);
});

test('directly lethal scheduled effects stay outside the proof, including A.I. simulation opportunities',()=>{
 for(const type of ['hospital_incident','terrorism']){
  const ordinary=fresh();ordinary.incidents.forEach(event=>event.type='silver_bullet');ordinary.incidents[1].type=type;
  const blackCat=replaceCharacter(fresh(),'nurse','black_cat');blackCat.incidents.forEach(event=>event.type='silver_bullet');blackCat.incidents[0].type=type;
  const lateGod=replaceCharacter(fresh(),'nurse','godly_being');lateGod.settings.godlyLoop=2;lateGod.incidents.forEach(event=>event.type='silver_bullet');lateGod.incidents[0].type=type;
  for(const script of [ordinary,blackCat,lateGod]){const q=quality(script);assert.ok(q.metrics.maximumFirstLoopEX<3);assert.equal(noFailure(q),false);assert.equal(q.accepted,true);}
 }
});

test('other loss roles and Smell of Gunpowder are conservatively preserved',()=>{
 for(const role of ['key_person','friend','killer','poisoner']){
  const script=fresh();script.characters.push('irregular');script.roles.irregular=role;
  const q=quality(script);assert.equal(q.metrics.maximumFirstLoopEX,2);assert.equal(noFailure(q),false);assert.equal(q.accepted,true);
 }
 const script=compiled(['absolute_will','smell_gunpowder']);
 script.incidents=Object.entries(script.roles).filter(([,role])=>['fool','obstinate'].includes(role)).map(([culprit],index)=>({day:index+1,type:'portent',culprit}));
 const q=quality(script);assert.equal(q.metrics.maximumFirstLoopEX,2);assert.equal(noFailure(q),false);assert.equal(q.accepted,true);
});

test('other rulesets, other Y rules and invalid repeated-date schedules never enter the narrow proof',()=>{
 const school=generateScript({ruleset:'MC',mainPlot:'black_school',subPlots:['absolute_will','tricky_twins'],days:3,loops:2,incidentCount:2,seed:97});
 assert.equal(noFailure(quality(school)),false);
 const invalid=fresh();invalid.incidents[1].day=invalid.incidents[0].day;const q=evaluateScriptQuality(invalid);
 assert.equal(q.accepted,false);assert.equal(q.metrics.structurallyValid,false);assert.ok(q.issues.some(issue=>issue.code==='INVALID_SCRIPT'));assert.equal(noFailure(q),false);
 const wrongSet=fresh();wrongSet.ruleset='MZ';assert.equal(evaluateScriptQuality(wrongSet).metrics.structurallyValid,false);
});

test('candidate compilation removes the real trivial sample while retaining alternatives under the same plan',()=>{
 const script=fresh(),plan={mainPlot:script.mainPlot,subPlots:script.subPlots,characters:script.characters,days:script.days,loops:script.loops,incidentCount:script.incidents.length,settings:script.settings};
 const config={ruleset:'MC',...plan,seed:261114232,includeAI:true,lengthPreset:'quick'};
 const pool=buildAuthorCandidates(plan,authorPrompt(config).configuration);
 assert.ok(pool.candidates.length>0);assert.ok(pool.compiledCount<24);
 assert.ok(pool.candidates.every(candidate=>candidate.fingerprint!==authoredScriptHash(script)));
 for(const candidate of pool.candidates){assert.equal(quality(candidate.script).accepted,true);assert.deepEqual(candidate.script.subPlots,script.subPlots);assert.deepEqual(candidate.script.characters,script.characters);}
});

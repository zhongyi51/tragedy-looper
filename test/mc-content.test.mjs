import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,roles,plots,incidents,generateScript,validateScript,publicScript} from '../src/content.mjs';
const entries=group=>catalog[group].filter(item=>item.sets.includes('MC'));
const mustBeCulprit=role=>roles[role]?.castingConstraints?.includes('mustBeCulprit');
const allCombinations=()=>entries('plots').filter(p=>p.kind==='Y').flatMap(y=>{
 const xs=entries('plots').filter(p=>p.kind==='X');return xs.flatMap((x,i)=>xs.slice(i+1).map(z=>({mainPlot:y.id,subPlots:[x.id,z.id]})));
});

test('Mystery Circle catalog contains the complete published official set, including all 105 plot combinations',()=>{
 const set=catalog.sets.find(s=>s.id==='MC');assert.equal(set.mainPlots,1);assert.equal(set.subPlots,2);assert.equal(set.finalGuess,true);assert.equal(set.usesExtraGauge,true);
 assert.deepEqual(entries('plots').filter(p=>p.kind==='Y').map(p=>p.id).sort(),['murder_plan','tightrope_plan','strychnine','quilt_incidents','black_school'].sort());
 assert.deepEqual(entries('plots').filter(p=>p.kind==='X').map(p=>p.id).sort(),['hidden_freak','dance_fools','isolated_psycho','absolute_will','tricky_twins','smell_gunpowder','master_detective'].sort());
 assert.deepEqual(entries('roles').map(r=>r.id).sort(),['person','key_person','killer','brain','misleader','friend','serial_killer','obstinate','poisoner','fool','paranoiac','therapist','twin','private_investigator'].sort());
 assert.deepEqual(entries('incidents').map(e=>e.id).sort(),['serial_murder','hospital_incident','portent','unease','terrorism','bestial_murder','suicide','faked_suicide','suspicious_letter','closed_circle','silver_bullet'].sort());
 assert.equal(allCombinations().length,105);
 for(const p of entries('plots'))for(const role of Object.keys(p.addedRoles))assert.ok(entries('roles').some(r=>r.id===role),`${p.id} ${role}`);
 assert.equal(roles.fool.maxCount,1);assert.equal(roles.misleader.maxCount,1);assert.equal(roles.friend.maxCount,2);
 assert.equal(roles.poisoner.goodwillRefusal,'optional');assert.equal(roles.paranoiac.goodwillRefusal,'mandatory');assert.equal(roles.obstinate.goodwillRefusal,'mandatory');
 assert.deepEqual(roles.fool.castingConstraints,['mustBeCulprit']);assert.deepEqual(roles.twin.castingConstraints,['mustBeCulprit']);assert.deepEqual(roles.private_investigator.castingConstraints,['cannotBeCulprit']);
 assert.equal(incidents.portent.paranoiaLimitModifier,-1);assert.equal(incidents.bestial_murder.paranoiaLimitModifier,1);assert.equal(incidents.bestial_murder.extraGaugeIncrement,2);assert.equal(incidents.silver_bullet.extraGaugeIncrement,0);
 assert.ok(incidents.faked_suicide.sets.includes('MZ'));assert.ok(incidents.faked_suicide.sets.includes('MC'));assert.match(incidents.faked_suicide.effect_zh,/不能.*行动牌/);
 assert.match(plots.black_school.effect_zh,/第一个轮回必定失败/);
});

test('all MC combinations generate valid scripts across standard, full-pool and all-character casts',()=>{
 let n=0;
 for(const combo of allCombinations())for(const cast of [{},{characterPool:'all',includeAI:true},{characters:catalog.characters.map(c=>c.id)}])for(const incidentVisibility of ['hidden','public']){
  const options={ruleset:'MC',seed:++n,...combo,...cast,incidentVisibility},s=generateScript(options);
  assert.deepEqual(validateScript(s).errors,[],JSON.stringify(options));assert.equal(s.incidents.length,3);
  for(const c of s.characters){if(mustBeCulprit(s.roles[c]))assert.ok(s.incidents.some(e=>e.culprit===c),`${s.roles[c]} must be a culprit`);if(s.roles[c]==='private_investigator')assert.ok(s.incidents.every(e=>e.culprit!==c));}
  if(s.characters.includes('ai_character'))assert.notEqual(s.roles.ai_character,'person');
  if(cast.includeAI)assert.ok(s.characters.includes('ai_character'));
  const publicView=publicScript(s);assert.equal(publicView.roles,undefined);assert.equal(publicView.mainPlot,undefined);assert.equal(publicView.subPlots,undefined);
  assert.ok(publicView.incidents.every(e=>!('culprit' in e)));assert.equal(publicView.incidents.every(e=>'type' in e),incidentVisibility==='public');
  assert.deepEqual(s,generateScript(options));
 }
 assert.equal(n,630);
});

test('MC rule role counts are capped after merging plots, without rejecting compatible combinations',()=>{
 const s=generateScript({ruleset:'MC',seed:60,mainPlot:'quilt_incidents',subPlots:['dance_fools','master_detective'],characters:catalog.characters.map(c=>c.id)});
 const counts={};for(const [c,r] of Object.entries(s.roles))if(c!=='irregular')counts[r]=(counts[r]||0)+1;
 assert.equal(counts.fool,1);assert.equal(counts.misleader,1);assert.equal(counts.friend,2);assert.equal(counts.private_investigator,1);
 assert.deepEqual(validateScript(s).errors,[]);
});

test('MC validates mandatory culprits and the Private Investigator prohibition, including Irregular casting',()=>{
 for(const role of ['fool','twin','obstinate']){
  const script=generateScript({ruleset:'MC',seed:41,mainPlot:'strychnine',subPlots:['absolute_will','tricky_twins']});
  const c=script.characters.find(c=>script.roles[c]===role);assert.ok(c);script.incidents=script.incidents.filter(e=>e.culprit!==c);
  assert.ok(validateScript(script).errors.some(e=>e.path==='roles.'+c));
 }
 const investigator=generateScript({ruleset:'MC',seed:29,mainPlot:'black_school',subPlots:['hidden_freak','master_detective']});
 const pi=investigator.characters.find(c=>investigator.roles[c]==='private_investigator');investigator.incidents[0].culprit=pi;
 assert.ok(validateScript(investigator).errors.some(e=>e.path==='incidents.0.culprit'&&e.message.includes('私家侦探')));
 const irregular=generateScript({ruleset:'MC',seed:54,mainPlot:'black_school',subPlots:['hidden_freak','smell_gunpowder'],characters:catalog.characters.map(c=>c.id)});
 irregular.roles.irregular='fool';irregular.incidents=irregular.incidents.filter(e=>e.culprit!=='irregular');assert.ok(validateScript(irregular).errors.some(e=>e.path==='roles.irregular'&&e.message.includes('犯人')));
 irregular.roles.irregular='private_investigator';irregular.incidents[0].culprit='irregular';assert.ok(validateScript(irregular).errors.some(e=>e.path==='incidents.0.culprit'));
});

test('MC random rules honor small event budgets; fixed impossible choices fail clearly',()=>{
 for(const incidentCount of [0,1,2])for(let seed=0;seed<150;seed++){
  const s=generateScript({ruleset:'MC',seed,days:Math.max(1,incidentCount),incidentCount,characterPool:'all',includeAI:true});
  assert.deepEqual(validateScript(s).errors,[]);assert.equal(s.incidents.length,incidentCount);
 }
 assert.throws(()=>generateScript({ruleset:'MC',mainPlot:'strychnine',subPlots:['absolute_will','tricky_twins'],incidentCount:2}),e=>e.code==='INVALID_SETUP'&&e.message.includes('犯人'));
 assert.throws(()=>generateScript({ruleset:'MC',subPlots:['absolute_will','tricky_twins'],days:1}),e=>e.code==='INVALID_SETUP');
 assert.throws(()=>generateScript({ruleset:'MC',incidentCount:11,days:10}),e=>e.code==='INVALID_SETUP');
});

test('small fixed MC casts can cover long schedules with only legally repeated Serial Murder culprits',()=>{
 for(const options of [
  {mainPlot:'black_school',subPlots:['absolute_will','tricky_twins'],characters:['boy_student','girl_student','doctor','ai_character']},
  {mainPlot:'black_school',subPlots:['master_detective','smell_gunpowder'],characters:['boy_student','girl_student','doctor','ai_character','office_worker','idol']}
 ]){
  const s=generateScript({ruleset:'MC',seed:31,days:10,incidentCount:10,...options});assert.equal(s.incidents.length,10);assert.deepEqual(validateScript(s).errors,[]);
  for(const c of s.characters){const events=s.incidents.filter(e=>e.culprit===c);if(events.length>1)assert.ok(events.every(e=>e.type==='serial_murder'));if(s.roles[c]==='private_investigator')assert.equal(events.length,0);}
 }
});

test('MC rejects roles and incidents from other sets and never inherits MZ fake-event aliases',()=>{
 const s=generateScript({ruleset:'MC',seed:391,mainPlot:'black_school',subPlots:['hidden_freak','smell_gunpowder']});
 for(const type of ['fake_incident','conspiracies','missing','breakthrough','faked_suicide_missing']){const bad=structuredClone(s);bad.incidents[0].type=type;assert.ok(validateScript(bad).errors.some(e=>e.path==='incidents.0.type'));}
 const bad=structuredClone(s);bad.roles[bad.characters[0]]='ninja';assert.ok(validateScript(bad).errors.some(e=>e.path==='roles.'+bad.characters[0]));
 const alias=structuredClone(s);alias.incidents[0].publicType='suicide';assert.ok(validateScript(alias).errors.some(e=>e.path==='incidents.0.publicType'));
});


test('script identifiers must be strings and cannot coerce arrays into valid MC rules or casting',()=>{
 const script=generateScript({ruleset:'MC',seed:529,mainPlot:'black_school',subPlots:['hidden_freak','smell_gunpowder']});
 for(const mutate of [
  s=>{s.mainPlot=[s.mainPlot];},
  s=>{s.subPlots[0]=[s.subPlots[0]];},
  s=>{s.characters[0]=[s.characters[0]];},
  s=>{s.roles[s.characters[0]]=[s.roles[s.characters[0]]];},
  s=>{s.roles.unknown_character='private_investigator';}
 ]){const malformed=structuredClone(script);mutate(malformed);assert.ok(validateScript(malformed).errors.length);}
});

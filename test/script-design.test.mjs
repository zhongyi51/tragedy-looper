import test from 'node:test';
import assert from 'node:assert/strict';
import {generateScript,publicScript,validateScript} from '../src/content.mjs';
import {getCuratedScript,listCuratedScripts} from '../src/script-library.mjs';
import {designOptions,compileDesign,DESIGN_VERSION} from '../src/script-design.mjs';

const selectionFor=script=>{
 const options=designOptions(script);
 return {focus:options.focuses[0].id,...Object.fromEntries(['threats','counterplay','clues','loopFacts'].map(section=>[section,options.facts.filter(fact=>fact.sections.includes(section)).slice(0,section==='loopFacts'?2:3).map(fact=>fact.id)]))};
};
const swapRoles=(script,person,role)=>{
 const previous=script.roles[person],other=script.characters.find(id=>script.roles[id]===role);
 assert.ok(other,role);script.roles[other]=previous;script.roles[person]=role;return script;
};

test('catalog-derived designs cover all sets and never mutate scripts or publish secret references',()=>{
 for(const item of listCuratedScripts()){
  const script=getCuratedScript(item.id),snapshot=structuredClone(script);
  const options=designOptions(script),result=compileDesign(script,selectionFor(script));
  assert.equal(options.version,DESIGN_VERSION);assert.equal(result.grounding.version,DESIGN_VERSION);
  for(const field of ['premise','threatPlan','counterplay','cluePlan','loopPlan'])assert.ok(result.design[field].length>=12,field);
  assert.deepEqual(compileDesign(script,selectionFor(script)),result);
  assert.deepEqual(script,snapshot);
  script.privateDesign=result.design;script.generation={grounding:result.grounding};
  const visible=publicScript(script);assert.equal(visible.privateDesign,undefined);assert.equal(visible.generation,undefined);
  assert.doesNotMatch(result.design.counterplay,/保证获胜|已经证明|必定阻止/);
 }
});

test('contract target is taken from the actual rule, never from a model narrative',()=>{
 const script=generateScript({ruleset:'BTX',mainPlot:'contract',subPlots:['threads_fate','unsettling_rumor'],seed:81});
 script.privateDesign={threatPlan:'保护神社暗跃即可获胜',ruleEffects:[{id:'contract',effect:'神社暗跃达到2'}]};
 script.ruleEffects=[{id:'contract',effect:'神社暗跃达到2'}];
 const options=designOptions(script),contract=options.facts.find(fact=>fact.id==='plot:contract');
 assert.match(contract.text,/关键人物必须是少女/);assert.match(contract.text,/如果她的暗跃达到 2/);assert.doesNotMatch(contract.text,/神社/);assert.match(contract.text,/本稿初始配役：关键人物＝/);
 const out=compileDesign(script);assert.match(out.design.loopPlan,/不继承友好计数/);
 assert.doesNotMatch(JSON.stringify(out),/保护神社暗跃即可获胜/);
 const selected=selectionFor(script);selected.premise='任意新规则';
 assert.throws(()=>compileDesign(script,selected),error=>error.code==='DESIGN_SELECTION');
});

test('mandatory refusal is excluded from protagonist resources and doctor mastermind use stays a threat',()=>{
 const script=swapRoles(getCuratedScript('curated-second-chime'),'doctor','paranoiac');
 assert.deepEqual(validateScript(script).errors,[]);
 const options=designOptions(script),doctor=options.facts.find(fact=>fact.id==='ability:doctor:0');
 assert.equal(doctor.refusal,'mandatory');assert.deepEqual(doctor.sections,[]);assert.match(doctor.text,/必须拒绝/);
 assert.deepEqual(options.facts.find(fact=>fact.id==='doctor:mastermind').sections,['threats']);
 assert.match(options.facts.find(fact=>fact.id==='doctor:mastermind').text,/必须拒绝/);
 const selected=selectionFor(script);selected.counterplay=['ability:doctor:0'];
 assert.throws(()=>compileDesign(script,selected),error=>error.code==='DESIGN_SELECTION');
});

test('cannotRefuse overrides a mandatory role while optional refusal remains explicitly conditional',()=>{
 const script=swapRoles(getCuratedScript('curated-second-chime'),'doctor','paranoiac');
 script.characters.push('nurse');script.roles.nurse='person';
 swapRoles(script,'nurse','paranoiac');
 assert.deepEqual(validateScript(script).errors,[]);
 const options=designOptions(script),nurse=options.facts.find(fact=>fact.id==='ability:nurse:0');
 assert.equal(nurse.refusal,'none');assert.ok(nurse.sections.includes('counterplay'));assert.match(nurse.text,/不能被拒绝/);
 const ai=options.facts.find(fact=>fact.id==='ability:ai_character:0');
 assert.equal(ai.refusal,'optional');assert.match(ai.text,/可以拒绝.*不能视为保证成功/);
 const optionalDoctor=swapRoles(getCuratedScript('curated-last-ward'),'doctor','brain');
 assert.match(designOptions(optionalDoctor).facts.find(fact=>fact.id==='doctor:mastermind').text,/可以拒绝/);
});

test('absent patients, absent student targets and unavailable loop requirements cannot become counterplay',()=>{
 const noPatient=getCuratedScript('curated-last-ward');
 const options=designOptions(noPatient),doctor=options.facts.find(fact=>fact.id==='ability:doctor:1');
 assert.ok(!doctor.sections.includes('counterplay'));assert.match(doctor.text,/没有住院患者/);
 const script=generateScript({ruleset:'BTX',characters:['teacher','doctor','office_worker','nurse','police','patient'],mainPlot:'sealed_item',subPlots:['threads_fate','hidden_killer'],seed:5});
 swapRoles(script,'teacher','person');
 const teacher=designOptions(script).facts.find(fact=>fact.id==='ability:teacher:1');
 assert.deepEqual(teacher.sections,[]);assert.match(teacher.text,/没有符合该能力条件的学生目标/);
 const oneLoop=generateScript({ruleset:'BTX',characters:['irregular','doctor','office_worker','shrine_maiden','police','idol'],mainPlot:'sealed_item',subPlots:['threads_fate','hidden_killer'],loops:1,seed:5});
 const irregular=designOptions(oneLoop).facts.find(fact=>fact.id==='ability:irregular:0');
 assert.deepEqual(irregular.sections,[]);assert.match(irregular.text,/没有足够轮回/);
});

test('victory, MZ transfer and A.I. simulation notes use exact rule boundaries',()=>{
 const fs=compileDesign(getCuratedScript('curated-last-ward'));
 assert.match(fs.design.loopPlan,/FS 没有最后的战斗/);assert.match(fs.design.loopPlan,/查明真相本身不会获胜/);
 const mz=generateScript({ruleset:'MZ',mainPlot:'fated_connections',subPlots:['dice_of_gods','worship_apocalypse'],includeAI:true,seed:189,days:5});
 const result=compileDesign(mz);
 assert.match(result.design.loopPlan,/从第二轮回起/);assert.match(result.design.loopPlan,/选择一名，不是将所有死者转换/);
 assert.match(result.design.loopPlan,/变为关键人物并失去原角色/);assert.match(result.design.loopPlan,/首轮没有上轮死者/);
 assert.match(result.design.loopPlan,/不作该事件的发生检查/);assert.match(result.design.loopPlan,/特性只用于它担任真实事件犯人/);
});

test('unknown, cross-script, wrong-section, duplicated and oversized references fail closed',()=>{
 const script=getCuratedScript('curated-last-ward'),selected=selectionFor(script);
 for(const changes of [{focus:'invented'},{threats:['plot:contract']},{counterplay:['plot:avenger']},{counterplay:['card:move_h','card:move_h']},{clues:[]},{loopFacts:['rule:reset','rule:victory','rule:reset','rule:victory']},{threats:[{}]},{ruleOverride:'new mechanic'}]){
  assert.throws(()=>compileDesign(script,{...selected,...changes}),error=>error.code==='DESIGN_SELECTION');
 }
 const invalid=structuredClone(script);invalid.roles.doctor='missing';
 assert.throws(()=>designOptions(invalid),error=>error.code==='INVALID_SCRIPT_DESIGN');
 assert.throws(()=>compileDesign(script,selected,{difficulty:'expert'}),error=>error.code==='DESIGN_SELECTION');
});

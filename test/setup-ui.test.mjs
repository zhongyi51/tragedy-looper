import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,starter} from '../src/content.mjs';
import {createGame,view} from '../src/engine.mjs';
import {setCatalog,name,plotsFor} from '../public/js/lookup.mjs';
import {newGameModal,truthModal,characterModal,guideModal} from '../public/js/ui/modals.mjs';
import {editorHtml} from '../public/js/ui/editor.mjs';
import {rulesHtml} from '../public/js/ui/rules.mjs';
import {incidentSchedule,sideBodyHtml} from '../public/js/ui/side.mjs';
import {boardHtml} from '../public/js/ui/board.mjs';
import {normalizeGameSetup,generationOptions} from '../public/js/game-setup.mjs';
import {publicDraft,printableHtml} from '../public/js/exporters.mjs';
import {editDraft} from '../public/js/script-draft.mjs';
import {analyze,emptyMarks,markRole} from '../public/js/deduce.mjs';
import {choiceGroups,turnGuidance} from '../public/js/guidance.mjs';

setCatalog(catalog);
const state={info:{configured:true},editor:{text:'',tab:'form',generator:{ruleset:'FS',seed:1,theme:''}}};
const player=()=>({...view(createGame(starter),'A'),id:'test-ui',mode:'heroes',budget:.5,spent:null});

test('new games retain the compact layout and put advanced controls behind a closed disclosure',()=>{
 const html=newGameModal(state);
 assert.match(html,/<details class="setup-options" id="new-advanced">/);
 assert.match(html,/name="new-script" value="starter" checked/);
 assert.match(html,/value="hidden" selected/);
 assert.match(html,/固定的规则、人物与日程/);
 assert.doesNotMatch(html,/id="new-main"/);
 for(const set of ['FS','BTX','MZ','MC']){
  const advanced=newGameModal(state,'heroes',set,{advancedOpen:true,seed:14});
  assert.match(advanced,/<details class="setup-options" id="new-advanced" open>/);
  assert.equal((advanced.match(/id="new-sub-/g)||[]).length,set==='FS'?1:2);
  assert.match(advanced,/id="new-main"/);assert.match(advanced,/保证人工智能（AI）登场/);
  assert.match(advanced,/每轮回天数/);assert.match(advanced,/事件数/);
  assert.doesNotMatch(advanced,/主规则|副规则/);
 }
});

test('set switches keep compatible rule choices and clear incompatible or duplicate rule X choices',()=>{
 const subs=plotsFor('BTX','X');
 const btx=normalizeGameSetup('BTX',{mainPlot:'murder_plan',subPlots:[subs[0].id,subs[0].id],days:7,includeAI:true});
 assert.equal(btx.mainPlot,'murder_plan');assert.deepEqual(btx.subPlots,[subs[0].id,'']);
 const mz=normalizeGameSetup('MZ',btx);
 assert.equal(mz.ruleset,'MZ');assert.equal(mz.mainPlot,'');assert.deepEqual(mz.subPlots,['','']);
 assert.equal(mz.days,7);assert.equal(mz.includeAI,true);
 const fs=normalizeGameSetup('FS',mz);assert.equal(fs.subPlots.length,1);
});

test('opening constraints leave random secrets to the server and preserve partially random plots',()=>{
 const x=plotsFor('MZ','X')[0].id;
 const options=generationOptions('MZ',{days:'6',loops:'4',seed:'123',incidentCount:'3',subPlots:[x,''],characterPool:'all',includeAI:true,incidentVisibility:'public',communication:'allowed_during_loop'});
 assert.deepEqual(options,{ruleset:'MZ',title:'未曾发生的明天',days:6,loops:4,seed:123,incidentCount:3,subPlots:[x,''],characterPool:'all',includeAI:true,incidentVisibility:'public',communication:'allowed_during_loop'});
 for(const key of ['roles','characters','incidents','mainPlot'])assert.ok(!(key in options));
 const random=generationOptions('BTX',{seed:14});assert.ok(!('subPlots' in random));
});

test('public schedule and exports honor the chosen visibility without exposing culprits or disguise truth',()=>{
 const script={...structuredClone(starter),ruleset:'MZ',settings:{incidentVisibility:'public'},incidents:[{day:2,type:'fake_incident',publicType:'suicide',culprit:'doctor'}]};
 const exported=publicDraft(script);assert.deepEqual(exported.incidents,[{day:2,type:'suicide'}]);
 const html=printableHtml(script,false),schedule=html.split('<h2>事件日程</h2>')[1];
 assert.match(schedule,/自杀/);assert.doesNotMatch(schedule,/伪装事件|医生/);
 const v=player();v.script=exported;assert.match(incidentSchedule(v),/自杀/);assert.doesNotMatch(incidentSchedule(v),/犯人/);
 script.settings.incidentVisibility='hidden';assert.deepEqual(publicDraft(script).incidents,[{day:2}]);
 assert.match(printableHtml(script,false),/事件未公开/);
});

test('workshop fake incident editing adds or removes only its public disguise',()=>{
 let d={...structuredClone(starter),ruleset:'MZ',incidents:[{day:2,type:'fake_incident',culprit:'doctor'}]};
 d=editDraft(d,{kind:'disguise',key:'2',value:'suicide'});
 assert.deepEqual(d.incidents,[{day:2,type:'fake_incident',publicType:'suicide',culprit:'doctor'}]);
 const html=editorHtml({...state,editor:{...state.editor,text:JSON.stringify(d)}});
 assert.match(html,/第 2 日 · 对主人公公开的名称/);assert.match(html,/data-edit="disguise"/);
 d=editDraft(d,{kind:'incident',key:'2',value:'confession'});assert.equal(d.incidents[0].publicType,undefined);
 d=editDraft(d,{kind:'field',key:'ruleset',value:'BTX'});assert.equal(d.incidents[0].publicType,undefined);
});

test('MZ declarations never force a false role or quota deduction',()=>{
 const v=player();v.script.ruleset='MZ';v.knownRoles={doctor:'key_person'};
 v.log.push({type:'ability',who:'doctor',ability:0},{type:'refused',who:'doctor'});
 let a=analyze(v,emptyMarks());assert.equal(a.manualOnly,true);assert.equal(a.plots.subCount,2);assert.equal(a.combos,105);
 const doctor=a.rows.find(r=>r.id==='doctor');
 assert.equal(doctor.confirmed,false);assert.equal(doctor.pick,null);assert.match(doctor.note,/已宣告.*可能是伪装/);
 assert.ok(Object.values(doctor.cells).every(c=>c.mark===''&&!c.locked));assert.deepEqual(a.hints,[]);
 assert.ok(a.roles.every(r=>r.uncertain&&!r.hidden));
 a=analyze(v,markRole(emptyMarks(),'doctor','ninja','yes'));
 assert.equal(a.rows.find(r=>r.id==='doctor').pick,'ninja');assert.equal(a.combos,105);
 const sheet=sideBodyHtml(v,{tab:'sheet',analysis:a,tool:'no',aiFeed:[]});assert.match(sheet,/MZ 中角色公开可能是伪装/);
 const intel=sideBodyHtml(v,{tab:'intel',aiFeed:[]});assert.match(intel,/已宣告的角色/);
 v.actions=[{command:{type:'guess',character:'doctor',role:'key_person'}},{command:{type:'guess',character:'doctor',role:'ninja'}}];
 const [group]=choiceGroups(v,analyze(v,emptyMarks()));assert.match(group.detail,/可能是伪装/);assert.ok(group.items.every(it=>it.cls!=='known'));
});

test('MZ rule help, EX markers and new choice phases are usable without changing the board layout',()=>{
 const v=player();v.script.ruleset='MZ';v.board.doctor.extra=true;
 assert.match(boardHtml(v),/class="tag extra" title="EX 卡">EX/);
 const html=rulesHtml({rulesTab:'MZ'});assert.match(html,/规则 Y/);assert.match(html,/规则 X/);assert.match(html,/Midnight Zone/);
 for(const phase of ['extra_setup','reveal_role']){
  const choice={...v,mode:'mastermind',phaseId:phase,turn:'M',actions:[{command:{type:phase,target:'doctor'},label:'选择医生'}]};
  assert.match(turnGuidance(choice).detail,phase==='extra_setup'?/EX/:/公开/);
  assert.equal(choiceGroups(choice)[0].items[0].text,'选择医生');
 }
});

test('AI counter warning uses all its counters while retaining individual counter displays',()=>{
 const v=player();v.script.characters.push('ai_character');
 v.board.ai_character={...v.board.doctor,id:'ai_character',location:'city',goodwill:3,paranoia:0,intrigue:1,guard:0};
 const html=boardHtml(v);
 assert.match(html,/class="tok danger" data-character="ai_character"/);
 assert.match(html,/事件判定不安 4/);
});


test('the short guide distinguishes First Steps from sets with a final battle',()=>{
 const html=guideModal();assert.match(html,/FS 由剧作家获胜/);assert.match(html,/BTX \/ MZ \/ MC 还有最后的战斗/);assert.match(html,/指认全部配役/);
 assert.doesNotMatch(html,/每个轮回都失败，剧作家赢/);
});

test('AI simulation reveals only the selected hidden day and offers its target choices',()=>{
 const v=player();v.script.incidents=[{day:1,type:'murder'},{day:2,type:'suicide'},{day:3,type:'hospital_incident'}];
 v.knownIncidentTypes={2:'suicide'};
 const html=incidentSchedule(v);assert.match(html,/自杀/);assert.doesNotMatch(html,/谋杀|医院事件/);assert.equal((html.match(/事件未公开/g)||[]).length,2);
 const choice={...v,phaseId:'ai_target',turn:'A',actions:[{command:{type:'ai_target',target:'doctor'},label:'医生'}]};
 assert.match(turnGuidance(choice).detail,/已公开所选事件/);assert.equal(choiceGroups(choice)[0].title,'选择模拟事件的目标');assert.equal(choiceGroups(choice)[0].items[0].text,'医生');
 const config=newGameModal(state,'heroes','MZ',{advancedOpen:true});assert.match(config,/其他隐藏日程不变/);
});

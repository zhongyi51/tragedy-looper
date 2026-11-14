import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {catalog,starter,generateScript,validateScript} from '../src/content.mjs';
import {createGame,view} from '../src/engine.mjs';
import {setCatalog,plotsFor,rolesFor,incidentsFor,cardPreview} from '../public/js/lookup.mjs';
import {normalizeGameSetup,generationOptions} from '../public/js/game-setup.mjs';
import {newGameModal,characterModal} from '../public/js/ui/modals.mjs';
import {boardHtml} from '../public/js/ui/board.mjs';
import {hudHtml,stepper} from '../public/js/ui/hud.mjs';
import {sideBodyHtml} from '../public/js/ui/side.mjs';
import {rulesHtml} from '../public/js/ui/rules.mjs';
import {editorHtml} from '../public/js/ui/editor.mjs';
import {editDraft} from '../public/js/script-draft.mjs';
import {analyze,emptyMarks} from '../public/js/deduce.mjs';
import {turnGuidance,choiceGroups} from '../public/js/guidance.mjs';
import {offlineReplayHtml} from '../public/js/exporters.mjs';
import {validateReplay,sanitizePublicReplay} from '../public/replay-validation.mjs';

setCatalog(catalog);
const player=()=>({...view(createGame(starter),'A'),id:'mc-ui',mode:'heroes',budget:.5,spent:null});
const replay=v=>({format:'tragedy-replay-1',perspective:'public',frames:[{view:v}]});
const state={info:{configured:true},editor:{text:'',tab:'form',generator:{ruleset:'MC',seed:1,theme:''}}};

test('MC opening defaults to three incidents while explicit counts and partial rule choices survive',()=>{
 assert.equal(normalizeGameSetup('MC').incidentCount,3);
 const random=generationOptions('MC',{seed:77});assert.equal(random.ruleset,'MC');assert.equal(random.incidentCount,3);assert.ok(!('mainPlot'in random));assert.ok(!('roles'in random));
 assert.equal(generationOptions('MC',{seed:77,incidentCount:1}).incidentCount,1);
 const html=newGameModal(state,'heroes','MC',{advancedOpen:true});
 assert.match(html,/Mystery Circle/);assert.match(html,/name="new-script" value="MC" checked/);
 assert.equal((html.match(/id="new-sub-/g)||[]).length,2);
 assert.match(html,/私家侦探不能担任犯人/);
 assert.match(html,/id="new-incidents"[^>]*value="3"/);
});

test('new public replay fields are optional for old saves and validated when present',()=>{
 const old=replay(player());assert.doesNotThrow(()=>validateReplay(old,catalog));
 const cleared=structuredClone(old);cleared.frames[0].view.board.doctor.movementLockedDay=null;assert.doesNotThrow(()=>validateReplay(cleared,catalog));
 const data=structuredClone(old),v=data.frames[0].view;
 v.extraGauge=0;v.closedLocations={school:5};v.board.doctor.movementLockedDay=2;v.board.doctor.extra=true;v.knownIncidentTypes={3:'suicide'};
 assert.doesNotThrow(()=>validateReplay(data,catalog));assert.deepEqual(sanitizePublicReplay(data).frames[0].view.knownIncidentTypes,{3:'suicide'});
 const invalid=[
  x=>{x.extraGauge=-1;},x=>{x.extraGauge=1.5;},x=>{x.extraGauge='3';},
  x=>{x.closedLocations=['school'];},x=>{x.closedLocations={moon:2};},x=>{x.closedLocations={school:0};},x=>{x.closedLocations={school:'2'};},
  x=>{x.board.doctor.movementLockedDay=-1;},x=>{x.board.doctor.movementLockedDay=0;},x=>{x.board.doctor.movementLockedDay=true;},x=>{x.board.doctor.extra=1;},
  x=>{x.knownIncidentTypes=[];},x=>{x.knownIncidentTypes={0:'suicide'};},x=>{x.knownIncidentTypes={4:'suicide'};},x=>{x.knownIncidentTypes={'03':'suicide'};},x=>{x.knownIncidentTypes={3:'not-an-event'};}
 ];
 for(const change of invalid){const bad=structuredClone(data);change(bad.frames[0].view);assert.throws(()=>validateReplay(bad,catalog));}
});

test('MC public counters and temporary restrictions remain visible without revealing roles',()=>{
 const v=player();v.extraGauge=2;v.closedLocations={school:3,hospital:0};v.board.doctor.movementLockedDay=1;
 assert.match(hudHtml(v),/本轮回的 EX 计数[\s\S]*<b>2<\/b>/);
 const board=boardHtml(v);assert.match(board,/封锁至第 3 日/);assert.match(board,/移动禁止/);assert.doesNotMatch(board,/角色：|真相 · 只有你知道/);
 const info=sideBodyHtml(v,{tab:'intel',aiFeed:[]});assert.match(info,/EX 计数：2/);assert.match(info,/学校封锁至第 3 日/);assert.doesNotMatch(info,/医院封锁/);
 assert.match(characterModal('doctor',v),/第 1 日不能移动/);
 v.day=4;assert.doesNotMatch(boardHtml(v),/封锁至第 3 日|移动禁止/);
});

test('HUD exposes a simulation-revealed day but keeps other legacy hidden schedule types concealed',()=>{
 const v=player();v.script.incidents=[{day:1,type:'murder'},{day:2,type:'suicide'},{day:3,type:'hospital_incident'}];v.knownIncidentTypes={2:'suicide'};
 const html=hudHtml(v);assert.match(html,/第 2 日 · 自杀/);assert.doesNotMatch(html,/谋杀|医院事件/);
});

test('offline replay renders EX, closure expiry and movement locks from the viewed frame',()=>{
 const v=player();v.extraGauge=3;v.closedLocations={school:3};v.board.doctor.movementLockedDay=2;v.board.doctor.extra=true;
 const later=structuredClone(v);later.day=4;later.extraGauge=0;later.board.doctor.extra=false;
 const data=replay(v);data.frames.push({view:later});
 const html=offlineReplayHtml(data),source=html.match(/<script>([\s\S]*)<\/script>/)[1],rows=[];
 const nodes={range:{value:'0'},phase:{},conditions:{},log:{},board:{replaceChildren(){rows.length=0;},insertRow(){const row={cells:[],append(cell){this.cells.push(cell);},insertCell(){const cell={};this.cells.push(cell);return cell;}};rows.push(row);return row;}}};
 for(const id of Object.keys(nodes))assert.ok(html.includes('id="'+id+'"'),'artifact contains '+id);
 runInNewContext(source,{document:{getElementById:id=>nodes[id],createElement:()=>({})}});
 assert.equal(nodes.conditions.textContent,'EX 计数：3 · 学校封锁至第 3 日');
 const doctor=rows.find(r=>r.cells[0]?.textContent==='医生');assert.equal(doctor.cells[2].textContent,'存活 · EX 卡 · 第 2 日不能移动');
 assert.doesNotMatch(nodes.log.textContent,/doctor.*brain/);
 nodes.range.value='1';nodes.range.oninput();
 assert.equal(nodes.conditions.textContent,'EX 计数：0');assert.equal(rows.find(r=>r.cells[0]?.textContent==='医生').cells[2].textContent,'存活');
});


test('MC catalog drives rule choices, workshop editing and all 105 initial deduction combinations',()=>{
 const script=generateScript({ruleset:'MC',seed:77,incidentCount:3}),v={...view(createGame(script),'A'),mode:'heroes'};
 assert.deepEqual(validateScript(script).errors,[]);
 const setup=normalizeGameSetup('MC',{mainPlot:script.mainPlot,subPlots:[script.subPlots[0],'']});
 assert.equal(setup.mainPlot,script.mainPlot);assert.deepEqual(setup.subPlots,[script.subPlots[0],'']);
 const analysis=analyze(v,emptyMarks());assert.equal(analysis.combos,105);assert.equal(analysis.manualOnly,false);assert.equal(analysis.plots.subCount,2);assert.equal(analysis.roles.length,14);
 const who=script.characters[0];v.knownRoles[who]='private_investigator';
 const known=analyze(v,emptyMarks()).rows.find(r=>r.id===who);assert.equal(known.confirmed,true);assert.equal(known.cells.private_investigator.mark,'yes');assert.ok(Object.values(known.cells).every(c=>c.locked));
 const rules=rulesHtml({rulesTab:'MC'});assert.match(rules,/Mystery Circle（谜之环）/);assert.match(rules,/私家侦探/);assert.match(rules,/公共 EX 计数/);assert.match(rules,/最后的战斗/);
 const d=editDraft(starter,{kind:'field',key:'ruleset',value:'MC'});assert.equal(d.subPlots.length,2);assert.ok(plotsFor('MC','Y').some(p=>p.id===d.mainPlot));assert.ok(d.subPlots.every(id=>plotsFor('MC','X').some(p=>p.id===id)));
 const html=editorHtml({...state,editor:{...state.editor,text:JSON.stringify(script)}});assert.match(html,/value="MC" selected/);assert.match(html,/私家侦探不能担任犯人/);
});

test('MC mandatory end-of-day choices remain operable and carry the normal phase marker',()=>{
 const v=player();Object.assign(v,{phaseId:'end_forced',phase:'日结束',turn:'M',mode:'mastermind',actions:[
  {command:{type:'end_forced',index:0,target:'doctor'},label:'选择医生'},
  {command:{type:'end_forced',index:0,target:'idol'},label:'选择偶像'}
 ]});
 assert.match(turnGuidance(v).detail,/日结束时的强制效果/);
 const [group]=choiceGroups(v);assert.equal(group.title,'日结束结算');assert.deepEqual(group.items.map(i=>[i.i,i.text,i.hl]),[[0,'选择医生','doctor'],[1,'选择偶像','idol']]);
 assert.match(stepper(v),/aria-current="step"><span>日结束<\/span>/);
});

test('movement previews respect MC origin closure, destination closure and the next-day letter lock',()=>{
 const v=player(),card='move_h#0',from=v.board.doctor.location;
 v.closedLocations={[from]:3};assert.equal(cardPreview(card,'doctor',v),'地点封锁');
 v.closedLocations={shrine:3};assert.equal(cardPreview(card,'doctor',v),'地点封锁');
 v.closedLocations={};v.board.doctor.movementLockedDay=2;assert.equal(cardPreview(card,'doctor',v),'→ 神社');
 v.day=2;assert.equal(cardPreview(card,'doctor',v),'移动禁止');
 v.day=3;assert.equal(cardPreview(card,'doctor',v),'→ 神社');
});

test('workshop can reuse a culprit for consecutive serial murders without selecting an empty culprit',()=>{
 const d={...structuredClone(starter),ruleset:'MC',days:7,characters:['doctor','idol','boy_student','girl_student'],incidents:[
  {day:1,type:'serial_murder',culprit:'doctor'},
  {day:2,type:'unease',culprit:'idol'},
  {day:3,type:'suicide',culprit:'boy_student'},
  {day:4,type:'missing',culprit:'girl_student'}
 ]};
 const edited=editDraft(d,{kind:'incident',key:'5',value:'serial_murder'});assert.deepEqual(edited.incidents.at(-1),{day:5,type:'serial_murder',culprit:'doctor'});
});

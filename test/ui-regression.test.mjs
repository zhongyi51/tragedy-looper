import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {catalog,starter} from '../src/content.mjs';
import {createGame,view} from '../src/engine.mjs';
import {validateReplay,sanitizePublicReplay} from '../public/replay-validation.mjs';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderFunctions(){const context={catalog,esc,glyph:{move_h:'↔'},name:id=>catalog.incidents.find(e=>e.id===id)?.name_zh_working||id};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const seatName='),source.indexOf('function game(')),context);return context;}
test('board cards render backs without hidden names and reveal only at resolution',()=>{
 const c=renderFunctions(),p={seat:'M',target:'doctor'},v={phaseId:'hero_cards',placements:[p],revealedCards:[]};
 let html=c.boardPlacement(v,p);assert.match(html,/card-back/);assert.doesNotMatch(html,/face-up/);assert.match(html,/牌面未公开/);assert.doesNotMatch(html,/横向移动/);
 v.phaseId='cultist';v.revealedCards=[{...p,card:'move_h#0'}];html=c.boardPlacement(v,p);assert.match(html,/face-up/);assert.match(html,/↔/);assert.match(html,/M:doctor/);
});
test('public schedule hides event names even when an imported old snapshot carries type',()=>{
 const c=renderFunctions(),v=view(createGame(starter),'public');v.script.incidents=structuredClone(starter.incidents);
 const html=c.incidentSchedule(v);assert.match(html,/事件未公开/);for(const e of starter.incidents)assert.ok(!html.includes(c.name(e.type)));
 v.seat='M';assert.ok(c.incidentSchedule(v).includes(c.name(starter.incidents[0].type)));
});
test('public exports and printouts contain dates without event types or culprits',()=>{
 let output;const c={esc,name:id=>id,download:value=>output=value};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function publicDraft('),source.indexOf('function offlineReplay(')),c);
 const exported=c.publicDraft(starter);assert.ok(exported.incidents.every(e=>Object.keys(e).length===1&&'day'in e));
 c.printable(starter,false);assert.match(output,/事件未公开/);for(const e of starter.incidents){assert.ok(!output.includes(e.type));assert.ok(!output.split('<h2>事件日程</h2>')[1].includes(e.culprit));}
 c.printable(starter,true);assert.ok(output.includes(starter.incidents[0].type));assert.ok(output.includes(starter.incidents[0].culprit));
});
test('replay import accepts concealed schedules and rejects an unknown supplied event type',()=>{
 const r={format:'tragedy-replay-1',frames:[{view:view(createGame(starter),'public')}]};
 assert.doesNotThrow(()=>validateReplay(r,catalog));r.frames[0].view.script.incidents[0].type='not-an-event';assert.throws(()=>validateReplay(r,catalog));
});

test('idle AI and revealed-card handoff give explicit actionable prompts',()=>{
 const c=renderFunctions();Object.assign(c,{working:false,auto:false,actionError:'',btn:(label,action)=>`<button data-do="${action}">${label}</button>`});
 const v={mode:'heroes',turn:'M',phaseId:'cultist',winner:null};
 assert.equal(c.turnGuidance(v).title,'等待你启动 AI');assert.match(c.coreTurn(v),/让 AI 完成结算/);assert.match(c.coreTurn(v),/data-do="auto"/);
 v.mode='mastermind';assert.match(c.turnGuidance(v).title,/轮到你/);assert.match(c.turnGuidance(v).detail,/执行选择/);assert.doesNotMatch(c.coreTurn(v),/data-do="auto"/);
 c.working=true;c.auto=true;assert.match(c.turnGuidance(v).title,/AI 正在处理/);
});
test('legacy public replay names are stripped at import/export without changing full replay',()=>{
 const v=view(createGame(starter),'public');v.script.incidents=structuredClone(starter.incidents);v.log.push({type:'incident',day:2,text:'预告的「医院事件」没有发生。'});
 const data={perspective:'public',script:structuredClone(starter),frames:[{view:v}]},clean=sanitizePublicReplay(data);
 assert.ok(clean.script.incidents.every(e=>Object.keys(e).length===1));assert.ok(clean.frames[0].view.script.incidents.every(e=>Object.keys(e).length===1));assert.equal(clean.frames[0].view.log.at(-1).text,'第 2 日预告的事件没有发生。');assert.equal(data.frames[0].view.log.at(-1).text,'预告的「医院事件」没有发生。');
 const full={perspective:'M',script:structuredClone(starter),frames:[{view:view(createGame(starter),'M')}]};assert.deepEqual(sanitizePublicReplay(full),full);
});
test('revealing cards completes on old board before any character movement starts',async()=>{
 const prev={id:'game',day:1,loop:1,board:{doctor:{location:'hospital'}},revealedCards:[]},next={...prev,board:{doctor:{location:'school'}},revealedCards:Array(6).fill({})};
 let finishCards;const stages=[],c={reduced:()=>false,page:'game',Element:{prototype:{animate(){}}},transitionView:null,g:next,document:{querySelectorAll:()=>[]}};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('const boardPositions='),source.indexOf('function newModal(')),c);
 c.render=()=>stages.push(c.transitionView?.board===prev.board?'old-board':'new-board');c.animateCards=async()=>{stages.push('flip-start');await new Promise(resolve=>{finishCards=resolve;});stages.push('flip-end');};c.animateBoardChanges=async()=>stages.push('move-start');
 const pending=c.animateTransition(prev,next,{},null);await Promise.resolve();assert.deepEqual(stages,['old-board','flip-start']);finishCards();await pending;
 assert.deepEqual(stages,['old-board','flip-start','flip-end','new-board','move-start']);assert.equal(c.transitionView,null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,starter,validateScript} from '../src/content.mjs';
import {createGame,view,applyCommand,advanceAutomatic,legalActions} from '../src/engine.mjs';
import {settlementHtml} from '../public/js/ui/settlement.mjs';
import {validateReplay,sanitizePublicReplay} from '../public/replay-validation.mjs';
import {setCatalog,name,cardPreview} from '../public/js/lookup.mjs';
import {cardsOn,boardHtml} from '../public/js/ui/board.mjs';
import {incidentSchedule,sideTabsHtml,sideBodyHtml} from '../public/js/ui/side.mjs';
import {dockHtml} from '../public/js/ui/dock.mjs';
import {hudHtml} from '../public/js/ui/hud.mjs';
import {turnGuidance,turnControl,choiceGroups} from '../public/js/guidance.mjs';
import {publicDraft,printableHtml} from '../public/js/exporters.mjs';
import {createAnimator} from '../public/js/anim.mjs';
import {createSession,outcomeBanner} from '../public/js/session.mjs';
import {parseDraft,blankDraft,roleNeeds,editDraft} from '../public/js/script-draft.mjs';

setCatalog(catalog);
test('ability results remain in the dock after automatic day advance and reload',()=>{
 const s=createGame(starter);s.phase='hero_ability';s.board.boy_student.goodwill=2;s.board.girl_student.paranoia=1;
 const action=legalActions(s).find(a=>a.command.actor==='boy_student').command;
 const next=advanceAutomatic(applyCommand(s,'A',action)).state;
 assert.equal(next.day,2);assert.equal(next.board.girl_student.paranoia,0);
 const v={...view(next,'A'),mode:'heroes'};
 const html=settlementHtml(v);assert.match(html,/友好能力 1 开始结算/);assert.match(html,/女学生 · 不安 -1/);
 assert.match(html,/日结束：结算强制效果/);assert.match(dockHtml(v,{}),/最近结算/);
 assert.equal(settlementHtml(JSON.parse(JSON.stringify(v))),html);
 assert.equal(settlementHtml({log:[]}), '');
 assert.match(settlementHtml({log:[{type:'phase',loop:1,day:1,text:'<script>bad</script>'}]}), /&lt;script&gt;/);
});

test('a human ability decision renders choices and cannot trigger automatic opponent play',async()=>{
 const s=createGame(starter);s.phase='hero_ability';s.board.boy_student.goodwill=2;s.board.girl_student.paranoia=1;
 const g={...view(s,'A'),id:'ability-game',mode:'heroes'};
 assert.match(dockHtml(g,{}),/class="choice /);assert.match(dockHtml(g,{}),/男学生/);
 const state={g,page:'game',autoPlay:true,aiFeed:[]},routes=[];
 const client=createSession({state,api:async route=>{routes.push(route);return g;},render:()=>{},storage:{getItem:()=>null,setItem:()=>{}},wait:async()=>{}});
 client.kick();assert.deepEqual(routes,[]);await client.runAuto();
 assert.deepEqual(routes,['/games/ability-game/advance']);assert.equal(state.g.phaseId,'hero_ability');
});
const table=(mode,seat,s=createGame(starter))=>({...view(s,seat),id:'game',mode,budget:.5,spent:null,aiConfigured:true,busy:false});

test('board cards render backs without hidden names and reveal only at resolution',()=>{
 const p={seat:'M',target:'doctor'},v={phaseId:'hero_cards',placements:[p],revealedCards:[]};
 let html=cardsOn(v,'doctor');assert.match(html,/mini-back/);assert.doesNotMatch(html,/face-up/);assert.match(html,/牌面未公开/);assert.doesNotMatch(html,/横移/);
 v.phaseId='cultist';v.revealedCards=[{...p,card:'move_h#0'}];html=cardsOn(v,'doctor');assert.match(html,/face-up/);assert.match(html,/横移/);assert.match(html,/data-placement="M:doctor"/);
 v.placements=[];html=cardsOn(v,'doctor');assert.match(html,/resolved/);assert.match(html,/已结算/);
});
test('own face-down cards are readable to their owner only',()=>{
 const s=applyCommand(createGame(starter),'M',{type:'place',card:'paranoia_1#0',target:'doctor'});
 const mine=cardsOn(view(s,'M'),'doctor'),theirs=cardsOn(view(s,'A'),'doctor');
 assert.match(mine,/class="mini mm own/);assert.match(mine,/对手看不到牌面/);assert.match(theirs,/牌面未公开/);assert.doesNotMatch(theirs,/不安/);
});
test('public schedule hides event names even when an imported old snapshot carries type',()=>{
 const v=view(createGame(starter),'public');v.script.incidents=structuredClone(starter.incidents);
 const html=incidentSchedule(v);assert.match(html,/事件未公开/);for(const e of starter.incidents)assert.ok(!html.includes(name(e.type)));
 v.seat='M';assert.ok(incidentSchedule(v).includes(name(starter.incidents[0].type)));
});
test('public exports and printouts contain dates without event types or culprits',()=>{
 const exported=publicDraft(starter);assert.ok(exported.incidents.every(e=>Object.keys(e).length===1&&'day'in e));assert.ok(!('roles'in exported)&&!('mainPlot'in exported));
 let output=printableHtml(starter,false);assert.match(output,/事件未公开/);
 for(const e of starter.incidents){assert.ok(!output.includes(name(e.type)));assert.ok(!output.split('<h2>事件日程</h2>')[1].includes(name(e.culprit)));}
 output=printableHtml(starter,true);assert.ok(output.includes(name(starter.incidents[0].type)));assert.ok(output.split('<h2>事件日程</h2>')[1].includes(name(starter.incidents[0].culprit)));
});
test('replay import accepts concealed schedules and rejects an unknown supplied event type',()=>{
 const r={format:'tragedy-replay-1',frames:[{view:view(createGame(starter),'public')}]};
 assert.doesNotThrow(()=>validateReplay(r,catalog));r.frames[0].view.script.incidents[0].type='not-an-event';assert.throws(()=>validateReplay(r,catalog));
});

test('idle AI and revealed-card handoff give explicit actionable prompts',()=>{
 const v={mode:'heroes',turn:'M',phaseId:'cultist',phase:'行动结算',winner:null,actions:[{command:{type:'cultist'}}]};
 assert.equal(turnGuidance(v).title,'等待你启动 AI');assert.deepEqual({...turnControl(v)},{action:'auto',label:'让 AI 继续',disabled:false,icon:'play'});
 v.mode='mastermind';assert.match(turnGuidance(v).title,/轮到你/);assert.match(turnGuidance(v).detail,/选择结算方式/);assert.notEqual(turnControl(v)?.action,'auto');
 const busy={working:true,auto:true,requestKind:'rules'};assert.match(turnGuidance(v,busy).title,/规则结算/);assert.doesNotMatch(turnGuidance(v,busy).title,/AI/);
 assert.equal(turnControl({...v,mode:'heroes'},{auto:true,working:true}).label,'暂停对手');
 assert.equal(turnControl(v,{syncRequired:true}).action,'sync-state');
});
test('the dock offers the hand to the seat on turn and only a pause switch otherwise',()=>{
 const ctx={selected:null,peekSeat:null,working:false,auto:false,syncRequired:false,actionError:'',aiFeed:[]};
 const mm=dockHtml(table('mastermind','M'),ctx);assert.match(mm,/class="dock human placing"/);assert.equal((mm.match(/class="hcard /g)||[]).length,view(createGame(starter),'M').hand.length);assert.doesNotMatch(mm,/data-do="auto"/);
 const waiting=dockHtml(table('heroes','A'),ctx);assert.match(waiting,/data-do="auto"/);assert.doesNotMatch(waiting,/class="hcard /);
 const watching=dockHtml(table('observe','public'),ctx);assert.match(watching,/data-do="auto"/);assert.doesNotMatch(watching,/data-do="bot"/);
});
test('selecting a card highlights exactly the legal targets with an effect preview',()=>{
 const s=createGame(starter),v=view(s,'M'),card=v.hand.find(c=>c.type==='move_h').id,targets=new Set(v.actions.filter(a=>a.command.card===card).map(a=>a.command.target));
 const html=boardHtml(v,{selected:card,targets});
 assert.equal((html.match(/class="tok targetable/g)||[]).length,starter.characters.length);assert.equal((html.match(/class="zone zone-\w+ targetable/g)||[]).length,4);
 assert.equal(cardPreview(card,'doctor',v),'→ 神社');assert.equal(cardPreview(card,'hospital',v),'佯动');
});
test('the table never leaks hidden roles into a protagonist or spectator view',()=>{
 for(const seat of ['A','public']){
  const v=table(seat==='A'?'heroes':'observe',seat),html=boardHtml(v)+hudHtml(v,{autoPlay:true})+sideTabsHtml(v,{tab:'intel'})+['intel','log','sheet','ref'].map(tab=>sideBodyHtml(v,{tab,aiFeed:[],sheet:{}})).join('');
  assert.doesNotMatch(html,/class="tag role/);assert.doesNotMatch(html,/剧作家幕布/);assert.doesNotMatch(html,/tag culprit/);
 }
 const mm=table('mastermind','M'),html=boardHtml(mm)+sideBodyHtml(mm,{tab:'intel',aiFeed:[],sheet:{}});
 assert.match(html,/class="tag role secret"/);assert.match(html,/tag culprit/);assert.match(html,/剧作家幕布/);
});
test('legacy public replay names are stripped at import/export without changing full replay',()=>{
 const v=view(createGame(starter),'public');v.script.incidents=structuredClone(starter.incidents);v.log.push({type:'incident',day:2,text:'预告的「医院事件」没有发生。'});
 const data={perspective:'public',script:structuredClone(starter),frames:[{view:v}]},clean=sanitizePublicReplay(data);
 assert.ok(clean.script.incidents.every(e=>Object.keys(e).length===1));assert.ok(clean.frames[0].view.script.incidents.every(e=>Object.keys(e).length===1));assert.equal(clean.frames[0].view.log.at(-1).text,'第 2 日预告的事件没有发生。');assert.equal(data.frames[0].view.log.at(-1).text,'预告的「医院事件」没有发生。');
 const full={perspective:'M',script:structuredClone(starter),frames:[{view:view(createGame(starter),'M')}]};assert.deepEqual(sanitizePublicReplay(full),full);
});

function animator(stages,{reduced=()=>false,cards,changes}={}){
 const state={page:'game',transitionView:null,g:null,requestKind:''};
 const fx={supported:()=>true,positions:()=>({}),cards:cards||(async(_prev,next)=>{stages.push('cards:'+next.revision);}),changes:changes||(async(_prev,next)=>{stages.push('changes:'+next.revision);})};
 return {state,fx,...createAnimator({state,fx,reduced,render:()=>stages.push(state.transitionView?'render:'+(state.transitionView.board===state.old?'old-board':'new-board'):'render:live')})};
}
test('revealing cards completes on old board before any character movement starts',async()=>{
 const prev={id:'game',day:1,loop:1,board:{doctor:{location:'hospital'}},revealedCards:[],log:[]},next={...prev,board:{doctor:{location:'school'}},revealedCards:Array(6).fill({})};
 let finishCards;const stages=[];
 const a=animator(stages,{cards:async()=>{stages.push('flip-start');await new Promise(resolve=>{finishCards=resolve;});stages.push('flip-end');},changes:async()=>{stages.push('move-start');}});
 a.state.g=next;a.state.old=prev.board;
 const pending=a.animateTransition(prev,next,{},[]);await Promise.resolve();assert.deepEqual(stages,['render:old-board','flip-start']);finishCards();await pending;
 assert.deepEqual(stages,['render:old-board','flip-start','flip-end','render:new-board','move-start']);assert.equal(a.state.transitionView,null);
});
test('public transition frames play reveal, movement, counters and final state in order',async()=>{
 const prev={id:'game',revision:5,day:1,loop:1,board:{doctor:{location:'hospital'}},revealedCards:[],log:[]};
 const reveal={...prev,revision:6,phaseId:'cultist',board:{doctor:{location:'school'}},revealedCards:Array(6).fill({})},counters={...reveal,revision:7,phaseId:'mm_ability',placements:[]},next={...counters,revision:8,phaseId:'hero_ability'};
 const stages=[];let a=animator(stages);a.state.g=next;
 await a.animateTransition(prev,next,{},[reveal,counters,next]);assert.deepEqual(stages.filter(x=>!x.startsWith('render')),['cards:6','changes:6','cards:7','changes:7','cards:8','changes:8']);assert.equal(a.state.transitionView,null);
 stages.length=0;a=animator(stages,{reduced:()=>true});a.state.g=next;await a.animateTransition(prev,next,{},[reveal,counters,next]);assert.deepEqual(stages,[]);
 stages.length=0;a=animator(stages);a.state.g=next;a.state.page='rules';await a.animateTransition(prev,next,{},[reveal,counters,next]);assert.deepEqual(stages,[]);
});

function session(overrides={}){
 const state={page:'game',working:false,auto:false,syncRequired:false,g:{id:'game',mode:'heroes',turn:'M',revision:6,phaseId:'cultist',winner:null,log:[],loop:1,day:1,script:{loops:3}},advancedRevision:'',info:{configured:true},aiFeed:[],banner:null,pendingOutcome:null,autoPlay:true,requestKind:'',actionError:'',actionErrorCode:'',selected:null,peekSeat:null,transitionView:null,...overrides.state};
 const calls=[],store=new Map(Object.entries(overrides.storage||{}));
 const s=createSession({state,render(){},wait:overrides.wait||(async()=>{}),uuid:()=>'once-only',storage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},
  api:async(url,data)=>{calls.push({url,data});return overrides.api(url,data,state,calls);}});
 return {state,calls,...s};
}
test('automatic continuation stops after forced victory or a pause during settlement',async()=>{
 for(const finish of ['victory','pause']){
  const c=session({api:(url,data,state)=>{if(finish==='pause')state.auto=false;return {...state.g,revision:7,winner:finish==='victory'?'heroes':null};}});
  await c.runAuto();assert.deepEqual(c.calls.map(x=>x.url),['/games/game/advance']);assert.equal(c.state.auto,false);assert.equal(c.state.working,false);
 }
});
test('automatic play hands back to the human seat and uses the chosen opponent',async()=>{
 for(const [stored,route] of [[{},'ai-step'],[{'tl-opp-game':'bot'},'bot-step']]){
  const c=session({storage:stored,state:{g:{id:'game',mode:'heroes',turn:'M',revision:1,phaseId:'mm_cards',winner:null,log:[],loop:1,day:1,script:{loops:3}}},
   api:(url,data,state)=>({...state.g,revision:state.g.revision+1,turn:state.g.revision>=3?'A':'M',phaseId:state.g.revision>=3?'hero_cards':'mm_cards'})});
  await c.runAuto();assert.deepEqual(c.calls.map(x=>x.url),Array(3).fill('/games/game/'+route));assert.equal(c.state.g.turn,'A');assert.equal(c.state.auto,false);
  assert.ok(c.calls.every(x=>x.data.commandId==='once-only'&&x.data.command===undefined));
 }
});
test('AI remarks are kept with the moment they were made and the outcome is announced once',async()=>{
 const c=session({wait:()=>new Promise(()=>{}),api:(url,data,state)=>({...state.g,revision:7,phaseId:'between',log:[{n:1,type:'death',text:'女学生死亡。'}],decision:{controller:'AI',seat:'M',reason:'先压不安。'}})});
 await c.step(undefined,'ai-step');
 assert.deepEqual(c.state.aiFeed,[{gameId:'game',seat:'M',text:'先压不安。',loop:1,day:1,at:0}]);assert.equal(c.state.banner.kind,'loop');assert.match(c.state.banner.title,/第 1 轮回失败/);assert.equal(c.state.pendingOutcome,null);
 const base={mode:'heroes',winner:null,loop:3,log:[],script:{loops:3}};
 assert.match(outcomeBanner(base,{...base,winner:'heroes'}).lines[0],/你赢了/);assert.match(outcomeBanner(base,{...base,winner:'mastermind'}).lines[0],/你输了/);
 assert.doesNotMatch(outcomeBanner({...base,mode:'observe'},{...base,mode:'observe',winner:'heroes'}).lines[0],/你/);assert.equal(outcomeBanner(base,{...base,log:[{n:1,type:'move',text:'x'}]}),null);
});
test('final guess choices mark roles the protagonists already confirmed',()=>{
 const s=createGame(starter);s.script.ruleset='BTX';s.phase='guess';s.guessed={};s.knownRoles={office_worker:'killer'};
 const v=view(s,'A'),groups=choiceGroups(v),office=groups.find(gr=>gr.items.some(it=>v.actions[it.i].command.character==='office_worker'));
 assert.match(office.detail,/已确认/);
 assert.equal(office.items.filter(it=>it.cls==='known').map(it=>v.actions[it.i].command.role).join(),'killer');
 assert.ok(groups.filter(gr=>gr!==office).every(gr=>gr.items.every(it=>!it.cls)));
});
test('workshop form edits keep a script draft valid and report role quotas',()=>{
 let d=parseDraft(JSON.stringify(starter));assert.ok(roleNeeds(d).every(n=>n.ok));
 const [who,role]=Object.entries(d.roles).find(([,r])=>r!=='person');
 d=editDraft(d,{kind:'role',key:who,value:'person'});assert.equal(roleNeeds(d).find(n=>n.role===role).ok,false);
 d=editDraft(d,{kind:'role',key:who,value:role});assert.ok(roleNeeds(d).every(n=>n.ok));assert.deepEqual(d,parseDraft(JSON.stringify(starter)));
 const spare='police';
 d=editDraft(d,{kind:'cast',key:spare});assert.ok(d.characters.includes(spare));assert.equal(d.roles[spare],'person');
 d=editDraft(d,{kind:'cast',key:spare});assert.ok(!d.characters.includes(spare));assert.ok(!(spare in d.roles));
 d=editDraft(d,{kind:'field',key:'title',value:'新的惨剧'});assert.equal(d.title,'新的惨剧');assert.deepEqual(validateScript(d).errors,[]);
 assert.notEqual(validateScript(blankDraft()).errors.length,0);assert.equal(parseDraft('{oops'),null);
});

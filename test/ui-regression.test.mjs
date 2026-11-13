import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,starter,validateScript} from '../src/content.mjs';
import {createGame,view,applyCommand} from '../src/engine.mjs';
import {validateReplay,sanitizePublicReplay} from '../public/replay-validation.mjs';
import {setCatalog,name,cardPreview} from '../public/js/lookup.mjs';
import {cardsOn,boardHtml} from '../public/js/ui/board.mjs';
import {incidentSchedule,sideTabsHtml,sideBodyHtml} from '../public/js/ui/side.mjs';
import {dockHtml} from '../public/js/ui/dock.mjs';
import {hudHtml} from '../public/js/ui/hud.mjs';
import {turnGuidance,turnControl,choiceGroups,afterPlacing} from '../public/js/guidance.mjs';
import {publicDraft,printableHtml} from '../public/js/exporters.mjs';
import {createAnimator} from '../public/js/anim.mjs';
import {analyze,emptyMarks,markRole,markPlot,markCulprit,clues,failure} from '../public/js/deduce.mjs';
import {tableRegions} from '../public/js/ui/game.mjs';
import {playStep,stepReport,project} from '../src/play.mjs';
import {createSession,outcomeBanner} from '../public/js/session.mjs';
import {bannerHtml} from '../public/js/ui/modals.mjs';
import {parseDraft,blankDraft,roleNeeds,editDraft} from '../public/js/script-draft.mjs';

setCatalog(catalog);
const table=(mode,seat,s=createGame(starter))=>({...view(s,seat),id:'game',mode,budget:.5,spent:null,aiConfigured:true,busy:false});

test('board cards render backs without hidden names and reveal only at resolution',()=>{
 const p={seat:'M',target:'doctor'},v={phaseId:'hero_cards',placements:[p],revealedCards:[]};
 let html=cardsOn(v,'doctor');assert.match(html,/mini-back/);assert.doesNotMatch(html,/face-up/);assert.match(html,/未翻开/);assert.doesNotMatch(html,/横移/);
 v.phaseId='cultist';v.revealedCards=[{...p,card:'move_h#0'}];html=cardsOn(v,'doctor');assert.match(html,/face-up/);assert.match(html,/横移/);assert.match(html,/data-placement="M:doctor"/);
 v.placements=[];html=cardsOn(v,'doctor');assert.match(html,/resolved/);assert.match(html,/已结算/);
});
test('own face-down cards are readable to their owner only',()=>{
 const s=applyCommand(createGame(starter),'M',{type:'place',card:'paranoia_1#0',target:'doctor'});
 const mine=cardsOn(view(s,'M'),'doctor'),theirs=cardsOn(view(s,'A'),'doctor');
 assert.match(mine,/class="mini mm own/);assert.match(mine,/对手看不到/);assert.match(theirs,/未翻开/);assert.doesNotMatch(theirs,/不安/);
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
 const v={mode:'heroes',turn:'M',phaseId:'cultist',phase:'翻牌结算',winner:null,actions:[{command:{type:'cultist'}}]};
 assert.equal(turnGuidance(v).title,'对手回合');assert.deepEqual({...turnControl(v)},{action:'auto',label:'继续',disabled:false,icon:'play'});
 v.mode='mastermind';assert.match(turnGuidance(v).title,/轮到你/);assert.match(turnGuidance(v).detail,/是否无视暗跃禁止/);assert.notEqual(turnControl(v)?.action,'auto');
 const busy={working:true,auto:true,requestKind:'rules'};assert.match(turnGuidance(v,busy).title,/结算中/);assert.doesNotMatch(turnGuidance(v,busy).title,/AI/);
 assert.equal(turnControl({...v,mode:'heroes'},{auto:true,working:true}).label,'暂停');
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
 assert.equal(cardPreview(card,'doctor',v),'→ 神社');assert.equal(cardPreview(card,'hospital',v),'无效');
});
test('the table never leaks hidden roles into a protagonist or spectator view',()=>{
 const client={sideTab:'intel',aiFeed:[],sheetTool:'no'};
 for(const seat of ['A','public']){
  const v=table(seat==='A'?'heroes':'observe',seat),html=['intel','log','sheet','ref'].map(sideTab=>Object.values(tableRegions(v,{...client,sideTab},{marks:emptyMarks()})).join('')).join('');
  assert.doesNotMatch(html,/class="tag role/);assert.doesNotMatch(html,/真相 · 只有你知道/);assert.doesNotMatch(html,/tag culprit/);assert.match(html,/data-tab="sheet"/);
 }
 const mm=table('mastermind','M'),html=Object.values(tableRegions(mm,{...client,sideTab:'sheet'},{marks:emptyMarks()})).join('');
 assert.match(html,/class="tag role secret"/);assert.match(html,/tag culprit/);assert.match(html,/真相 · 只有你知道/);assert.doesNotMatch(html,/data-tab="sheet"/);
});
test('legacy public replay names are stripped at import/export without changing full replay',()=>{
 const v=view(createGame(starter),'public');v.script.incidents=structuredClone(starter.incidents);v.log.push({type:'incident',day:2,text:'预告的「医院事件」没有发生。'});
 const data={perspective:'public',script:structuredClone(starter),frames:[{view:v}]},clean=sanitizePublicReplay(data);
 assert.ok(clean.script.incidents.every(e=>Object.keys(e).length===1));assert.ok(clean.frames[0].view.script.incidents.every(e=>Object.keys(e).length===1));assert.equal(clean.frames[0].view.log.at(-1).text,'第 2 日预告的事件没有发生。');assert.equal(data.frames[0].view.log.at(-1).text,'预告的「医院事件」没有发生。');
 const full={perspective:'M',script:structuredClone(starter),frames:[{view:view(createGame(starter),'M')}]};assert.deepEqual(sanitizePublicReplay(full),full);
});

function animator(stages,{reduced=()=>false,cards,changes,wait=async()=>{}}={}){
 const state={page:'game',transitionView:null,playback:null,banner:null,g:null,requestKind:'',speed:1};
 const fx={supported:()=>true,positions:()=>({}),freeze(){},thaw(){},finish(){},announce:async lines=>{stages.push('announce:'+lines.join('|'));},stamp:async(who,text,kind)=>{stages.push(`stamp:${who}:${text}:${kind}`);},shock:async kind=>{stages.push('shock:'+kind);},
  cards:cards||(async(_prev,next)=>{stages.push('cards:'+next.revision);}),changes:changes||(async(_prev,next)=>{stages.push('changes:'+next.revision);})};
 return {state,fx,...createAnimator({state,fx,reduced,wait,render:()=>stages.push(state.playback?.gate?'gate:'+state.playback.gate.day:state.banner?'banner:'+state.banner.title:state.transitionView?'render:'+(state.transitionView.board===state.old?'old-board':'new-board'):'render:live')})};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('revealing cards completes on old board before any character movement starts',async()=>{
 const prev={id:'game',day:1,loop:1,board:{doctor:{location:'hospital'}},revealedCards:[],log:[]},next={...prev,board:{doctor:{location:'school'}},revealedCards:Array(6).fill({})};
 let finishCards;const stages=[];
 const a=animator(stages,{cards:async()=>{stages.push('flip-start');await new Promise(resolve=>{finishCards=resolve;});stages.push('flip-end');},changes:async()=>{stages.push('move-start');}});
 a.state.g=next;a.state.old=prev.board;
 const pending=a.animateTransition(prev,next,{},[]);await Promise.resolve();assert.deepEqual(stages,['render:old-board','flip-start']);finishCards();await pending;
 assert.deepEqual(stages,['render:old-board','flip-start','flip-end','render:new-board','move-start']);assert.equal(a.state.transitionView,null);assert.equal(a.state.playback,null);
});
test('public transition frames play one result after another and reduced motion keeps the steps',async()=>{
 const prev={id:'game',revision:5,day:1,loop:1,board:{doctor:{location:'hospital'}},revealedCards:[],log:[]};
 const reveal={...prev,revision:6,phaseId:'cultist',board:{doctor:{location:'school'}},revealedCards:Array(6).fill({})},counters={...reveal,revision:7,phaseId:'mm_ability',placements:[]},next={...counters,revision:8,phaseId:'hero_ability'};
 const stages=[];let a=animator(stages);a.state.g=next;
 await a.animateTransition(prev,next,{},[reveal,counters,next]);assert.deepEqual(stages.filter(x=>!x.startsWith('render')),['cards:6','changes:6','cards:7','changes:7','cards:8','changes:8']);assert.equal(a.state.transitionView,null);
 stages.length=0;a=animator(stages,{reduced:()=>true});a.state.g=next;await a.animateTransition(prev,next,{},[reveal,counters,next]);assert.deepEqual(stages,Array(3).fill('render:new-board'));
 stages.length=0;a=animator(stages);a.state.g=next;a.state.page='rules';await a.animateTransition(prev,next,{},[reveal,counters,next]);assert.deepEqual(stages,[]);
});

// One step that resolves an effect, ends day 1 and opens day 2, as the server reports it.
function dayEnding(mode='heroes'){
 const base={id:'game',mode,loop:1,day:1,script:{loops:3,days:3},board:{},revealedCards:[],placements:[]};
 const entry=(n,type,text,extra={})=>({n,loop:1,day:n>3?2:1,type,text,...extra});
 const log=[entry(1,'counter','医生 · 不安 +1',{who:'doctor',by:'M'}),entry(2,'death','医生死亡。',{who:'doctor',phase:'end'}),entry(3,'dayend','第 1 日结束。'),entry(4,'day','第 2 日。')];
 const frames=log.map((e,i)=>({...base,revision:6+i,day:e.day,log:log.slice(0,i+1)}));
 return {prev:{...base,revision:5,log:[]},next:{...frames.at(-1),actions:[]},frames};
}
test('each result is shown on its own and the day ends only when the player says so',async()=>{
 const {prev,next,frames}=dayEnding(),stages=[],a=animator(stages);a.state.g=next;
 let done=false;const playing=a.animateTransition(prev,next,{},frames).then(()=>{done=true;});
 await settle();
 assert.deepEqual(stages.filter(x=>/^(changes|announce|gate)/.test(x)),['changes:6','changes:7','announce:医生死亡','changes:8','gate:1']);
 assert.equal(done,false);const {recap,...gate}=a.state.playback.gate;assert.deepEqual(gate,{day:1,last:false,auto:false});assert.deepEqual(recap.map(e=>[e.phase,e.text]),[['end','医生死亡。']]);
 assert.equal(a.state.transitionView.day,1);assert.deepEqual(a.state.playback.trail.map(e=>e.type),['counter','death','dayend']);
 assert.match(dockHtml(a.state.transitionView,a.state),/第 1 日结束[\s\S]*<li class="death"><i>日结束<\/i><span>医生死亡。<\/span>[\s\S]*data-do="gate-continue"[^>]*>进入第 2 日/);
 a.release();await playing;
 assert.deepEqual(stages.filter(x=>/^(changes|announce)/.test(x)).slice(-2),['changes:9','announce:第 2 日']);assert.equal(a.state.playback,null);
});
test('the result being played names its subject and card, and skipping still stops at the day gate',async()=>{
 const {prev,next,frames}=dayEnding(),stages=[];let hold;
 const a=animator(stages,{wait:()=>new Promise(resolve=>{hold=resolve;})});a.state.g=next;
 const playing=a.animateTransition(prev,next,{},frames);await settle();
 assert.deepEqual(a.state.playback.spot,{who:'doctor',by:'M'});assert.equal(a.state.playback.entry.text,'医生 · 不安 +1');
 const html=dockHtml(a.state.transitionView,a.state);assert.match(html,/医生 · 不安 \+1/);assert.match(html,/data-do="skip"/);assert.match(html,/data-do="speed"[^>]*>1×/);
 assert.match(boardHtml({...table('heroes','A'),...a.state.transitionView,board:table('heroes','A').board},{spot:a.state.playback.spot}),/class="tok[^"]* spot"[^>]*data-character="doctor"/);
 a.skip();await settle();
 assert.equal(a.state.playback.gate.day,1);assert.ok(!stages.includes('changes:7'));
 a.release();hold();await settle();a.skip();await playing;assert.equal(a.state.playback,null);
});
test('spectators are moved past the day gate, and leaving the table cancels playback',async()=>{
 const watch=dayEnding('observe'),stages=[];let a=animator(stages);a.state.g=watch.next;
 await a.animateTransition(watch.prev,watch.next,{},watch.frames);assert.ok(stages.includes('gate:1'));assert.equal(stages.at(-1),'announce:第 2 日');
 const {prev,next,frames}=dayEnding();stages.length=0;a=animator(stages);a.state.g=next;
 const playing=a.animateTransition(prev,next,{},frames);await settle();a.state.page='home';a.cancel();await playing;
 assert.ok(!stages.includes('changes:9'));assert.equal(a.state.playback,null);
});
test('a failed loop holds on its banner before the next loop is shown',async()=>{
 const base={id:'game',mode:'mastermind',loop:1,day:3,script:{loops:3,days:3},board:{},revealedCards:[],placements:[]};
 const log=[{n:1,loop:1,day:3,type:'death',phase:'incident',text:'巫女死亡。',who:'shrine_maiden'},{n:2,loop:1,day:3,type:'failed',phase:'incident',when:'death',dead:['shrine_maiden'],text:'第 1 轮回失败：巫女死亡，轮回立即结束。'},{n:3,loop:2,day:1,type:'loop',text:'第 2 轮回开始。'}];
 const frames=log.map((e,i)=>({...base,revision:6+i,loop:e.loop,day:e.day,log:log.slice(0,i+1)})),next={...frames.at(-1),actions:[]};
 const stages=[],a=animator(stages);a.state.g=next;
 const playing=a.animateTransition({...base,revision:5,log:[]},next,{},frames);await settle();
 assert.equal(stages.at(-1),'banner:第 1 轮回失败');assert.ok(stages.includes('shock:fail'));assert.ok(!stages.includes('changes:8'));
 const banner=a.state.banner;assert.deepEqual([banner.stamp,banner.cause,banner.detail],['第 3 日 · 事件','巫女死亡，轮回立即结束','']);
 assert.deepEqual(banner.recap.map(e=>e.text),['巫女死亡。']);assert.deepEqual(banner.lines,['失败的原因不会公布，要靠线索推理。','还可以重来 2 次']);
 assert.match(bannerHtml(banner),/class="banner loop"[\s\S]*第 3 日 · 事件[\s\S]*巫女死亡，轮回立即结束[\s\S]*<li class="death"><i>事件<\/i><span>巫女死亡。/);
 a.state.banner=null;a.release();await playing;assert.ok(stages.includes('changes:8'));
 // The last loop of a lost game goes straight to the closing banner instead.
 stages.length=0;const lost={...next,loop:3,winner:'mastermind'},final=frames.slice(0,2).map(f=>({...f,loop:3}));
 a.state.g=lost;await a.animateTransition({...base,loop:3,revision:5,log:[]},lost,{},final);assert.ok(!stages.some(x=>x.startsWith('banner')));
});
test('the server reports a step as one frame per logged result, ending each day explicitly',async()=>{
 let state=createGame(starter),days=0;const types=[];
 for(let i=0;i<60&&state.day<3;i++){
  const {seat,frames}=await playStep({state,mode:'heroes',route:'bot-step'});
  const report=stepReport({mode:'heroes',route:'bot-step',seat,answer:null,initial:state,frames});
  let seen=state.log.length;
  for(const frame of report.transitionFrames){
   assert.ok(frame.log.length-seen<=1,'a frame adds at most one result');
   for(const key of ['hand','hands','actions','secret','pending'])assert.ok(!(key in frame));
   if(frame.log.length>seen){const e=frame.log.at(-1);types.push(e.type);if(e.type==='dayend'){days++;assert.equal(frame.day,e.day);}}
   seen=frame.log.length;
  }
  assert.equal(seen,frames.at(-1).state.log.length);state=frames.at(-1).state;
 }
 assert.equal(days,2);assert.ok(types.indexOf('cards')>types.lastIndexOf('placed',types.indexOf('cards')));
 for(const type of ['placed','cards','dayend','day'])assert.ok(types.includes(type),type);
 const at=types.indexOf('dayend');assert.equal(types[at+1],'day');
});

function session(overrides={}){
 const state={page:'game',working:false,auto:false,syncRequired:false,g:{id:'game',mode:'heroes',turn:'M',revision:6,phaseId:'cultist',winner:null,log:[],loop:1,day:1,script:{loops:3}},advancedRevision:'',info:{configured:true},aiFeed:[],banner:null,pendingOutcome:null,autoPlay:true,requestKind:'',actionError:'',actionErrorCode:'',selected:null,peekSeat:null,transitionView:null,...overrides.state};
 const calls=[],store=new Map(Object.entries(overrides.storage||{}));
 const s=createSession({state,render(){},wait:overrides.wait||(async()=>{}),uuid:()=>'once-only',storage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},
  api:async(url,data)=>{calls.push({url,data});return overrides.api(url,data,state,calls);},...overrides.inject});
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
 const sounds=[],c=session({inject:{sound:cue=>sounds.push(cue)},api:(url,data,state)=>({...state.g,revision:7,phaseId:'over',winner:'mastermind',log:[{n:1,type:'death',text:'女学生死亡。'}],decision:{controller:'AI',seat:'M',reason:'先压不安。'}})});
 await c.step(undefined,'ai-step');
 assert.deepEqual(c.state.aiFeed,[{gameId:'game',seat:'M',text:'先压不安。',loop:1,day:1,at:0}]);
 assert.equal(c.state.banner.kind,'defeat');assert.deepEqual(c.state.banner.lines,['剧作家获胜 · 你输了']);assert.deepEqual(c.state.banner.recap.map(e=>e.text),['女学生死亡。']);assert.equal(c.state.banner.cause,undefined);assert.equal(c.state.pendingOutcome,null);assert.deepEqual(sounds,['bong_001']);
 const base={mode:'heroes',winner:null,loop:3,log:[],script:{loops:3}};
 assert.match(outcomeBanner(base,{...base,winner:'heroes'}).lines[0],/你赢了/);assert.match(outcomeBanner(base,{...base,winner:'mastermind'}).lines[0],/你输了/);
 assert.doesNotMatch(outcomeBanner({...base,mode:'observe'},{...base,mode:'observe',winner:'heroes'}).lines[0],/你/);
 assert.equal(outcomeBanner(base,{...base,phaseId:'between',log:[{n:1,type:'failed',text:'x'}]}),null);
});
test('the table predicted for the player\'s own card is the one the server then reports',()=>{
 const seen=v=>({...v,actions:v.actions.map(o=>o.command)});
 let s=createGame(starter);
 for(const mode of ['mastermind','heroes'])for(let i=0;i<3;i++){
  const v=project(mode,s),command=v.actions[i*5+2].command,guess=afterPlacing(v,command);
  s=applyCommand(s,v.turn,command);
  // Up to the last card the whole view is known; after it only that the card is down and the turn has gone.
  if(i<2)assert.deepEqual(seen(guess),seen(project(mode,s)));
  else{assert.deepEqual(guess.actions,[]);assert.deepEqual(guess.placements,project(mode,s).placements);assert.equal(guess.hand.find(c=>c.id===command.card).available,false);}
 }
 assert.equal(s.placements.length,6);
});
// A local server for the session: applies each command to a real game and answers when the test says so.
function heroTable(){
 let s=createGame(starter);for(let i=0;i<3;i++)s=applyCommand(s,'M',project('mastermind',s).actions[i*5+2].command);
 const decorate=v=>({...v,id:'game',mode:'heroes',busy:false}),replies=[];
 const answer=async data=>{
  if(!data)return decorate(project('heroes',s));
  if(data.revision!==s.revision)throw Object.assign(Error('局面已变化，请刷新'),{code:'STATE_CONFLICT'});
  const {seat,frames}=await playStep({state:s,mode:'heroes',route:'command',command:data.command}),initial=s;s=frames.at(-1).state;
  return {...decorate(project('heroes',s)),...stepReport({mode:'heroes',route:'command',seat,answer:null,initial,frames,decorate})};
 };
 return {start:decorate(project('heroes',s)),replies,api:(url,data)=>new Promise((resolve,reject)=>replies.push(error=>error?reject(error):resolve(answer(data)))),server:()=>s};
}
test('the player\'s own cards go down at once, are confirmed in order, and only the last waits for its result',async()=>{
 const t=heroTable(),landed=[],played=[];
 const c=session({state:{g:t.start},api:t.api,inject:{land(prev,next){landed.push(next.placements.length);},animate:async(prev,next,before,frames)=>{played.push([prev.log.length,...frames.map(f=>f.log.at(-1).type)]);}}});
 const pick=()=>c.state.g.actions[4].command,first=pick();
 c.state.selected=first.card;c.step(first);
 assert.equal(c.state.working,false);assert.equal(c.state.selected,null);assert.equal(c.state.g.turn,'B');assert.equal(c.state.g.placements.at(-1).card,first.card);
 assert.match(dockHtml(c.state.g,c.state),/class="hand"[^>]*aria-label="主人公 B的手牌"/);
 c.step(pick());assert.equal(c.state.g.turn,'C');
 const last=c.step(pick());assert.equal(c.state.working,true);assert.equal(c.state.g.placements.length,6);assert.deepEqual(landed,[4,5,6]);
 // One request at a time, each for the revision the one before it produces.
 await settle();assert.deepEqual(c.calls.map(x=>x.data.revision),[t.start.revision]);
 t.replies[0]();await settle();assert.equal(c.state.g.placements.length,6);
 t.replies[1]();await settle();assert.deepEqual(c.calls.map(x=>x.data.revision),[0,1,2].map(i=>t.start.revision+i));assert.deepEqual(played,[]);
 t.replies[2]();await last;
 assert.equal(c.state.working,false);assert.equal(c.state.g.revision,t.server().revision);assert.equal(c.state.g.phaseId,'mm_ability');
 // What plays back starts after the card the player has already watched land.
 assert.equal(played.length,1);assert.equal(played[0][0],t.start.log.length+3);assert.equal(played[0][1],'cards');assert.ok(!played[0].includes('placed'));
});
test('a card the server does not confirm comes back off the table, and nothing queued behind it is sent',async()=>{
 const t=heroTable(),told=[],c=session({state:{g:t.start},api:t.api,inject:{toast:(text,kind)=>told.push(kind)}});
 c.step(c.state.g.actions[4].command);c.step(c.state.g.actions[4].command);assert.equal(c.state.g.placements.length,5);
 await settle();t.replies[0](Object.assign(Error('连接中断，请检查网络并同步局面。'),{code:'NETWORK',uncertain:true}));
 await settle();assert.equal(c.state.working,true);t.replies[1]();await settle();
 assert.deepEqual(c.calls.map(x=>x.url),['/games/game/command','/games/game']);
 assert.equal(c.state.g.placements.length,3);assert.equal(c.state.g.turn,'A');assert.equal(c.state.working,false);assert.equal(c.state.syncRequired,false);
 assert.match(c.state.actionError,/^连接中断，请检查网络并同步局面。局面没有变化，可以重试。$/);assert.deepEqual(told,['error']);
 // The table is usable again and the next card is sent for the revision the server really has.
 c.state.actionError='';c.step(c.state.g.actions[0].command);await settle();assert.equal(c.calls.at(-1).data.revision,t.start.revision);
});
test('final guess choices mark confirmed roles and the player\'s own deductions',()=>{
 const s=createGame(starter);s.script.ruleset='BTX';s.phase='guess';s.guessed={};s.knownRoles={office_worker:'killer'};
 const v=view(s,'A'),sheet=analyze(v,markRole(markRole(emptyMarks(),'doctor','brain','yes'),'doctor','cultist','no'));
 const groups=choiceGroups(v,sheet),of=id=>groups.find(gr=>gr.items.some(it=>v.actions[it.i].command.character===id)),roles=(gr,cls)=>gr.items.filter(it=>it.cls===cls).map(it=>v.actions[it.i].command.role).join();
 assert.match(of('office_worker').detail,/已确认/);assert.equal(roles(of('office_worker'),'known'),'killer');assert.equal(roles(of('office_worker'),'ruled'),'');
 assert.match(of('doctor').detail,/你的推理：/);assert.equal(roles(of('doctor'),'picked'),'brain');assert.ok(roles(of('doctor'),'ruled').split(',').includes('cultist'));
 assert.ok(choiceGroups(v).filter(gr=>gr.title!==name('office_worker')).every(gr=>gr.items.every(it=>!it.cls)));
});

test('a forbidden, cancelled or ignored effect is stamped on its target and its card stays crossed out',async()=>{
 const base={id:'game',mode:'heroes',loop:1,day:1,script:{loops:3,days:3},board:{},revealedCards:[],placements:[]};
 const log=[{n:1,loop:1,day:1,phase:'cultist',type:'blocked',text:'医生的暗跃被禁止。',who:'doctor',what:'intrigue',by:'A',hit:['M']},
  {n:2,loop:1,day:1,phase:'cultist',type:'voided',text:'医院的暗跃禁止无效：同一天出了 2 张。',who:'hospital',what:'intrigue',hit:['B']},
  {n:3,loop:1,day:1,phase:'cultist',type:'ignored',text:'巫女的暗跃禁止被无视。',who:'shrine_maiden',what:'intrigue',hit:['C']},
  {n:4,loop:1,day:1,phase:'hero_ability',type:'refused',text:'偶像拒绝了请求。',who:'idol'}];
 const frames=log.map((e,i)=>({...base,revision:6+i,log:log.slice(0,i+1)})),next={...frames.at(-1),actions:[]},stages=[];let hold;
 const a=animator(stages,{wait:()=>new Promise(resolve=>{hold=resolve;})});a.state.g=next;
 const playing=a.animateTransition({...base,revision:5,log:[]},next,{},frames);await settle();
 assert.deepEqual(a.state.playback.spot,{who:'doctor',by:'A',hit:['M']});
 const v={...table('heroes','A'),phaseId:'cultist',placements:[{seat:'M',target:'doctor'},{seat:'A',target:'doctor'}],revealedCards:[{seat:'M',target:'doctor',card:'intrigue_1#0',void:true},{seat:'A',target:'doctor',card:'forbid_intrigue#0'}]};
 const cards=cardsOn(v,'doctor',a.state.playback.spot);
 assert.match(cards,/class="mini mm face-up struck void[^"]*"[^>]*aria-label="剧作家：暗跃\+1（无效）"/);assert.match(cards,/class="mini hero face-up spot /);assert.doesNotMatch(cards,/hero[^"]*void/);
 v.placements=[];assert.match(cardsOn(v,'doctor'),/class="mini mm face-up resolved void/);
 hold();await settle();a.skip();await playing;
 // Played to the end, every one of them lands.
 stages.length=0;const b=animator(stages);b.state.g=next;await b.animateTransition({...base,revision:5,log:[]},next,{},frames);
 assert.deepEqual(stages.filter(x=>/^(stamp|announce)/.test(x)),['stamp:doctor:暗跃禁止:ban','stamp:hospital:禁止失效:void','announce:巫女的暗跃禁止被无视','stamp:shrine_maiden:禁止被无视:void','stamp:idol:拒绝:refuse']);
});
test('the record and the clues say which phase each thing happened in, and a lost loop explains its timing',()=>{
 const s=createGame(starter);
 const at=(n,day,phase,type,text,extra={})=>({n,loop:1,day,phase,type,text,...extra});
 s.log=[at(1,1,'setup','loop','第 1 轮回开始。'),at(2,1,'mm_cards','day','第 1 日。'),at(3,1,'mm_cards','placed','剧作家出牌：医生',{who:'doctor',by:'M'}),at(4,1,'cultist','counter','医生 · 暗跃 +1',{who:'doctor',by:'M'}),
  at(5,1,'mm_ability','counter','医生 · 暗跃 +1',{who:'doctor'}),at(6,1,'end','death','偶像死亡。',{who:'idol'}),at(7,1,'end','dayend','第 1 日结束。'),
  at(8,3,'incident','incident','「自杀」发生。'),at(9,3,'incident','death','女学生死亡。',{who:'girl_student'}),at(10,3,'incident','failed','第 1 轮回失败：女学生死亡，轮回立即结束。',{when:'death',dead:['girl_student']})];
 s.phase='between';s.day=3;
 const v={...view(s,'A'),id:'game',mode:'heroes'},record=sideBodyHtml(v,{tab:'log',aiFeed:[]});
 const heads=[...record.matchAll(/<h5>([^<]+)<\/h5>|<h6 class="log-phase">([^<]+)<\/h6>/g)].map(m=>m[1]||'· '+m[2]);
 assert.deepEqual(heads,['第 1 轮回 · 第 3 日','· 事件','第 1 轮回 · 第 1 日','· 日结束','· 剧作家能力','· 翻牌结算','· 剧作家出牌']);
 assert.deepEqual(clues(v)[0].items.map(e=>[e.day,e.phase,e.type]),[[1,'end','death'],[3,'incident','incident'],[3,'incident','death'],[3,'incident','failed']]);
 const a=analyze(v,emptyMarks()),sheet=sideBodyHtml(v,{tab:'sheet',analysis:a,tool:'no',aiFeed:[]});
 assert.match(sheet,/<p class="clue death"><b>第1日<i>日结束<\/i><\/b><span>偶像死亡。/);assert.match(sheet,/<p class="clue failed"><b>第3日<i>事件<\/i><\/b>/);
 // Only a key person's death ends a loop on the spot, so the sheet offers that as a lead.
 assert.deepEqual(a.hints.filter(h=>h.role==='key_person'),[{character:'girl_student',role:'key_person',text:'女学生一死，轮回就结束了，多半是关键人物'}]);
 assert.deepEqual(analyze(v,markRole(emptyMarks(),'girl_student','key_person','no')).hints.filter(h=>h.role==='key_person'),[]);
 assert.deepEqual(failure(v),{stamp:'第 3 日 · 事件',cause:'女学生死亡，轮回立即结束',detail:''});
 assert.match(dockHtml(v,{aiFeed:[]},a),/class="why"><b><i>第 3 日 · 事件<\/i>女学生死亡，轮回立即结束<\/b>/);assert.match(boardHtml(v),/class="board failed"/);
 // A loop lost at the end of its last day keeps the public counters that were on the table.
 s.log.push(at(11,3,'end','failed','第 1 轮回失败：最后一天结束时，失败条件成立。',{when:'end',intrigue:{school:2,doctor:1}}));
 assert.deepEqual(failure(view(s,'A')),{stamp:'第 3 日 · 日结束',cause:'最后一天结束时，失败条件成立',detail:'当时的暗跃：学校 2、医生 1'});
 assert.equal(failure({log:[{type:'failed',loop:1,text:'第 1 轮回失败。'}],loop:1}),null);
});

/* ---------- deduction sheet ---------- */
const heroView=(edit=()=>{})=>{const s=createGame(starter);edit(s);return {...view(s,'A'),id:'game',mode:'heroes'};};
const said=(n,type,who,extra={})=>({n,loop:1,day:1,type,text:type,who,...extra});
test('the sheet narrows rule combinations and role columns from plot marks and confirmed roles',()=>{
 const v=heroView(),open=analyze(v,emptyMarks());
 assert.equal(open.combos,9);assert.equal(open.only,null);assert.ok(open.roles.every(r=>!r.hidden));assert.deepEqual(open.hints,[]);assert.deepEqual(open.warns,[]);
 let marks=markPlot(emptyMarks(),'murder_plan','yes'),a=analyze(v,marks);
 assert.equal(a.combos,3);assert.deepEqual(a.plots.main.map(p=>[p.id,p.mark,Boolean(p.auto)]),[['murder_plan','yes',false],['avenger','no',true],['protect_place','no',true]]);
 assert.deepEqual(a.roles.filter(r=>r.hidden).map(r=>r.id),['cultist']);assert.deepEqual([a.roles.find(r=>r.id==='killer').min,a.roles.find(r=>r.id==='killer').max],[1,1]);
 marks=markPlot(marks,'ripper_shadow','yes');a=analyze(v,marks);
 assert.equal(a.combos,1);assert.deepEqual(a.only,[name('murder_plan'),name('ripper_shadow')]);assert.deepEqual(a.roles.filter(r=>r.hidden).map(r=>r.id).sort(),['cultist','friend','negative']);
 assert.equal(markPlot(marks,'ripper_shadow','yes').plots.ripper_shadow,undefined,'the same tool clears a mark');
 // A confirmed serial killer leaves only the sub plot that has one.
 const known=analyze(heroView(s=>{s.knownRoles.doctor='serial_killer';}),emptyMarks());
 assert.equal(known.combos,3);assert.deepEqual(known.plots.sub.filter(p=>p.mark==='yes').map(p=>[p.id,p.auto]),[['ripper_shadow','只剩这一种可能']]);
 assert.deepEqual(Object.values(known.rows.find(r=>r.id==='doctor').cells).map(c=>c.locked),Array(known.roles.length).fill(true));
});
test('marks on one cell settle the rest of its row and column, and leads follow from what is left',()=>{
 const v=heroView(),cast=v.script.characters,first=cast[0],last=cast.at(-1),day=v.script.incidents[0].day;
 let marks=markRole(markPlot(markPlot(emptyMarks(),'murder_plan','yes'),'unsettling_rumor','yes'),first,'killer','yes'),a=analyze(v,marks);
 assert.equal(a.rows[0].pick,'killer');assert.equal(a.rows[0].cells.brain.auto,'已认定为'+name('killer'));assert.ok(a.rows.slice(1).every(r=>r.cells.killer.mark==='no'&&r.cells.killer.auto==='人数已满'));
 assert.equal(markRole(marks,first,'brain','yes').roles[first].killer,undefined,'a character holds one ✓');
 // Rule everyone but one person out of a required role: the sheet names who is left.
 for(const c of cast.slice(1,-1))marks=markRole(marks,c,'brain','no');
 a=analyze(v,marks);assert.deepEqual(a.hints.filter(h=>h.role==='brain'),[{character:last,role:'brain',text:`只剩${name(last)}能当${name('brain')}`}]);assert.equal(a.rows.at(-1).cells.brain.lead,true);
 // Contradicting marks are reported instead of silently emptying the sheet.
 a=analyze(v,markRole(marks,cast[1],'cultist','yes'));assert.match(a.warns[0],/矛盾/);assert.ok(a.combos>0);
 const guess=markCulprit(marks,day,first);assert.equal(analyze(v,guess).culprits.find(e=>e.day===day).guess,first);assert.deepEqual(markCulprit(guess,day,'').culprits,{});
});
test('refused and granted goodwill requests rule roles out on their own',()=>{
 const refuser=starter.characters[0],giver=starter.characters[1],day=starter.incidents[0].day;
 const v=heroView(s=>{s.log.push(said(90,'ability',refuser,{ability:0}),said(91,'refused',refuser),said(92,'ability',giver,{ability:0}),said(93,'counter',giver));});
 const a=analyze(v,emptyMarks()),row=id=>a.rows.find(r=>r.id===id),marked=(id,mark)=>Object.entries(row(id).cells).filter(([,c])=>c.mark===mark).map(([r])=>r).sort();
 assert.equal(row(refuser).note,'拒绝过能力');assert.deepEqual(marked(refuser,''),catalog.roles.filter(r=>r.sets.includes('FS')&&r.goodwillRefusal!=='none').map(r=>r.id).sort());
 assert.deepEqual(marked(giver,'no'),['cultist']);assert.equal(row(giver).cells.cultist.auto,'接受过能力');
 assert.deepEqual(clues(v).at(0).items.map(e=>e.type),['refused']);
 const html=sideBodyHtml(v,{tab:'sheet',analysis:a,tool:'no',aiFeed:[]});
 assert.match(html,/data-do="sheet-tool" data-tool="no" aria-pressed="true"/);assert.match(html,/class="cell no auto"[^>]*title="拒绝过能力"/);assert.match(html,new RegExp(`data-sheet-culprit="${day}"`));assert.match(html,/还剩 9 种组合/);
 const board=boardHtml(v,{sheet:analyze(v,markCulprit(markRole(emptyMarks(),refuser,'killer','yes'),day,refuser))});
 assert.match(board,/class="tag role guess"[^>]*>杀手\?</);assert.match(board,new RegExp(`class="tag culprit guess"[^>]*>${day}日犯人\\?<`));
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

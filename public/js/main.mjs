import {validateReplay,sanitizePublicReplay} from '../replay-validation.mjs';
import {esc,icon,btn,iconBtn} from './html.mjs';
import {setCatalog,PLACING} from './lookup.mjs';
import {createApi} from './api.mjs';
import {state} from './state.mjs';
import {humanTurn} from './guidance.mjs';
import {createSession} from './session.mjs';
import {createAnimator,domFx} from './anim.mjs';
import {publicDraft,printableHtml,offlineReplayHtml} from './exporters.mjs';
import {parseDraft,blankDraft,editDraft} from './script-draft.mjs';
import {TABLE_SKELETON,emptyGameHtml,tableRegions} from './ui/game.mjs';
import {homeHtml} from './ui/home.mjs';
import {rulesHtml} from './ui/rules.mjs';
import {editorHtml} from './ui/editor.mjs';
import {replayIntroHtml,replayBarHtml} from './ui/replay.mjs';
import {newGameModal,characterModal,guideModal,truthModal,bannerHtml} from './ui/modals.mjs';
import {analyze,emptyMarks,markRole,markPlot,markCulprit} from './deduce.mjs';

const PAGES=[['home','首页','home'],['game','对局','board'],['editor','剧本','pen'],['replay','回放','film'],['rules','规则','book']];
const $=selector=>document.querySelector(selector);
const api=createApi();
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const fx=domFx(document,()=>state.speed);

/* ---------- small browser helpers ---------- */
function toast(text,kind=''){
 const el=$('#toast');el.textContent=text;el.className=kind;el.hidden=false;
 clearTimeout(toast.timer);toast.timer=setTimeout(()=>{el.hidden=true;},5000);
}
function play(cue){
 if(!state.sound)return;
 const audio=new Audio(`/assets/audio/Audio/${cue}.ogg`);audio.volume=.25;audio.play().catch(()=>{});
}
function download(data,file,type='application/json'){
 const url=URL.createObjectURL(new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type}));
 const a=document.createElement('a');a.href=url;a.download=file;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
const readMarks=id=>{try{return JSON.parse(localStorage.getItem('deduce-'+id))||emptyMarks();}catch{return emptyMarks();}};
const editMarks=edit=>{const id=state.g.id;localStorage.setItem('deduce-'+id,JSON.stringify(edit(readMarks(id))));render();};

/* ---------- rendering: fixed regions, replaced only when their HTML changes ---------- */
const rendered=new WeakMap();
function patch(el,html){
 if(!el||rendered.get(el)===html)return;
 const active=document.activeElement,inside=active&&el.contains(active);
 const key=inside&&(active.id?'#'+CSS.escape(active.id):active.dataset.card?`[data-card="${CSS.escape(active.dataset.card)}"]`:active.dataset.do?`[data-do="${CSS.escape(active.dataset.do)}"]${active.dataset.index?`[data-index="${CSS.escape(active.dataset.index)}"]`:''}`:'');
 const caret=inside&&'selectionStart' in active?[active.selectionStart,active.selectionEnd]:null;
 el.innerHTML=html;rendered.set(el,html);
 const note=el.querySelector('#notes');if(note)note.value=localStorage.getItem('note-'+note.dataset.note)||'';
 if(key){const again=el.querySelector(key);again?.focus({preventScroll:true});if(caret&&again?.setSelectionRange)try{again.setSelectionRange(...caret);}catch{}}
}

function navHtml(){
 const {info,page,sound}=state;
 return `<button type="button" class="brand" data-do="nav-home" aria-label="返回首页"><span class="brand-mark">${icon('loop')}</span><span class="brand-text">时隙<small>TRAGEDY LOOPER</small></span></button>
  <nav class="nav-links" aria-label="主导航">${PAGES.map(([id,label,glyph])=>`<button type="button" class="${page===id?'active':''}" data-do="nav-${id}" aria-label="${label}"${page===id?' aria-current="page"':''}>${icon(glyph)}<span>${label}</span></button>`).join('')}</nav>
  <div class="nav-meta"><span class="ai-status${info.configured?' online':''}" title="${info.configured?'模型：'+esc(info.model):'没有配置 DeepSeek 密钥，对手是离线机器人'}"><i></i><span>${info.configured?'AI 已连接':'离线模式'}</span></span>${iconBtn(sound?'soundOn':'soundOff','sound',sound?'关闭声音':'开启声音')}</div>`;
}
const footerHtml=()=>`<footer class="footer"><span>原作 惨劇RoopeR / BakaFire Party · 非官方模拟器 · JP5 / FS + BTX</span><span><a href="https://main-bakafire.ssl-lolipop.jp/rooper/sr_dl_04_sozai.htm" target="_blank" rel="noreferrer">惨劇コモンズ作成：BakaFire、NEKOG(紺ノ玲)</a> · Kenney CC0 音效</span></footer>`;

const replayView=()=>state.replay.data?.frames[state.replay.at].view;
const tableView=()=>state.page==='game'?state.transitionView||state.g:state.page==='replay'?replayView():null;

function renderTable(page,v,{skipDock=false}={}){
 const readOnly=state.page==='replay';
 const regions=tableRegions(v,state,{marks:readOnly?null:readMarks(v.id),readOnly,dock:readOnly?replayBarHtml(state):undefined});
 const table=page.firstElementChild;
 table.classList.toggle('side-open',state.sideOpen);table.classList.toggle('side-wide',state.sideWide&&state.sideTab==='sheet');table.classList.toggle('read-only',readOnly);
 for(const [name,html] of Object.entries(regions))if(!(skipDock&&name==='dock'))patch(table.querySelector(`[data-region="${name}"]`),html);
}

function render(){
 const hadModal=Boolean($('.overlay')),shell=$('#shell'),page=$('#page'),v=tableView(),kind=v?'table':state.page;
 patch($('#nav'),navHtml());
 if(page.dataset.kind!==kind){page.dataset.kind=kind;page.innerHTML=v?TABLE_SKELETON:'';rendered.delete(page);}
 if(v)renderTable(page,v);
 else patch(page,(state.page==='home'?homeHtml(state):state.page==='game'?emptyGameHtml():state.page==='editor'?editorHtml(state):state.page==='rules'?rulesHtml(state):replayIntroHtml(state))+footerHtml());
 patch($('#layer'),bannerHtml(state.banner)+state.modal);
 shell.inert=Boolean(state.modal);
 document.body.dataset.page=kind;document.body.classList.toggle('dialog-open',Boolean(state.modal));
 if(state.modal&&!hadModal)$('.modal .primary, .modal button, .modal input, .modal select')?.focus();
}

/* ---------- game session ---------- */
const animator=createAnimator({state,render,fx,sound:play,reduced});
const session=createSession({state,api,render,animate:animator.animateTransition,land:animator.land,capture:fx.capture,cleanup:fx.cleanup,sound:play,toast,storage:localStorage});
const {step,kick}=session;

const route=page=>{if(location.hash!=='#/'+page)history.pushState(null,'','#/'+page);};
function setPage(page,{push=true}={}){
 if(!PAGES.some(([id])=>id===page))page='home';
 animator.cancel();Object.assign(state,{page,auto:false,modal:'',sideOpen:false,banner:null,pendingOutcome:null});stopReplay();fx.cleanup();
 if(push)route(page);
 render();window.scrollTo(0,0);
 if(page==='home')api('/games').then(saves=>{state.saves=saves;if(state.page==='home')render();}).catch(()=>{});
 kick();
}
function openGame(game){
 animator.cancel();Object.assign(state,{g:game,page:'game',modal:'',selected:null,peekSeat:null,actionError:'',actionErrorCode:'',syncRequired:false,banner:null,pendingOutcome:null,sideOpen:false,sideTab:'intel'});
 localStorage.setItem('tl-game',game.id);route('game');render();
}
const openModal=html=>{state.modal=html;render();};
const closeModal=()=>{state.modal='';render();};
const rememberGame=()=>{const id=state.g?.id||localStorage.getItem('tl-game');if(id){localStorage.setItem('tl-game',id);localStorage.setItem('tl-resume',id);}};

async function placeOn(target){
 const g=state.g,action=g.actions.find(o=>o.command.type==='place'&&o.command.card===state.selected&&o.command.target===target);
 if(!action){toast(g.board[target]?.alive===false?'不能对死者出牌':'今天已经对这里出过牌了');return;}
 await step(action.command);
}
function selectCard(id){
 if(state.working||state.syncRequired||state.g?.busy)return;
 state.selected=state.selected===id?null:id;state.peekSeat=null;play('click_001');render();
}

/* ---------- script workshop ---------- */
const editor=state.editor;
function setDraft(draft){editor.text=JSON.stringify(draft,null,2);editor.report=null;validateSoon();}
function readDraft(){const draft=parseDraft(editor.text);if(!draft)throw Error('剧本 JSON 格式有误');return draft;}
async function validate(){
 const draft=parseDraft(editor.text);
 editor.report=draft?await api('/scripts/validate',draft):{failure:'剧本 JSON 格式有误'};
 return editor.report;
}
async function validDraft(){
 const draft=readDraft(),report=await validate();render();
 if(report.errors.length)throw Error('剧本有误：'+report.errors.map(x=>x.message).join('；'));
 return draft;
}
function validateSoon(){
 clearTimeout(validateSoon.timer);
 validateSoon.timer=setTimeout(()=>validate().then(()=>{if(state.page==='editor')render();}).catch(()=>{}),300);
}
function applyEdit(edit){
 const draft=parseDraft(editor.text);if(!draft)return;
 setDraft(editDraft(draft,edit));render();
}

/* ---------- replay ---------- */
const replay=state.replay;
function stopReplay(){replay.playing=false;clearInterval(stopReplay.timer);}
function seekReplay(at,{fromSlider=false}={}){
 replay.at=Math.max(0,Math.min(replay.data.frames.length-1,at));
 if(!fromSlider)return render();
 // Keep the slider element alive while it is being dragged.
 renderTable($('#page'),replayView(),{skipDock:true});
 $('#replay-position').textContent=`${replay.at+1} / ${replay.data.frames.length}`;
}
function toggleReplay(){
 if(replay.playing){stopReplay();return render();}
 if(replay.at>=replay.data.frames.length-1)replay.at=0;
 replay.playing=true;
 stopReplay.timer=setInterval(()=>{
  if(state.page!=='replay'||!replay.data||replay.at>=replay.data.frames.length-1){stopReplay();return render();}
  seekReplay(replay.at+1);
 },reduced()?1400:900);
 render();
}
async function loadReplay({full=replay.full}={}){
 const g=state.g,data=sanitizePublicReplay(await api(`/games/${g.id}/replay${full?'?full=1':''}`));
 stopReplay();Object.assign(replay,{data,gameId:g.id,full,at:Math.min(replay.gameId===g.id&&replay.data?replay.at:Infinity,data.frames.length-1)});
 animator.cancel();Object.assign(state,{page:'replay',modal:'',banner:null,pendingOutcome:null,sideOpen:false});fx.cleanup();route('replay');render();
}

/* ---------- events ---------- */
const actions={
 sound(){state.sound=!state.sound;localStorage.setItem('tl-sound',state.sound?'on':'off');render();play('click_001');},
 guide(){openModal(guideModal());},
 close:closeModal,
 'dismiss-banner'(){state.banner=null;animator.release();render();},
 'gate-continue':()=>animator.release(),
 skip:()=>animator.skip(),
 speed(){state.speed=state.speed===1?2:1;localStorage.setItem('tl-speed',String(state.speed));render();},
 'toggle-side'(){state.sideOpen=!state.sideOpen;render();},
 tab(b){state.sideTab=b.dataset.tab;render();},
 'rules-tab'(b){state.rulesTab=b.dataset.tab;render();},
 'editor-tab'(b){editor.tab=b.dataset.tab;render();},
 peek(b){state.peekSeat=b.dataset.seat===state.g.turn?null:b.dataset.seat;state.selected=null;render();},
 'clear-selection'(){state.selected=null;render();},
 'sheet-tool'(b){state.sheetTool=b.dataset.tool;render();},
 'sheet-wide'(){state.sideWide=!state.sideWide;render();},
 sheet(b){editMarks(marks=>markRole(marks,b.dataset.c,b.dataset.r,state.sheetTool));},
 'sheet-plot'(b){editMarks(marks=>markPlot(marks,b.dataset.p,state.sheetTool));},
 'sheet-adopt'(b){editMarks(marks=>markRole(marks,b.dataset.c,b.dataset.r,'yes'));},
 // Adopting one lead can settle or void the next, so re-derive after each.
 'sheet-adopt-all'(){
  editMarks(marks=>{
   for(let i=0;i<40;i++){const [lead]=analyze(state.g,marks).hints;if(!lead)break;marks=markRole(marks,lead.character,lead.role,'yes');}
   return marks;
  });
 },
 'sheet-reset'(){if(confirm('清空这一局的全部推理标记？'))editMarks(emptyMarks);},
 reconnect(){rememberGame();location.reload();},
 'sync-state':()=>session.syncState(),
 async truth(){
  const g=state.g;if(!g?.winner)return;
  if(state.truth?.id!==g.id)state.truth={id:g.id,script:await api(`/games/${g.id}/script?full=1`)};
  openModal(truthModal(state.truth.script,g));
 },
 async create(b){
  if(state.creating)return;state.creating=true;b.disabled=true;
  const pick=group=>$(`input[name="${group}"]:checked`).value;
  const type=pick('new-script'),mode=pick('new-mode'),budget=+($('#new-budget')?.value??.5),talk=$('#new-talk').value,opponent=$('#new-opponent').value;
  try{
   const script=type==='editor'?readDraft():type==='starter'?await api('/scripts/starter'):await api('/scripts/generate',{ruleset:type,seed:Date.now(),title:'未曾发生的明天'});
   script.communication=talk;
   const created=await api('/games',{script,mode,budget});
   localStorage.setItem('tl-opp-'+created.id,opponent);openGame(created);play('confirmation_001');
   if(!localStorage.getItem('tl-guide-seen')){localStorage.setItem('tl-guide-seen','1');openModal(guideModal());}
  }finally{state.creating=false;b.disabled=false;}
 },
 async refresh(){state.saves=await api('/games');render();},
 async load(b){state.auto=false;openGame(await api('/games/'+b.dataset.id));await session.resumeRules();},
 async 'execute-first'(){const only=state.g.actions;if(only.length===1)await step(only[0].command);},
 async choose(b){const option=state.g.actions[+b.dataset.index];if(option)await step(option.command);},
 bot:()=>step(undefined,'bot-step'),
 async auto(){if(!state.auto&&state.actionError){state.actionError='';state.actionErrorCode='';}await session.runAuto();},
 'blank-script'(){setDraft(blankDraft());editor.tab='form';render();},
 cast(b){applyEdit({kind:'cast',key:b.dataset.id});},
 async generate(b){await generate(b.dataset.do);},
 'ai-generate':b=>generate(b.dataset.do),
 async 'starter-editor'(){setDraft(await api('/scripts/starter'));render();},
 async validate(){await validate();render();},
 'play-editor'(){readDraft();openModal(newGameModal(state,'mastermind','editor'));},
 async 'export-script'(){download(await validDraft(),'script-private.SPOILERS.json');},
 async 'export-public'(){download(publicDraft(await validDraft()),'script-public.json');},
 async 'print-public'(){download(printableHtml(await validDraft(),false),'script-public.html','text/html');},
 async 'print-private'(){download(printableHtml(await validDraft(),true),'script-private.SPOILERS.html','text/html');},
 async 'save-replay'(){download(sanitizePublicReplay(await api(`/games/${state.g.id}/replay`)),'replay-public.json');},
 async 'full-replay'(){download(sanitizePublicReplay(await api(`/games/${state.g.id}/replay?full=1`)),'replay-full.SPOILERS.json');},
 'open-replay':()=>loadReplay({full:false}),
 'replay-full':()=>loadReplay({full:!replay.full}),
 'close-replay'(){stopReplay();Object.assign(replay,{data:null,gameId:null,full:false,at:0});render();},
 'replay-prev'(){stopReplay();seekReplay(replay.at-1);},
 'replay-next'(){stopReplay();seekReplay(replay.at+1);},
 'replay-play':toggleReplay,
 'offline-replay'(){download(offlineReplayHtml(replay.data),'tragedy-replay-offline.html','text/html');},
 async branch(){
  if(replay.gameId!==state.g?.id)throw Error('导入的回放不能创建分支');
  stopReplay();openGame(await api(`/games/${state.g.id}/branch`,{revision:replayView().revision}));
 }
};
async function generate(kind){
 if(state.working)return;
 const gen=editor.generator,config={ruleset:gen.ruleset,seed:+gen.seed,title:gen.theme||'未曾发生的明天',theme:gen.theme};
 state.working=true;render();
 try{
  const data=await api(kind==='generate'?'/scripts/generate':'/scripts/ai-generate',config);
  setDraft(data.script||data);
  toast(kind==='generate'?'已生成剧本':'AI 润色完成，约 $'+data.estimatedCost.toFixed(5));
 }finally{state.working=false;render();}
}

document.addEventListener('click',async e=>{
 try{
  if(e.target.closest('a[data-reauth]')){rememberGame();return;}
  const card=e.target.closest('[data-card]');
  if(card){if(!card.disabled)selectCard(card.dataset.card);return;}
  const onBoard=state.page==='game'&&state.selected,character=e.target.closest('[data-character]');
  if(character){
   if(onBoard&&character.closest('.board'))await placeOn(character.dataset.character);
   else openModal(characterModal(character.dataset.character,character.closest('.table')?tableView():null));
   kick();return;
  }
  const zone=e.target.closest('.board [data-zone]');
  if(zone&&onBoard){await placeOn(zone.dataset.zone);kick();return;}
  const b=e.target.closest('[data-do]');if(!b)return;
  const name=b.dataset.do;
  if(name.startsWith('nav-'))return setPage(name.slice(4));
  if(name==='new'||name.startsWith('new-')){state.auto=false;openModal(newGameModal(state,name==='new'?'heroes':name.slice(4)));return;}
  await actions[name]?.(b);
  kick();
 }catch(error){state.auto=false;toast(error.message,'error');render();play('error_001');}
});

document.addEventListener('input',e=>{
 const t=e.target;
 if(t.id==='gen-seed')editor.generator.seed=+t.value;
 else if(t.id==='gen-theme')editor.generator.theme=t.value;
 else if(t.id==='notes')localStorage.setItem('note-'+t.dataset.note,t.value);
 else if(t.id==='script-editor'){editor.text=t.value;editor.report=null;validateSoon();}
 else if(t.id==='replay-range'){stopReplay();seekReplay(+t.value,{fromSlider:true});}
});

document.addEventListener('change',async e=>{
 const t=e.target;
 try{
  if(t.id==='replay-range')return render();
  if(t.id==='gen-set'){editor.generator.ruleset=t.value;return;}
  if(t.dataset.edit)return applyEdit({kind:t.dataset.edit,key:t.dataset.key,value:t.value});
  if(t.dataset.sheetCulprit)return editMarks(marks=>markCulprit(marks,t.dataset.sheetCulprit,t.value));
  if(t.id==='autoplay'){
   state.autoPlay=t.checked;localStorage.setItem('tl-autoplay',t.checked?'on':'off');if(!t.checked)state.auto=false;
   render();kick();return;
  }
  if(t.id==='script-file'||t.id==='replay-file'){
   const file=t.files[0];if(!file)return;
   if(file.size>20*1024*1024)throw Error('文件太大，最多 20MB');
   const data=JSON.parse(await file.text());
   if(t.id==='script-file')setDraft(data);
   else{validateReplay(data,state.catalog);stopReplay();Object.assign(replay,{data:sanitizePublicReplay(data),at:0,gameId:null,full:false});}
   render();
  }
 }catch(error){toast(error.message,'error');}
});

// Hovering a choice shows who or where it affects.
document.addEventListener('mouseover',e=>{
 const b=e.target.closest('[data-hl]');
 document.querySelectorAll('.hl').forEach(el=>el.classList.remove('hl'));
 if(b)document.querySelectorAll(`.board [data-character="${CSS.escape(b.dataset.hl)}"],.board [data-zone="${CSS.escape(b.dataset.hl)}"]`).forEach(el=>el.classList.add('hl'));
});

document.addEventListener('keydown',e=>{
 const typing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName),g=state.g;
 if(e.key==='Escape'){
  if(state.banner)actions['dismiss-banner']();
  else if(state.modal)closeModal();
  else if(state.selected||state.peekSeat){state.selected=null;state.peekSeat=null;render();}
  else if(state.sideOpen){state.sideOpen=false;render();}
  return;
 }
 if(e.key==='Tab'&&state.modal){
  const items=[...document.querySelectorAll('.modal button:not(:disabled),.modal input,.modal select,.modal textarea,.modal a[href]')],first=items[0],last=items.at(-1);
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  return;
 }
 if(state.modal||typing)return;
 if(state.playback?.gate&&['Enter',' '].includes(e.key)&&document.activeElement?.tagName!=='BUTTON'){e.preventDefault();animator.release();return;}
 if(state.page==='replay'&&replay.data&&['ArrowLeft','ArrowRight'].includes(e.key)){stopReplay();seekReplay(replay.at+(e.key==='ArrowRight'?1:-1));return;}
 if(/^[1-9]$/.test(e.key)&&state.page==='game'&&g&&humanTurn(g)&&PLACING.includes(g.phaseId)&&!state.working){
  const card=g.hand[+e.key-1];if(card?.available)selectCard(card.id);
 }
});

window.addEventListener('hashchange',()=>{const page=location.hash.replace(/^#\//,'');if(page!==state.page)setPage(page,{push:false});});

/* ---------- start ---------- */
try{
 [state.catalog,state.info,state.saves]=await Promise.all([api('/catalog'),api('/info'),api('/games')]);
 setCatalog(state.catalog);
 const id=localStorage.getItem('tl-game'),resume=localStorage.getItem('tl-resume'),wanted=location.hash.replace(/^#\//,'');
 if(id)try{state.g=await api('/games/'+id);if(resume===id){state.page='game';localStorage.removeItem('tl-resume');}}catch(error){if(resume)throw error;if(error.status===404)localStorage.removeItem('tl-game');}
 if(PAGES.some(([page])=>page===wanted)&&!(wanted==='game'&&!state.g))state.page=wanted;
 $('#app').innerHTML='<div id="shell"><header class="nav" id="nav"></header><div id="page"></div></div><div id="layer"></div>';
 render();
 if(state.page==='game'){await session.resumeRules();kick();}
}catch(error){
 $('#app').innerHTML=`<main class="startup-error"><h1>连接失败</h1><p>${esc(error.message)}</p>${error.requiresLogin?'<a class="btn primary" data-reauth href="/signin-with-chatgpt" target="_top">重新登录</a>':btn('重新连接','reconnect','primary')}</main>`;
}

// Drives one game against the server: submits steps, recovers from uncertain results and
// keeps the opponent moving. Everything it touches is injected so it runs without a browser.
import {humanTurn} from './guidance.mjs';
import {PLACING} from './lookup.mjs';
import {failure,NOTABLE} from './deduce.mjs';

const mark=g=>g.id+':'+g.revision;
const fresh=(prev,next)=>next.log.filter(e=>e.n>prev.log.length);

// The closing banner, once a step has decided the game: who won, and what the deciding step showed.
export function outcomeBanner(prev,next){
 if(!next.winner||prev.winner)return null;
 const heroesWon=next.winner==='heroes',yours=next.mode==='observe'?'':(next.mode!=='mastermind')===heroesWon?' · 你赢了':' · 你输了',news=fresh(prev,next);
 return {kind:heroesWon?'victory':'defeat',title:heroesWon?'明天，终于到来。':'惨剧，再度重演。',
  ...(news.some(e=>e.type==='failed')?failure(next):{}),recap:news.filter(e=>NOTABLE.includes(e.type)).slice(-4),
  lines:[`${heroesWon?'主人公':'剧作家'}获胜${yours}`,...news.filter(e=>e.type==='guess').slice(-3).map(e=>e.text)]};
}

export function createSession({state,api,render,animate=async()=>{},capture=()=>({}),cleanup=()=>{},sound=()=>{},toast=()=>{},storage,uuid=()=>crypto.randomUUID(),wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 function recordDecision(prev,next){
  const d=next.decision;
  if(d?.reason){state.aiFeed.push({gameId:next.id,seat:d.seat,text:d.reason,loop:prev.loop,day:prev.day,at:prev.log.length});if(state.aiFeed.length>200)state.aiFeed.shift();}
  state.pendingOutcome=outcomeBanner(prev,next)||state.pendingOutcome;
 }
 function showOutcome(){
  if(!state.pendingOutcome)return;
  if(state.page==='game'){state.banner=state.pendingOutcome;sound('bong_001');}
  state.pendingOutcome=null;render();
 }

 async function syncState(){
  if(state.working||!state.g)return;
  const id=state.g.id;state.working=true;state.requestKind='sync';state.auto=false;render();
  try{
   const latest=await api('/games/'+id);if(state.g?.id!==id)return;
   state.g=latest;state.selected=null;state.syncRequired=Boolean(latest.busy);
   state.actionError=latest.busy?'还在处理中，请稍后再同步。':'';state.actionErrorCode='';
   toast(latest.busy?'还在处理中':'已同步');
  }catch(error){state.syncRequired=true;state.actionError=error.message;state.actionErrorCode=error.code;toast(error.message,'error');}
  finally{state.working=false;state.requestKind='';render();}
 }

 async function step(command,route='command'){
  if(state.working||!state.g)return;
  if(state.syncRequired||state.g.busy){toast('请先同步');return;}
  const prev=state.g,before=capture();let frames=[];
  storage.setItem('tl-game',prev.id);
  state.working=true;state.requestKind=route==='advance'?'rules':route==='ai-step'||route==='bot-step'&&!humanTurn(prev)?'ai':'human';
  state.actionError='';state.actionErrorCode='';render();
  try{
   const updated=await api(`/games/${prev.id}/${route}`,{revision:prev.revision,commandId:uuid(),command});
   if(state.g?.id!==prev.id)return;
   frames=updated.transitionFrames||[];state.g=updated;state.selected=null;state.peekSeat=null;state.syncRequired=false;state.advancedRevision=mark(updated);
   if(updated.decision?.controller==='规则引擎')state.requestKind='rules';
   recordDecision(prev,updated);
  }catch(error){
   // The request may or may not have been applied. Only ever re-read; never resend.
   state.auto=false;let recovered=false;
   if(state.g?.id===prev.id)try{state.g=await api('/games/'+prev.id);state.selected=null;recovered=true;}catch{}
   state.syncRequired=!recovered||Boolean(state.g?.busy);state.actionErrorCode=error.code;
   const status=!recovered?'无法核对局面，请同步或重新连接。':state.g.busy?'还在处理中，请稍后同步。':state.g.revision>prev.revision?'局面已更新，请确认后继续。':'局面未变，可以重试。';
   state.actionError=error.message+' '+status+(error.uncertain&&route==='ai-step'?' 未自动重发，避免重复计费。':'');
   error.message=state.actionError;throw error;
  }finally{
   try{if(state.g?.id===prev.id)await animate(prev,state.g,before,frames);}
   catch{cleanup();}
   finally{state.transitionView=null;state.working=false;state.requestKind='';render();showOutcome();}
  }
 }

 const aiRoute=()=>state.info.configured&&storage.getItem('tl-opp-'+state.g.id)!=='bot'?'ai-step':'bot-step';
 const settled=g=>PLACING.includes(g.phaseId)||state.advancedRevision===mark(g);

 // Runs forced rule steps and opponent turns until a human decision, the end, or a pause.
 async function runAuto(){
  if(state.working&&!state.auto)return;
  if(state.auto){state.auto=false;render();return;}
  if(state.syncRequired||state.g?.busy){toast('请先同步');return;}
  state.auto=true;render();
  try{
   for(let i=0;i<180&&state.auto&&state.g&&!state.g.winner;i++){
    if(!settled(state.g)){await step(undefined,'advance');if(!state.auto||!state.g||state.g.winner||state.syncRequired)break;}
    if(humanTurn(state.g))break;
    await step(undefined,aiRoute());
    await wait(humanTurn(state.g)?80:380);
   }
  }finally{state.auto=false;render();}
 }

 function kick(){
  const g=state.g;
  if(!state.autoPlay||state.page!=='game'||!g||g.winner||humanTurn(g)||state.working||state.auto||state.syncRequired||state.actionError||g.busy)return;
  const id=g.id;
  wait(350).then(()=>{
   if(state.g?.id===id&&state.page==='game'&&!state.working&&!state.auto&&!humanTurn(state.g))runAuto().catch(error=>{toast(error.message,'error');sound('error_001');render();});
  });
 }

 async function resumeRules(){
  const g=state.g;
  if(!g||g.winner||g.busy||state.syncRequired||settled(g))return;
  try{await step(undefined,'advance');}catch(error){toast(error.message,'error');}
 }

 return {step,syncState,runAuto,kick,resumeRules,aiRoute};
}

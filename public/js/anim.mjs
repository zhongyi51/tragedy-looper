// Plays a server step one result at a time: a card lands, six flip, someone moves, a counter ticks.
// Days and failed loops end on a gate that waits for the player.
import {COUNTERS} from './lookup.mjs';

const placementKey=p=>p.seat+':'+p.target;
const sameDay=(a,b)=>a.day===b.day&&a.loop===b.loop;
const justRevealed=(prev,next)=>next.revealedCards?.length===6&&(!prev.revealedCards?.length||!sameDay(prev,next));
const added=(prev,next)=>(next.log||[]).filter(e=>e.n>(prev.log?.length||0));

// How long a result stays up once its motion has finished, in ms at 1× speed.
const HOLD={placed:150,cards:350,move:300,counter:200,day:100,death:250,incident:250,reveal:250,refused:250};
const HOLD_TEXT=800;
const SOUND={placed:'drop_001',cards:'open_001',death:'error_001',failed:'glitch_001'};
const QUIET=/没有发生|没有效果/;
// Results nobody should miss get a caption across the board: [style, ms on screen].
const callout=e=>e.type==='death'?['danger',1500]:e.type==='incident'?[QUIET.test(e.text)?'info':'danger',1500]:e.type==='reveal'?['info',1600]:e.type==='refused'?['warn',1300]:e.type==='day'?['day',850]:e.type==='loop'?['day',1100]:null;

export const NOTABLE=['death','incident','reveal','refused'];
export const dayRecap=v=>v.log.filter(e=>e.loop===v.loop&&e.day===v.day&&NOTABLE.includes(e.type)).map(e=>e.text);

function loopBanner(v){
 const left=v.script.loops-v.loop;
 return {kind:'loop',title:`第 ${v.loop} 轮回失败`,lines:[...dayRecap(v).slice(-3),left>0?`还能重来 ${left} 次`:'进入最后的战斗']};
}

export function createAnimator({state,render,fx,sound=()=>{},reduced=()=>false,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 let wake=null,open=null,skipping=false,cancelled=false;
 const live=id=>!cancelled&&state.page==='game'&&state.g?.id===id;
 const pause=ms=>skipping||cancelled?null:new Promise(done=>{wake=done;wait(ms/(state.speed||1)).then(done);});

 // Holds the table until the player continues; spectators are moved on after `auto` ms.
 function gate(show,auto){
  return new Promise(done=>{
   const mine=open=()=>{if(open===mine)open=null;done();};
   show();render();
   if(auto)wait(auto).then(mine);
  });
 }
 function release(){open?.();}
 function skip(){skipping=true;fx.finish();wake?.();}
 function cancel(){cancelled=true;skip();release();}

 function stopAt(entries,snap,final){
  if(entries.some(e=>e.type==='failed'))return final.winner&&snap.loop>=snap.script.loops?null:'loop';
  return entries.some(e=>e.type==='dayend')?'day':null;
 }

 async function beat(prev,snap,entries,positions,origin,motion){
  const pb=state.playback,main=entries.at(-1);
  if(main){pb.entry=main;pb.spot=main.who?{who:main.who,by:main.by}:null;}
  for(const e of entries)if(SOUND[e.type])sound(SOUND[e.type]);
  if(!motion){state.transitionView=snap;render();if(entries.length)await pause(HOLD_TEXT);return;}
  if(justRevealed(prev,snap)){
   // Flip all six on the old board first, so nobody moves before the cards can be read.
   const flipped={...snap,phaseId:'cultist',phase:'翻牌结算',placements:snap.revealedCards,board:prev.board,locations:prev.locations};
   state.transitionView=flipped;render();await fx.cards(prev,flipped,origin);
   positions=fx.positions();state.transitionView=snap;render();
  }else{state.transitionView=snap;render();await fx.cards(prev,snap,origin);}
  const notes=entries.map(e=>[e,callout(e)]).filter(([,c])=>c).slice(-3);
  await Promise.all([fx.changes(prev,snap,positions),notes.length&&fx.announce(notes.map(([e])=>e.text.replace(/。$/,'')),notes.at(-1)[1][0],Math.max(...notes.map(([,c])=>c[1])))]);
  await pause(main?HOLD[main.type]??HOLD_TEXT:150);
 }

 // before: {positions, origin, dock} captured from the DOM before the request was sent.
 async function animateTransition(prev,next,before={},frames=[]){
  if(state.page!=='game')return;
  const snapshots=frames.map(frame=>({...next,...frame}));
  if(!snapshots.length||snapshots.at(-1).revision!==next.revision)snapshots.push(next);
  const motion=!reduced()&&fx.supported(),observer=next.mode==='observe';
  cancelled=skipping=false;
  state.playback={entry:null,spot:null,gate:null,trail:[],at:0,total:snapshots.length};state.requestKind='animation';
  fx.freeze(before.dock);
  let previous=prev,positions=before.positions||{};
  try{
   for(const [index,snap] of snapshots.entries()){
    if(!live(next.id))break;
    const entries=added(previous,snap),stop=stopAt(entries,snap,next),pb=state.playback;
    pb.at=index+1;pb.trail.push(...entries);
    if(!skipping||stop||index===snapshots.length-1)await beat(previous,snap,entries,positions,index===0?before.origin:undefined,motion&&!skipping);
    if(stop&&live(next.id)){
     // The gate may need more room than the frozen dock; let it reflow while nothing is moving.
     pb.spot=null;fx.thaw();
     if(stop==='day')await gate(()=>{pb.gate={day:snap.day,last:snap.day>=snap.script.days,lines:dayRecap(snap),auto:observer};},observer&&2600);
     else{await gate(()=>{state.banner=loopBanner(snap);},observer&&3600);state.banner=null;}
     pb.gate=null;skipping=false;fx.freeze();
    }
    previous=snap;positions=motion?fx.positions():{};
   }
  }finally{state.playback=null;state.transitionView=null;fx.thaw();}
 }
 return {animateTransition,release,skip,cancel};
}

const rectOf=el=>el?.getBoundingClientRect();

// speed: () => playback rate. Every animation it starts can be finished early by finish().
export function domFx(doc=document,speed=()=>1){
 const all=selector=>[...doc.querySelectorAll(selector)],running=new Set();
 const ms=n=>n/(speed()||1);
 const run=(el,keyframes,options)=>{
  const animation=el.animate(keyframes,{...options,duration:ms(options.duration),delay:ms(options.delay||0)});
  running.add(animation);
  return animation.finished.catch(()=>{}).then(()=>{running.delete(animation);});
 };
 const positions=()=>Object.fromEntries(all('.board [data-character]').map(el=>[el.dataset.character,rectOf(el)]));
 const dock=()=>doc.querySelector('.r-dock');
 const cleanup=()=>all('.fx-flight,.fx-delta,.announce').forEach(el=>el.remove());
 const finish=()=>{for(const animation of [...running])try{animation.finish();}catch{}};

 function capture(){
  const origin=rectOf(doc.querySelector('.hcard.chosen'))||rectOf(doc.querySelector('.dock .emblem'));
  return {positions:positions(),origin,dock:rectOf(dock())?.height};
 }
 // The dock keeps its height while results play, so the board under them never reflows.
 function freeze(height=rectOf(dock())?.height){const el=dock();if(el&&height){el.style.height=height+'px';el.classList.add('frozen');}}
 function thaw(){const el=dock();if(el){el.style.height='';el.classList.remove('frozen');}}

 async function cards(prev,next,origin){
  const jobs=[],fresh=all('.board [data-placement]:not(.resolved)').filter(el=>!prev.placements?.some(p=>placementKey(p)===el.dataset.placement)||!sameDay(prev,next));
  const flipping=justRevealed(prev,next);
  if(flipping)all('.board .mini.face-up:not(.resolved) .mini-inner').forEach((el,i)=>jobs.push(run(el,[{transform:'rotateY(0deg)'},{transform:'rotateY(180deg)'}],{duration:520,delay:(fresh.length?370:0)+i*90,easing:'cubic-bezier(.2,.7,.3,1)',fill:'backwards'})));
  for(const el of fresh){
   const to=rectOf(el),table=rectOf(doc.querySelector('.board')),from=origin||{x:table.x+table.width/2,y:table.y+table.height,width:40,height:56};
   const fly=el.cloneNode(true);fly.removeAttribute('data-placement');fly.setAttribute('aria-hidden','true');fly.classList.add('fx-flight');fly.classList.remove('face-up');
   Object.assign(fly.style,{left:to.x+'px',top:to.y+'px',width:to.width+'px',height:to.height+'px'});fly.style.setProperty('--mini-w',to.width+'px');doc.body.append(fly);el.style.opacity='0';
   const dx=from.x+from.width/2-to.x-to.width/2,dy=from.y+from.height/2-to.y-to.height/2;
   jobs.push(run(fly,[{transform:`translate(${dx}px,${dy}px) rotate(-14deg) scale(1.6)`,opacity:.2},{transform:'translate(0,0) rotate(3deg) scale(1.08)',opacity:1,offset:.82},{transform:'none',opacity:1}],{duration:420,easing:'cubic-bezier(.2,.7,.25,1)'}).then(()=>{el.style.opacity='';fly.remove();}));
  }
  await Promise.all(jobs);
 }

 function floatDelta(el,text,cls){
  const r=rectOf(el),tag=doc.createElement('span');tag.className='fx-delta '+cls;tag.textContent=text;tag.setAttribute('aria-hidden','true');
  Object.assign(tag.style,{left:r.x+r.width/2+'px',top:r.y+r.height*.4+'px'});doc.body.append(tag);
  return run(tag,[{transform:'translate(-50%,0) scale(.7)',opacity:0},{transform:'translate(-50%,-16px) scale(1.2)',opacity:1,offset:.22},{transform:'translate(-50%,-22px) scale(1)',opacity:1,offset:.72},{transform:'translate(-50%,-46px)',opacity:0}],{duration:1050,easing:'ease-out'}).then(()=>tag.remove());
 }

 function announce(lines,kind,hold){
  const host=doc.querySelector('.board-wrap');if(!host)return null;
  const el=doc.createElement('div');el.className='announce '+kind;el.setAttribute('role','status');
  for(const text of lines){const p=doc.createElement('p');p.textContent=text;el.append(p);}
  host.append(el);
  return run(el,[{opacity:0,transform:'translate(-50%,-50%) scale(.92)'},{opacity:1,transform:'translate(-50%,-50%) scale(1)',offset:.14},{opacity:1,transform:'translate(-50%,-50%) scale(1)',offset:.82},{opacity:0,transform:'translate(-50%,-56%) scale(1)'}],{duration:hold,easing:'ease-out'}).then(()=>el.remove());
 }

 async function changes(prev,next,before){
  const jobs=[];
  for(const el of all('.board [data-character]')){
   const id=el.dataset.character,a=prev.board[id],b=next.board[id],from=before[id],to=rectOf(el);
   if(!b)continue;
   if(from&&a&&a.location!==b.location){
    // The clone travels in a viewport overlay so it can cross zone boundaries without clipping.
    const fly=el.cloneNode(true);fly.removeAttribute('data-character');fly.setAttribute('aria-hidden','true');fly.tabIndex=-1;fly.classList.add('fx-flight');
    // Token sizes come from its zone (a size container), which the clone has left behind.
    Object.assign(fly.style,{left:to.x+'px',top:to.y+'px',width:to.width+'px',height:to.height+'px'});
    fly.style.setProperty('--w',to.width+'px');fly.style.setProperty('--zone',getComputedStyle(el).getPropertyValue('--zone'));
    doc.body.append(fly);el.style.opacity='0';
    const dx=from.x-to.x,dy=from.y-to.y;
    jobs.push(run(fly,[{transform:`translate(${dx}px,${dy}px)`},{transform:`translate(${dx/2}px,${dy/2-22}px) scale(1.08)`,offset:.5},{transform:'none'}],{duration:680,easing:'ease-in-out'}).then(()=>{el.style.opacity='';fly.remove();}));
   }else if(a){
    const deltas=Object.entries(COUNTERS).filter(([k])=>a[k]!==b[k]).map(([k,c])=>[`${c.label} ${b[k]>a[k]?'+':'−'}${Math.abs(b[k]-a[k])}`,c.cls]);
    deltas.forEach(([text,cls],i)=>jobs.push(new Promise(r=>setTimeout(r,ms(i*170))).then(()=>floatDelta(el,text,cls))));
    if(a.alive&&!b.alive)jobs.push(run(el,[{transform:'translateX(0)',filter:'none'},{transform:'translateX(-6px)',filter:'brightness(2.2) saturate(0)',offset:.2},{transform:'translateX(6px)',offset:.4},{transform:'translateX(-3px)',offset:.6},{transform:'none'}],{duration:640}));
    else if(deltas.length)jobs.push(run(el,[{filter:'brightness(1.6)'},{filter:'none'}],{duration:700}));
   }
  }
  for(const el of all('.board .zone')){
   const id=el.dataset.zone,d=(next.locations?.[id]??0)-(prev.locations?.[id]??0);
   if(d)jobs.push(floatDelta(el.querySelector('.zone-intrigue')||el,`暗跃 ${d>0?'+':'−'}${Math.abs(d)}`,'i'));
  }
  const board=doc.querySelector('.board');
  if(prev.loop!==next.loop&&board)jobs.push(run(board,[{opacity:0,filter:'blur(12px) hue-rotate(60deg)',transform:'scale(1.03)'},{opacity:1,filter:'none',transform:'none'}],{duration:900,easing:'ease-out'}));
  await Promise.all(jobs);
 }

 return {positions,capture,freeze,thaw,cards,changes,announce,finish,cleanup,supported:()=>typeof Element!=='undefined'&&typeof Element.prototype.animate==='function'};
}

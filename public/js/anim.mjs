// Plays a server step as visible beats: cards land, flip, people move, counters tick.
import {COUNTERS} from './lookup.mjs';

const VISUAL=['counter','move','death','day','loop','incident','reveal'];
const placementKey=p=>p.seat+':'+p.target;
const sameDay=(a,b)=>a.day===b.day&&a.loop===b.loop;
const justRevealed=(prev,next)=>next.revealedCards?.length===6&&(!prev.revealedCards?.length||!sameDay(prev,next));
const added=(prev,next)=>(next.log||[]).filter(e=>e.n>(prev.log?.length||0));

export function createAnimator({state,render,fx,reduced=()=>false}){
 async function visualStep(prev,next,positions,origin){
  const reveal=justRevealed(prev,next);
  if(reveal||added(prev,next).some(e=>VISUAL.includes(e.type)))state.requestKind='animation';
  if(reveal){
   // Flip all six on the old board first, so nobody moves before the cards can be read.
   const flipped={...next,phaseId:'cultist',phase:'行动结算',placements:next.revealedCards,board:prev.board,locations:prev.locations};
   state.transitionView=flipped;render();await fx.cards(prev,flipped,origin);
   positions=fx.positions();state.transitionView=next;render();
  }else{state.transitionView=next;render();await fx.cards(prev,next,origin);}
  if(state.page==='game'&&state.g?.id===next.id)await fx.changes(prev,next,positions);
 }

 // before: {positions, origin} captured from the DOM before the request was sent.
 async function animateTransition(prev,next,before={},frames=[]){
  if(reduced()||state.page!=='game'||!fx.supported())return;
  const snapshots=frames.map(frame=>({...next,...frame}));
  if(!snapshots.length||snapshots.at(-1).revision!==next.revision)snapshots.push(next);
  let previous=prev,positions=before.positions||{};
  for(const [index,snapshot] of snapshots.entries()){
   if(state.page!=='game'||state.g?.id!==next.id)break;
   await visualStep(previous,snapshot,positions,index===0?before.origin:undefined);
   previous=snapshot;positions=fx.positions();
  }
  state.transitionView=null;
 }
 return {animateTransition};
}

const done=animation=>animation.finished.catch(()=>{});
const rectOf=el=>el?.getBoundingClientRect();

export function domFx(doc=document){
 const all=selector=>[...doc.querySelectorAll(selector)];
 const positions=()=>Object.fromEntries(all('.board [data-character]').map(el=>[el.dataset.character,rectOf(el)]));
 const cleanup=()=>all('.fx-flight,.fx-delta,.announce').forEach(el=>el.remove());

 function capture(){
  const origin=rectOf(doc.querySelector('.hcard.chosen'))||rectOf(doc.querySelector('.dock .emblem'));
  return {positions:positions(),origin};
 }

 async function cards(prev,next,origin){
  const running=[],fresh=all('.board [data-placement]:not(.resolved)').filter(el=>!prev.placements?.some(p=>placementKey(p)===el.dataset.placement)||!sameDay(prev,next));
  const flipping=justRevealed(prev,next);
  if(flipping)all('.board .mini.face-up:not(.resolved) .mini-inner').forEach((el,i)=>running.push(done(el.animate([{transform:'rotateY(0deg)'},{transform:'rotateY(180deg)'}],{duration:520,delay:(fresh.length?370:0)+i*80,easing:'cubic-bezier(.2,.7,.3,1)',fill:'backwards'}))));
  for(const el of fresh){
   const to=rectOf(el),table=rectOf(doc.querySelector('.board')),from=origin||{x:table.x+table.width/2,y:table.y+table.height,width:40,height:56};
   const fly=el.cloneNode(true);fly.removeAttribute('data-placement');fly.setAttribute('aria-hidden','true');fly.classList.add('fx-flight');fly.classList.remove('face-up');
   Object.assign(fly.style,{left:to.x+'px',top:to.y+'px',width:to.width+'px',height:to.height+'px'});fly.style.setProperty('--mini-w',to.width+'px');doc.body.append(fly);el.style.opacity='0';
   const dx=from.x+from.width/2-to.x-to.width/2,dy=from.y+from.height/2-to.y-to.height/2;
   running.push(done(fly.animate([{transform:`translate(${dx}px,${dy}px) rotate(-14deg) scale(1.6)`,opacity:.2},{transform:'translate(0,0) rotate(3deg) scale(1.08)',opacity:1,offset:.82},{transform:'none',opacity:1}],{duration:420,easing:'cubic-bezier(.2,.7,.25,1)'})).then(()=>{el.style.opacity='';fly.remove();}));
  }
  await Promise.all(running);
  // Leave the revealed faces up long enough to read before anything resolves.
  if(flipping)await new Promise(r=>setTimeout(r,650));
 }

 function floatDelta(el,text,cls){
  const r=rectOf(el),tag=doc.createElement('span');tag.className='fx-delta '+cls;tag.textContent=text;tag.setAttribute('aria-hidden','true');
  Object.assign(tag.style,{left:r.x+r.width/2+'px',top:r.y+r.height*.4+'px'});doc.body.append(tag);
  return done(tag.animate([{transform:'translate(-50%,0) scale(.7)',opacity:0},{transform:'translate(-50%,-16px) scale(1.15)',opacity:1,offset:.22},{transform:'translate(-50%,-22px) scale(1)',opacity:1,offset:.7},{transform:'translate(-50%,-48px)',opacity:0}],{duration:1250,easing:'ease-out'})).then(()=>tag.remove());
 }

 // A short caption over the board for the beats a player must not miss.
 function announce(prev,next){
  const lines=[];let kind='info',hold=1500;
  for(const e of added(prev,next)){
   if(e.type==='death'){lines.push(e.text);kind='danger';}
   else if(e.type==='incident'&&/发生/.test(e.text)&&!/没有发生/.test(e.text)){lines.push('事件 · '+e.text);kind='danger';}
   else if(e.type==='reveal')lines.push(e.text);
   else if(e.type==='refused'){lines.push(e.text);if(kind==='info')kind='warn';}
  }
  if(!lines.length&&next.day!==prev.day&&next.loop===prev.loop){lines.push(`第 ${next.day} 日`);kind='day';hold=850;}
  const host=doc.querySelector('.board-wrap');
  if(!lines.length||!host)return Promise.resolve();
  const el=doc.createElement('div');el.className='announce '+kind;el.setAttribute('role','status');
  for(const text of lines.slice(-3)){const p=doc.createElement('p');p.textContent=text;el.append(p);}
  host.append(el);
  return done(el.animate([{opacity:0,transform:'translate(-50%,-50%) scale(.92)'},{opacity:1,transform:'translate(-50%,-50%) scale(1)',offset:.14},{opacity:1,transform:'translate(-50%,-50%) scale(1)',offset:.82},{opacity:0,transform:'translate(-50%,-56%) scale(1)'}],{duration:hold,easing:'ease-out'})).then(()=>el.remove());
 }

 async function changes(prev,next,before){
  const running=[announce(prev,next)];
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
    running.push(done(fly.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:`translate(${dx/2}px,${dy/2-22}px) scale(1.08)`,offset:.5},{transform:'none'}],{duration:620,easing:'ease-in-out'})).then(()=>{el.style.opacity='';fly.remove();}));
   }else if(a){
    const deltas=Object.entries(COUNTERS).filter(([k])=>a[k]!==b[k]).map(([k,c])=>[`${c.label} ${b[k]>a[k]?'+':'−'}${Math.abs(b[k]-a[k])}`,c.cls]);
    deltas.forEach(([text,cls],i)=>running.push(new Promise(r=>setTimeout(r,i*170)).then(()=>floatDelta(el,text,cls))));
    if(a.alive&&!b.alive)running.push(done(el.animate([{transform:'translateX(0)',filter:'none'},{transform:'translateX(-6px)',filter:'brightness(2.2) saturate(0)',offset:.2},{transform:'translateX(6px)',offset:.4},{transform:'translateX(-3px)',offset:.6},{transform:'none'}],{duration:640})));
    else if(deltas.length)running.push(done(el.animate([{filter:'brightness(1.5)'},{filter:'none'}],{duration:700})));
   }
  }
  for(const el of all('.board .zone')){
   const id=el.dataset.zone,d=(next.locations?.[id]??0)-(prev.locations?.[id]??0);
   if(d)running.push(floatDelta(el.querySelector('.zone-intrigue')||el,`暗跃 ${d>0?'+':'−'}${Math.abs(d)}`,'i'));
  }
  const board=doc.querySelector('.board');
  if(prev.loop!==next.loop&&board)running.push(done(board.animate([{opacity:0,filter:'blur(12px) hue-rotate(60deg)',transform:'scale(1.03)'},{opacity:1,filter:'none',transform:'none'}],{duration:900,easing:'ease-out'})));
  await Promise.all(running);
 }

 return {positions,capture,cards,changes,cleanup,supported:()=>typeof Element!=='undefined'&&typeof Element.prototype.animate==='function'};
}

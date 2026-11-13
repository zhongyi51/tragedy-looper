import {esc,icon,btn} from '../html.mjs';
import {char,name,seatName,seatMark,cardLabel,cardMeta,phaseLabel,PLACING,SEATS} from '../lookup.mjs';
import {humanTurn,turnGuidance,turnControl,choiceGroups} from '../guidance.mjs';
import {cardFace} from './board.mjs';
import {failure} from '../deduce.mjs';

export const reconnectControl=ctx=>ctx.actionErrorCode==='AUTH'
 ?'<a class="btn" data-reauth href="/signin-with-chatgpt" target="_top">重新登录</a>'
 :btn('重新连接','reconnect');

// Notable results with the phase each happened in: the day-end gate and the loop banner both list them.
export const recapHtml=entries=>`<ul class="recap">${entries.map(e=>`<li class="${esc(e.type)}">${e.phase?`<i>${esc(phaseLabel(e.phase))}</i>`:''}<span>${esc(e.text)}</span></li>`).join('')}</ul>`;

function prompt(v,ctx){
 const guide=turnGuidance(v,ctx),control=turnControl(v,ctx),human=humanTurn(v),selected=ctx.selected&&cardMeta(ctx.selected);
 const detail=selected&&guide.kind==='human'?selected.info+(selected.location?'':' 对地点无效。'):guide.detail;
 const alert=['reconnect','paused'].includes(guide.kind),mark=alert?'!':human?seatMark(v.turn):seatMark(v.turn||'终');
 const thinking=ctx.working&&ctx.requestKind==='ai';
 const recovery=(ctx.actionError&&control?.action!=='sync-state'?btn(icon('sync')+'同步','sync-state','',ctx.working?'disabled':''):'')+(ctx.actionErrorCode==='AUTH'||ctx.syncRequired?reconnectControl(ctx):'');
 const assist=human&&!alert?btn('代走','bot','ghost small',`title="让机器人替你走这一步"${ctx.working?' disabled':''}`):'';
 return `<div class="prompt ${guide.kind}${ctx.working?' is-working':''}">
  <span class="emblem ${alert?'alert':v.turn==='M'?'mm':'hero'}${human?' you':''}" aria-hidden="true">${esc(mark)}</span>
  <div class="prompt-copy" aria-live="polite"><small class="kicker">${esc(v.phase)}</small><b>${esc(guide.title)}${thinking?'<span class="dots"><i></i><i></i><i></i></span>':''}</b>${detail?`<p>${esc(detail)}</p>`:''}</div>
  <div class="prompt-actions">${control?btn((control.icon?icon(control.icon):'')+esc(control.label),control.action,control.quiet?'':'primary',control.disabled?'disabled':''):''}${recovery}${assist}</div>
 </div>`;
}

// Six slots: who has put a card where today. Protagonist slots follow the leader's order.
function tracker(v,ctx){
 if(![...PLACING,'cultist'].includes(v.phaseId))return '';
 const mine=v.mode==='heroes',lead=SEATS.indexOf(v.leader),order=[...SEATS.slice(lead),...SEATS.slice(0,lead)],mm=v.placements.filter(p=>p.seat==='M');
 const slot=(seat,p,current,extra='')=>{
  const label=p?`${p.card?cardLabel(p.card)+' → ':''}${name(p.target)}`:current?'出牌中':'';
  const peek=mine&&seat!=='M'&&v.hands&&PLACING.includes(v.phaseId)&&humanTurn(v)&&!ctx.playback;
  const cls=`slot ${seat==='M'?'mm':'hero'}${p?' filled':''}${current?' current':''}${peek&&(ctx.peekSeat||v.turn)===seat?' viewing':''}`;
  const inner=`<b>${esc(seatMark(seat))}</b>${extra}${label?`<span>${esc(label)}</span>`:''}`;
  return peek?`<button type="button" class="${cls}" data-do="peek" data-seat="${seat}" title="看${esc(seatName(seat))}的手牌">${inner}</button>`:`<span class="${cls}" title="${esc(seatName(seat)+'：'+(label||'未出'))}">${inner}</span>`;
 };
 return `<div class="tracker" aria-label="今日出牌"><span class="tracker-label">出牌 <b>${v.placements.length}</b>/6</span>
  ${[0,1,2].map(i=>slot('M',mm[i],v.phaseId==='mm_cards'&&i===mm.length)).join('')}<i class="tracker-gap"></i>
  ${order.map(seat=>slot(seat,v.placements.find(p=>p.seat===seat),v.phaseId==='hero_cards'&&v.turn===seat,seat===v.leader?`<em title="领导者">${icon('crown')}</em>`:'')).join('')}</div>`;
}

function hand(v,ctx,blocked){
 const peeking=ctx.peekSeat&&ctx.peekSeat!==v.turn&&v.hands?.[ctx.peekSeat],cards=peeking||v.hand;
 const card=(c,i)=>{
  const meta=cardMeta(c.id),chosen=ctx.selected===c.id,usable=c.available&&!peeking;
  const note=!c.available?'已用':c.once?'每轮回一次':'';
  return `<button type="button" class="hcard fam-${meta.family}${meta.forbid?' forbid':''}${chosen?' chosen':''}${c.available?'':' spent'}" data-card="${c.id}" ${!usable||blocked?'disabled':''} aria-pressed="${chosen}" title="${esc(c.label+'：'+meta.info)}">
   ${i<9&&usable?`<span class="hcard-key">${i+1}</span>`:''}${c.once?'<span class="hcard-once" title="每轮回只能用一次">Ⅰ</span>':''}
   ${cardFace(c.id)}<span class="hcard-name">${esc(c.label)}</span>${note?`<span class="hcard-note">${note}</span>`:''}
  </button>`;
 };
 return `<div class="hand${peeking?' peeking':''}" role="group" aria-label="${esc(seatName(peeking?ctx.peekSeat:v.turn))}的手牌">${peeking?`<span class="hand-peek">${esc(seatName(ctx.peekSeat))}的手牌（只能看）</span>`:''}${cards.map(card).join('')}</div>`;
}

function choices(v,blocked,sheet){
 const pass=v.actions.findIndex(o=>o.command.type==='pass'),groups=choiceGroups(v,sheet),off=blocked?' disabled':'';
 if(v.phaseId==='between'){
  const next=v.actions.findIndex(o=>o.command.type==='next_loop'),final=v.actions.findIndex(o=>o.command.type==='final_battle');
  const why=failure(v);
  return `<div class="between">${why?`<div class="why"><b><i>${esc(why.stamp)}</i>${esc(why.cause)}</b>${why.detail?`<small>${esc(why.detail)}</small>`:''}</div>`:''}<p>人物和计数会复原，查出的角色和你的推理都会保留。</p>
   <div class="row">${next>=0?btn(icon('loop')+`开始第 ${v.loop+1} 轮回`,'choose','primary big',`data-index="${next}"${off}`):''}${final>=0?btn('放弃剩下的轮回，进入最后的战斗','choose','',`data-index="${final}"${off}`):''}</div></div>`;
 }
 const group=gr=>`<div class="choice-group">${gr.title?`<div class="choice-head">${gr.actor?`<img src="/${char(gr.actor).portrait}" alt="">`:''}<div><b>${esc(gr.title)}</b>${gr.detail?`<small>${esc(gr.detail)}</small>`:''}</div></div>`:''}
  <div class="choice-items">${gr.items.map(it=>`<button type="button" class="choice ${it.cls||''}" data-do="choose" data-index="${it.i}"${it.hl?` data-hl="${esc(it.hl)}"`:''}${off}>${esc(it.text)}</button>`).join('')}</div></div>`;
 return `<div class="choices${v.phaseId==='guess'?' guess':''}">${groups.map(group).join('')}
  ${pass>=0?`<div class="choice-pass">${btn(esc(v.actions[pass].label),'choose',groups.length?'':'primary',`data-index="${pass}"${off}`)}</div>`:''}</div>`;
}

function outcome(v){
 const win=v.winner==='heroes',yours=v.mode==='observe'?'':(v.mode!=='mastermind')===win?' · 你赢了':' · 你输了';
 return `<div class="outcome ${win?'heroes':'mastermind'}"><span class="outcome-mark" aria-hidden="true">${icon(win?'sun':'skull')}</span><div><b>${win?'明天，终于到来。':'惨剧，再度重演。'}</b><p>${win?'主人公':'剧作家'}获胜${yours} · 共 ${v.loop} 个轮回</p></div>
  <div class="row">${btn('查看真相','truth','primary')}${btn('回放','open-replay')}${btn('导出回放','full-replay','ghost')}${btn(icon('plus')+'再来一局','new')}</div></div>`;
}

function waiting(v,ctx){
 const last=ctx.aiFeed?.filter(f=>f.gameId===v.id).at(-1);
 return last?`<div class="waiting"><span class="bubble"><b>${esc(seatName(last.seat))}</b>「${esc(last.text)}」</span></div>`:'';
}

// While a step plays back: the result on screen now, the ones before it, and the day's closing gate.
function playback(v,ctx){
 const {entry,gate,trail,at,total}=ctx.playback;
 const top=gate
  ?`<div class="prompt gate"><span class="emblem you" aria-hidden="true">${icon('clock')}</span>
    <div class="prompt-copy" aria-live="polite"><small class="kicker">第 ${v.loop} 轮回</small><b>第 ${gate.day} 日结束</b>${gate.recap.length?recapHtml(gate.recap):'<p>今天平安无事。</p>'}</div>
    <div class="prompt-actions">${btn(esc(gate.last?'查看结果':`进入第 ${gate.day+1} 日`)+icon('next'),'gate-continue','primary big',gate.auto?'title="稍后会自动继续"':'')}</div></div>`
  :`<div class="prompt playing"><span class="emblem" aria-hidden="true">${icon('play')}</span>
    <div class="prompt-copy" aria-live="polite"><small class="kicker">${esc(v.phase)}${total>1?` · ${at}/${total}`:''}</small><b class="beat ${esc(entry?.type||'')}">${esc(entry?.text||'结算中')}</b></div>
    <div class="prompt-actions">${btn(ctx.speed+'×','speed','small ghost','title="播放速度"')}${total>1?btn('跳过','skip','small','title="直接看结果"'):''}</div></div>`;
 const earlier=gate?[]:trail.slice(0,-1).slice(-4).reverse();
 return `<div class="dock playback${gate?' human':''}" id="dock"><div class="dock-top">${top}${tracker(v,ctx)}</div>
  ${earlier.length?`<ol class="trail" aria-label="刚才的结果">${earlier.map(e=>`<li class="${esc(e.type)}">${esc(e.text)}</li>`).join('')}</ol>`:''}</div>`;
}

// ctx is the client state (working, selected, peekSeat, playback, errors, aiFeed…); sheet is the deduction analysis.
export function dockHtml(v,ctx,sheet){
 if(ctx.playback)return playback(v,ctx);
 if(v.winner&&!ctx.working)return `<div class="dock over">${outcome(v)}</div>`;
 const human=humanTurn(v),placing=PLACING.includes(v.phaseId),blocked=Boolean(ctx.working||ctx.syncRequired||v.busy);
 const body=human&&placing?hand(v,ctx,blocked):human&&v.actions?.length&&!(v.actions.length===1&&!['between','guess'].includes(v.phaseId))?choices(v,blocked,sheet):!human?waiting(v,ctx):'';
 return `<div class="dock${human?' human':''}${placing&&human?' placing':''}" id="dock" aria-busy="${Boolean(ctx.working)}"><div class="dock-top">${prompt(v,ctx)}${tracker(v,ctx)}</div>${body}</div>`;
}

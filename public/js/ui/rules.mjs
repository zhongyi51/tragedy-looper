import {esc,icon} from '../html.mjs';
import {cat,name,cardMeta,rolesFor,plotsFor,incidentsFor,plotRoles} from '../lookup.mjs';
import {cardFace} from './board.mjs';

const TABS=[['basics','基础规则'],['cards','行动牌'],['cast','人物档案'],['FS','First Steps 规则表'],['BTX','Basic Tragedy Χ 规则表']];
const BASICS=[
 ['胜负','主人公只需完整度过<b>一个</b>轮回而不触发失败条件就获胜。First Steps 中所有轮回都失败则剧作家获胜；Basic Tragedy Χ 此时进入“最后的战斗”：逐一指认每个人物的角色，全部正确才能翻盘，错一次即败。'],
 ['出牌','每天剧作家先盖 3 张牌到不同目标；主人公从领导者开始，每席盖 1 张，三席目标不能重复。双方可以盖在同一目标上。只有暗跃 ±、暗跃禁止对地点有效；其它牌盖在地点上是无效果的佯动。'],
 ['结算','六张牌同时翻开：先移动，再结算计数。同一人物的横移＋纵移合成斜移，同向不叠加。同一天出现两张以上“暗跃禁止”时全部失效，即使它们盖在不同目标上。'],
 ['人物能力','人物的友好达到门槛后，主人公可以在能力阶段请求其能力，不消耗友好。部分秘密角色可以（或必须）拒绝。每项能力分别计次；“每轮回一次”的能力即使被拒绝也算用过。'],
 ['事件','日程只公开事件发生在哪一天，名称与犯人只有剧作家知道。当天的犯人存活、在场且不安达到临界时事件发生，效果由剧作家选择。事件没发生，并不能直接确定谁是犯人。'],
 ['重来','轮回失败后时间倒流：计数器清零、人物回到初始地点、手牌复原，但你已经确认的角色、推理表与笔记都会保留。失败本身就是线索。']
];
const FLOW=['剧作家盖 3 张牌','主人公各盖 1 张','同时翻开并结算','剧作家能力','主人公能力（友好）','事件','日结束'];

const REFUSAL={optional:'可拒绝友好能力',mandatory:'必定拒绝友好能力'};

function basics(){
 return `<ol class="flow" aria-label="一天的流程">${FLOW.map((t,i)=>`<li><b>${i+1}</b><span>${t}</span></li>`).join('')}</ol>
  <div class="rules-grid">${BASICS.map(([h,p],i)=>`<article class="rule-card"><span class="num">0${i+1}</span><h3>${h}</h3><p>${p}</p></article>`).join('')}</div>
  <div class="counter-legend">
   <div class="g">${icon('heart')}<b>友好</b><span>达到人物能力的门槛即可请求能力：公开角色、减少不安、保护他人……</span></div>
   <div class="p">${icon('unrest')}<b>不安</b><span>达到人物的临界值时，若他是当天事件的犯人，事件就会发生。</span></div>
   <div class="i">${icon('intrigue')}<b>暗跃</b><span>堆在人物或地点上，是多数主规则与杀手能力的触发条件。</span></div>
   <div class="gd">${icon('shield')}<b>护卫</b><span>人物将要死亡时改为移除一枚护卫。</span></div>
  </div>`;
}

function cards(){
 const deck=side=>cat().actionDeckEntries.filter(d=>d.side===side).map(d=>{
  const meta=cardMeta(d.actionType);
  return `<div class="deck-card fam-${meta.family}${meta.forbid?' forbid':''}">${cardFace(d.actionType)}<div><b>${esc(d.name_zh)}${d.copiesPerHand>1?' ×'+d.copiesPerHand:''}${d.oncePerLoop?'<i>每轮回一次</i>':''}</b><p>${esc(meta.info)}</p></div></div>`;
 }).join('');
 return `<div class="decks"><section><h3>${icon('users')}主人公 · 每席一套</h3><div class="deck">${deck('protagonist')}</div></section><section><h3>${icon('mask')}剧作家</h3><div class="deck">${deck('mastermind')}</div></section></div>`;
}

function cast(){
 return `<p class="hint">点击人物查看原始卡面与完整能力。</p><div class="archive">${cat().characters.map(c=>`<button type="button" class="archive-card" data-character="${c.id}">
   <span class="archive-art"><img src="/${c.portrait}" alt="" loading="lazy"></span>
   <span class="archive-copy"><strong>${esc(c.name_zh_working)}</strong><small>${esc(name(c.start))} · 不安临界 ${c.paranoiaLimit}</small>${c.abilities.map(a=>`<span class="archive-ability"><i>友好 ${a.minGoodwill}</i>${esc(a.effect_zh)}</span>`).join('')}</span>
  </button>`).join('')}</div>`;
}

function table(set){
 const plot=p=>`<tr><th>${esc(p.name_zh_working)}</th><td>${esc(plotRoles(p))||'—'}</td><td>${esc(p.effect_zh)||'仅由所加入的角色产生效果。'}</td></tr>`;
 const plots=(kind,title)=>`<h3>${title}</h3><div class="table-scroll"><table class="ref-table"><thead><tr><th>规则</th><th>加入的角色</th><th>效果</th></tr></thead><tbody>${plotsFor(set,kind).map(plot).join('')}</tbody></table></div>`;
 return `<p class="lead">${set==='FS'?'入门集合：每个剧本由 1 条主规则与 1 条副规则组成，没有最后的战斗。':'基础集合：每个剧本由 1 条主规则与 2 条副规则组成；所有轮回失败后进入最后的战斗。'}</p>
  ${plots('Y','主规则 Y')}${plots('X','副规则 X')}
  <h3>角色</h3><div class="table-scroll"><table class="ref-table"><thead><tr><th>角色</th><th>限制</th><th>能力</th></tr></thead><tbody>${rolesFor(set).map(r=>`<tr><th>${esc(r.name_zh_working)}</th><td>${[r.maxCount?`至多 ${r.maxCount} 人`:'',REFUSAL[r.goodwillRefusal]||''].filter(Boolean).join('；')||'—'}</td><td>${r.effects_zh.map(esc).join('<br>')||'没有特殊能力。'}</td></tr>`).join('')}</tbody></table></div>
  <h3>事件</h3><div class="table-scroll"><table class="ref-table"><thead><tr><th>事件</th><th>效果</th></tr></thead><tbody>${incidentsFor(set).map(e=>`<tr><th>${esc(e.name_zh_working)}</th><td>${esc(e.effect_zh)}</td></tr>`).join('')}</tbody></table></div>`;
}

export function rulesHtml(state){
 const tab=TABS.some(([id])=>id===state.rulesTab)?state.rulesTab:'basics';
 const body=tab==='cards'?cards():tab==='cast'?cast():tab==='basics'?basics():table(tab);
 return `<main class="wrap rules">
  <div class="page-intro"><div><div class="eyebrow">FIELD GUIDE</div><h1>在轮回中，找到真相。</h1></div><p class="lead">一个剧作家、三套主人公手牌。人物的公开身份与秘密角色不同，事件的犯人也不一定是杀手。</p></div>
  <div class="page-tabs" role="tablist">${TABS.map(([id,label])=>`<button type="button" role="tab" aria-selected="${tab===id}" class="${tab===id?'active':''}" data-do="rules-tab" data-tab="${id}">${label}</button>`).join('')}</div>
  <section class="rules-body tab-${tab}">${body}</section>
  <p class="disclosure">素材采用原作者 Commons 包（CC BY-SA 2.1 Japan，并附游戏相关用途要求）。中文为项目工作译名。规则来源、原始卡面与完整授权说明位于项目的 CREDITS.md。</p>
 </main>`;
}

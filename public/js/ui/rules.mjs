import {esc,icon} from '../html.mjs';
import {cat,name,cardMeta,rolesFor,plotsFor,incidentsFor,plotRoles} from '../lookup.mjs';
import {cardFace} from './board.mjs';

const TABS=[['basics','基础'],['cards','行动牌'],['cast','人物'],['FS','FS 规则表'],['BTX','BTX 规则表'],['MZ','MZ 扩展规则表']];
const BASICS=[
 ['胜负','只要有<b>一个</b>轮回从头到尾没有失败，主人公就赢。每个轮回都失败，剧作家赢；BTX / MZ 下主人公还有最后的战斗：说对所有人物的角色。'],
 ['出牌','每天剧作家先出 3 张，主人公再每人出 1 张。同一方的牌不能出在同一个目标上。只有暗跃牌对地点有效。'],
 ['结算','六张牌一起翻开：先移动，再加减计数。同一天出了两张以上“暗跃禁止”，它们全都无效。'],
 ['能力','人物的友好够了，主人公可以用他的能力。有些角色会拒绝——这本身就是线索。'],
 ['事件','日程名称是否公开由开局设置决定。到预告日满足触发条件，事件才会发生，并公开名称和结果。事件或能力明确要求时，才公开犯人身份。隐藏日程中，主动用人工智能模拟某日会先公开该日名称。'],
 ['重来','轮回失败后回到第一天，人物和计数复原，查出的角色和你的推理都会保留。']
];
const FLOW=['剧作家出 3 张牌','主人公各出 1 张','翻牌结算','剧作家能力','主人公能力','事件','一天结束'];

const REFUSAL={optional:'可以拒绝能力',mandatory:'一定拒绝能力'};

function basics(){
 return `<ol class="flow" aria-label="一天的流程">${FLOW.map((t,i)=>`<li><b>${i+1}</b><span>${t}</span></li>`).join('')}</ol>
  <div class="rules-grid">${BASICS.map(([h,p],i)=>`<article class="rule-card"><span class="num">0${i+1}</span><h3>${h}</h3><p>${p}</p></article>`).join('')}</div>
  <div class="counter-legend">
   <div class="g">${icon('heart')}<b>友好</b><span>够了就能用人物的能力。</span></div>
   <div class="p">${icon('unrest')}<b>不安</b><span>当天的犯人不安满了，事件就会发生。</span></div>
   <div class="i">${icon('intrigue')}<b>暗跃</b><span>大多数失败条件都看它。</span></div>
   <div class="gd">${icon('shield')}<b>护卫</b><span>每点抵消一次死亡。</span></div>
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
 return `<p class="hint">点人物看详情。</p><div class="archive">${cat().characters.map(c=>`<button type="button" class="archive-card" data-character="${c.id}">
   <span class="archive-art"><img src="/${c.portrait}" alt="" loading="lazy"></span>
   <span class="archive-copy"><strong>${esc(c.name_zh_working)}</strong><small>${esc(name(c.start))} · 不安上限 ${c.paranoiaLimit}</small>${c.abilities.map(a=>`<span class="archive-ability"><i>友好 ${a.minGoodwill}</i>${esc(a.effect_zh)}</span>`).join('')}</span>
  </button>`).join('')}</div>`;
}

function table(set){
 const plot=p=>`<tr><th>${esc(p.name_zh_working)}</th><td>${esc(plotRoles(p))||'—'}</td><td>${esc(p.effect_zh)||'没有额外效果，只带来角色。'}</td></tr>`;
 const plots=(kind,title)=>`<h3>${title}</h3><div class="table-scroll"><table class="ref-table"><thead><tr><th>规则</th><th>角色</th><th>效果</th></tr></thead><tbody>${plotsFor(set,kind).map(plot).join('')}</tbody></table></div>`;
 return `${set==='MZ'?'<p class="disclosure">Midnight Zone（午夜领域）：新增忍者、EX 卡与伪装事件。角色公开可能是伪装，EX 卡也可能改变角色；具体效果见下表。</p>':''}<p class="lead">${set==='FS'?'每个剧本有 1 条规则 Y和 1 条规则 X。':'每个剧本有 1 条规则 Y和 2 条规则 X。轮回全部失败后，主人公还有最后的战斗。'}</p>
  ${plots('Y','规则 Y')}${plots('X','规则 X')}
  <h3>角色</h3><div class="table-scroll"><table class="ref-table"><thead><tr><th>角色</th><th>特点</th><th>能力</th></tr></thead><tbody>${rolesFor(set).map(r=>`<tr><th>${esc(r.name_zh_working)}</th><td>${[r.maxCount?`至多 ${r.maxCount} 人`:'',REFUSAL[r.goodwillRefusal]||''].filter(Boolean).join('；')||'—'}</td><td>${r.effects_zh.map(esc).join('<br>')||'没有能力'}</td></tr>`).join('')}</tbody></table></div>
  <h3>事件</h3><div class="table-scroll"><table class="ref-table"><thead><tr><th>事件</th><th>效果</th></tr></thead><tbody>${incidentsFor(set).map(e=>`<tr><th>${esc(e.name_zh_working)}</th><td>${esc(e.effect_zh)}</td></tr>`).join('')}</tbody></table></div>`;
}

export function rulesHtml(state){
 const tab=TABS.some(([id])=>id===state.rulesTab)?state.rulesTab:'basics';
 const body=tab==='cards'?cards():tab==='cast'?cast():tab==='basics'?basics():table(tab);
 return `<main class="wrap rules">
  <div class="page-intro"><div><h1>规则</h1></div><p class="lead">剧作家制造惨剧，主人公在轮回中找出真相。</p></div>
  <div class="page-tabs" role="tablist">${TABS.map(([id,label])=>`<button type="button" role="tab" aria-selected="${tab===id}" class="${tab===id?'active':''}" data-do="rules-tab" data-tab="${id}">${label}</button>`).join('')}</div>
  <section class="rules-body tab-${tab}">${body}</section>
  <p class="disclosure">图片素材来自原作者发布的「惨劇コモンズ」（CC BY-SA 2.1 日本），中文名称是暂定译名。详见 CREDITS.md。</p>
 </main>`;
}

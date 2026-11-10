import {esc,icon,btn,iconBtn} from '../html.mjs';
import {char,name,COUNTERS} from '../lookup.mjs';
import {cardsOn} from './board.mjs';

const frame=(label,body,cls='')=>`<div class="overlay"><section class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${esc(label)}">${body}</section></div>`;
const head=title=>`<header class="modal-head"><h2>${title}</h2>${iconBtn('close','close','关闭')}</header>`;

export function newGameModal(state,mode='heroes',script='starter'){
 const {info,editor}=state;
 const tile=(group,value,title,detail,checked,glyph='')=>`<label class="tile"><input type="radio" name="${group}" value="${value}"${checked?' checked':''}><span>${glyph?icon(glyph):''}<b>${title}</b><small>${detail}</small></span></label>`;
 return frame('开启新轮回',`${head('开启新的轮回')}
  <h4>你的立场</h4><div class="tiles">${tile('new-mode','heroes','主人公','操控三套手牌，阻止惨剧',mode==='heroes','users')}${tile('new-mode','mastermind','剧作家','知晓真相，对抗三名 AI',mode==='mastermind','mask')}${tile('new-mode','observe','AI 观战','双方均由对手程序控制',mode==='observe','eye')}</div>
  <h4>剧本</h4><div class="tiles">${tile('new-script','starter','起始剧本','FS 教学 · 3 日 × 3 轮回 · 推荐首局',script==='starter')}${tile('new-script','FS','随机 FS 剧本','入门规则 · 每次都不同',script==='FS')}${tile('new-script','BTX','随机 BTX 剧本','基础规则 · 含最后的战斗',script==='BTX')}${editor.text.trim()?tile('new-script','editor','工坊中的剧本','使用剧本工坊里的草稿',script==='editor'):''}</div>
  <div class="fields">
   <label class="field"><span>对手</span><select id="new-opponent">${info.configured?'<option value="ai">DeepSeek AI（推荐）</option>':''}<option value="bot">离线练习机器人</option></select></label>
   <label class="field"><span>交流规则</span><select id="new-talk"><option value="between_loops_only">仅轮回间讨论</option><option value="allowed_during_loop">允许轮回内讨论</option></select></label>
   ${info.configured?'<label class="field"><span>每局 API 预算（美元）</span><input id="new-budget" type="number" min=".01" max="10" step=".1" value=".5"></label>':''}
  </div>
  <p class="hint">${info.configured?'DeepSeek 对手每次决策约花费 $0.002，每局通常低于 $0.10。':'未配置 DeepSeek 密钥，对手将使用离线练习机器人。'}所有对局自动保存，可随时继续。</p>
  <footer class="modal-foot">${btn('取消','close')}${btn('进入棋盘'+icon('next'),'create','primary big')}</footer>`,'wide');
}

// v: the game being viewed, when the character is opened from a board.
export function characterModal(id,v){
 const c=char(id),here=v?.board?.[id],role=v&&(v.secret?.roles?.[id]||v.knownRoles?.[id]),cards=here?cardsOn(v,id):'';
 const stat=key=>`<span class="${COUNTERS[key].cls}">${icon(COUNTERS[key].icon)}${COUNTERS[key].label} ${here[key]}${key==='paranoia'?' / '+c.paranoiaLimit:''}</span>`;
 return frame(name(id)+'详情',`${head(`${esc(name(id))} <small>${esc(c.name_ja)}</small>`)}
  <div class="detail"><img class="detail-card" src="/${c.card}" alt="${esc(name(id))}原始人物卡面"><div class="detail-copy">
   ${role?`<p class="detail-role">角色：<b>${esc(name(role))}</b>${v.secret?' · 仅剧作家可见':' · 已确认'}</p>`:''}
   ${here?`<p class="detail-state">${stat('goodwill')}${stat('paranoia')}${stat('intrigue')}${here.guard?stat('guard'):''}${here.alive?'':'<span class="dead">已死亡</span>'}</p><p class="hint">当前位于${esc(name(here.location))}${here.present?'':'（尚未到场）'}</p>`:''}
   ${cards?`<div class="detail-cards"><span class="hint">今日盖在此人身上的牌</span>${cards}</div>`:''}
   <p class="hint">初始：${esc(name(c.start))} · 禁入：${c.forbiddenLocations.map(l=>esc(name(l))).join('、')||'无'} · 不安临界 ${c.paranoiaLimit}</p>
   ${c.abilities.map(a=>`<div class="ability"><b class="g">${icon('heart')}友好 ${a.minGoodwill}</b><i>${a.limit==='loop'?'每轮回一次':'每天一次'}</i><p>${esc(a.effect_zh)}</p></div>`).join('')}
   ${c.traits_zh.map(t=>`<div class="ability trait"><p>${esc(t)}</p></div>`).join('')}
  </div></div>`);
}

export function guideModal(){
 const step=(title,text)=>`<li><b>${title}</b><p>${text}</p></li>`;
 return frame('玩法指南',`${head('五分钟学会玩法')}
  <ol class="guide-steps">
   ${step('目标','剧作家秘密安排了角色（杀手、关键人物……）和事件日程。<em>主人公只要完整度过一个轮回而没有触发失败条件就获胜</em>；所有轮回都失败则剧作家获胜。')}
   ${step('每天先盖牌','剧作家先盖 3 张，主人公 A、B、C 各盖 1 张。在下方选一张手牌，再点击棋盘上高亮的人物或地点——选中后会直接显示这张牌将造成的效果。六张牌齐后同时翻开：先移动，再加减计数。')}
   ${step('读懂人物',`<span class="p">${icon('unrest')}不安</span>达到临界（小格全部点亮、头像变红）时，若该人物是当天事件的犯人，事件就会发生。<span class="i">${icon('intrigue')}暗跃</span>常常是失败条件。<span class="g">${icon('heart')}友好</span>达到门槛可请求人物能力，例如公开角色或减少不安。`)}
   ${step('观察剧作家','剧作家把牌盖在谁身上是公开的。他反复给谁加不安、加暗跃，谁就可能是犯人或关键人物。用“不安 −1”和“暗跃禁止”去阻止——但同一天两张暗跃禁止会互相抵消。')}
   ${step('失败也是线索','轮回失败后时间倒流，计数器复原，但已确认的角色和记录都会保留。右侧“推理”表可以逐格排除角色，“速查”列出了本集合所有规则、角色与事件。')}
  </ol>
  <p class="hint">对手回合会自动进行（可用顶部的“对手自动”开关关闭）。键盘：数字键选手牌，Esc 取消选择。</p>
  <footer class="modal-foot">${btn('开始游戏','close','primary big')}</footer>`,'wide guide');
}

export function truthModal(script,g){
 const known=g.knownRoles||{};
 return frame('真相揭晓',`${head('真相揭晓')}
  <div class="truth-plots"><div><small>主规则 Y</small><b>${esc(name(script.mainPlot))}</b></div>${script.subPlots.map(p=>`<div><small>副规则 X</small><b>${esc(name(p))}</b></div>`).join('')}</div>
  <div class="truth-grid">${script.characters.map(c=>{
   const role=script.roles[c],special=role!=='person';
   return `<div class="truth-card${special?'':' plain'}${known[c]?' found':''}"><img src="/${char(c).portrait}" alt=""><b>${esc(name(c))}</b><span>${esc(name(role))}</span>${g.mode==='heroes'&&special?`<small>${known[c]?'已被识破':'未被识破'}</small>`:''}</div>`;
  }).join('')}</div>
  <h4>事件日程</h4>${script.incidents.map(e=>`<div class="schedule"><b>DAY ${e.day}</b><span>${esc(name(e.type))}</span><em>犯人 ${esc(name(e.culprit))}</em></div>`).join('')||'<p class="hint">没有预告事件。</p>'}
  <footer class="modal-foot">${btn('再开一局','new')}${btn(icon('film')+'查看回放','open-replay','primary')}</footer>`,'wide truth');
}

export function bannerHtml(banner){
 return banner?`<div class="banner ${banner.kind}" data-do="dismiss-banner" role="status"><div class="banner-inner"><span class="eyebrow">${esc(banner.kicker)}</span><h2>${esc(banner.title)}</h2>${banner.lines.map(l=>`<p>${esc(l)}</p>`).join('')}<small>点击任意处继续</small></div></div>`:'';
}

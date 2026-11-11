import {esc,icon,btn,iconBtn} from '../html.mjs';
import {char,name,COUNTERS} from '../lookup.mjs';
import {cardsOn} from './board.mjs';

const frame=(label,body,cls='')=>`<div class="overlay"><section class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${esc(label)}">${body}</section></div>`;
const head=title=>`<header class="modal-head"><h2>${title}</h2>${iconBtn('close','close','关闭')}</header>`;

export function newGameModal(state,mode='heroes',script='starter'){
 const {info,editor}=state;
 const tile=(group,value,title,detail,checked,glyph='')=>`<label class="tile"><input type="radio" name="${group}" value="${value}"${checked?' checked':''}><span>${glyph?icon(glyph):''}<b>${title}</b><small>${detail}</small></span></label>`;
 return frame('新对局',`${head('新对局')}
  <h4>你扮演</h4><div class="tiles">${tile('new-mode','heroes','主人公','阻止惨剧',mode==='heroes','users')}${tile('new-mode','mastermind','剧作家','制造惨剧',mode==='mastermind','mask')}${tile('new-mode','observe','观战','看 AI 对局',mode==='observe','eye')}</div>
  <h4>剧本</h4><div class="tiles">${tile('new-script','starter','入门剧本','3 天 × 3 轮回 · 推荐',script==='starter')}${tile('new-script','FS','随机 · 入门','First Steps',script==='FS')}${tile('new-script','BTX','随机 · 进阶','Basic Tragedy Χ',script==='BTX')}${editor.text.trim()?tile('new-script','editor','我的剧本','来自剧本工坊',script==='editor'):''}</div>
  <div class="fields">
   <label class="field"><span>对手</span><select id="new-opponent">${info.configured?'<option value="ai">DeepSeek AI</option>':''}<option value="bot">离线机器人</option></select></label>
   <label class="field"><span>主人公讨论</span><select id="new-talk"><option value="between_loops_only">仅轮回之间</option><option value="allowed_during_loop">随时</option></select></label>
   ${info.configured?'<label class="field"><span>API 预算（美元）</span><input id="new-budget" type="number" min=".01" max="10" step=".1" value=".5"></label>':''}
  </div>
  <footer class="modal-foot">${btn('取消','close')}${btn('开始'+icon('next'),'create','primary big')}</footer>`,'wide');
}

// v: the game being viewed, when the character is opened from a board.
export function characterModal(id,v){
 const c=char(id),here=v?.board?.[id],role=v&&(v.secret?.roles?.[id]||v.knownRoles?.[id]),cards=here?cardsOn(v,id):'';
 const stat=key=>`<span class="${COUNTERS[key].cls}">${icon(COUNTERS[key].icon)}${COUNTERS[key].label} ${here[key]}${key==='paranoia'?' / '+c.paranoiaLimit:''}</span>`;
 return frame(name(id)+'详情',`${head(`${esc(name(id))} <small>${esc(c.name_ja)}</small>`)}
  <div class="detail"><img class="detail-card" src="/${c.card}" alt="${esc(name(id))}的人物卡"><div class="detail-copy">
   ${role?`<p class="detail-role">角色：<b>${esc(name(role))}</b>${v.secret?' · 仅你可见':' · 已确认'}</p>`:''}
   ${here?`<p class="detail-state">${stat('goodwill')}${stat('paranoia')}${stat('intrigue')}${here.guard?stat('guard'):''}${here.alive?'':'<span class="dead">已死亡</span>'}</p><p class="hint">位于${esc(name(here.location))}${here.present?'':'（未登场）'}</p>`:''}
   ${cards?`<div class="detail-cards"><span class="hint">今天的牌</span>${cards}</div>`:''}
   <p class="hint">起点：${esc(name(c.start))} · 禁入：${c.forbiddenLocations.map(l=>esc(name(l))).join('、')||'无'} · 不安上限 ${c.paranoiaLimit}</p>
   ${c.abilities.map(a=>`<div class="ability"><b class="g">${icon('heart')}友好 ${a.minGoodwill}</b><i>${a.limit==='loop'?'每轮回一次':'每天一次'}</i><p>${esc(a.effect_zh)}</p></div>`).join('')}
   ${c.traits_zh.map(t=>`<div class="ability trait"><p>${esc(t)}</p></div>`).join('')}
  </div></div>`);
}

export function guideModal(){
 const step=(title,text)=>`<li><b>${title}</b><p>${text}</p></li>`;
 return frame('玩法',`${head('怎么玩')}
  <ol class="guide-steps">
   ${step('目标','撑过一个完整的轮回不失败，主人公就赢。每个轮回都失败，剧作家赢。')}
   ${step('出牌','选一张手牌，再点人物或地点。六张牌出齐后一起翻开。')}
   ${step('看计数',`<span class="p">${icon('unrest')}不安</span>满了，犯人会引发事件。<span class="i">${icon('intrigue')}暗跃</span>多了，往往就是失败。<span class="g">${icon('heart')}友好</span>够了，可以用人物的能力。`)}
   ${step('推理','留意剧作家总把牌出给谁。右侧“推理”页帮你排除角色和规则。')}
   ${step('重来','轮回失败会回到第一天，但线索都还在。')}
  </ol>
  <footer class="modal-foot">${btn('知道了','close','primary big')}</footer>`,'wide guide');
}

export function truthModal(script,g){
 const known=g.knownRoles||{};
 return frame('真相',`${head('真相')}
  <div class="truth-plots"><div><small>主规则 Y</small><b>${esc(name(script.mainPlot))}</b></div>${script.subPlots.map(p=>`<div><small>副规则 X</small><b>${esc(name(p))}</b></div>`).join('')}</div>
  <div class="truth-grid">${script.characters.map(c=>{
   const role=script.roles[c],special=role!=='person';
   return `<div class="truth-card${special?'':' plain'}${known[c]?' found':''}"><img src="/${char(c).portrait}" alt=""><b>${esc(name(c))}</b><span>${esc(name(role))}</span>${g.mode==='heroes'&&special?`<small>${known[c]?'已识破':'未识破'}</small>`:''}</div>`;
  }).join('')}</div>
  <h4>事件日程</h4>${script.incidents.map(e=>`<div class="schedule"><b>第 ${e.day} 日</b><span>${esc(name(e.type))}</span><em>犯人 ${esc(name(e.culprit))}</em></div>`).join('')||'<p class="hint">没有事件。</p>'}
  <footer class="modal-foot">${btn('再来一局','new')}${btn(icon('film')+'回放','open-replay','primary')}</footer>`,'wide truth');
}

export function bannerHtml(banner){
 return banner?`<div class="banner ${banner.kind}" data-do="dismiss-banner" role="status"><div class="banner-inner"><h2>${esc(banner.title)}</h2>${banner.lines.map(l=>`<p>${esc(l)}</p>`).join('')}<small>点击继续</small></div></div>`:'';
}

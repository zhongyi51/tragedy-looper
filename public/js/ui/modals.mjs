import {esc,icon,btn,iconBtn} from '../html.mjs';
import {char,name,COUNTERS} from '../lookup.mjs';
import {cardsOn} from './board.mjs';
import {recapHtml} from './dock.mjs';

const frame=(label,body,cls='')=>`<div class="overlay"><section class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${esc(label)}">${body}</section></div>`;
const head=title=>`<header class="modal-head"><h2>${title}</h2>${iconBtn('close','close','关闭')}</header>`;

export function newGameModal(state,mode='heroes',script='starter'){
 const {info,editor}=state;
 const tile=(group,value,title,detail,checked,glyph='')=>`<label class="tile"><input type="radio" name="${group}" value="${value}"${checked?' checked':''}><span>${glyph?icon(glyph):''}<b>${title}</b><small>${detail}</small></span></label>`;
 return frame('新对局',`${head('新对局')}
  <h4>你扮演</h4><div class="tiles">${tile('new-mode','heroes','主人公','阻止惨剧',mode==='heroes','users')}${tile('new-mode','mastermind','剧作家','制造惨剧',mode==='mastermind','mask')}${tile('new-mode','observe','观战','看双方自动对局',mode==='observe','eye')}</div>
  <h4>剧本</h4><div class="tiles">${tile('new-script','starter','起始剧本','3 天 × 3 轮回 · 推荐新手',script==='starter')}${tile('new-script','FS','随机 · 入门','规则少，容易上手',script==='FS')}${tile('new-script','BTX','随机 · 进阶','规则更多，有最后的战斗',script==='BTX')}${editor.text.trim()?tile('new-script','editor','我的剧本','剧本工坊里的那份',script==='editor'):''}</div>
  <div class="fields">
   <label class="field"><span>对手</span><select id="new-opponent">${info.configured?'<option value="ai">DeepSeek AI</option>':''}<option value="bot">离线机器人</option></select></label>
   <label class="field"><span>主人公讨论</span><select id="new-talk"><option value="between_loops_only">只在轮回之间</option><option value="allowed_during_loop">随时可以</option></select></label>
   ${info.configured?'<label class="field"><span>AI 花费上限（美元）</span><input id="new-budget" type="number" min=".01" max="10" step=".1" value=".5"></label>':''}
  </div>
  <footer class="modal-foot">${btn('取消','close')}${btn('开始'+icon('next'),'create','primary big')}</footer>`,'wide');
}

// v: the game being viewed, when the character is opened from a board.
export function characterModal(id,v){
 const c=char(id),here=v?.board?.[id],role=v&&(v.secret?.roles?.[id]||v.knownRoles?.[id]),cards=here?cardsOn(v,id):'';
 const stat=key=>`<span class="${COUNTERS[key].cls}">${icon(COUNTERS[key].icon)}${COUNTERS[key].label} ${here[key]}${key==='paranoia'?' / '+c.paranoiaLimit:''}</span>`;
 return frame(name(id)+'详情',`${head(`${esc(name(id))} <small>${esc(c.name_ja)}</small>`)}
  <div class="detail"><img class="detail-card" src="/${c.card}" alt="${esc(name(id))}的人物卡"><div class="detail-copy">
   ${role?`<p class="detail-role">角色：<b>${esc(name(role))}</b>${v.secret?' · 只有你知道':' · 已确认'}</p>`:''}
   ${here?`<p class="detail-state">${stat('goodwill')}${stat('paranoia')}${stat('intrigue')}${here.guard?stat('guard'):''}${here.alive?'':'<span class="dead">已死亡</span>'}</p><p class="hint">位于${esc(name(here.location))}${here.present?'':'（未登场）'}</p>`:''}
   ${cards?`<div class="detail-cards"><span class="hint">今天的牌</span>${cards}</div>`:''}
   <p class="hint">初始地点：${esc(name(c.start))} · 不能进入：${c.forbiddenLocations.map(l=>esc(name(l))).join('、')||'无'} · 不安上限 ${c.paranoiaLimit}</p>
   ${c.abilities.map(a=>`<div class="ability"><b class="g">${icon('heart')}需要友好 ${a.minGoodwill}</b><i>${a.limit==='loop'?'每轮回一次':'每天一次'}</i><p>${esc(a.effect_zh)}</p></div>`).join('')}
   ${c.traits_zh.map(t=>`<div class="ability trait"><p>${esc(t)}</p></div>`).join('')}
  </div></div>`);
}

export function guideModal(){
 const step=(title,text)=>`<li><b>${title}</b><p>${text}</p></li>`;
 return frame('玩法',`${head('怎么玩')}
  <ol class="guide-steps">
   ${step('目标','只要有一个轮回从头到尾没有失败，主人公就赢。每个轮回都失败，剧作家赢。')}
   ${step('出牌','先选一张手牌，再点人物或地点。六张牌出齐后一起翻开。')}
   ${step('看计数',`<span class="p">${icon('unrest')}不安</span>满了，当天的犯人就会引发事件。<span class="i">${icon('intrigue')}暗跃</span>多了，轮回多半会失败。<span class="g">${icon('heart')}友好</span>够了，就能用人物的能力。`)}
   ${step('推理','留意剧作家总把牌出给谁。“推理”页会帮你排除不可能的角色和规则。')}
   ${step('重来','轮回失败后回到第一天，人物和计数复原，线索都还在。')}
  </ol>
  <footer class="modal-foot">${btn('知道了','close','primary big')}</footer>`,'wide guide');
}

export function truthModal(script,g){
 const known=g.knownRoles||{};
 return frame('真相',`${head('真相')}
  <div class="truth-plots"><div><small>主规则</small><b>${esc(name(script.mainPlot))}</b></div>${script.subPlots.map(p=>`<div><small>副规则</small><b>${esc(name(p))}</b></div>`).join('')}</div>
  <div class="truth-grid">${script.characters.map(c=>{
   const role=script.roles[c],special=role!=='person';
   return `<div class="truth-card${special?'':' plain'}${known[c]?' found':''}"><img src="/${char(c).portrait}" alt=""><b>${esc(name(c))}</b><span>${esc(name(role))}</span>${g.mode==='heroes'&&special?`<small>${known[c]?'已识破':'未识破'}</small>`:''}</div>`;
  }).join('')}</div>
  <h4>事件日程</h4>${script.incidents.map(e=>`<div class="schedule"><b>第 ${e.day} 日</b><span>${esc(name(e.type))}</span><em>犯人 ${esc(name(e.culprit))}</em></div>`).join('')||'<p class="hint">没有事件。</p>'}
  <footer class="modal-foot">${btn('再来一局','new')}${btn(icon('film')+'回放','open-replay','primary')}</footer>`,'wide truth');
}

const MOTES=Array.from({length:22},(_,i)=>`<i style="--x:${(i*47+9)%100}%;--delay:${(i*37%60)/10}s;--time:${5+(i*29%40)/10}s;--size:${3+i*13%5}px"></i>`).join('');
const BANNER_MARK={loop:'loop',victory:'sun',defeat:'skull'};
// banner: {kind, title, lines} plus, for a failed loop, {stamp, cause, detail, recap}.
export function bannerHtml(banner){
 if(!banner)return '';
 return `<div class="banner ${banner.kind}" data-do="dismiss-banner" role="status">
  <div class="banner-fx" aria-hidden="true"><span class="banner-ring"></span><span class="banner-rays"></span><span class="banner-motes">${MOTES}</span></div>
  <div class="banner-inner"><span class="banner-mark" aria-hidden="true">${icon(BANNER_MARK[banner.kind]||'clock')}</span><h2 data-text="${esc(banner.title)}">${esc(banner.title)}</h2>
   ${banner.cause?`<div class="banner-why">${banner.stamp?`<i>${esc(banner.stamp)}</i>`:''}<b>${esc(banner.cause)}</b>${banner.detail?`<small>${esc(banner.detail)}</small>`:''}</div>`:''}
   ${banner.recap?.length?recapHtml(banner.recap):''}
   ${banner.lines.map(l=>`<p>${esc(l)}</p>`).join('')}<small class="banner-go">点击继续</small></div></div>`;
}

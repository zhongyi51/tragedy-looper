import {esc,icon,btn,iconBtn} from '../html.mjs';
import {char,name,COUNTERS,plotsFor} from '../lookup.mjs';
import {normalizeGameSetup,randomSetup} from '../game-setup.mjs';
import {parseDraft} from '../script-draft.mjs';
import {cardsOn} from './board.mjs';
import {recapHtml} from './dock.mjs';

const frame=(label,body,cls='')=>`<div class="overlay"><section class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${esc(label)}">${body}</section></div>`;
const head=title=>`<header class="modal-head"><h2>${title}</h2>${iconBtn('close','close','关闭')}</header>`;

export function newGameModal(state,mode='heroes',script='starter',values={}){
 const {info,editor}=state,random=randomSetup(script),draft=script==='editor'?parseDraft(editor.text):null;
 const setup=normalizeGameSetup(script,{communication:draft?.communication||'between_loops_only',incidentVisibility:draft?.settings?.incidentVisibility||'hidden',...values});
 const option=(value,label,current)=>`<option value="${esc(value)}"${value===current?' selected':''}>${esc(label)}</option>`;
 const select=(id,options,current)=>`<select id="${id}">${options.map(([v,l])=>option(v,l,current)).join('')}</select>`;
 const field=(label,control,cls='')=>`<label class="field ${cls}"><span>${label}</span>${control}</label>`;
 const number=(id,value,min,max)=>`<input id="${id}" type="number" min="${min}" max="${max}" step="1" required value="${esc(value)}">`;
 const plotOptions=kind=>[['','随机'],...plotsFor(setup.ruleset,kind).map(p=>[p.id,p.name_zh_working])];
 const tile=(group,value,title,detail,checked,glyph='')=>`<label class="tile"><input type="radio" id="${group}-${value}" name="${group}" value="${value}"${checked?' checked':''}><span>${glyph?icon(glyph):''}<b>${title}</b><small>${detail}</small></span></label>`;
 return frame('新对局',`${head('新对局')}
  <h4>你扮演</h4><div class="tiles">${tile('new-mode','heroes','主人公','阻止惨剧',mode==='heroes','users')}${tile('new-mode','mastermind','剧作家','制造惨剧',mode==='mastermind','mask')}${tile('new-mode','observe','观战','看双方自动对局',mode==='observe','eye')}</div>
  <h4>剧本</h4><div class="tiles">${tile('new-script','starter','起始剧本','3 天 × 3 轮回 · 推荐新手',script==='starter')}${tile('new-script','FS','随机 · FS','First Steps · 入门',script==='FS')}${tile('new-script','BTX','随机 · BTX','Basic Tragedy Χ · 进阶',script==='BTX')}${tile('new-script','MZ','随机 · MZ','Midnight Zone · 扩展',script==='MZ')}${editor.text.trim()?tile('new-script','editor','我的剧本','剧本工坊里的那份',script==='editor'):''}</div>
  <div class="fields">
   ${field('对手',select('new-opponent',[...(info.configured?[['ai','DeepSeek AI']]:[]),['bot','离线机器人']],setup.opponent||(info.configured?'ai':'bot')))}
   ${field('主人公讨论',select('new-talk',[['between_loops_only','只在轮回之间'],['allowed_during_loop','随时可以']],setup.communication))}
   ${info.configured?field('AI 花费上限（美元）',`<input id="new-budget" type="number" min=".01" max="10" step=".01" required value="${esc(setup.budget)}">`):''}
  </div>
  <details class="setup-options" id="new-advanced"${setup.advancedOpen?' open':''}>
   <summary>进阶自定义 <span>本场的规则与人物</span></summary>
   ${random?`<div class="fields">
    ${field('惨剧集合',select('new-ruleset',[['FS','FS · First Steps'],['BTX','BTX · Basic Tragedy Χ'],['MZ','MZ · Midnight Zone']],setup.ruleset))}
    ${field('随机种子',number('new-seed',setup.seed,0,Number.MAX_SAFE_INTEGER))}
    ${field('每轮回天数',number('new-days',setup.days,1,10))}
    ${field('轮回数',number('new-loops',setup.loops,1,8))}
    ${field('规则 Y',select('new-main',plotOptions('Y'),setup.mainPlot),'wide')}
    ${setup.subPlots.map((p,i)=>field('规则 X'+(setup.ruleset!=='FS'?' '+(i+1):''),select('new-sub-'+i,plotOptions('X').filter(([id])=>!id||id===p||!setup.subPlots.includes(id)),p),'wide')).join('')}
    ${field('人物池',select('new-pool',[['standard','常用人物'],['all','全部基础人物（24 人）']],setup.characterPool))}
    ${field('事件数',number('new-incidents',setup.incidentCount,0,Math.min(10,Number(setup.days))))}
   </div>
   <label class="setup-check"><input id="new-ai-character" type="checkbox"${setup.includeAI?' checked':''}><span>保证人工智能（AI）登场</span></label>
   <p class="hint">人物会从所选池中抽取。人工智能可模拟日程中的事件。</p>
   <p class="hint">指定规则会缩小推理范围；想保留悬念请选“随机”。</p>`:'<p class="hint">这份剧本已有固定的规则、人物与日程。选择随机剧本即可在此定制，或在剧本工坊编辑。</p>'}
   <div class="fields">${field('事件日程',select('new-visibility',[['hidden','隐藏名称（本站默认）'],['public','公开名称（原版日程）']],setup.incidentVisibility),'wide')}</div>
   <p class="hint">已发生的事件会公开名称和结果；事件或能力明确要求时，才公开犯人身份。MZ 的伪装事件按其公开名称显示。人工智能主动模拟会公开所选日的名称，其他隐藏日程不变。</p>
  </details>
  <footer class="modal-foot">${btn('取消','close')}${btn('开始'+icon('next'),'create','primary big')}</footer>`,'wide');
}

// v: the game being viewed, when the character is opened from a board.
export function characterModal(id,v){
 const c=char(id),here=v?.board?.[id],role=v&&(v.secret?.roles?.[id]||v.knownRoles?.[id]),cards=here?cardsOn(v,id):'';
 const stat=key=>`<span class="${COUNTERS[key].cls}">${icon(COUNTERS[key].icon)}${COUNTERS[key].label} ${here[key]}${key==='paranoia'?' / '+c.paranoiaLimit:''}</span>`;
 return frame(name(id)+'详情',`${head(`${esc(name(id))} <small>${esc(c.name_ja)}</small>`)}
  <div class="detail"><img class="detail-card" src="/${c.card}" alt="${esc(name(id))}的人物卡"><div class="detail-copy">
   ${role?`<p class="detail-role">角色：<b>${esc(name(role))}</b>${v.secret?' · 只有你知道':v.script.ruleset==='MZ'?' · 已宣告':' · 已确认'}</p>`:''}
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
   ${step('目标','只要有一个轮回从头到尾没有失败，主人公就赢。轮回全部失败后，FS 由剧作家获胜；BTX / MZ 还有最后的战斗，主人公可指认全部配役争取胜利。')}
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
  <div class="truth-plots"><div><small>规则 Y</small><b>${esc(name(script.mainPlot))}</b></div>${script.subPlots.map(p=>`<div><small>规则 X</small><b>${esc(name(p))}</b></div>`).join('')}</div>
  <div class="truth-grid">${script.characters.map(c=>{
   const role=script.roles[c],special=role!=='person';
   return `<div class="truth-card${special?'':' plain'}${known[c]?' found':''}"><img src="/${char(c).portrait}" alt=""><b>${esc(name(c))}</b><span>${esc(name(role))}</span>${g.mode==='heroes'&&special?`<small>${known[c]?(script.ruleset==='MZ'?'曾宣告':'已识破'):'未识破'}</small>`:''}</div>`;
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

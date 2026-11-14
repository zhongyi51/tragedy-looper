import {esc,icon,btn,iconBtn} from '../html.mjs';
import {char,name,COUNTERS,plotsFor} from '../lookup.mjs';
import {normalizeGameSetup,randomSetup,libraryItems} from '../game-setup.mjs';
import {parseDraft} from '../script-draft.mjs';
import {cardsOn} from './board.mjs';
import {recapHtml} from './dock.mjs';

const frame=(label,body,cls='')=>`<div class="overlay"><section class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${esc(label)}">${body}</section></div>`;
const head=title=>`<header class="modal-head"><h2>${title}</h2>${iconBtn('close','close','关闭')}</header>`;

export function newGameModal(state,mode='heroes',script='starter',values={}){
 const {info,editor}=state,random=randomSetup(script),ai=script==='ai',source=['FS','BTX','MZ','MC'].includes(script)?'random':script;
 const draft=script==='editor'?parseDraft(editor.text):null;
 const setup=normalizeGameSetup(script,{communication:draft?.communication||'between_loops_only',...values});
 const option=(value,label,current)=>`<option value="${esc(value)}"${value===current?' selected':''}>${esc(label)}</option>`;
 const select=(id,options,current)=>`<select id="${id}">${options.map(([v,l])=>option(v,l,current)).join('')}</select>`;
 const field=(label,control,cls='')=>`<label class="field ${cls}"><span>${label}</span>${control}</label>`;
 const number=(id,value,min,max,optional=false,placeholder='按时长生成')=>`<input id="${id}" type="number" min="${min}" max="${max}" step="1"${optional?` placeholder="${esc(placeholder)}"`:' required'} value="${esc(value??'')}">`;
 const plotOptions=kind=>[['','随机'],...plotsFor(setup.ruleset,kind).map(p=>[p.id,p.name_zh_working])];
 const tile=(group,value,title,detail,checked,glyph='',disabled=false)=>`<label class="tile"><input type="radio" id="${group}-${value}" name="${group}" value="${value}"${checked?' checked':''}${disabled?' disabled':''}><span>${glyph?icon(glyph):''}<b>${title}</b><small>${detail}</small></span></label>`;
 const library=libraryItems(state.library),selected=library.find(s=>s.id===setup.libraryId)||library[0];
 const lengthOptions=[['quick','短局'],['standard','标准'],['long','长局']];
 const rulesets=[['FS','FS · First Steps'],['BTX','BTX · Basic Tragedy Χ'],['MZ','MZ · Midnight Zone'],['MC','MC · Mystery Circle']];
 return frame('新对局',`${head('新对局')}
  <h4>你扮演</h4><div class="tiles">${tile('new-mode','heroes','主人公','阻止惨剧',mode==='heroes','users')}${tile('new-mode','mastermind','剧作家','制造惨剧',mode==='mastermind','mask')}${tile('new-mode','observe','观战','看双方自动对局',mode==='observe','eye')}</div>
  <h4>剧本</h4><div class="tiles">${tile('new-script','starter','起始剧本','3 天 × 3 轮回 · 推荐新手',source==='starter')}${tile('new-script','library','精选剧本','不同的谜局与线索',source==='library')}${tile('new-script','random','快速随机','按本场设置生成',source==='random')}${tile('new-script','ai','AI 编剧',info.configured?'试作剧本 · 尚需试玩':'需要连接 AI',source==='ai','bot',!info.configured)}${editor.text.trim()?tile('new-script','editor','我的剧本','剧本工坊里的那份',source==='editor'):''}</div>
  ${source==='library'?selected?`<div class="fields">${field('选择剧本',select('new-library',library.map(s=>[s.id,`${s.title} · ${s.ruleset} · ${s.days} 天 × ${s.loops} 轮回`]),selected.id),'wide')}</div><p class="hint">${esc(selected.description||'本场使用固定剧本，结束后可查看设计与线索。')}</p>`:'<p class="hint">精选剧本暂未载入，请稍后重试。</p>':''}
  ${random?`<div class="fields">${field('惨剧集合',select('new-ruleset',rulesets,setup.ruleset))}${field('时长',select('new-length',lengthOptions,setup.lengthPreset))}${ai?field('难度',select('new-difficulty',[['beginner','入门'],['standard','标准'],['hard','挑战']],setup.difficulty))+field('主题（可选）',`<input id="new-theme" maxlength="300" value="${esc(setup.theme)}" placeholder="例如：雨夜的末班电车">`):''}</div>${ai?'<p class="hint">编剧需要稍等片刻，每次上限 $0.12，另计于对局费用。通过检查后才会开局，轮回中的真相保持不变。</p>':''}`:''}
  <div class="fields">
   ${field('对手',select('new-opponent',[...(info.configured?[['ai','DeepSeek AI']]:[]),['bot','离线机器人']],setup.opponent||(info.configured?'ai':'bot')))}
   ${field('主人公讨论',select('new-talk',[['between_loops_only','只在轮回之间'],['allowed_during_loop','随时可以']],setup.communication))}
   ${info.configured?field('AI 对局花费上限（美元）',`<input id="new-budget" type="number" min=".01" max="10" step=".01" required value="${esc(setup.budget)}">`):''}
  </div>
  <details class="setup-options" id="new-advanced"${setup.advancedOpen?' open':''}>
   <summary>进阶自定义 <span>本场的规则与人物</span></summary>
   ${random?`<div class="fields">
    ${field('随机种子',number('new-seed',setup.seed,0,Number.MAX_SAFE_INTEGER,true,'随机'))}
    ${field('每轮回天数',number('new-days',setup.days,1,10,true))}
    ${field('轮回数',number('new-loops',setup.loops,1,8,true))}
    ${field('规则 Y',select('new-main',plotOptions('Y'),setup.mainPlot),'wide')}
    ${setup.subPlots.map((p,i)=>field('规则 X'+(setup.ruleset!=='FS'?' '+(i+1):''),select('new-sub-'+i,plotOptions('X').filter(([id])=>!id||id===p||!setup.subPlots.includes(id)),p),'wide')).join('')}
    ${field('人物池',select('new-pool',[['standard','常用人物'],['all','全部基础人物（24 人）']],setup.characterPool))}
    ${field('事件数',number('new-incidents',setup.incidentCount,0,setup.days?Math.min(10,Number(setup.days)):10,true))}
   </div>
   <label class="setup-check"><input id="new-ai-character" type="checkbox"${setup.includeAI?' checked':''}><span>保证人工智能（AI）登场</span></label>
   <p class="hint">留空的天数、轮回数和事件数随时长生成。填写后，本场优先采用你的设置。</p>
   <p class="hint">${ai?'种子仅作为编剧输入；保存后的剧本保持不变。':'指定种子可复现剧本，建议主人公留空。'}</p>
   <p class="hint">人物会从所选池中抽取。人工智能可模拟日程中的事件。</p>
   <p class="hint">指定规则会缩小推理范围；想保留悬念请选“随机”。</p>
   ${setup.ruleset==='MC'?'<p class="hint">MC 的愚者、双子、绝对者须各自担任事件犯人；私家侦探不能担任犯人。请为所选规则留足事件数。</p>':''}`:'<p class="hint">这份剧本已有固定的规则、人物与日程。选择快速随机或 AI 编剧即可在此定制，或在剧本工坊编辑。</p>'}
   <p class="hint">事件日程按原版公开日期和名称。发生时告知结果，犯人与配役仍需推理；MZ 的伪装事件显示公开名称。</p>
  </details>
  <footer class="modal-foot">${btn('取消','close')}${btn((state.creating?'正在准备…':'开始')+(state.creating?'':icon('next')),'create','primary big',state.creating||source==='library'&&!selected?'disabled':'')}</footer>`,'wide');
}

// v: the game being viewed, when the character is opened from a board.
export function characterModal(id,v){
 const c=char(id),here=v?.board?.[id],role=v&&(v.secret?.roles?.[id]||v.knownRoles?.[id]),cards=here?cardsOn(v,id):'';
 const stat=key=>`<span class="${COUNTERS[key].cls}">${icon(COUNTERS[key].icon)}${COUNTERS[key].label} ${here[key]}${key==='paranoia'?' / '+c.paranoiaLimit:''}</span>`;
 return frame(name(id)+'详情',`${head(`${esc(name(id))} <small>${esc(c.name_ja)}</small>`)}
  <div class="detail"><img class="detail-card" src="/${c.card}" alt="${esc(name(id))}的人物卡"><div class="detail-copy">
   ${role?`<p class="detail-role">角色：<b>${esc(name(role))}</b>${v.secret?' · 只有你知道':v.script.ruleset==='MZ'?' · 已宣告':' · 已确认'}</p>`:''}
   ${here?`<p class="detail-state">${stat('goodwill')}${stat('paranoia')}${stat('intrigue')}${here.guard?stat('guard'):''}${here.alive?'':'<span class="dead">已死亡</span>'}</p><p class="hint">位于${esc(name(here.location))}${here.present?'':'（未登场）'}${here.alive&&here.movementLockedDay>=v.day?' · 第 '+here.movementLockedDay+' 日不能移动':''}</p>`:''}
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
   ${step('目标','只要有一个轮回从头到尾没有失败，主人公就赢。轮回全部失败后，FS 由剧作家获胜；BTX / MZ / MC 还有最后的战斗，主人公可指认全部配役争取胜利。')}
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
  <footer class="modal-foot">${btn('再来一局','new')}${btn('终局复盘','review')}${btn(icon('film')+'回放','open-replay','primary')}</footer>`,'wide truth');
}

const feedbackOptions=[['interesting','有趣'],['too_easy','偏易'],['too_hard','偏难'],['unclear','线索不足'],['repetitive','重复感强']];
const reviewText=value=>typeof value==='string'?value:typeof value==='number'?String(value):'';
export function reviewModal(data,g,rating){
 const text=reviewText,design=data.design&&typeof data.design==='object'?data.design:{};
 const aiDesign=(data.source||g.script.source||g.script.generation?.source)==='ai';
 const ruleEffects=Array.isArray(data.ruleEffects)?data.ruleEffects:[];
 const paragraphs=value=>(Array.isArray(value)?value:[value]).map(item=>text(item)||text(item?.text)||text(item?.description)).filter(Boolean).map(item=>`<p>${esc(item)}</p>`).join('');
 const sections=[['设计意图',design.premise||design.intent||design.summary],['威胁与布局',design.threatPlan||design.mainThreat||design.primaryThreat||design.threats],
  ['备用路线',design.backupThreat||design.backupPlan],['可发现的线索',design.clues||design.cluePlan],['可行反制',design.counterplay||design.responses],
  ['轮回中的学习',design.loopPlan],['误导与解释',design.misdirection],['难度说明',design.difficultyRationale||design.difficultyReason]];
 const notes=sections.map(([label,value])=>{const body=paragraphs(value);return body?`<section class="review-section"><h4>${label}</h4>${body}</section>`:'';}).join('');
 const clues=Array.isArray(data.clues)?data.clues:[],alternatives=Array.isArray(data.alternatives)?data.alternatives:[];
 return frame('终局复盘',`${head('终局复盘')}<p class="lead">${esc(data.title||g.script.title)}</p>
  ${text(data.summary)?`<p>${esc(data.summary)}</p>`:''}
  ${ruleEffects.length?`<section class="review-section"><h4>本场实际规则</h4>${ruleEffects.map(rule=>`<p><b>${esc(text(rule.name))}</b> · ${esc(text(rule.effect))}</p>`).join('')}</section>`:''}
  ${notes?`<h4>${aiDesign?'AI 创作设想':'编剧的设计意图'}</h4><p class="hint">${esc(text(data.note)||(aiDesign?'模型说明可能误述规则，请以本场实际规则与速查为准。':'可与本场实际发生的事情对照。'))}</p>${notes}`:'<p class="hint">这份剧本未附设计说明。可结合本场线索与完整回放复盘。</p>'}
  ${clues.length?`<section class="review-section"><h4>本场关键线索</h4><ul class="review-clues">${clues.map(c=>`<li>${Number.isInteger(c.loop)&&Number.isInteger(c.day)?`<small>第 ${c.loop} 轮回 · 第 ${c.day} 日</small>`:''}<span>${esc(text(c)||text(c.text))}</span></li>`).join('')}</ul></section>`:''}
  ${alternatives.length?`<section class="review-section"><h4>可以再想一想</h4>${paragraphs(alternatives)}</section>`:''}
  <section class="review-section"><h4>这份剧本玩起来如何？</h4><div class="row feedback-options">${feedbackOptions.map(([id,label])=>btn(label,'feedback','small'+(rating===id?' primary':''),`data-rating="${id}" aria-pressed="${rating===id}"`)).join('')}</div>${rating?'<p class="hint">已记录，可以重新选择。</p>':''}</section>
  <footer class="modal-foot">${btn('查看真相','truth')}${btn(icon('film')+'回放','open-replay','primary')}</footer>`,'wide review');
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

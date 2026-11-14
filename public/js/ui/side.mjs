import {esc,icon,btn} from '../html.mjs';
import {char,name,seatName,seatMark,cardLabel,phaseLabel,rolesFor,plotsFor,incidentsFor,plotRoles} from '../lookup.mjs';
import {MARKS,clues,failure} from '../deduce.mjs';

const REFUSAL={optional:'可以拒绝能力',mandatory:'一定拒绝能力'};

export function incidentSchedule(v){
 const named=v.seat==='M'||Boolean(v.secret)||v.script.settings?.incidentVisibility==='public';
 return v.script.incidents.map(e=>{
  const happened=v.occurred?.includes(e.day),status=happened?'已发生':e.day<v.day?'未发生':e.day===v.day?'今日':'';
  const culprit=v.knownCulprits?.[e.day],type=(named?e.type:undefined)||v.knownIncidentTypes?.[e.day];
  return `<div class="schedule${e.day===v.day?' today':''}${e.day<v.day?' past':''}${happened?' happened':''}"><b>第 ${e.day} 日</b><span class="${type?'':'unrevealed'}">${type?esc(name(type)):'事件未公开'}</span>${culprit?`<em>犯人 ${esc(name(culprit))}</em>`:''}${status?`<i>${status}</i>`:''}</div>`;
 }).join('')||'<p class="hint">没有事件。</p>';
}

function intel(v,ctx){
 const known=Object.entries(v.knownRoles),flags=[];
 if(Number.isInteger(v.extraGauge))flags.push('EX 计数：'+v.extraGauge);
 for(const [id,until] of Object.entries(v.closedLocations||{}))if(until>=v.day)flags.push(name(id)+'封锁至第 '+until+' 日');
 for(const c of Object.values(v.board))if(c.alive&&c.movementLockedDay>=v.day)flags.push(name(c.id)+'第 '+c.movementLockedDay+' 日不能移动');
 if(v.flags?.heroImmortal)flags.push('主人公不会死亡');
 if(v.flags?.patientFree)flags.push('住院患者可以进入任何地点');
 for(const id of v.flags?.suppressed||[])flags.push(name(id)+'不会引发事件');
 const curtain=v.secret?`<section class="block curtain"><h4>${icon('mask')}真相 · 只有你知道</h4>
   <p class="plots"><b>${esc(name(v.secret.mainPlot))}</b>${v.secret.subPlots.map(p=>`<span>${esc(name(p))}</span>`).join('')}</p>
   <table class="roles">${Object.entries(v.secret.roles).filter(([,r])=>r!=='person').map(([c,r])=>`<tr><td>${esc(name(c))}</td><td>${esc(name(r))}</td><td>${v.knownRoles[c]?'已暴露':''}</td></tr>`).join('')}</table>
   ${v.secret.incidents.map(e=>`<p class="secret-incident">第 ${e.day} 日 · ${esc(name(e.type))} · 犯人 ${esc(name(e.culprit))}</p>`).join('')}</section>`:'';
 const budget=!ctx.readOnly&&v.aiConfigured?`<section class="block budget"><h4>AI 花费</h4><div class="budget-row"><span>${v.spent===null?'对局结束后显示':'$'+v.spent.toFixed(4)}</span><b>上限 $${v.budget.toFixed(2)}</b></div>${v.spent===null?'':`<div class="meter"><span style="width:${Math.min(100,v.spent/v.budget*100)}%"></span></div>`}</section>`:'';
 return `<section class="block"><h4>${icon('clock')}事件日程</h4>${incidentSchedule(v)}</section>
  ${v.secret&&!known.length?'':`<section class="block"><h4>${icon('eye')}${v.secret?'主人公已知的角色':v.script.ruleset==='MZ'?'已宣告的角色':'已确认的角色'}</h4>${known.length?`<div class="known-roles">${known.map(([c,r])=>`<span class="known-role"><img src="/${char(c).portrait}" alt="">${esc(name(c))}<b>${esc(name(r))}</b></span>`).join('')}</div>`:'<p class="hint">还没有。用人物的能力可以查出角色。</p>'}</section>`}
  ${v.knownPlots?.length?`<section class="block"><h4>已公开的规则 X</h4><p class="plots">${v.knownPlots.map(p=>`<span>${esc(name(p))}</span>`).join('')}</p></section>`:''}
  ${flags.length?`<section class="block"><h4>本轮回</h4>${flags.map(f=>`<p class="flag">${esc(f)}</p>`).join('')}</section>`:''}
  ${curtain}${budget}
  ${v.winner&&!ctx.readOnly?`<section class="block">${btn('查看真相','truth','primary wide')}</section>`:''}
  <p class="legend"><span class="g">${icon('heart')}友好</span><span class="p">${icon('unrest')}不安</span><span class="i">${icon('intrigue')}暗跃</span><span class="gd">${icon('shield')}护卫</span></p>`;
}

// Newest first, under a heading for each day and, within it, each phase things happened in.
const UNPHASED=['day','loop'];
function log(v,ctx){
 const feed=ctx.readOnly?[]:(ctx.aiFeed||[]).filter(f=>f.gameId===v.id);
 const items=[...v.log.map(e=>({key:e.n,e})),...feed.map(f=>({key:f.at+.5,f}))].sort((a,b)=>a.key-b.key).slice(-160).reverse();
 let stamp='',phase='';const out=[];
 for(const {e,f} of items){
  const x=e||f,here=`第 ${x.loop} 轮回 · 第 ${x.day} 日`;
  if(here!==stamp){out.push(`<h5>${here}</h5>`);stamp=here;phase='';}
  if(e){
   const label=e.phase&&!UNPHASED.includes(e.type)?phaseLabel(e.phase):'';
   if(label&&label!==phase)out.push(`<h6 class="log-phase">${esc(label)}</h6>`);
   phase=label;
  }
  if(f)out.push(`<p class="entry talk"><b>${esc(seatName(f.seat))}</b>「${esc(f.text)}」</p>`);
  else out.push(`<p class="entry ${esc(e.type)}">${esc(e.text)}${e.cards?`<span class="entry-cards">${e.cards.map(p=>`<i class="${p.seat==='M'?'mm':'hero'}"><b>${esc(seatMark(p.seat))}</b>${esc(name(p.target))} · ${esc(cardLabel(p.card))}</i>`).join('')}</span>`:''}</p>`);
 }
 return `<div class="log">${out.join('')}</div>`;
}

// Rows are characters, columns the roles the remaining rule combinations can still contain.
function sheet(v,ctx){
 const a=ctx.analysis,tool=ctx.tool,cols=a.roles.filter(r=>!r.hidden),gone=a.roles.filter(r=>r.hidden);
 const toolBtn=(id,label)=>`<button type="button" class="tool ${id}${tool===id?' active':''}" data-do="sheet-tool" data-tool="${id}" aria-pressed="${tool===id}"><b>${MARKS[id]}</b>${label}</button>`;
 const chip=p=>`<button type="button" class="plot-chip ${p.mark}${p.auto?' auto':''}" data-do="sheet-plot" data-p="${p.id}"${p.locked?' disabled':''} title="${esc([p.auto||(p.locked?'已公开':''),p.effect].filter(Boolean).join(' · '))}"><i>${MARKS[p.mark]||''}</i><span><b>${esc(p.name)}</b>${p.roles?`<small>${esc(p.roles)}</small>`:''}</span></button>`;
 const quota=r=>r.uncertain?'—':r.id==='person'?'':r.min===r.max?r.max:r.min+'–'+r.max;
 const cell=(row,r)=>{
  const c=row.cells[r.id],state=c.locked?'已确认':c.auto||(c.lead?'推论：很可能':'');
  return `<td><button type="button" class="cell ${c.mark}${c.auto?' auto':''}${c.locked?' locked':''}${c.lead?' lead':''}" data-do="sheet" data-c="${row.id}" data-r="${r.id}"${c.locked?' disabled':''} title="${esc(state)}" aria-label="${esc(`${name(row.id)} · ${r.name}：${MARKS[c.mark]||'未标记'}${state?'（'+state+'）':''}`)}">${MARKS[c.mark]||(c.lead?'✓':'')}</button></td>`;
 };
 const culprit=e=>`<label class="culprit-row"><b>第 ${e.day} 日</b>${e.known?`<span class="sure">${esc(name(e.known))} · 已确认</span>`:`<select data-sheet-culprit="${e.day}" aria-label="第 ${e.day} 日事件的犯人"><option value="">未定</option>${v.script.characters.map(c=>`<option value="${c}"${e.guess===c?' selected':''}>${esc(name(c))}</option>`).join('')}</select>`}</label>`;
 const history=clues(v);
 return `${a.manualOnly?'<p class="hint">MZ 中角色公开可能是伪装，EX 卡也可能改变角色。此处保留你的标记，不据此自动排除原配役。</p>':''}<div class="sheet-tools" role="toolbar" aria-label="标记工具">${toolBtn('no','排除')}${toolBtn('yes','认定')}${toolBtn('maybe','存疑')}
   <button type="button" class="icon-btn sheet-wide" data-do="sheet-wide" title="${ctx.wide?'收窄':'加宽'}" aria-label="${ctx.wide?'收窄侧栏':'加宽侧栏'}" aria-pressed="${Boolean(ctx.wide)}">${icon('panel')}</button></div>
  <section class="block"><h4>规则 <small>${a.only?'只剩一种组合':`还剩 ${a.combos} 种组合`}</small></h4>
   <div class="plot-chips"><span class="plot-kind">规则 Y</span>${a.plots.main.map(chip).join('')}</div>
   <div class="plot-chips"><span class="plot-kind">规则 X ×${a.plots.subCount}</span>${a.plots.sub.map(chip).join('')}</div></section>
  <section class="block"><h4>角色</h4>
   <div class="sheet-scroll"><table class="sheet"><thead><tr><th></th>${cols.map(r=>`<th class="${r.id!=='person'&&r.max&&r.yes>=r.max?'full':''}" title="${esc(r.name)}${r.id==='person'?'':` · ${quota(r)} 人，已认定 ${r.yes}`}"><span>${esc(r.name)}</span><small>${quota(r)}</small></th>`).join('')}</tr></thead>
   <tbody>${a.rows.map(row=>`<tr class="${row.confirmed?'confirmed':''}"><th><button type="button" class="sheet-who" data-character="${row.id}" title="${esc(row.note)}"><img src="/${char(row.id).portrait}" alt="" loading="lazy">${esc(name(row.id))}${row.note?'<i></i>':''}</button></th>${cols.map(r=>cell(row,r)).join('')}</tr>`).join('')}</tbody></table></div>
   ${gone.length?`<p class="hint">这一局不会有：${gone.map(r=>esc(r.name)).join('、')}</p>`:''}</section>
  ${a.hints.length||a.warns.length?`<section class="block leads"><h4>推论${a.hints.length>1?btn('全部采纳','sheet-adopt-all','small ghost'):''}</h4>
   ${a.warns.map(w=>`<p class="lead-row warn">${icon('alert')}<span>${esc(w)}</span></p>`).join('')}
   ${a.hints.map(h=>`<p class="lead-row"><span>${esc(h.text)}</span>${btn('采纳','sheet-adopt','small',`data-c="${h.character}" data-r="${h.role}"`)}</p>`).join('')}</section>`:''}
  ${a.culprits.length?`<section class="block"><h4>事件的犯人</h4>${a.culprits.map(culprit).join('')}</section>`:''}
  <section class="block"><h4>线索</h4>${history.length?history.map(g=>`<h5 class="clue-loop">第 ${g.loop} 轮回</h5>${g.items.map(e=>`<p class="clue ${esc(e.type)}"><b>第${e.day}日${e.phase?`<i>${esc(phaseLabel(e.phase))}</i>`:''}</b><span>${esc(e.text)}${e.type==='failed'&&failure(v,e.loop)?.detail?`<small>${esc(failure(v,e.loop).detail)}</small>`:''}</span></p>`).join('')}`).join(''):'<p class="hint">死亡、事件、查出的角色都会记在这里，并标明发生在哪个阶段。</p>'}</section>
  <label class="notes"><span>笔记</span><textarea id="notes" data-note="${esc(v.id)}" placeholder="随手记下你的猜测"></textarea></label>
  ${btn('清空全部标记','sheet-reset','small ghost')}`;
}

function reference(v){
 const set=v.script.ruleset,inPlay=new Set([...(v.knownPlots||[]),...(v.secret?[v.secret.mainPlot,...v.secret.subPlots]:[])]);
 const plot=p=>`<div class="ref${inPlay.has(p.id)?' in-play':''}"><b>${esc(p.name_zh_working)}${inPlay.has(p.id)?'<i>本剧本</i>':''}</b>${plotRoles(p)?`<span class="ref-roles">${esc(plotRoles(p))}</span>`:''}${p.effect_zh?`<p>${esc(p.effect_zh)}</p>`:''}</div>`;
 const role=r=>`<div class="ref"><b>${esc(r.name_zh_working)}${r.maxCount?`<i>至多 ${r.maxCount} 人</i>`:''}${REFUSAL[r.goodwillRefusal]?`<i>${REFUSAL[r.goodwillRefusal]}</i>`:''}</b>${r.effects_zh.length?r.effects_zh.map(t=>`<p>${esc(t)}</p>`).join(''):'<p class="none">没有能力</p>'}</div>`;
 const incident=e=>`<div class="ref"><b>${esc(e.name_zh_working)}</b><p>${esc(e.effect_zh)}</p></div>`;
 const fold=(title,body,open=false)=>`<details class="fold"${open?' open':''}><summary>${title}</summary>${body}</details>`;
 return `<p class="hint">本剧本：1 条规则 Y + ${set==='FS'?1:2} 条规则 X。</p>
  ${fold('规则 Y',plotsFor(set,'Y').map(plot).join(''),true)}
  ${fold('规则 X',plotsFor(set,'X').map(plot).join(''))}
  ${fold('角色',rolesFor(set).map(role).join(''))}
  ${fold('事件',incidentsFor(set).map(incident).join(''))}`;
}

const TABS=[['intel','情报'],['log','记录'],['sheet','推理'],['ref','速查']];

// ctx: {tab, sheet} — the sheet tab exists only while there is something left to deduce.
export function sideTabsHtml(v,ctx){
 return `<div class="tabs" role="tablist">${TABS.filter(([id])=>id!=='sheet'||ctx.sheet).map(([id,label])=>`<button type="button" role="tab" aria-selected="${ctx.tab===id}" class="${ctx.tab===id?'active':''}" data-do="tab" data-tab="${id}">${label}${id==='log'?`<small>${v.log.length}</small>`:''}</button>`).join('')}<button type="button" class="side-close" data-do="toggle-side" aria-label="关闭侧栏">${icon('close')}</button></div>`;
}

// ctx: {tab, aiFeed, analysis, tool, wide, readOnly}
export function sideBodyHtml(v,ctx){
 const body=ctx.tab==='log'?log(v,ctx):ctx.tab==='sheet'?sheet(v,ctx):ctx.tab==='ref'?reference(v):intel(v,ctx);
 return `<div class="side-body tab-${ctx.tab}" role="tabpanel">${body}</div>`;
}

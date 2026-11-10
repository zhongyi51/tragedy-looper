import {esc,icon,btn} from '../html.mjs';
import {char,name,seatName,seatMark,cardLabel,rolesFor,plotsFor,incidentsFor,plotRoles} from '../lookup.mjs';

const REFUSAL={optional:'可拒绝友好能力',mandatory:'必定拒绝友好能力'};
export const SHEET_MARKS=['','✗','✓','?'];

export function incidentSchedule(v){
 const named=v.seat==='M'||Boolean(v.secret);
 return v.script.incidents.map(e=>{
  const happened=v.occurred?.includes(e.day),status=happened?'已发生':e.day<v.day?'未发生':e.day===v.day?'今日':'';
  const culprit=v.knownCulprits?.[e.day];
  return `<div class="schedule${e.day===v.day?' today':''}${e.day<v.day?' past':''}${happened?' happened':''}"><b>DAY ${e.day}</b><span class="${named&&e.type?'':'unrevealed'}">${named&&e.type?esc(name(e.type)):'事件未公开'}</span>${culprit?`<em>犯人 ${esc(name(culprit))}</em>`:''}${status?`<i>${status}</i>`:''}</div>`;
 }).join('')||'<p class="hint">本剧本没有预告事件。</p>';
}

function intel(v,ctx){
 const known=Object.entries(v.knownRoles),flags=[];
 if(v.flags?.heroImmortal)flags.push('本轮回主人公不会死亡');
 if(v.flags?.patientFree)flags.push('住院患者本轮回可以自由移动');
 for(const id of v.flags?.suppressed||[])flags.push(name(id)+'本轮回不会引发事件');
 const curtain=v.secret?`<section class="block curtain"><h4>${icon('mask')}剧作家幕布 · 仅你可见</h4>
   <p class="plots"><b>${esc(name(v.secret.mainPlot))}</b>${v.secret.subPlots.map(p=>`<span>${esc(name(p))}</span>`).join('')}</p>
   <table class="roles">${Object.entries(v.secret.roles).filter(([,r])=>r!=='person').map(([c,r])=>`<tr><td>${esc(name(c))}</td><td>${esc(name(r))}</td><td>${v.knownRoles[c]?'已暴露':''}</td></tr>`).join('')}</table>
   ${v.secret.incidents.map(e=>`<p class="secret-incident">第 ${e.day} 日 · ${esc(name(e.type))} · 犯人 ${esc(name(e.culprit))}</p>`).join('')}</section>`:'';
 const budget=!ctx.readOnly&&v.aiConfigured?`<section class="block budget"><h4>本局 API 估算</h4><div class="budget-row"><span>${v.spent===null?'用量在终局后显示':'$'+v.spent.toFixed(4)}</span><b>上限 $${v.budget.toFixed(2)}</b></div>${v.spent===null?'':`<div class="meter"><span style="width:${Math.min(100,v.spent/v.budget*100)}%"></span></div>`}</section>`:'';
 return `<section class="block"><h4>${icon('clock')}事件日程</h4>${incidentSchedule(v)}</section>
  ${v.secret&&!known.length?'':`<section class="block"><h4>${icon('eye')}${v.secret?'主人公已确认的角色':'已确认角色'}</h4>${known.length?`<div class="known-roles">${known.map(([c,r])=>`<span class="known-role"><img src="/${char(c).portrait}" alt="">${esc(name(c))}<b>${esc(name(r))}</b></span>`).join('')}</div>`:'<p class="hint">尚未确认任何角色。提升友好、使用人物能力来揭开身份。</p>'}</section>`}
  ${v.knownPlots?.length?`<section class="block"><h4>已公开副规则</h4><p class="plots">${v.knownPlots.map(p=>`<span>${esc(name(p))}</span>`).join('')}</p></section>`:''}
  ${flags.length?`<section class="block"><h4>本轮回状态</h4>${flags.map(f=>`<p class="flag">${esc(f)}</p>`).join('')}</section>`:''}
  ${curtain}${budget}
  ${v.winner&&!ctx.readOnly?`<section class="block">${btn('揭晓完整真相','truth','primary wide')}</section>`:''}
  <p class="legend"><span class="g">${icon('heart')}友好</span><span class="p">${icon('unrest')}不安</span><span class="i">${icon('intrigue')}暗跃</span><span class="gd">${icon('shield')}护卫</span></p>`;
}

function log(v,ctx){
 const feed=ctx.readOnly?[]:(ctx.aiFeed||[]).filter(f=>f.gameId===v.id);
 const items=[...v.log.map(e=>({key:e.n,e})),...feed.map(f=>({key:f.at+.5,f}))].sort((a,b)=>a.key-b.key).slice(-160).reverse();
 let stamp='';const out=[];
 for(const {e,f} of items){
  const x=e||f,here=`第 ${x.loop} 轮回 · 第 ${x.day} 日`;
  if(here!==stamp){out.push(`<h5>${here}</h5>`);stamp=here;}
  if(f)out.push(`<p class="entry talk"><b>${esc(seatName(f.seat))}</b>「${esc(f.text)}」</p>`);
  else out.push(`<p class="entry ${esc(e.type)}">${esc(e.text)}${e.cards?`<span class="entry-cards">${e.cards.map(p=>`<i class="${p.seat==='M'?'mm':'hero'}"><b>${esc(seatMark(p.seat))}</b>${esc(name(p.target))} · ${esc(cardLabel(p.card))}</i>`).join('')}</span>`:''}</p>`);
 }
 return `<div class="log">${out.join('')}</div>`;
}

// Rows are characters, columns candidate roles; each cell cycles through SHEET_MARKS.
function sheet(v,ctx){
 const roles=rolesFor(v.script.ruleset),marks=ctx.sheet||{},truth=v.secret?.roles;
 const cell=(c,r)=>{
  const known=v.knownRoles[c]||truth?.[c],mark=known?(known===r.id?'✓':'✗'):marks[c]?.[r.id]||'';
  return `<td><button type="button" class="cell${mark==='✓'?' yes':mark==='✗'?' no':mark?' maybe':''}${known?' locked':''}" data-do="sheet" data-c="${c}" data-r="${r.id}"${known?' disabled':''} aria-label="${esc(name(c)+' 是否为 '+r.name_zh_working+'：'+(mark||'未标记'))}">${mark}</button></td>`;
 };
 return `<p class="hint">点击格子循环标记：✗ 排除 → ✓ 认定 → ? 存疑。已确认的角色自动锁定；标记只保存在此浏览器。</p>
  <div class="sheet-scroll"><table class="sheet"><thead><tr><th></th>${roles.map(r=>`<th title="${esc(r.name_zh_working)}"><span>${esc(r.name_zh_working)}</span></th>`).join('')}</tr></thead>
  <tbody>${v.script.characters.map(c=>`<tr><th>${esc(name(c))}</th>${roles.map(r=>cell(c,r)).join('')}</tr>`).join('')}</tbody></table></div>
  ${ctx.readOnly?'':`<label class="notes"><span>推理笔记</span><textarea id="notes" data-note="${esc(v.id)}" placeholder="写下假说与证据：谁是犯人？谁可能是关键人物？仅保存在此浏览器。"></textarea></label>`}`;
}

function reference(v){
 const set=v.script.ruleset,inPlay=new Set([...(v.knownPlots||[]),...(v.secret?[v.secret.mainPlot,...v.secret.subPlots]:[])]);
 const plot=p=>`<div class="ref${inPlay.has(p.id)?' in-play':''}"><b>${esc(p.name_zh_working)}${inPlay.has(p.id)?'<i>本剧本</i>':''}</b>${plotRoles(p)?`<span class="ref-roles">${esc(plotRoles(p))}</span>`:''}${p.effect_zh?`<p>${esc(p.effect_zh)}</p>`:''}</div>`;
 const role=r=>`<div class="ref"><b>${esc(r.name_zh_working)}${r.maxCount?`<i>至多 ${r.maxCount} 人</i>`:''}${REFUSAL[r.goodwillRefusal]?`<i>${REFUSAL[r.goodwillRefusal]}</i>`:''}</b>${r.effects_zh.length?r.effects_zh.map(t=>`<p>${esc(t)}</p>`).join(''):'<p class="none">没有特殊能力。</p>'}</div>`;
 const incident=e=>`<div class="ref"><b>${esc(e.name_zh_working)}</b><p>${esc(e.effect_zh)}</p></div>`;
 const fold=(title,body,open=false)=>`<details class="fold"${open?' open':''}><summary>${title}</summary>${body}</details>`;
 return `<p class="hint">${set==='FS'?'First Steps：1 条主规则 + 1 条副规则':'Basic Tragedy Χ：1 条主规则 + 2 条副规则'}。剧本的规则与角色都出自下表，用它来排除不可能的组合。</p>
  ${fold('主规则 Y',plotsFor(set,'Y').map(plot).join(''),true)}
  ${fold('副规则 X',plotsFor(set,'X').map(plot).join(''))}
  ${fold('角色',rolesFor(set).map(role).join(''))}
  ${fold('事件',incidentsFor(set).map(incident).join(''))}`;
}

const TABS=[['intel','情报'],['log','记录'],['sheet','推理'],['ref','速查']];

export function sideTabsHtml(v,ctx){
 return `<div class="tabs" role="tablist">${TABS.filter(([id])=>!(ctx.readOnly&&id==='sheet')).map(([id,label])=>`<button type="button" role="tab" aria-selected="${ctx.tab===id}" class="${ctx.tab===id?'active':''}" data-do="tab" data-tab="${id}">${label}${id==='log'?`<small>${v.log.length}</small>`:''}</button>`).join('')}<button type="button" class="side-close" data-do="toggle-side" aria-label="关闭侧栏">${icon('close')}</button></div>`;
}

// ctx: {tab, aiFeed, sheet, readOnly}
export function sideBodyHtml(v,ctx){
 const body=ctx.tab==='log'?log(v,ctx):ctx.tab==='sheet'?sheet(v,ctx):ctx.tab==='ref'?reference(v):intel(v,ctx);
 return `<div class="side-body tab-${ctx.tab}" role="tabpanel">${body}</div>`;
}

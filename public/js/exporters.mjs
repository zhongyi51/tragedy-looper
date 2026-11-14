// Builders for downloadable files. They return strings so they can be checked without a browser.
import {esc} from './html.mjs';
import {name,cat} from './lookup.mjs';
import {sanitizePublicReplay} from '../replay-validation.mjs';

const COMMUNICATION={between_loops_only:'仅轮回间讨论',allowed_during_loop:'允许轮回内讨论'};

export function publicDraft(s){
 return {id:s.id,title:s.title,author:s.author,...(s.intro?{intro:s.intro}:{}),ruleset:s.ruleset,days:s.days,loops:s.loops,communication:s.communication,characters:s.characters,incidents:s.incidents.map(({day,type,publicType})=>({day,...(s.settings?.incidentVisibility!=='hidden'?{type:publicType||type}:{})})),settings:{...(s.settings||{}),incidentVisibility:s.settings?.incidentVisibility??'public'},specialRules:s.specialRules||[]};
}

export function printableHtml(s,full){
 const d=full?s:publicDraft(s);
 const style='body{font:16px/1.8 "Noto Serif SC","Songti SC",serif;max-width:820px;margin:48px auto;padding:0 24px;color:#1c1c1c}h1{border-bottom:2px solid #1c1c1c;padding-bottom:8px}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #999;padding:8px 12px;text-align:left}th{background:#f2efe8}small{color:#666}.tag{display:inline-block;border:1px solid #999;border-radius:4px;padding:0 8px;margin-right:8px;font-size:13px}';
 const cast=s.characters.map(id=>`<tr><td>${esc(name(id))}</td>${full?'<td>'+esc(name(s.roles[id]))+'</td>':''}</tr>`).join('');
 const schedule=d.incidents.map(e=>`<tr><td>第 ${e.day} 日</td><td>${e.type?esc(name(e.type)):'事件未公开'}</td>${full?'<td>'+esc(name(e.culprit))+'</td>':''}</tr>`).join('');
 return `<!doctype html><meta charset="utf-8"><title>${esc(s.title)}</title><style>${style}</style>`
  +`<h1>${esc(s.title)}</h1><p><span class="tag">${full?'剧作家私密页 · 含答案':'主人公公开页'}</span><span class="tag">${esc(s.ruleset)}</span><span class="tag">${s.days} 日 / ${s.loops} 轮回</span><span class="tag">${esc(COMMUNICATION[s.communication]||s.communication)}</span></p>`
  +(s.intro?`<p>${esc(s.intro)}</p>`:'')
  +(full?`<p>规则 Y：${esc(name(s.mainPlot))}　规则 X：${s.subPlots.map(p=>esc(name(p))).join('、')}</p>`:'')
  +`<h2>登场人物</h2><table><tr><th>人物</th>${full?'<th>角色</th>':''}</tr>${cast}</table>`
  +`<h2>事件日程</h2><table><tr><th>日期</th><th>事件</th>${full?'<th>犯人</th>':''}</tr>${schedule}</table>`
  +`<p>公开参数：${esc(JSON.stringify(s.settings||{}))}</p><small>原作 惨劇RoopeR / BakaFire Party · 作者 ${esc(s.author)}</small>`;
}

// A single self-contained file: the data is inlined, so `<` is escaped to keep it inside its script element.
export function offlineReplayHtml(replay){
 const clean=sanitizePublicReplay(replay),catalog=cat();
 const names=catalog?Object.fromEntries([...catalog.characters.map(c=>[c.id,c.name_zh_working]),...catalog.locations.map(l=>[l.id,l.name_zh])]):{};
 const data=JSON.stringify({frames:clean.frames,names}).replace(/</g,'\\u003c');
 const style='body{font:15px/1.6 system-ui,sans-serif;background:#0d1317;color:#e8e4da;max-width:980px;margin:30px auto;padding:20px}h1{font-size:22px}input{width:100%}table{border-collapse:collapse;width:100%;margin:14px 0}td,th{padding:8px 10px;border:1px solid #33424d;text-align:left}th{color:#d9c08a}tr.dead td{opacity:.45;text-decoration:line-through}pre{white-space:pre-wrap;line-height:1.8;color:#abb8bd;max-height:50vh;overflow:auto}';
 const script=`const data=${data};const r=document.getElementById('range');r.max=data.frames.length-1;r.value=0;const n=id=>data.names[id]||id;`
  +`function draw(){const v=data.frames[r.value].view;document.getElementById('phase').textContent=v.script.title+' · 轮回 '+v.loop+' / 第 '+v.day+' 日 · '+v.phase;`
  +`const conditions=[];if(Number.isInteger(v.extraGauge))conditions.push('EX 计数：'+v.extraGauge);for(const [id,until] of Object.entries(v.closedLocations||{}))if(until>=v.day)conditions.push(n(id)+'封锁至第 '+until+' 日');document.getElementById('conditions').textContent=conditions.join(' · ');`
  +`const t=document.getElementById('board');t.replaceChildren();const h=t.insertRow();for(const x of ['人物','地点','状态','友好','不安','暗跃']){const th=document.createElement('th');th.textContent=x;h.append(th);}`
  +`for(const c of Object.values(v.board)){const tr=t.insertRow();if(!c.alive)tr.className='dead';for(const x of [n(c.id),n(c.location),(c.alive?'存活':'死亡')+(c.extra?' · EX 卡':'')+(c.alive&&c.movementLockedDay>=v.day?' · 第 '+c.movementLockedDay+' 日不能移动':''),c.goodwill,c.paranoia,c.intrigue])tr.insertCell().textContent=x;}`
  +`document.getElementById('log').textContent=v.log.map(e=>'L'+e.loop+' D'+e.day+'  '+e.text).join(String.fromCharCode(10));}r.oninput=draw;draw();`;
 return `<!doctype html><meta charset="utf-8"><title>惨剧轮回 · 离线回放</title><style>${style}</style><h1>惨剧轮回 · 离线回放</h1><p>无需网络、服务端或模型。此文件仅包含导出视角的信息。</p><input id="range" aria-label="回放进度" type="range" min="0"><h2 id="phase"></h2><p id="conditions"></p><table id="board"></table><pre id="log"></pre><script>${script}<\/script>`;
}

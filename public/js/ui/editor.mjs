import {esc,icon,btn} from '../html.mjs';
import {cat,name,rolesFor,plotsFor,incidentsFor,plotRoles} from '../lookup.mjs';
import {parseDraft,roleNeeds} from '../script-draft.mjs';

const option=(value,label,current)=>`<option value="${esc(value)}"${value===current?' selected':''}>${esc(label)}</option>`;
const select=(kind,key,options,current,label)=>`<select data-edit="${kind}" data-key="${esc(key)}" aria-label="${esc(label)}">${options.map(([v,l])=>option(v,l,current)).join('')}</select>`;
const field=(label,control,cls='')=>`<label class="field ${cls}"><span>${label}</span>${control}</label>`;

function form(d){
 const set=['FS','BTX'].includes(d.ruleset)?d.ruleset:'FS',cast=d.characters||[],roles=rolesFor(set).map(r=>[r.id,r.name_zh_working]);
 const plotOptions=kind=>plotsFor(set,kind).map(p=>[p.id,p.name_zh_working+(plotRoles(p)?`（${plotRoles(p)}）`:'')]);
 const needs=roleNeeds({...d,ruleset:set});
 const castCard=c=>{
  const on=cast.includes(c.id);
  return `<div class="cast-card${on?' on':''}">
   <button type="button" class="cast-toggle" data-do="cast" data-id="${c.id}" aria-pressed="${on}" title="${on?'移出剧本':'加入剧本'}"><img src="/${c.portrait}" alt="" loading="lazy"><b>${esc(c.name_zh_working)}</b>${on?icon('check'):icon('plus')}</button>
   ${on?select('role',c.id,roles,d.roles?.[c.id]||'person',c.name_zh_working+'的角色'):''}
  </div>`;
 };
 const dayRow=day=>{
  const e=(d.incidents||[]).find(x=>x.day===day);
  return `<div class="day-row${e?' has':''}"><b>第 ${day} 日</b>
   ${select('incident',day,[['','无事件'],...incidentsFor(set).map(x=>[x.id,x.name_zh_working])],e?.type||'','第 '+day+' 日的事件')}
   ${e?select('culprit',day,cast.map(c=>[c,name(c)]),e.culprit,'第 '+day+' 日事件的犯人'):'<span class="hint">—</span>'}</div>`;
 };
 const specials=[
  cast.includes('godly_being')&&field('神格到场轮回',`<input type="number" min="1" max="${d.loops}" data-edit="setting" data-key="godlyLoop" value="${esc(d.settings?.godlyLoop??1)}">`),
  cast.includes('transfer_student')&&field('转学生到场日',`<input type="number" min="1" max="${d.days}" data-edit="setting" data-key="transferDay" value="${esc(d.settings?.transferDay??1)}">`),
  cast.includes('boss')&&field('大人物领地',select('setting','bossTerritory',cat().locations.map(l=>[l.id,l.name_zh]),d.settings?.bossTerritory,'大人物领地'))
 ].filter(Boolean);
 return `<div class="form">
  <section class="form-block"><h3>基本信息</h3><div class="fields">
   ${field('标题',`<input data-edit="field" data-key="title" maxlength="120" value="${esc(d.title??'')}">`,'wide')}
   ${field('作者',`<input data-edit="field" data-key="author" maxlength="80" value="${esc(d.author??'')}">`)}
   ${field('惨剧集合',select('field','ruleset',[['FS','First Steps'],['BTX','Basic Tragedy Χ']],set,'惨剧集合'))}
   ${field('每轮回天数',`<input type="number" min="1" max="10" data-edit="field" data-key="days" value="${esc(d.days??4)}">`)}
   ${field('轮回次数',`<input type="number" min="1" max="8" data-edit="field" data-key="loops" value="${esc(d.loops??3)}">`)}
   ${field('交流规则',select('field','communication',[['between_loops_only','仅轮回间讨论'],['allowed_during_loop','允许轮回内讨论']],d.communication,'交流规则'))}
  </div></section>
  <section class="form-block"><h3>规则</h3><div class="fields">
   ${field('主规则 Y',select('field','mainPlot',plotOptions('Y'),d.mainPlot,'主规则'),'wide')}
   ${(set==='FS'?[0]:[0,1]).map(i=>field('副规则 X'+(set==='BTX'?' · '+(i+1):''),select('sub',i,plotOptions('X'),d.subPlots?.[i],'副规则 '+(i+1)),'wide')).join('')}
  </div>
  <div class="needs" aria-label="规则要求的角色">${needs.length?needs.map(n=>`<span class="need${n.ok?' ok':' bad'}">${esc(name(n.role))} <b>${n.count}</b>/${n.min===n.max?n.max:n.min+'–'+n.max}</span>`).join(''):'<span class="hint">所选规则没有要求特定角色。</span>'}</div></section>
  <section class="form-block"><h3>登场人物 <small>${cast.length} 人 · 点击头像加入或移出，并为每人指定角色</small></h3><div class="cast-grid">${cat().characters.map(castCard).join('')}</div></section>
  <section class="form-block"><h3>事件日程 <small>每天至多一个事件，每名犯人只负责一个事件</small></h3><div class="day-rows">${Array.from({length:Math.max(1,Math.min(10,d.days||1))},(_,i)=>dayRow(i+1)).join('')}</div></section>
  ${specials.length?`<section class="form-block"><h3>特殊人物设置</h3><div class="fields">${specials.join('')}</div></section>`:''}
 </div>`;
}

function report(r){
 if(!r)return '';
 if(r.failure)return `<div class="report error">${esc(r.failure)}</div>`;
 const errors=r.errors.map(x=>`<li>${esc(x.path+'：'+x.message)}</li>`).join(''),warnings=r.warnings.map(x=>`<li class="warn">提示：${esc(x.message)}</li>`).join('');
 return `<div class="report${r.errors.length?' error':''}"><b>${r.errors.length?`未通过校验（${r.errors.length} 项）`:'结构验证通过。平衡性仍需试玩评估。'}</b>${errors||warnings?`<ul>${errors}${warnings}</ul>`:''}</div>`;
}

export function editorHtml(state){
 const {editor,info,working}=state,gen=editor.generator,draft=parseDraft(editor.text),tab=editor.tab==='json'?'json':'form';
 const body=tab==='json'
  ?`<label class="json"><span class="sr-only">完整剧本 JSON</span><textarea id="script-editor" spellcheck="false" placeholder="生成、载入或导入一份剧本。">${esc(editor.text)}</textarea></label>`
  :draft?form(draft):`<div class="form-empty">${editor.text.trim()?'<p>当前 JSON 无法解析。请切换到 JSON 标签修正，或重新生成一份剧本。</p>':'<p>还没有剧本。从左侧生成一份合法骨架，载入教学剧本，或从空白开始。</p>'}${btn(icon('plus')+'从空白剧本开始','blank-script','primary')}</div>`;
 return `<main class="wrap editor">
  <div class="page-intro"><div><div class="eyebrow">SCRIPT WORKSHOP</div><h1>让一切，从剧本开始。</h1></div><p class="lead">用约束生成合法骨架，再调整配役与事件。结构合法不等于已经平衡，请在试玩后再分享。</p></div>
  <div class="editor-grid">
   <aside class="panel generator"><h3>快速开始</h3>
    ${field('惨剧集合',`<select id="gen-set">${option('FS','First Steps · 入门',gen.ruleset)}${option('BTX','Basic Tragedy Χ · 基础',gen.ruleset)}</select>`)}
    ${field('随机种子',`<input id="gen-seed" type="number" value="${esc(gen.seed)}">`)}
    ${field('故事主题（AI 润色用）',`<input id="gen-theme" value="${esc(gen.theme)}" placeholder="例如：雨夜，最后一班电车">`)}
    ${btn('生成合法骨架','generate','primary',working?'disabled':'')}
    ${btn(icon('bot')+'生成并用 AI 润色','ai-generate','',working||!info.configured?`disabled title="${info.configured?'':'未配置 DeepSeek 密钥'}"`:'')}
    ${btn('载入官方教学剧本','starter-editor')}
    <label class="btn file">导入剧本 JSON<input type="file" id="script-file" accept=".json,application/json"></label>
    <p class="hint">支持全部 24 名基础人物。暂不接受任意脚本代码和自定义特殊规则。</p>
   </aside>
   <section class="editor-main">
    <p class="disclosure">${icon('alert')}编辑器包含完整配役与犯人，是剧作家工作区。读过答案后，请勿把这份剧本当作自己的盲推局。</p>
    <div class="page-tabs" role="tablist"><button type="button" role="tab" aria-selected="${tab==='form'}" class="${tab==='form'?'active':''}" data-do="editor-tab" data-tab="form">可视化编辑</button><button type="button" role="tab" aria-selected="${tab==='json'}" class="${tab==='json'?'active':''}" data-do="editor-tab" data-tab="json">JSON</button></div>
    ${body}
    ${report(editor.report)}
    <div class="toolbar">${btn(icon('check')+'验证剧本','validate','primary')}${btn(icon('play')+'以此剧本开局','play-editor')}${btn('导出完整 JSON','export-script')}${btn('导出公开 JSON','export-public')}${btn('公开打印页','print-public')}${btn('私密打印页','print-private')}</div>
   </section>
  </div>
 </main>`;
}

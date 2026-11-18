import {esc,icon,btn} from '../html.mjs';
import {cat,name,rolesFor,plotsFor,incidentsFor,plotRoles} from '../lookup.mjs';
import {parseDraft,roleNeeds} from '../script-draft.mjs';
import {availableModels,authorModel,authorBudget} from '../ai-settings.mjs';

const option=(value,label,current)=>`<option value="${esc(value)}"${value===current?' selected':''}>${esc(label)}</option>`;
const select=(kind,key,options,current,label)=>`<select data-edit="${kind}" data-key="${esc(key)}" aria-label="${esc(label)}">${options.map(([v,l])=>option(v,l,current)).join('')}</select>`;
const RULESETS=[['FS','FS · First Steps（入门）'],['BTX','BTX · Basic Tragedy Χ（进阶）'],['MZ','MZ · Midnight Zone（扩展）'],['MC','MC · Mystery Circle（扩展）']];
// Where a problem is, in the words the form uses: “角色 · 医生”, “事件 2”.
const PARTS={title:'标题',ruleset:'惨剧集合',days:'天数',loops:'轮回数',communication:'主人公讨论',characters:'人物',mainPlot:'规则 Y',subPlots:'规则 X',roles:'角色',incidents:'事件',settings:'特殊人物',specialRules:'特殊规则',godlyLoop:'神格',transferDay:'转学生',bossTerritory:'大人物',culprit:'犯人',day:'日期',type:'事件',publicType:'公开名称',incidentVisibility:'事件日程',script:'剧本'};
const place=path=>path.split('.').map(part=>PARTS[part]||(/^\d+$/.test(part)?String(Number(part)+1):name(part))).join(' · ').replace(/ · (\d+)/,' $1');
const designFields=[['premise','故事真相'],['threatPlan','剧作家的取胜路径'],['cluePlan','主人公可发现的线索'],['counterplay','主人公的反制方法'],['loopPlan','各轮回的设计']];
const field=(label,control,cls='')=>`<label class="field ${cls}"><span>${label}</span>${control}</label>`;

function form(d){
 const set=['FS','BTX','MZ','MC'].includes(d.ruleset)?d.ruleset:'FS',cast=d.characters||[],roles=rolesFor(set).map(r=>[r.id,r.name_zh_working]);
 const plotOptions=kind=>plotsFor(set,kind).map(p=>[p.id,p.name_zh_working+(plotRoles(p)?`（${plotRoles(p)}）`:'')]);
 const needs=roleNeeds({...d,ruleset:set});
 const selectedPlots=[d.mainPlot,...(d.subPlots||[])].map(id=>cat().plots.find(p=>p.id===id)).filter(Boolean);
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
   ${e?select('culprit',day,cast.map(c=>[c,name(c)]),e.culprit,'第 '+day+' 日事件的犯人'):'<span class="hint">—</span>'}</div>${e?.type==='fake_incident'?`<div class="day-mask">${field('第 '+day+' 日 · 对主人公公开的名称',select('disguise',day,[['','伪装事件（不另作伪装）'],...incidentsFor(set).filter(x=>x.id!=='fake_incident').map(x=>[x.id,x.name_zh_working])],e.publicType||'','第 '+day+' 日伪装事件的公开名称'))}</div>`:''}`;
 };
 const specials=[
  cast.includes('godly_being')&&field('神格从第几轮回登场',`<input type="number" min="1" max="${d.loops}" data-edit="setting" data-key="godlyLoop" value="${esc(d.settings?.godlyLoop??1)}">`),
  cast.includes('transfer_student')&&field('转学生第几天登场',`<input type="number" min="1" max="${d.days}" data-edit="setting" data-key="transferDay" value="${esc(d.settings?.transferDay??1)}">`),
  cast.includes('boss')&&field('大人物的领地',select('setting','bossTerritory',cat().locations.map(l=>[l.id,l.name_zh]),d.settings?.bossTerritory,'大人物领地'))
 ].filter(Boolean);
 return `<div class="form">
  <section id="work-basics" class="form-block"><h3>基本信息</h3><div class="fields">
   ${field('标题',`<input data-edit="field" data-key="title" maxlength="120" value="${esc(d.title??'')}">`,'wide')}
   ${field('公开开场简介',`<textarea rows="2" maxlength="600" data-edit="field" data-key="intro">${esc(d.intro||'')}</textarea>`,'wide')}
   ${field('难度',select('field','difficulty',[['','未标注'],['beginner','入门'],['standard','标准'],['hard','挑战']],d.difficulty||'','难度'))}
   ${field('作者',`<input data-edit="field" data-key="author" maxlength="80" value="${esc(d.author??'')}">`)}
   ${field('惨剧集合',select('field','ruleset',RULESETS,set,'惨剧集合'))}
   ${field('天数',`<input type="number" min="1" max="10" data-edit="field" data-key="days" value="${esc(d.days??4)}">`)}
   ${field('轮回数',`<input type="number" min="1" max="8" data-edit="field" data-key="loops" value="${esc(d.loops??3)}">`)}
   ${field('主人公讨论',select('field','communication',[['between_loops_only','只在轮回之间'],['allowed_during_loop','随时可以']],d.communication,'主人公讨论'))}
   ${field('事件日程',select('setting','incidentVisibility',[['public','公开名称（原版日程）'],['hidden','隐藏名称（自定玩法）']],d.settings?.incidentVisibility||'public','事件日程'))}
  </div></section>
  <section id="work-plots" class="form-block"><h3>规则</h3><div class="fields">
   ${field('规则 Y',select('field','mainPlot',plotOptions('Y'),d.mainPlot,'规则 Y'),'wide')}
   ${(set==='FS'?[0]:[0,1]).map(i=>field('规则 X'+(set!=='FS'?' '+(i+1):''),select('sub',i,plotOptions('X').filter(([id])=>id===d.subPlots?.[i]||!d.subPlots?.includes(id)),d.subPlots?.[i],'规则 X '+(i+1)),'wide')).join('')}
  </div>
  ${selectedPlots.map(p=>`<p class="hint"><b>${esc(p.name_zh_working)}</b>　${esc(p.effect_zh||'通过配役影响本局。')}</p>`).join('')}
  <div class="needs" aria-label="需要的角色">${needs.length?needs.map(n=>`<span class="need${n.ok?' ok':' bad'}">${esc(name(n.role))} <b>${n.count}</b>/${n.min===n.max?n.max:n.min+'–'+n.max}</span>`).join(''):'<span class="hint">这些规则不要求特定的角色。</span>'}</div></section>
  <section id="work-cast" class="form-block"><h3>人物 <small>${cast.length} 人 · 点头像加入或移出</small></h3><div class="cast-grid">${cat().characters.map(castCard).join('')}</div></section>
  <section id="work-calendar" class="form-block"><h3>事件 <small>每天最多一个；同一犯人可用于多个连续杀人，不能与其他事件混用</small></h3>${set==='MC'?'<p class="hint">愚者、双子、绝对者须各自担任事件犯人；私家侦探不能担任犯人。</p>':''}<div class="day-rows">${Array.from({length:Math.max(1,Math.min(10,d.days||1))},(_,i)=>dayRow(i+1)).join('')}</div></section>
  <section id="work-design" class="form-block"><h3>剧作家手记 <small>含真相，公开版会隐藏</small></h3><div class="fields">${designFields.map(([key,label])=>field(label,`<textarea rows="2" data-edit="design" data-key="${key}">${esc([d.privateDesign?.[key]||''].flat().join('\n'))}</textarea>`,key==='premise'?'wide':'')).join('')}</div></section>
  ${specials.length?`<section class="form-block"><h3>特殊人物</h3><div class="fields">${specials.join('')}</div></section>`:''}
 </div>`;
}

export function report(r){
 if(!r)return '';
 if(r.failure)return `<div class="report error">${esc(r.failure)}</div>`;
 const errors=r.errors.map(x=>`<li>${esc(place(x.path)+'：'+x.message)}</li>`).join(''),warnings=r.warnings.map(x=>`<li class="warn">提示：${esc(x.message)}</li>`).join('');
 return `<div class="report${r.errors.length?' error':''}"><b>${r.errors.length?`有 ${r.errors.length} 处问题`:'剧本可以使用'}</b>${errors||warnings?`<ul>${errors}${warnings}</ul>`:''}</div>`;
}

export function editorHtml(state){
 const {editor,info,working}=state,gen=editor.generator,draft=parseDraft(editor.text),tab=editor.tab==='json'?'json':'form';
 const formReady=draft&&(!draft.characters||Array.isArray(draft.characters))&&(!draft.subPlots||Array.isArray(draft.subPlots))&&(!draft.incidents||Array.isArray(draft.incidents)&&draft.incidents.every(e=>e&&typeof e==='object'));
 const body=tab==='json'
  ?`<label class="json"><span class="sr-only">完整剧本 JSON</span><textarea id="script-editor" spellcheck="false" placeholder="剧本 JSON">${esc(editor.text)}</textarea></label>`
  :formReady?form(draft):`<div class="form-empty">${editor.text.trim()?'<p>这份草稿的结构需要调整，请到 JSON 页检查。</p>':'<p>还没有剧本。</p>'}${!editor.text.trim()?'点击“新建空白剧本”，或从模板起草。':''}</div>`;
 return `<main class="wrap editor">
  <div class="page-intro"><div><h1>剧本编辑器</h1></div><p class="lead">编排规则、人物配役和事件日程。草稿可以分几次写完。</p></div>
  <div class="editor-grid">
   <aside class="work-sidebar"><section class="panel draft-shelf"><h3>我的剧本</h3>
    ${btn(icon('plus')+'新建空白剧本','blank-script')}
    ${(editor.files||[]).map(f=>`<button class="draft-item" data-do="open-draft" data-id="${esc(f.id)}" aria-current="${editor.fileId===f.id}"><b>${esc(f.title)}</b><small>${esc(f.updated.slice(0,10))} · 第 ${f.revision} 版</small></button>`).join('')}
    ${editor.filesError?btn('重新加载草稿列表','refresh-drafts'):''}</section>
   <details class="panel work-generator" id="work-generator"${editor.generatorOpen?' open':''}><summary>从模板或生成器起草</summary><div class="generator">
    ${field('惨剧集合',`<select id="gen-set">${RULESETS.map(([id,label])=>option(id,label,gen.ruleset)).join('')}</select>`)}
    ${field('随机种子',`<input id="gen-seed" type="number" value="${esc(gen.seed)}">`)}
    <label class="setup-check"><input id="gen-lock" type="checkbox"${gen.lockSeed?' checked':''}><span>固定种子，复现这份随机剧本</span></label>
    ${field('时长',`<select id="gen-length">${[['quick','短局'],['standard','标准'],['long','长局']].map(([id,label])=>option(id,label,gen.lengthPreset||'standard')).join('')}</select>`)}
    ${field('编剧模型',`<select id="gen-provider">${availableModels(info).map(p=>option(p.id,p.label,authorModel(info,gen.provider))).join('')}</select>`)}
    ${field('AI 编剧难度',`<select id="gen-difficulty">${[['beginner','入门'],['standard','标准'],['hard','挑战']].map(([id,label])=>option(id,label,gen.difficulty||'standard')).join('')}</select>`)}
    ${field('主题（可选）',`<input id="gen-theme" maxlength="300" value="${esc(gen.theme)}" placeholder="例如：雨夜的末班电车">`)}
    ${btn(gen.lockSeed?'按种子生成':'随机生成 · 换一份','generate','primary',working?'disabled':'')}
    ${btn(icon('bot')+'AI 编剧','ai-generate','',working||!info.configured?`disabled title="${info.configured?'':'需要先连接 AI 模型'}"`:'')}
    ${btn('润色标题与简介','ai-polish','',working||!info.configured||!draft?'disabled':'')}
    <p class="hint">主题用于标题、开场氛围与选稿偏好，舞台与规则仍以本场设置为准。AI 编剧会策划规则与人物，再从试跑候选中选稿；试作剧本尚需试玩，每次上限 $${authorBudget(info,authorModel(info,gen.provider)).toFixed(2)}。润色只改标题与简介。</p>
    ${btn('载入起始剧本','starter-editor')}
    <label class="btn file">导入<input type="file" id="script-file" accept=".json,application/json"></label>
   </div></details></aside>
   <section class="editor-main"${working?' inert aria-busy="true"':''}>
    <div class="work-actions">${btn(icon('check')+'保存草稿','save-draft','primary',working||editor.fileBusy||!editor.text?'disabled':'')}${editor.fileRevision?btn('另存副本','copy-draft','',working||editor.fileBusy?'disabled':''):''}<small id="draft-status">${editor.fileBusy?'保存中…':editor.fileRevision&&editor.text===editor.savedText?'已保存 · 第 '+editor.fileRevision+' 版':editor.text?'尚未保存':''}</small></div>
    <p class="disclosure">${icon('alert')}这一页会显示剧本的全部真相。</p>
    <div class="page-tabs" role="tablist"><button type="button" role="tab" aria-selected="${tab==='form'}" class="${tab==='form'?'active':''}" data-do="editor-tab" data-tab="form">可视化编辑</button><button type="button" role="tab" aria-selected="${tab==='json'}" class="${tab==='json'?'active':''}" data-do="editor-tab" data-tab="json">JSON</button></div>
    ${tab==='form'&&formReady?`<nav aria-label="剧本章节" class="work-sections">${[['basics','基本信息'],['plots','规则'],['cast','人物配役'],['calendar','事件日程'],['design','私密手记']].map(([id,label])=>btn(label,'work-section','','data-section="'+id+'"')).join('')}</nav>`:''}
    ${body}
    <div id="draft-report" aria-live="polite">${report(editor.report)}</div>
    <div class="toolbar">${btn(icon('play')+'用它开局','play-editor','primary')}${btn(icon('check')+'检查','validate')}${btn('导出（含真相）','export-script')}${btn('导出（公开版）','export-public')}${btn('打印（公开版）','print-public')}${btn('打印（含真相）','print-private')}</div>
   </section>
  </div>
 </main>`;
}

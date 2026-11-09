import {validateReplay,sanitizePublicReplay} from './replay-validation.mjs';
const $=s=>document.querySelector(s),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog,info,g=null,page='home',saves=[],selected=null,modal='',editor='',editorReport='',replay=null,replayAt=0,working=false,auto=false,replayGameId=null,creating=false,actionError='',transitionView=null,syncRequired=false,actionErrorCode='',requestKind='',advancedRevision='';
let generator={ruleset:'FS',seed:Date.now()%1000000,theme:''};
let sound=localStorage.getItem('tl-sound')!=='off';
let autoPlay=localStorage.getItem('tl-autoplay')!=='off';
let rightTab='log',aiFeed=[],truth=null,loopBanner=null,pendingOutcome=null;
const legalTarget=id=>!working&&!syncRequired&&g?.actions?.some(a=>a.command.type==='place'&&a.command.card===selected&&a.command.target===id);
const char=id=>catalog.characters.find(c=>c.id===id),name=id=>char(id)?.name_zh_working||catalog.roles.find(c=>c.id===id)?.name_zh_working||catalog.incidents.find(c=>c.id===id)?.name_zh_working||catalog.plots.find(c=>c.id===id)?.name_zh_working||catalog.locations.find(c=>c.id===id)?.name_zh||id;
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const glyph={move_h:'↔',move_v:'↕',move_d:'⤢',forbid_move:'⊗',goodwill_1:'♡',goodwill_2:'♡',paranoia_1:'△',paranoia_minus_1:'▽',intrigue_1:'◇',intrigue_2:'◇',forbid_intrigue:'⊘',forbid_goodwill:'⊘',forbid_paranoia:'⊘'};
const cardInfo={move_h:'左右移动：医院↔神社，都市↔学校。',move_v:'上下移动：医院↔都市，神社↔学校。',move_d:'对角移动：医院↔学校，神社↔都市。',forbid_move:'阻止该人物当日的所有移动。',goodwill_1:'友好 +1。友好达到门槛可请求人物能力。',goodwill_2:'友好 +2。',paranoia_1:'不安 +1。不安达到临界的犯人会引发事件。',paranoia_minus_1:'不安 −1。',intrigue_1:'暗跃 +1。',intrigue_2:'暗跃 +2。',forbid_intrigue:'阻止该目标当日增加暗跃；同日两张以上则全部失效。',forbid_goodwill:'阻止该人物当日增加友好。',forbid_paranoia:'阻止该人物当日的不安变化。'};
const counterName={goodwill:'友好',paranoia:'不安',intrigue:'暗跃',guard:'护卫'};
function apiError(message,{status=0,code='NETWORK',uncertain=false,requiresLogin=false}={}){const error=Error(message);Object.assign(error,{status,code,uncertain,requiresLogin});return error;}
async function api(url,data,{timeoutMs=data===undefined?20000:210000}={}){
 const mutation=data!==undefined,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);let res,text;
 try{res=await fetch('/api'+url,{...(mutation?{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(data)}:{headers:{Accept:'application/json'}}),credentials:'same-origin',signal:controller.signal});text=await res.text();}
 catch(error){throw apiError(error?.name==='AbortError'?'连接等待超时，请同步局面后再继续。':'连接中断，请检查网络并同步局面。',{code:error?.name==='AbortError'?'TIMEOUT':'NETWORK',uncertain:mutation});}
 finally{clearTimeout(timer);}
 const type=res.headers.get('content-type')||'',html=/^\s*(?:<!doctype\s+html|<html|<)/i.test(text);
 let value;try{if(!html&&(/json/i.test(type)||/^\s*[\[{]/.test(text)))value=JSON.parse(text);}catch{}
 const auth=res.status===401||(res.status===403&&value===undefined)||Boolean(res.redirected&&/(?:login|signin|sign-in|oauth|auth)/i.test(res.url||''));
 if(auth)throw apiError('登录状态或访问权限需要重新确认。请重新连接站点，再打开当前存档。',{status:res.status,code:'AUTH',uncertain:mutation,requiresLogin:true});
 if(value===undefined){const message=res.status>=500?'站点网关暂时没有返回游戏数据。请先同步局面；若仍失败，请重新连接。':res.redirected?'请求跳转后未返回游戏数据。请同步局面或重新连接。':'收到网页而非游戏数据。请先同步局面；若仍失败，请重新连接站点。';throw apiError(message,{status:res.status,code:'NON_JSON',uncertain:mutation});}
 if(!res.ok)throw apiError(typeof value?.error==='string'?value.error:`请求失败（HTTP ${res.status}）。`,{status:res.status,code:value?.code||'HTTP_'+res.status,uncertain:mutation&&(res.status>=500||['NETWORK','TIMEOUT'].includes(value?.code))});
 return value;
}
function toast(t,kind=''){const el=$('#toast');el.textContent=t;el.className=kind;el.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.style.display='none',5000);}
function play(n){if(sound){const a=new Audio('/assets/audio/Audio/'+n+'.ogg');a.volume=.25;a.play().catch(()=>{});}}
function download(data,file,type='application/json'){const u=URL.createObjectURL(new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type}));const a=document.createElement('a');a.href=u;a.download=file;a.click();setTimeout(()=>URL.revokeObjectURL(u),30000);}
const btn=(text,action,cls='',extra='')=>`<button class="${cls}" data-do="${action}" ${extra}>${text}</button>`;
const modeName=m=>m==='heroes'?'主人公':m==='mastermind'?'剧作家':'AI 观战';
const phaseLabel=p=>({setup:'轮回准备',mm_cards:'剧作家行动',hero_cards:'主人公行动',cultist:'行动结算',mm_ability:'剧作家能力',hero_ability:'主人公能力',refusal:'主人公能力',reveal_plot:'主人公能力',incident:'事件',end_area:'日结束',end:'日结束',between:'时之狭间',guess:'最后的战斗',over:'已结束'})[p]||p;

function nav(){
 const links=[['home','档案室'],['game','轮回棋盘'],['editor','剧本工坊'],['replay','回放档案'],['rules','规则手册']];
 return `<header class="nav">
  <button class="brand" data-do="nav-home" aria-label="返回档案室"><span class="brand-symbol"><span>↻</span></span><span class="brand-text">时隙<small>TRAGEDY LOOPER</small></span></button>
  <nav class="navlinks">${links.map(([id,t])=>btn(t,'nav-'+id,page===id?'active':'')).join('')}</nav>
  <div class="navmeta"><span class="ai-status ${info.configured?'online':''}"><i></i>${info.configured?'DeepSeek 已连接':'离线练习模式'}</span>${btn(sound?'♪ 声音开':'♪ 声音关','sound','small ghost')}</div>
 </header>`;
}
function footer(){return `<footer class="footer"><span>原作 惨劇RoopeR / BakaFire Party · 非官方模拟器 · JP5 / FS + BTX</span><span><a href="https://main-bakafire.ssl-lolipop.jp/rooper/sr_dl_04_sozai.htm" target="_blank" rel="noreferrer">惨劇コモンズ作成：BakaFire、NEKOG(紺ノ玲)</a> · Kenney CC0 音效</span></footer>`;}
function home(){
 const cast=['office_worker','girl_student','shrine_maiden'];
 const saveCard=s=>`<article class="save ${s.phase==='over'?'finished':''}"><div class="save-mode">${s.mode==='heroes'?'◆':s.mode==='mastermind'?'幕':'◇'}</div><div class="save-copy"><b>${esc(s.title)}</b><small>${modeName(s.mode)} · ${esc(phaseLabel(s.phase))} · ${esc(s.created.slice(0,16).replace('T',' '))}</small></div>${btn(s.phase==='over'?'复盘 →':'继续 →','load','small',`data-id="${s.id}"`)}</article>`;
 return `<main class="wrap home">
  <section class="hero">
   <div class="hero-copy">
    <div class="eyebrow">THE NEXT LOOP IS YOURS</div>
    <h1>这一次，<br>改写惨剧的结局。</h1>
    <p>剧作家知道一切真相，你只有有限的轮回。观察人物、推理配役，在时间归零之前，找到通往明天的那条路。</p>
    <div class="row hero-actions">${btn('开启新轮回　↗','new','primary big')}${g&&!g.winner?btn('继续当前对局','nav-game','big'):btn('五分钟学会玩法','guide','big')}</div>
    <div class="row pills"><span class="pill">${info.configured?'DeepSeek AI 对手':'离线练习机器人'}</span><span class="pill">自动存档</span><span class="pill">完整回放</span><span class="pill">剧本工坊</span></div>
   </div>
   <div class="hero-art" aria-hidden="true"><div class="hero-ring"></div>${cast.map(id=>`<img src="/${char(id).portrait}" alt="">`).join('')}</div>
  </section>
  <div class="sectionline"><h2>选择你的立场</h2><span class="eyebrow">ONE STORY · TWO SIDES</span></div>
  <div class="featuregrid">
   <article class="feature hero-side"><span class="num">01</span><h3>成为主人公</h3><p>操控三名主人公的手牌，与知晓真相的剧作家对抗。失败了也没关系——带着记忆回到第一天。</p>${btn('以主人公开始','new-heroes','primary small')}</article>
   <article class="feature mm-side"><span class="num">02</span><h3>坐在幕布之后</h3><p>你就是剧作家。布置杀机，掩藏意图，让三名 AI 主人公看见线索却来不及阻止。</p>${btn('以剧作家开始','new-mastermind','small')}</article>
   <article class="feature"><span class="num">03</span><h3>旁观一场推理</h3><p>让 AI 剧作家与 AI 主人公完整对弈，观察每一张牌背后的思路。</p>${btn('开始观战','new-observe','small')}</article>
  </div>
  <div class="sectionline"><h2>最近的时间线</h2>${btn('刷新','refresh','small ghost')}</div>
  <div class="saves">${saves.length?saves.slice(0,8).map(saveCard).join(''):'<p class="hint empty-saves">还没有存档。开始一局，每一步都会自动保存。</p>'}</div>
 </main>`;
}
const seatName=seat=>seat==='M'?'剧作家':'主人公 '+seat;
const cardType=card=>card?.split('#')[0];
const cardLabel=card=>catalog.actionDeckEntries.find(d=>d.actionType===cardType(card))?.name_zh||card||'待揭示';
const placementKey=p=>p.seat+':'+p.target;
function boardPlacement(v,p){
 const revealed=!['mm_cards','hero_cards'].includes(v.phaseId)?v.revealedCards?.find(q=>q.seat===p.seat&&q.target===p.target):null;
 const card=revealed?.card||p.card,faceUp=Boolean(revealed?.card),label=cardLabel(card);
 return `<span class="board-card ${p.seat==='M'?'mastermind-card':'hero-card'} ${faceUp?'face-up':''}" data-placement="${esc(placementKey(p))}" role="img" aria-label="${esc(seatName(p.seat)+'：'+(faceUp?label:'已盖牌')+(card&&!faceUp?'，你的牌为'+label:''))}" title="${esc(seatName(p.seat)+' · '+(faceUp?label:card?label+'（仅你可见）':'牌面未公开'))}"><span class="board-card-inner"><span class="card-back"><span class="card-back-mark">↻</span><span class="card-seal">${p.seat==='M'?'幕':esc(p.seat)}</span></span><span class="card-front"><span class="mini-glyph">${glyph[cardType(card)]||'◇'}</span><span class="mini-label">${esc(label)}</span><span class="card-seal">${p.seat==='M'?'幕':esc(p.seat)}</span></span></span></span>`;
}
function targetCards(v,id){const placed=v.placements.filter(p=>p.target===id);return placed.length?`<span class="target-cards" aria-label="此目标上的行动牌">${placed.map(p=>boardPlacement(v,p)).join('')}</span>`:'';}
function placementProgress(v){
 if(!['mm_cards','hero_cards','cultist'].includes(v.phaseId))return '';
 const mm=v.placements.filter(p=>p.seat==='M').length;
 return `<div class="placement-progress" aria-label="盖牌进度"><span class="placement-caption">${v.phaseId==='cultist'?'六张牌已揭示 · 结算中':'今日盖牌'}</span><span class="placement-slots">${[0,1,2].map(i=>`<span class="placement-slot mastermind-slot ${i<mm?'filled':''}" title="剧作家第 ${i+1} 张">幕</span>`).join('')}<span class="slot-divider"></span>${['A','B','C'].map(seat=>`<span class="placement-slot hero-slot ${v.placements.some(p=>p.seat===seat)?'filled':''} ${v.turn===seat&&v.phaseId==='hero_cards'?'next':''}" title="主人公 ${seat}">${seat}</span>`).join('')}</span><span class="placement-count">${v.placements.length}<small> / 6</small></span></div>`;
}
function characterToken(v,c,readOnly){
 const d=char(c.id),limit=d.paranoiaLimit,role=v.secret?.roles?.[c.id]||v.knownRoles[c.id],known=Boolean(v.knownRoles[c.id]);
 const danger=c.alive&&c.paranoia>=limit,warn=c.alive&&!danger&&limit>0&&c.paranoia===limit-1,target=selected&&!readOnly&&legalTarget(c.id);
 const pips=Array.from({length:Math.max(limit,c.paranoia)},(_,i)=>`<i class="${i<c.paranoia?'on':''} ${i>=limit?'over':''}"></i>`).join('');
 const title=`${name(c.id)}：友好 ${c.goodwill} · 不安 ${c.paranoia}/${limit} · 暗跃 ${c.intrigue}${c.guard?' · 护卫 '+c.guard:''}${danger?' · 已达不安临界':''}`;
 return `<button class="char ${c.alive?'':'dead'} ${danger?'danger':warn?'warn':''} ${target?'targetable':''}" data-character="${c.id}" title="${esc(title)}">
  <span class="char-art"><img class="portrait" src="/${d.portrait}" alt="${esc(name(c.id))}" loading="lazy"></span>
  ${role?`<span class="badge role ${known?'known':'secret'}">${esc(name(role))}</span>`:''}
  ${c.guard?`<span class="guard-chip" title="护卫">盾 ${c.guard}</span>`:''}
  ${c.alive?'':'<span class="stamp">死亡</span>'}
  ${targetCards(v,c.id)}
  <span class="char-body"><strong>${esc(name(c.id))}</strong>
   <span class="paranoia-row" aria-label="不安 ${c.paranoia}，临界 ${limit}"><span class="pips">${pips}</span><b>${c.paranoia}<small>/${limit}</small></b></span>
   <span class="stats"><span class="g" title="友好">♡ ${c.goodwill}</span><span class="i" title="暗跃">◇ ${c.intrigue}</span></span>
  </span>
 </button>`;
}
function board(v,readOnly=false){
 const symbols={hospital:'✚',shrine:'⛩',city:'▥',school:'✎'},latin={hospital:'HOSPITAL',shrine:'SHRINE',city:'CITY',school:'SCHOOL'};
 const zone=loc=>{
  const people=Object.values(v.board).filter(c=>c.present&&c.location===loc.id),target=selected&&!readOnly&&legalTarget(loc.id),n=v.locations[loc.id];
  return `<section class="zone zone-${loc.id} ${target?'targetable':''}" data-target="${loc.id}" data-symbol="${symbols[loc.id]}">
   <div class="zonetop"><button class="flat zonelabel" data-target="${loc.id}" aria-label="地点 ${loc.name_zh}">${loc.name_zh}<small>${latin[loc.id]}</small></button><span class="intrigue ${n?'has':''}" title="地点暗跃">◇ <b>${n}</b></span></div>
   ${v.placements.some(p=>p.target===loc.id)?`<div class="location-cards"><span class="location-card-caption">地点上的牌</span>${targetCards(v,loc.id)}</div>`:''}
   <div class="cast">${people.map(c=>characterToken(v,c,readOnly)).join('')||'<div class="empty-zone"><span>◇</span>无人在此</div>'}</div>
  </section>`;
 };
 return `${placementProgress(v)}<div class="board">${catalog.locations.map(zone).join('')}<div class="board-core" aria-hidden="true"><small>LOOP ${v.loop}</small><b>${v.day}</b><small>DAY / ${v.script.days}</small></div></div>`;
}
function placementHint(v){
 if(!selected)return '先选一张行动牌，再点击棋盘上高亮的人物或地点。盖放后不能撤回。';
 const type=cardType(selected),locationEffect=['intrigue_1','intrigue_2','forbid_intrigue'].includes(type);
 return `${cardLabel(selected)}：${cardInfo[type]||''} ${locationEffect?'可放在人物或地点上。':'放在地点上只是无效果的佯动。'} 再次点击手牌可取消。`;
}
const humanTurn=v=>v.mode==='heroes'?v.turn!==null&&v.turn!=='M':v.mode==='mastermind'?v.turn==='M':false;
function turnGuidance(v,readOnly=false){
 if(v.winner)return {title:'对局已结束',detail:'这条时间线已经归档。查看真相，或回放每一步验证推理。',kind:'finished'};
 if(readOnly)return {title:v.phase,detail:'拖动时间线，查看当时已经公开的事实。',kind:'replay'};
 if(working)return {title:requestKind==='sync'?'正在同步局面':requestKind==='animation'?'规则自动结算':requestKind==='rules'?'正在进行规则结算':requestKind==='ai'?seatName(v.turn)+'正在思考…':'正在处理你的行动',detail:requestKind==='animation'?'正在展示翻牌、移动与计数变化。':requestKind==='ai'?'对手正在从合法选项中作出决定，你可以随时暂停。':requestKind==='sync'?'只读取最新状态，不会重复发送行动。':'正在保存结果并更新棋盘，请稍候。',kind:requestKind||'busy'};
 if(syncRequired||v.busy)return {title:v.busy?'这一步仍在处理中':'先核对当前局面',detail:actionError||'请先同步已保存的状态，再决定下一步。',kind:'reconnect'};
 if(actionError)return {title:'当前行动已暂停',detail:actionError,kind:'paused'};
 if(humanTurn(v)){
  const placing=['mm_cards','hero_cards'].includes(v.phaseId);
  if(v.phaseId==='between')return {title:'轮回失败 · 时之狭间',detail:'时间倒流回第一天。整理线索与已确认的角色，然后开始下一轮回。',kind:'human'};
  if(v.phaseId==='guess')return {title:'最后的战斗',detail:'逐一指认每个人物的角色。只要错一次，剧作家就赢了。',kind:'human'};
  return {title:placing?selected?'选择盖牌目标':'轮到你盖牌':'轮到你作出选择',detail:placing?selected?cardLabel(selected)+'已选中。点击棋盘上高亮的人物或地点。':seatName(v.turn)+' · 从下方手牌选一张，然后点击棋盘目标。':v.phaseId==='cultist'?'六张牌已揭示，请选择结算方式。':seatName(v.turn)+' · '+v.phase+'，从下方选项中决定下一步。',kind:'human'};
 }
 if(auto)return {title:seatName(v.turn)+'正在行动',detail:'对手会自动行动到你的回合，可以随时暂停。',kind:'ai'};
 return {title:'等待你启动 AI',detail:seatName(v.turn)+'的行动已就绪。强制效果自动结算，需要选择时才调用 AI。',kind:'ai-ready'};
}
const reconnectControl=()=>actionErrorCode==='AUTH'?'<a class="reconnect-link" data-reauth href="/signin-with-chatgpt" target="_top">重新登录并恢复对局</a>':btn('重新连接','reconnect','small');
function coreTurn(v,readOnly=false){
 if(readOnly||v.winner)return '';
 const guidance=turnGuidance(v),blocked=syncRequired||v.busy,aiTurn=!humanTurn(v);let control;
 if(blocked)control=btn(working?'同步中…':'同步局面','sync-state','primary',working?'disabled':'');
 else if(aiTurn)control=btn(auto?'暂停对手':working?'处理中…':actionError?'继续当前局面':'让 AI 继续','auto','primary',working&&!auto?'disabled':'');
 else if(['mm_cards','hero_cards'].includes(v.phaseId))control=selected?btn('取消选牌','clear-selection','small',working?'disabled':''):btn('选择手牌 ↓','focus-hand','primary',working?'disabled':'');
 else control=v.actions?.length===1?btn(v.actions[0].command.type==='pass'?'结束当前阶段':'执行下一步','execute-first','primary',working?'disabled':''):btn('查看选项 ↓','focus-hand','primary',working?'disabled':'');
 const emblem=guidance.kind==='human'?'◆':guidance.kind==='reconnect'||guidance.kind==='paused'?'!':v.turn==='M'?'幕':esc(v.turn||'◇');
 return `<div class="core-turn ${guidance.kind} ${working?'is-working':''}"><div class="turn-emblem" aria-hidden="true">${emblem}</div><div class="core-turn-copy" aria-live="polite"><span class="turn-kicker">${working&&['rules','animation'].includes(requestKind)?'规则引擎 · 自动结算':esc(v.phase)+' · '+(humanTurn(v)?'由你控制':'对手行动')}</span><b>${esc(guidance.title)}${working&&requestKind==='ai'?'<span class="dots"><i></i><i></i><i></i></span>':''}</b><p>${esc(guidance.detail)}</p></div><div class="core-turn-actions">${control}${actionErrorCode==='AUTH'||syncRequired?reconnectControl():''}</div></div>`;
}
function optionText(o){
 const a=o.command,parts=[];
 if(a.target)parts.push(name(a.target));if(a.to)parts.push('→ '+name(a.to));if(a.counter)parts.push(counterName[a.counter]||a.counter);
 if(a.amount)parts.push('不安'+(a.amount>0?'+1':'−1'));if(a.day)parts.push('第 '+a.day+' 日');if(a.card)parts.push('收回 '+cardLabel(a.card));
 return parts.join(' ')||o.label;
}
function choiceGroups(v){
 const groups=new Map(),add=(key,title,detail,item)=>{if(!groups.has(key))groups.set(key,{title,detail,items:[]});groups.get(key).items.push(item);};
 v.actions.forEach((o,i)=>{
  const a=o.command,item={i,o};
  if(a.type==='pass')return;
  if(a.type==='goodwill'){const ab=char(a.actor).abilities[a.index];add(a.actor+a.index,`${name(a.actor)} · 能力 ${a.index+1}`,`♡${ab.minGoodwill} · ${ab.limit==='loop'?'每轮回一次':'每天一次'} · ${ab.effect_zh}`,{...item,text:optionText(o),hl:a.target});}
  else if(a.type==='mm')add(a.actor+a.ability,o.label.split(' → ')[0],'',{...item,text:optionText(o),hl:a.target});
  else if(a.type==='guess')add(a.character,name(a.character),'',{...item,text:name(a.role),hl:a.character});
  else if(a.type==='incident')add('incident',v.choiceTitle||'选择事件效果','',{...item,text:o.label,hl:a.target});
  else add(a.type,'','',{...item,text:o.label,hl:a.target||a.actor});
 });
 return [...groups.values()];
}
function choicePanel(v,blocked){
 const pass=v.actions.findIndex(o=>o.command.type==='pass'),groups=choiceGroups(v);
 if(v.phaseId==='between'){const next=v.actions.findIndex(o=>o.command.type==='next_loop'),final=v.actions.findIndex(o=>o.command.type==='final_battle');
  return `<div class="between-panel"><div class="between-copy"><span class="eyebrow">TIME REWINDS</span><b>第 ${v.loop+1} 轮回即将开始</b><p>计数器与人物位置将复原，已确认的角色和你的笔记会保留。</p></div><div class="row">${next>=0?btn('开始第 '+(v.loop+1)+' 轮回','choose','primary big',`data-index="${next}" ${blocked?'disabled':''}`):''}${final>=0?btn('放弃剩余轮回，进入最后的战斗','choose','',`data-index="${final}" ${blocked?'disabled':''}`):''}</div></div>`;}
 const groupHtml=gr=>`<div class="choice-group">${gr.title?`<div class="choice-head"><b>${esc(gr.title)}</b>${gr.detail?`<small>${esc(gr.detail)}</small>`:''}</div>`:''}<div class="choice-items">${gr.items.map(it=>`<button class="choice" data-do="choose" data-index="${it.i}" ${it.hl?`data-hl="${esc(it.hl)}"`:''} ${blocked?'disabled':''}>${esc(it.text)}</button>`).join('')}</div></div>`;
 return `<div class="choice-panel ${v.phaseId==='guess'?'guess-panel':''}">${groups.map(groupHtml).join('')}${pass>=0?`<div class="choice-pass">${btn(v.actions[pass].label,'choose',groups.length?'':'primary',`data-index="${pass}" ${blocked?'disabled':''}`)}${groups.length?'<span class="hint">不使用能力也可以直接结束此阶段。</span>':''}</div>`:''}</div>`;
}
function hand(v){
 const human=humanTurn(v),placement=['mm_cards','hero_cards'].includes(v.phaseId),blocked=working||syncRequired||v.busy;
 if(!human&&!actionError){
  const last=aiFeed.filter(f=>f.gameId===v.id).at(-1);
  return `<div class="waiting-hand ${working&&requestKind==='ai'?'thinking':''}"><span class="seat-token ${v.turn==='M'?'mm':''}">${v.turn==='M'?'幕':esc(v.turn||'终')}</span><div class="waiting-copy"><b>${v.winner?'本局已结束':seatName(v.turn)+(working&&requestKind==='ai'?' 正在思考':' 的回合')}</b><p>${v.winner?'回放已保存，可查看每次轮回的变化。':last?`${esc(seatName(last.seat))}：「${esc(last.text)}」`:'你的手牌会在轮到你时出现。'}</p></div>${v.winner?'':btn('练习机器人代走','bot','small ghost',blocked?'disabled':'')}</div>`;
 }
 const cards=placement&&human?`<div class="hand">${v.hand.map((c,i)=>`<button class="actioncard ${selected===c.id?'chosen':''} ${c.available?'':'spent'}" data-card="${c.id}" data-family="${c.type.startsWith('move')||c.type==='forbid_move'?'move':c.type.includes('goodwill')?'goodwill':c.type.includes('paranoia')?'paranoia':'intrigue'}" ${!c.available||blocked?'disabled':''} aria-pressed="${selected===c.id}" title="${esc(c.label+'：'+(cardInfo[c.type]||''))}"><span class="card-corner">${c.once?'Ⅰ':'∞'}</span>${i<9&&c.available?`<span class="card-key">${i+1}</span>`:''}<span class="glyph">${glyph[c.type]||'◇'}</span><span class="cardname">${c.label}</span><small>${!c.available?'本轮已用':c.once?'每轮回一次':'每天可用'}</small></button>`).join('')}</div><p class="hint selection-hint ${selected?'has-selection':''}" role="status">${esc(placementHint(v))}</p>`:'';
 const head=placement?`${seatName(v.turn)} 的手牌`:v.phaseId==='between'?'时之狭间':v.phaseId==='guess'?'指认角色':`${seatName(v.turn)} · ${v.phase}`;
 return `<div class="handpanel" id="hand-panel" aria-busy="${working}"><div class="handhead"><div><span class="turn-kicker">YOUR MOVE</span><b>${human?esc(head):'对局已暂停'}</b></div><span class="hand-instruction">${placement?'① 选牌（数字键）　② 点击高亮目标':esc(v.phase)}</span></div>${cards}${!placement&&human&&v.actions.length?choicePanel(v,blocked):''}${actionError?`<div class="action-error" role="alert"><b>${syncRequired?'尚未确认操作结果':'当前行动已暂停'}</b><p>${esc(actionError)}</p><div class="row">${btn('同步局面','sync-state','small',working?'disabled':'')}${reconnectControl()}</div></div>`:''}${v.phaseId==='over'||!human?'':`<div class="hand-secondary">${btn('练习机器人代走一步','bot','small ghost',blocked?'disabled':'')}<span>不确定时可让机器人按合法选项走一步</span></div>`}</div>`;
}
function incidentSchedule(v){const canSeeNames=v.seat==='M'||Boolean(v.secret);return v.script.incidents.map(e=>`<div class="schedule ${e.day===v.day?'today':''} ${e.day<v.day?'past':''}"><b>DAY ${e.day}</b><span class="${canSeeNames&&e.type?'':'unrevealed-event'}">${canSeeNames&&e.type?esc(name(e.type)):'事件未公开'}</span>${v.knownCulprits?.[e.day]?`<em>犯人 ${esc(name(v.knownCulprits[e.day]))}</em>`:''}</div>`).join('');}
function phaseStepper(v){
 const steps=[['mm_cards','剧作家出牌'],['hero_cards','主人公出牌'],['cultist','揭示结算'],['mm_ability','剧作家能力'],['hero_ability','主人公能力'],['incident','事件'],['end','日结束']];
 const current=v.phaseId==='end_area'?'end':['refusal','reveal_plot'].includes(v.phaseId)?'hero_ability':v.phaseId==='setup'?'mm_cards':v.phaseId;
 if(['between','guess','over'].includes(current))return `<div class="phase-stepper special"><span class="current">${esc(v.phase)}</span></div>`;
 const at=steps.findIndex(([id])=>id===current);
 return `<ol class="phase-stepper">${steps.map(([id,t],i)=>`<li class="${i<at?'done':i===at?'current':''}">${t}</li>`).join('')}</ol>`;
}
function pips(n,total,cls){return `<span class="track ${cls}">${Array.from({length:total},(_,i)=>`<i class="${i<n-1?'done':i===n-1?'now':''}"></i>`).join('')}</span>`;}
function intelPanel(v,readOnly){
 const known=Object.entries(v.knownRoles);
 return `<section class="panel intel"><div class="panel-head"><span>情报</span><span class="eyebrow">${v.script.ruleset}</span></div>
  <div class="intel-block"><div class="section-label">事件日程</div>${incidentSchedule(v)}</div>
  ${v.secret&&!known.length?'':`<div class="intel-block"><div class="section-label">主人公已确认角色</div>${known.length?`<div class="known-roles">${known.map(([c,r])=>`<span class="known"><img src="/${char(c).portrait}" alt="">${esc(name(c))}<b>${esc(name(r))}</b></span>`).join('')}</div>`:'<p class="hint">尚未确认任何角色。提升友好、使用能力来揭开身份。</p>'}</div>`}
  ${v.knownPlots?.length?`<div class="intel-block"><div class="section-label">已公开副规则</div><p class="hint">${v.knownPlots.map(p=>esc(name(p))).join('、')}</p></div>`:''}
  ${v.secret?`<div class="intel-block curtain"><div class="section-label">剧作家幕布 · 仅你可见</div><p class="plots"><b>${esc(name(v.secret.mainPlot))}</b> / ${v.secret.subPlots.map(p=>esc(name(p))).join(' + ')}</p><table class="secrettable">${Object.entries(v.secret.roles).filter(([,r])=>r!=='person').map(([c,r])=>`<tr><td>${esc(name(c))}</td><td>${esc(name(r))}</td></tr>`).join('')}</table>${v.secret.incidents.map(e=>`<p class="secret-incident">第 ${e.day} 日 · ${esc(name(e.type))} · 犯人 ${esc(name(e.culprit))}</p>`).join('')}</div>`:''}
  ${v.winner&&!readOnly?`<div class="intel-block">${btn('揭晓完整真相','truth','primary small wide')}</div>`:''}
  <p class="legend">♡ 友好　△ 不安　◇ 暗跃　盾 护卫</p>
 </section>`;
}
function logPanel(v,readOnly){
 const events=v.log.slice(-80).reverse(),feed=aiFeed.filter(f=>f.gameId===v.id).slice(-30).reverse();
 const tabs=[['log','记录'],...(readOnly?[]:[['notes','笔记']]),...(feed.length&&!readOnly?[['talk','AI 思路']]:[])],tab=tabs.some(([id])=>id===rightTab)?rightTab:'log';
 const entry=e=>`<div class="logentry ${esc(e.type)}"><small>L${e.loop} · D${e.day}</small><span>${esc(e.text)}</span>${e.cards?`<span class="log-cards">${e.cards.map(p=>`<i class="${p.seat==='M'?'mm':'hero'}">${esc(p.seat==='M'?'幕':p.seat)} ${esc(name(p.target))} · ${esc(cardLabel(p.card))}</i>`).join('')}</span>`:''}</div>`;
 let body;
 if(tab==='notes')body=`<label><span class="sr-only">私人推理笔记</span><textarea class="notearea" id="notes" placeholder="写下假说与证据：谁是犯人？谁可能是关键人物？仅保存在此浏览器。">${esc(localStorage.getItem('note-'+v.id)||'')}</textarea></label>`;
 else if(tab==='talk')body=`<div class="logentries">${feed.map(f=>`<div class="logentry talk"><small>${esc(seatName(f.seat))} · L${f.loop} D${f.day}</small><span>「${esc(f.text)}」</span></div>`).join('')}</div>`;
 else body=`<div class="logentries">${events.map(entry).join('')}</div>`;
 return `<section class="panel logpanel"><div class="tabs" role="tablist">${tabs.map(([id,t])=>`<button role="tab" aria-selected="${tab===id}" class="${tab===id?'active':''}" data-do="tab" data-tab="${id}">${t}${id==='log'?` <small>${v.log.length}</small>`:''}</button>`).join('')}</div>${body}</section>`;
}
function game(v=transitionView||g,readOnly=false){
 if(!v)return `<main class="wrap empty-game"><div class="eyebrow">NO ACTIVE LOOP</div><h2>棋盘尚未展开</h2><p class="hint">开始新轮回，或从档案室继续存档。</p><div class="toolbar">${btn('开启新轮回','new','primary')}${btn('返回档案室','nav-home')}</div></main>`;
 const view=v.mode==='mastermind'?'剧作家视角':v.seat==='public'?'公开观战':'主人公视角';
 return `<div class="gametop">
   <div class="game-title"><div class="eyebrow">${esc(v.script.ruleset)} · ${readOnly?'REPLAY ARCHIVE':esc(view)}</div><h2>${esc(v.script.title)}</h2></div>
   <div class="hud-track">
    <div class="hud-stat"><span class="section-label">轮回</span><b>${v.loop}<small>/${v.script.loops}</small></b>${pips(v.loop,v.script.loops,'loops')}</div>
    <div class="hud-stat"><span class="section-label">日期</span><b>${v.day}<small>/${v.script.days}</small></b>${pips(v.day,v.script.days,'days')}</div>
    <div class="hud-stat"><span class="section-label">领导者</span><b class="leader">${esc(v.leader)}</b></div>
   </div>
   ${readOnly?'':`<div class="row game-tools">${btn('玩法指南','guide','small ghost')}${v.winner?'':`<label class="switch" title="对手回合自动行动"><input type="checkbox" id="autoplay" ${autoPlay?'checked':''}><span></span>对手自动</label>`}${btn('导出回放','save-replay','small ghost')}${btn('新对局','new','small')}</div>`}
  </div>
  ${phaseStepper(v)}
  <main class="gamegrid ${selected&&!readOnly?'choosing-target':''}">
   <section class="play-area">${coreTurn(v,readOnly)}${v.winner&&!readOnly?outcomeStrip(v):''}${board(v,readOnly)}${readOnly?'':hand(v)}</section>
   <aside class="rightpanel">${intelPanel(v,readOnly)}${logPanel(v,readOnly)}${!readOnly&&v.aiConfigured?`<div class="budget"><div class="row"><span>本局 API 估算</span><b>${v.spent===null?'赛后显示':'$'+v.spent.toFixed(4)} / $${v.budget.toFixed(2)}</b></div><div class="meter"><span style="width:${Math.min(100,(v.spent||0)/v.budget*100)}%"></span></div></div>`:''}</aside>
  </main>`;
}
function outcomeStrip(v){const win=v.winner==='heroes',heroSide=v.mode!=='mastermind';return `<div class="victory ${win?'heroes':'mastermind'}"><div class="eyebrow">THE TIMELINE HAS ENDED</div><h2>${win?'明天，终于到来。':'惨剧，再度重演。'}</h2><p class="hint">${win?'主人公':'剧作家'}获胜${v.mode==='observe'?'':heroSide===win?' · 你赢了':' · 你输了'} · 共 ${v.loop} 个轮回</p><div class="row">${btn('揭晓真相','truth','primary')}${btn('查看回放','open-replay')}${btn('导出全解答回放','full-replay','ghost')}${btn('再开一局','new')}</div></div>`;}
function editorPage(){return `<main class="wrap"><div class="pageintro"><div><div class="eyebrow">SCRIPT WORKSHOP</div><h1>让一切，从剧本开始。</h1></div><p>用约束生成合法骨架，编辑配役与事件。结构合法不等于已经平衡；请在试玩后再分享。</p></div><div class="editorgrid"><aside class="editorconfig panel"><label>惨剧集合<select id="gen-set"><option value="FS" ${generator.ruleset==='FS'?'selected':''}>First Steps · 入门</option><option value="BTX" ${generator.ruleset==='BTX'?'selected':''}>Basic Tragedy Χ · 基础</option></select></label><label>随机种子<input id="gen-seed" type="number" value="${generator.seed}"></label><label>故事主题<input id="gen-theme" value="${esc(generator.theme)}" placeholder="例如：雨夜，最后一班电车"></label>${btn('生成合法骨架','generate','primary')}${btn('生成并用 AI 润色','ai-generate','',working||!info.configured?'disabled':'')}${btn('载入官方教学剧本','starter-editor')}<label class="filebutton">导入剧本 JSON<input type="file" id="script-file" accept=".json,application/json"></label><div class="hint">支持 24 名基础人物。含特殊人物时需要设置到场日、到场轮回或领地。暂不接受任意脚本代码和自定义特殊规则。</div></aside><section class="editor-main"><div class="disclosure">编辑器包含完整配役与犯人，是剧作家工作区。读过答案后，请勿将这份剧本用作自己的盲推评测。</div><label>完整剧本 JSON<textarea id="script-editor" spellcheck="false" placeholder="生成、载入或导入一份剧本。">${esc(editor)}</textarea></label><div class="toolbar">${btn('验证剧本','validate','primary')}${btn('以此剧本开局','play-editor')}${btn('导出完整 JSON','export-script')}${btn('导出公开 JSON','export-public')}${btn('公开打印页','print-public')}${btn('私密打印页','print-private')}</div>${editorReport}</section></div></main>`;}
function rulesPage(){
 const rules=[['01 · 胜负','主人公只需成功度过一个轮回。FS 所有轮回失败则剧作家胜；BTX 此时进入最后的战斗，逐人物猜角色，首次错误即失败。'],['02 · 出牌','剧作家先盖放三张牌到不同目标；主人公按领导者顺序每席放一张，三席目标不能重复。双方目标可重叠，牌面一起揭示。只有暗跃增减及暗跃禁止会影响地点；移动、友好、不安等牌盖在地点上属于无效果佯动。'],['03 · 结算','先移动、后计数器。横移＋纵移成为斜移，同向不重复。一天有多张暗跃禁止时全部失效，即使放在不同目标上。'],['04 · 人物能力','友好达到门槛即可请求能力，不消耗友好。秘密角色可能拒绝。不同能力分别计次，一次/轮回能力被拒绝也已用掉。'],['05 · 事件','本站约定：主人公日程只显示事件日期，名称及犯人仅剧作家可见；已发生事件按实际公开结果记录。犯人存活、已入场且不安达到临界时发生，效果由剧作家选择；没有发生不代表能确定犯人身份。'],['06 · 重来','失败后清空计数器、恢复人物和手牌，保留已经获得的知识。禁止轮回内交流的剧本，仍允许在轮回间讨论。']];
 const deck=side=>catalog.actionDeckEntries.filter(d=>d.side===side).map(d=>`<div class="deck-card"><span class="glyph">${glyph[d.actionType]||'◇'}</span><b>${d.name_zh}${d.copiesPerHand>1?' ×'+d.copiesPerHand:''}</b><small>${d.oncePerLoop?'每轮回一次 · ':''}${cardInfo[d.actionType]||''}</small></div>`).join('');
 return `<main class="wrap"><div class="pageintro"><div><div class="eyebrow">FIELD GUIDE</div><h1>在轮回中，找到真相。</h1></div><p>一个剧作家、三套主人公手牌。人物的公开身份与秘密角色不同，事件犯人也不等于杀手角色。</p></div><div class="rulesgrid">${rules.map(([h,p])=>`<article class="rulescard"><h3>${h}</h3><p>${p}</p></article>`).join('')}</div><div class="sectionline"><h2>行动牌</h2><span class="eyebrow">ACTION CARDS</span></div><div class="deckgrid"><div><h3>主人公（每人一套）</h3><div class="deck">${deck('protagonist')}</div></div><div><h3>剧作家</h3><div class="deck">${deck('mastermind')}</div></div></div><div class="sectionline"><h2>人物档案</h2><span class="hint">点击查看能力与原始卡面</span></div><div class="cast archive">${catalog.characters.map(c=>`<button class="char" data-character="${c.id}"><span class="char-art"><img class="portrait" src="/${c.portrait}" alt="${c.name_zh_working}" loading="lazy"></span><span class="char-body"><strong>${c.name_zh_working}</strong><span class="stats"><span>不安临界 ${c.paranoiaLimit}</span></span></span></button>`).join('')}</div><div class="disclosure">素材采用原作者 Commons 包（CC BY-SA 2.1 Japan，并附游戏相关用途要求）。中文为项目工作译名。规则来源、原始卡面与完整授权说明位于项目的 CREDITS.md。</div></main>`;
}
function replayPage(){return `<div class="wrap"><div class="pageintro"><div><div class="eyebrow">REPLAY ARCHIVE</div><h1>每一步，都留下回声。</h1></div><p>回放只读取已保存的观察快照，不请求模型。公开回放不会显示当时尚未获知的秘密。</p></div><div class="toolbar">${g?btn('打开当前对局回放','open-replay','primary'):''}<label class="filebutton">导入回放 JSON<input id="replay-file" type="file" accept=".json,application/json"></label>${replay?btn('导出离线 HTML 回放','offline-replay'):''}</div></div>${replay?`<div class="replaybar">${btn('←','replay-prev','small')}<label class="sr-only" for="replay-range">回放进度</label><input id="replay-range" type="range" min="0" max="${replay.frames.length-1}" value="${replayAt}">${btn('→','replay-next','small')}<span id="replay-position">${replayAt+1} / ${replay.frames.length}</span>${g&&replayGameId===g.id&&g.phaseId==='over'?btn('从此处创建分支','branch','small'):''}</div><div id="replay-scene">${game(replay.frames[replayAt].view,true)}</div>`:'<div class="wrap hint">选择一段回放，重新审视那些被忽略的细节。</div>'}`;}
function bannerHtml(){return loopBanner?`<div class="loop-banner ${loopBanner.kind}" data-do="dismiss-banner" role="status"><div class="loop-banner-inner"><span class="eyebrow">${esc(loopBanner.kicker)}</span><h2>${esc(loopBanner.title)}</h2>${loopBanner.lines.map(l=>`<p>${esc(l)}</p>`).join('')}<small>点击任意处继续</small></div></div>`:'';}
function render(){
 const el=document.activeElement,focus=el?.id,prior=el?.dataset?.do,hadModal=!!document.querySelector('.overlay');
 $('#app').innerHTML=`<div class="shell" ${modal?'inert':''}>${nav()}${page==='home'?home():page==='game'?game():page==='editor'?editorPage():page==='rules'?rulesPage():replayPage()}${footer()}</div>${bannerHtml()}${modal}`;
 if(modal&&!hadModal){$('.modal button, .modal input, .modal select')?.focus();}
 else if(focus)document.getElementById(focus)?.focus({preventScroll:true});
 else if(prior)document.querySelector(`[data-do="${CSS.escape(prior)}"]`)?.focus({preventScroll:true});
 document.body.classList.toggle('dialog-open',!!modal);
}
const boardPositions=()=>Object.fromEntries([...document.querySelectorAll('.board [data-character]')].map(el=>[el.dataset.character,el.getBoundingClientRect()]));
async function animateCards(prev,next,cardOrigin){
 const animations=[],newCards=[...document.querySelectorAll('.board [data-placement]')].filter(el=>!prev.placements.some(p=>placementKey(p)===el.dataset.placement)||prev.day!==next.day||prev.loop!==next.loop);
 const didReveal=next.revealedCards?.length===6&&(!prev.revealedCards?.length||prev.day!==next.day||prev.loop!==next.loop);
 if(didReveal)document.querySelectorAll('.board-card.face-up .board-card-inner').forEach((el,i)=>{animations.push(el.animate([{transform:'rotateY(0deg)'},{transform:'rotateY(180deg)'}],{duration:520,delay:(newCards.length?370:0)+i*70,easing:'cubic-bezier(.2,.7,.3,1)',fill:'backwards'}).finished.catch(()=>{}));});
 for(const el of newCards){
  const to=el.getBoundingClientRect(),table=document.querySelector('.board').getBoundingClientRect(),origin=cardOrigin||{x:table.x+table.width/2,y:table.y-24,width:44,height:62};
  const fly=el.cloneNode(true);fly.removeAttribute('data-placement');fly.setAttribute('aria-hidden','true');fly.classList.add('card-flight');fly.classList.remove('face-up');
  Object.assign(fly.style,{left:to.x+'px',top:to.y+'px',width:to.width+'px',height:to.height+'px'});document.body.append(fly);el.style.opacity='0';
  const animation=fly.animate([{transform:`translate(${origin.x+origin.width/2-to.x-to.width/2}px,${origin.y+origin.height/2-to.y-to.height/2}px) rotate(-12deg) scale(1.18)`,opacity:.25},{transform:'translate(0,0) rotate(3deg) scale(1.02)',opacity:1,offset:.82},{transform:'none',opacity:1}],{duration:400,easing:'cubic-bezier(.2,.7,.25,1)'});
  animations.push(animation.finished.catch(()=>{}).then(()=>{el.style.opacity='';fly.remove();}));
 }
 await Promise.all(animations);
}
function floatDelta(el,text,cls){
 const r=el.getBoundingClientRect(),tag=document.createElement('span');tag.className='delta-float '+cls;tag.textContent=text;tag.setAttribute('aria-hidden','true');
 Object.assign(tag.style,{left:r.x+r.width/2+'px',top:r.y+r.height*.42+'px'});document.body.append(tag);
 return tag.animate([{transform:'translate(-50%,0) scale(.8)',opacity:0},{transform:'translate(-50%,-14px) scale(1.08)',opacity:1,offset:.25},{transform:'translate(-50%,-44px)',opacity:0}],{duration:1150,easing:'ease-out'}).finished.catch(()=>{}).then(()=>tag.remove());
}
async function animateBoardChanges(prev,next,positions){
 const animations=[];
 document.querySelectorAll('.board [data-character]').forEach(el=>{
  const id=el.dataset.character,a=prev.board[id],b=next.board[id],from=positions[id],to=el.getBoundingClientRect();
  if(from&&a?.location!==b.location){
   // A viewport overlay can cross location boundaries without zone clipping.
   const fly=el.cloneNode(true);fly.removeAttribute('data-character');fly.setAttribute('aria-hidden','true');fly.tabIndex=-1;fly.classList.add('character-flight');
   Object.assign(fly.style,{left:to.x+'px',top:to.y+'px',width:to.width+'px',height:to.height+'px'});document.body.append(fly);el.style.opacity='0';
   animations.push(fly.animate([{transform:`translate(${from.x-to.x}px,${from.y-to.y}px)`,opacity:.8},{transform:`translate(${(from.x-to.x)/2}px,${(from.y-to.y)/2-18}px) scale(1.05)`,opacity:1,offset:.5},{transform:'none',opacity:1}],{duration:560,easing:'ease-in-out'}).finished.catch(()=>{}).then(()=>{el.style.opacity='';fly.remove();}));
  }else if(a){
   const deltas=[['goodwill','♡','g'],['paranoia','△','p'],['intrigue','◇','i'],['guard','盾','gd']].filter(([k])=>a[k]!==b[k]).map(([k,s,c])=>[`${s}${b[k]>a[k]?'+':''}${b[k]-a[k]}`,c]);
   deltas.forEach(([text,cls],i)=>animations.push(new Promise(r=>setTimeout(r,i*160)).then(()=>floatDelta(el,text,cls))));
   if(a.alive&&!b.alive)animations.push(el.animate([{transform:'translateX(0)',filter:'none'},{transform:'translateX(-5px)',filter:'brightness(1.8) saturate(0)',offset:.2},{transform:'translateX(5px)',offset:.4},{transform:'translateX(-3px)',offset:.6},{transform:'none'}],{duration:620}).finished.catch(()=>{}));
   else if(deltas.length)animations.push(el.animate([{boxShadow:'0 0 0 3px #e8cf91',filter:'brightness(1.35)'},{boxShadow:'none',filter:'none'}],{duration:700}).finished.catch(()=>{}));
  }
 });
 document.querySelectorAll('.board .zone').forEach(el=>{const id=el.dataset.target,d=(next.locations?.[id]??0)-(prev.locations?.[id]??0);if(d)animations.push(floatDelta(el.querySelector('.intrigue')||el,`◇${d>0?'+':''}${d}`,'i'));});
 if(prev.loop!==next.loop)animations.push(document.querySelector('.board')?.animate([{opacity:0,filter:'blur(10px) hue-rotate(40deg)'},{opacity:1,filter:'none'}],{duration:800}).finished.catch(()=>{}));
 await Promise.all(animations);
}
async function animateVisualStep(prev,next,positions,cardOrigin){
 const didReveal=next.revealedCards?.length===6&&(!prev.revealedCards?.length||prev.day!==next.day||prev.loop!==next.loop);
 if(didReveal||next.log?.some(e=>e.n>(prev.log?.length||0)&&['counter','move','death','day','loop'].includes(e.type)))requestKind='animation';
 if(didReveal){
  const visibleReveal={...next,phaseId:'cultist',phase:'行动结算',placements:next.revealedCards,board:prev.board};
  transitionView=visibleReveal;render();await animateCards(prev,visibleReveal,cardOrigin);
  positions=boardPositions();transitionView=next;render();
 }else{transitionView=next;render();await animateCards(prev,next,cardOrigin);}
 if(page==='game'&&g?.id===next.id)await animateBoardChanges(prev,next,positions);
}
async function animateTransition(prev,next,positions,cardOrigin,frames=[]){
 if(reduced()||page!=='game'||typeof Element.prototype.animate!=='function')return;
 const snapshots=frames.map(frame=>({...next,...frame}));
 if(!snapshots.length||snapshots.at(-1).revision!==next.revision)snapshots.push(next);
 let previous=prev;
 for(const [index,snapshot]of snapshots.entries()){
  if(page!=='game'||g?.id!==next.id)break;
  await animateVisualStep(previous,snapshot,positions,index===0?cardOrigin:undefined);previous=snapshot;positions=boardPositions();
 }
 transitionView=null;
}
function newModal(mode='heroes'){
 auto=false;
 const tile=(value,title,detail,checked)=>`<label class="tile"><input type="radio" name="new-mode" value="${value}" ${checked?'checked':''}><span><b>${title}</b><small>${detail}</small></span></label>`;
 const scriptTile=(value,title,detail,checked)=>`<label class="tile"><input type="radio" name="new-script" value="${value}" ${checked?'checked':''}><span><b>${title}</b><small>${detail}</small></span></label>`;
 modal=`<div class="overlay"><section class="modal wide-modal" role="dialog" aria-modal="true" aria-label="开启新轮回"><div class="modalhead"><h2>开启新的轮回</h2>${btn('×','close','flat')}</div>
  <div class="section-label">你的立场</div><div class="tiles">${tile('heroes','主人公','操控三套手牌，阻止惨剧',mode==='heroes')}${tile('mastermind','剧作家','知晓真相，对抗三名 AI',mode==='mastermind')}${tile('observe','AI 观战','双方均由对手程序控制',mode==='observe')}</div>
  <div class="section-label">剧本</div><div class="tiles">${scriptTile('starter','起始剧本','FS 教学 · 3 日 × 3 轮回',true)}${scriptTile('FS','随机 FS 剧本','入门规则 · 4 日 × 3 轮回',false)}${scriptTile('BTX','随机 BTX 剧本','基础规则 · 含最后的战斗',false)}${editor?scriptTile('editor','编辑器中的剧本','使用剧本工坊的草稿',false):''}</div>
  <div class="formgrid"><label>对手<select id="new-opponent">${info.configured?'<option value="ai">DeepSeek AI（推荐）</option>':''}<option value="bot">离线练习机器人</option></select></label><label>交流规则<select id="new-talk"><option value="between_loops_only">仅轮回间讨论</option><option value="allowed_during_loop">允许轮回内讨论</option></select></label>${info.configured?'<label>每局 API 预算（美元）<input id="new-budget" type="number" min=".01" max="10" step=".1" value=".5"></label>':''}</div>
  <p class="hint">${info.configured?'DeepSeek 对手每次决策约花费 $0.002，每局通常低于 $0.10。':'未配置 DeepSeek 密钥，对手将使用离线练习机器人。'}所有对局自动保存，可随时继续。</p>
  <div class="row">${btn('进入棋盘','create','primary big')}${btn('取消','close')}</div></section></div>`;
 render();
}
function detail(id){
 const c=char(id),role=g&&page==='game'?(g.secret?.roles?.[id]||g.knownRoles?.[id]):null,state=g&&page==='game'?g.board?.[id]:null;
 modal=`<div class="overlay"><section class="modal" role="dialog" aria-modal="true" aria-label="${name(id)}详情"><div class="modalhead"><h2>${name(id)} <small>${c.name_ja}</small></h2>${btn('×','close','flat')}</div>
  <div class="detail-grid"><img class="detailimg" src="/${c.card}" alt="${name(id)}原始人物卡面"><div>
   ${role?`<p class="detail-role">角色：<b>${esc(name(role))}</b>${g.secret?' · 仅剧作家可见':''}</p>`:''}
   ${state?`<p class="detail-state"><span class="g">♡ ${state.goodwill}</span><span class="p">△ ${state.paranoia}/${c.paranoiaLimit}</span><span class="i">◇ ${state.intrigue}</span>${state.alive?'':'<span class="dead-tag">已死亡</span>'}</p>`:''}
   <p class="hint">初始：${name(c.start)} · 禁入：${c.forbiddenLocations.map(name).join('、')||'无'} · 不安临界 ${c.paranoiaLimit}</p>
   ${c.abilities.map(a=>`<div class="abilitytext"><span class="g">♡ ${a.minGoodwill}</span> · ${a.limit==='loop'?'每轮回一次':'每天一次'}<br>${esc(a.effect_zh)}</div>`).join('')}${c.traits_zh.map(t=>`<div class="abilitytext trait">${esc(t)}</div>`).join('')}
  </div></div></section></div>`;
 render();
}
function guideModal(){
 modal=`<div class="overlay"><section class="modal wide-modal guide" role="dialog" aria-modal="true" aria-label="玩法指南"><div class="modalhead"><h2>五分钟学会玩法</h2>${btn('×','close','flat')}</div>
  <ol class="guide-steps">
   <li><b>目标</b><p>剧作家秘密安排了角色（杀手、关键人物……）和事件日程。<em>主人公只要完整度过一个轮回而没有触发失败条件就获胜</em>；所有轮回都失败则剧作家获胜。</p></li>
   <li><b>每天先盖牌</b><p>剧作家先盖 3 张，主人公 A、B、C 各盖 1 张。选一张手牌，再点击棋盘上高亮的人物或地点。六张牌齐后同时翻开：先移动，再加减计数。</p></li>
   <li><b>读懂人物</b><p><span class="p">△ 不安</span>达到临界（进度条满格变红）时，若该人物是当天事件的犯人，事件就会发生。<span class="i">◇ 暗跃</span>常常是失败条件。<span class="g">♡ 友好</span>达到门槛可请求人物能力，例如公开角色或减少不安。</p></li>
   <li><b>观察剧作家</b><p>剧作家把牌盖在谁身上是公开的。他反复给谁加不安、加暗跃，谁就可能是犯人或关键人物。用不安−1和暗跃禁止去阻止——但同一天两张暗跃禁止会互相抵消。</p></li>
   <li><b>失败也是线索</b><p>轮回失败后时间倒流，计数器复原，但你已确认的角色和记录都会保留。右侧"情报"和"记录"可以随时查看。</p></li>
  </ol>
  <p class="hint">对手回合会自动进行（可在棋盘右上角关闭"对手自动"）。键盘：数字键选手牌，Esc 取消选择。</p>
  <div class="row">${btn('开始游戏','close','primary big')}</div></section></div>`;
 render();
}
async function truthModal(){
 if(!g?.winner)return;
 if(truth?.id!==g.id)truth={id:g.id,script:await api('/games/'+g.id+'/script?full=1')};
 const s=truth.script,known=g.knownRoles||{};
 modal=`<div class="overlay"><section class="modal wide-modal truth" role="dialog" aria-modal="true" aria-label="真相揭晓"><div class="modalhead"><h2>真相揭晓</h2>${btn('×','close','flat')}</div>
  <p class="plots"><span class="section-label">主规则</span><b>${esc(name(s.mainPlot))}</b><span class="section-label">副规则</span><b>${s.subPlots.map(p=>esc(name(p))).join(' + ')}</b></p>
  <div class="truth-grid">${s.characters.map(c=>`<div class="truth-card ${s.roles[c]==='person'?'plain':''} ${known[c]?'found':''}"><img src="/${char(c).portrait}" alt=""><b>${esc(name(c))}</b><span>${esc(name(s.roles[c]))}</span>${g.mode==='heroes'&&s.roles[c]!=='person'?`<small>${known[c]?'已被识破':'未被识破'}</small>`:''}</div>`).join('')}</div>
  <div class="section-label">事件日程</div>${s.incidents.map(e=>`<div class="schedule"><b>DAY ${e.day}</b><span>${esc(name(e.type))}</span><em>犯人 ${esc(name(e.culprit))}</em></div>`).join('')}
  <div class="row">${btn('查看回放','open-replay','primary')}${btn('再开一局','new')}</div></section></div>`;
 render();
}
async function syncState(){
 if(working||!g)return;const id=g.id;working=true;requestKind='sync';auto=false;render();
 try{const latest=await api('/games/'+id);if(g?.id!==id)return;g=latest;selected=null;syncRequired=Boolean(g.busy);actionError=g.busy?'服务器仍在处理这一步。请稍后再次同步，不要重复提交。':'';actionErrorCode='';toast(g.busy?'这一步仍在处理中。':'已读取最新局面，请确认后继续。');}
 catch(error){syncRequired=true;actionError=error.message;actionErrorCode=error.code;toast(error.message);}
 finally{working=false;requestKind='';render();}
}
async function step(command,route='command'){
 if(working||!g)return;if(syncRequired||g.busy){toast('请先同步当前局面，再继续行动。');return;}
 const prev=g,cardOrigin=document.querySelector('.actioncard.chosen')?.getBoundingClientRect(),positions=boardPositions();let frames=[];
 localStorage.setItem('tl-game',prev.id);working=true;requestKind=route==='advance'?'rules':route==='ai-step'||route==='bot-step'&&!humanTurn(prev)?'ai':'human';actionError='';actionErrorCode='';render();
 try{
  const updated=await api('/games/'+prev.id+'/'+route,{revision:prev.revision,commandId:crypto.randomUUID(),command});
  if(g?.id!==prev.id)return;frames=updated.transitionFrames||[];g=updated;selected=null;syncRequired=false;advancedRevision=g.id+':'+g.revision;
  if(updated.decision?.controller==='规则引擎')requestKind='rules';
  recordDecision(prev,updated);
  play(g.winner?'bong_001':g.loop!==prev.loop||g.phaseId==='between'&&prev.phaseId!=='between'?'glitch_001':g.log.some(e=>e.n>prev.log.length&&e.type==='death')?'error_001':g.log.some(e=>e.n>prev.log.length&&e.type==='cards')?'open_001':'drop_001');
 }catch(error){
  auto=false;let recovered=false;
  if(g?.id===prev.id)try{g=await api('/games/'+prev.id);selected=null;recovered=true;}catch{}
  syncRequired=!recovered||Boolean(g?.busy);actionErrorCode=error.code;
  const status=recovered?(g.busy?'服务器仍在处理，请稍后同步。':g.revision>prev.revision?'已获取更新后的局面，请查看盘面再决定下一步。':'已读取当前局面，请确认后再继续。'):'暂时无法核对服务器状态，请先同步或重新连接。';
  actionError=error.message+' '+status+(error.uncertain&&route==='ai-step'?' 上次模型请求可能已产生用量，未自动重发。':'');
  error.message=actionError;throw error;
 }finally{try{render();if(g?.id===prev.id)await animateTransition(prev,g,positions,cardOrigin,frames);}catch{document.querySelectorAll('.card-flight,.character-flight,.delta-float').forEach(el=>el.remove());}finally{transitionView=null;working=false;requestKind='';render();showOutcome();}}
}
async function runAuto(){
 if(working&&!auto)return;if(auto){auto=false;render();return;}if(syncRequired||g?.busy){toast('请先同步当前局面。');return;}auto=true;render();
 try{for(let i=0;i<180&&auto&&g&&!g.winner;i++){
  if(!['mm_cards','hero_cards'].includes(g.phaseId)&&advancedRevision!==g.id+':'+g.revision){await step(undefined,'advance');if(!auto||!g||g.winner||syncRequired)break;}
  if(humanTurn(g))break;
  while(loopBanner&&auto)await new Promise(r=>setTimeout(r,200));
  await step(undefined,aiRoute());await new Promise(r=>setTimeout(r,humanTurn(g)?80:420));
 }}finally{auto=false;render();}
}
function aiRoute(){return info.configured&&localStorage.getItem('tl-opp-'+g.id)!=='bot'?'ai-step':'bot-step';}
function kick(){
 if(!autoPlay||page!=='game'||!g||g.winner||humanTurn(g)||working||auto||syncRequired||actionError||g.busy)return;
 const id=g.id;setTimeout(()=>{if(g?.id===id&&!working&&!auto&&!humanTurn(g))runAuto().catch(error=>{toast(error.message);play('error_001');render();});},350);
}
function recordDecision(prev,next){
 const d=next.decision;
 if(d?.reason){aiFeed.push({gameId:next.id,seat:d.seat,text:d.reason,loop:prev.loop,day:prev.day});if(aiFeed.length>200)aiFeed.shift();}
 const fresh=next.log.filter(e=>e.n>prev.log.length);
 if(next.winner&&!prev.winner){pendingOutcome={kind:next.winner==='heroes'?'victory':'defeat',kicker:'THE TIMELINE HAS ENDED',title:next.winner==='heroes'?'明天，终于到来。':'惨剧，再度重演。',lines:[`${next.winner==='heroes'?'主人公':'剧作家'}获胜${next.mode==='observe'?'':(next.mode!=='mastermind')===(next.winner==='heroes')?' · 你赢了！':' · 你输了'}`,...fresh.filter(e=>['death','victory','defeat'].includes(e.type)).slice(-3).map(e=>e.text)]};}
 else if(next.loop!==prev.loop||next.phaseId==='between'&&prev.phaseId!=='between'){const failed=next.phaseId==='between'?next.loop:prev.loop;pendingOutcome={kind:'loop',kicker:'TIME REWINDS',title:`第 ${failed} 轮回失败`,lines:fresh.filter(e=>['death','incident'].includes(e.type)).slice(-3).map(e=>e.text).concat(next.script.loops-failed>0?[`还剩 ${next.script.loops-failed} 次重来的机会。`]:[])};}
}
function showOutcome(){
 if(!pendingOutcome)return;loopBanner=pendingOutcome;pendingOutcome=null;render();
 const shown=loopBanner;if(shown.kind==='loop')setTimeout(()=>{if(loopBanner===shown){loopBanner=null;render();}},reduced()?1800:3200);
}
async function resumeRules(){if(!g||g.winner||g.busy||syncRequired||['mm_cards','hero_cards'].includes(g.phaseId)||advancedRevision===g.id+':'+g.revision)return;try{await step(undefined,'advance');}catch(error){toast(error.message);}}
async function openReplay(){replay=sanitizePublicReplay(await api('/games/'+g.id+'/replay'));replayAt=Math.max(0,replay.frames.length-1);replayGameId=g.id;page='replay';modal='';loopBanner=null;render();}
function draft(){const val=$('#script-editor')?.value??editor;editor=val;return JSON.parse(val);}
async function validDraft(){const d=draft(),v=await api('/scripts/validate',d);if(v.errors.length)throw Error('请先修正剧本：'+v.errors.map(x=>x.message).join('；'));return d;}
function publicDraft(s){return {id:s.id,title:s.title,author:s.author,ruleset:s.ruleset,days:s.days,loops:s.loops,communication:s.communication,characters:s.characters,incidents:s.incidents.map(({day})=>({day})),settings:s.settings,specialRules:s.specialRules||[]};}
function printable(s,full){const d=full?s:publicDraft(s);const html=`<!doctype html><meta charset="utf-8"><title>${esc(s.title)}</title><style>body{font:16px sans-serif;max-width:850px;margin:50px auto;line-height:1.8}table{border-collapse:collapse;width:100%}td,th{border:1px solid #aaa;padding:8px}h1{border-bottom:2px solid}small{color:#666}@media print{button{display:none}}</style><h1>${esc(s.title)}</h1><p>${full?'剧作家私密页 · 含答案':'主人公公开页'} · ${esc(s.ruleset)} · ${s.days}日 / ${s.loops}轮回</p><p>交流：${esc(s.communication)}</p>${full?`<p>Y ${name(s.mainPlot)} / X ${s.subPlots.map(name).join('、')}</p>`:''}<table><tr><th>人物</th>${full?'<th>角色</th>':''}</tr>${s.characters.map(id=>`<tr><td>${name(id)}</td>${full?'<td>'+name(s.roles[id])+'</td>':''}</tr>`).join('')}</table><h2>事件日程</h2><table>${d.incidents.map(e=>`<tr><td>第${e.day}日</td><td>${e.type?name(e.type):'事件未公开'}</td>${full?'<td>'+name(e.culprit)+'</td>':''}</tr>`).join('')}</table><p>公开参数：${esc(JSON.stringify(s.settings||{}))}</p><small>原作 惨劇RoopeR / BakaFire Party · 作者 ${esc(s.author)}</small>`;download(html,full?'script-private.SPOILERS.html':'script-public.html','text/html');}
function offlineReplay(){const data=JSON.stringify(sanitizePublicReplay(replay)).replace(/</g,'\\u003c');const html=`<!doctype html><meta charset="utf-8"><title>惨剧轮回 · 离线回放</title><style>body{font:15px system-ui;background:#11171b;color:#eee;max-width:1000px;margin:30px auto;padding:20px}input{width:100%}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #40515d}pre{white-space:pre-wrap;line-height:1.8;color:#abb8bd}</style><h1>惨剧轮回 · 离线回放</h1><p>无需网络、服务端或模型。此文件仅包含导出视角的信息。</p><input id="range" aria-label="回放进度" type="range" min="0"><h2 id="phase"></h2><table id="board"></table><pre id="log"></pre><script>const data=${data};const r=document.getElementById('range');r.max=data.frames.length-1;r.value=0;function draw(){const v=data.frames[r.value].view;document.getElementById('phase').textContent=v.script.title+' · 轮回 '+v.loop+' / 第 '+v.day+' 日 · '+v.phase;const t=document.getElementById('board');t.replaceChildren();for(const c of Object.values(v.board)){const tr=t.insertRow();for(const x of [c.id,c.location,c.alive?'存活':'死亡','友好 '+c.goodwill,'不安 '+c.paranoia,'暗跃 '+c.intrigue])tr.insertCell().textContent=x;}document.getElementById('log').textContent=v.log.map(e=>e.text).join(String.fromCharCode(10));}r.oninput=draw;draw();<\/script>`;download(html,'tragedy-replay-offline.html','text/html');}
function openGame(next){g=next;localStorage.setItem('tl-game',g.id);page='game';modal='';selected=null;actionError='';actionErrorCode='';syncRequired=false;loopBanner=null;pendingOutcome=null;render();}
async function placeOn(target){const a=g.actions.find(o=>o.command.type==='place'&&o.command.card===selected&&o.command.target===target);if(!a){toast(target in (g.board||{})?'此目标不能使用所选牌。':'本方今天已在这里盖过牌，请选择高亮目标。');return;}await step(a.command);}
document.addEventListener('input',e=>{if(e.target.id==='gen-seed')generator.seed=+e.target.value;if(e.target.id==='gen-theme')generator.theme=e.target.value;if(e.target.id==='notes')localStorage.setItem('note-'+g.id,e.target.value);if(e.target.id==='script-editor')editor=e.target.value;if(e.target.id==='replay-range'){replayAt=+e.target.value;$('#replay-position').textContent=`${replayAt+1} / ${replay.frames.length}`;$('#replay-scene').innerHTML=game(replay.frames[replayAt].view,true);}});
document.addEventListener('change',async e=>{try{
 if(e.target.id==='gen-set')generator.ruleset=e.target.value;
 if(e.target.id==='autoplay'){autoPlay=e.target.checked;localStorage.setItem('tl-autoplay',autoPlay?'on':'off');if(!autoPlay)auto=false;render();kick();return;}
 if(['script-file','replay-file'].includes(e.target.id)){const file=e.target.files[0];if(!file)return;if(file.size>20*1024*1024)throw Error('文件超过20MB');const data=JSON.parse(await file.text());if(e.target.id==='script-file'){editor=JSON.stringify(data,null,2);editorReport='';}else{validateReplay(data,catalog);replay=sanitizePublicReplay(data);replayAt=0;replayGameId=null;}render();}
}catch(err){toast(err.message,'error');}});
document.addEventListener('mouseover',e=>{const b=e.target.closest('[data-hl]');document.querySelectorAll('.hl').forEach(el=>el.classList.remove('hl'));if(b)document.querySelectorAll(`.board [data-character="${CSS.escape(b.dataset.hl)}"],.board .zone[data-target="${CSS.escape(b.dataset.hl)}"]`).forEach(el=>el.classList.add('hl'));});
document.addEventListener('click',async e=>{try{
 const authLink=e.target.closest('a[data-reauth]');if(authLink){const id=g?.id||localStorage.getItem('tl-game');if(id){localStorage.setItem('tl-game',id);localStorage.setItem('tl-resume',id);}return;}
 if(e.target.closest('.loop-banner')){loopBanner=null;render();kick();return;}
 const card=e.target.closest('[data-card]');if(card){if(working||syncRequired||g?.busy||card.disabled)return;selected=selected===card.dataset.card?null:card.dataset.card;play('click_001');render();return;}
 const character=e.target.closest('[data-character]');if(character){if(selected&&page==='game')await placeOn(character.dataset.character);else detail(character.dataset.character);kick();return;}
 const zone=e.target.closest('[data-target]');if(zone&&selected&&page==='game'){await placeOn(zone.dataset.target);kick();return;}
 const b=e.target.closest('[data-do]');if(!b)return;const a=b.dataset.do;
 if(a==='reconnect'){const id=g?.id||localStorage.getItem('tl-game');if(id){localStorage.setItem('tl-game',id);localStorage.setItem('tl-resume',id);}location.reload();return;}
 if(a==='sync-state'){await syncState();kick();return;}
 if(a==='clear-selection'){selected=null;render();return;}
 if(a==='focus-hand'){document.getElementById('hand-panel')?.scrollIntoView({behavior:reduced()?'instant':'smooth',block:'center'});return;}
 if(a==='tab'){rightTab=b.dataset.tab;render();return;}
 if(a.startsWith('nav-')){page=a.slice(4);auto=false;modal='';render();kick();return;}
 if(a==='sound'){sound=!sound;localStorage.setItem('tl-sound',sound?'on':'off');render();play('click_001');}
 else if(a==='new'||a.startsWith('new-'))newModal(a==='new'?'heroes':a.slice(4));
 else if(a==='guide')guideModal();
 else if(a==='truth')await truthModal();
 else if(a==='close'){modal='';render();}
 else if(a==='create'){
  if(creating)return;creating=true;b.disabled=true;
  const type=document.querySelector('input[name="new-script"]:checked').value,mode=document.querySelector('input[name="new-mode"]:checked').value,budget=+($('#new-budget')?.value??.5),talk=$('#new-talk').value,opponent=$('#new-opponent').value;
  try{let script=type==='editor'?JSON.parse(editor):type==='starter'?await api('/scripts/starter'):await api('/scripts/generate',{ruleset:type,seed:Date.now(),title:'未曾发生的明天'});script.communication=talk;const created=await api('/games',{script,mode,budget});localStorage.setItem('tl-opp-'+created.id,opponent);openGame(created);play('confirmation_001');
   if(!localStorage.getItem('tl-guide-seen')){localStorage.setItem('tl-guide-seen','1');guideModal();}}
  finally{creating=false;b.disabled=false;}
 }
 else if(a==='refresh'){saves=await api('/games');render();}
 else if(a==='load'){auto=false;openGame(await api('/games/'+b.dataset.id));await resumeRules();}
 else if(a==='advance')await step(undefined,'advance');
 else if(a==='execute-first'){if(g.actions.length===1)await step(g.actions[0].command);}
 else if(a==='choose'){const o=g.actions[+b.dataset.index];if(o)await step(o.command);}
 else if(a==='bot')await step(undefined,'bot-step');
 else if(a==='auto'){if(!auto&&actionError){actionError='';actionErrorCode='';}await runAuto();return;}
 else if(a==='generate'||a==='ai-generate'){if(working)return;const config={ruleset:$('#gen-set').value,seed:+$('#gen-seed').value,title:$('#gen-theme').value||'未曾发生的明天',theme:$('#gen-theme').value};working=true;render();try{const data=await api(a==='generate'?'/scripts/generate':'/scripts/ai-generate',config);editor=JSON.stringify(data.script||data,null,2);editorReport='';toast(a==='generate'?'合法骨架已生成，尚未做平衡试玩。':'AI 润色完成，估算 $'+data.estimatedCost.toFixed(5));}finally{working=false;render();}}
 else if(a==='starter-editor'){editor=JSON.stringify(await api('/scripts/starter'),null,2);editorReport='';render();}
 else if(a==='validate'){const v=await api('/scripts/validate',draft());editorReport=`<div class="report ${v.errors.length?'error':''}">${v.errors.length?'未通过校验：'+v.errors.map(x=>esc(x.path+' '+x.message)).join('<br>'):'结构验证通过。仍需试玩评估平衡。'}${v.warnings.map(x=>'<br>提示：'+esc(x.message)).join('')}</div>`;render();}
 else if(a==='play-editor'){draft();newModal('mastermind');document.querySelector('input[name="new-script"][value="editor"]').checked=true;}
 else if(a==='export-script')download(await validDraft(),'script-private.SPOILERS.json');
 else if(a==='export-public')download(publicDraft(await validDraft()),'script-public.json');
 else if(a==='print-public'||a==='print-private')printable(await validDraft(),a==='print-private');
 else if(a==='save-replay'||a==='full-replay')download(sanitizePublicReplay(await api('/games/'+g.id+'/replay'+(a==='full-replay'?'?full=1':''))),a==='full-replay'?'replay-full.SPOILERS.json':'replay-public.json');
 else if(a==='open-replay')await openReplay();
 else if(a==='replay-prev'||a==='replay-next'){replayAt=Math.max(0,Math.min(replay.frames.length-1,replayAt+(a==='replay-next'?1:-1)));render();}
 else if(a==='offline-replay')offlineReplay();
 else if(a==='branch'){if(replayGameId!==g?.id)throw Error('导入回放不能创建本机存档分支');openGame(await api('/games/'+g.id+'/branch',{revision:replay.frames[replayAt].view.revision}));}
 kick();
 }catch(err){auto=false;toast(err.message,'error');render();play('error_001');}});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&loopBanner){loopBanner=null;render();kick();return;}
 if(e.key==='Escape'&&modal){modal='';render();return;}
 if(e.key==='Escape'&&selected){selected=null;render();return;}
 if(e.key==='Tab'&&modal){const items=[...document.querySelectorAll('.modal button:not(:disabled),.modal input,.modal select,.modal textarea,.modal a[href]')];const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}return;}
 if(/^[1-9]$/.test(e.key)&&!modal&&page==='game'&&g&&humanTurn(g)&&['mm_cards','hero_cards'].includes(g.phaseId)&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!working){const c=g.hand[+e.key-1];if(c?.available){selected=selected===c.id?null:c.id;play('click_001');render();}}
});
try{
 [catalog,info,saves]=await Promise.all([api('/catalog'),api('/info'),api('/games')]);
 const id=localStorage.getItem('tl-game'),resume=localStorage.getItem('tl-resume');
 if(id)try{g=await api('/games/'+id);if(resume===id){page='game';localStorage.removeItem('tl-resume');}}catch(error){if(resume)throw error;}
 render();if(page==='game'){await resumeRules();kick();}
}catch(err){actionErrorCode=err.code;$('#app').innerHTML=`<main class="startup-error"><span class="eyebrow">时隙 · CONNECTION</span><h1>暂时无法展开棋盘</h1><p>${esc(err.message)}</p><p class="hint">已保存的对局不会在此处重复提交。重新连接后，可从档案室继续。</p>${err.requiresLogin?'<a class="reconnect-link" data-reauth href="/signin-with-chatgpt" target="_top">重新登录并恢复对局</a>':btn('重新连接站点','reconnect','primary')}</main>`;}

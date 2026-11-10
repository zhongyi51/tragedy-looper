import {esc,icon,btn} from '../html.mjs';
import {char,modeName,phaseLabel} from '../lookup.mjs';

const MODE_ICON={heroes:'users',mastermind:'mask',observe:'eye'};

function saveCard(s){
 const over=s.phase==='over',status=over?`已结束${s.winner?' · '+(s.winner==='heroes'?'主人公获胜':'剧作家获胜'):''}`:`第 ${s.loop} 轮回 · 第 ${s.day} 日 · ${phaseLabel(s.phase)}`;
 return `<article class="save${over?' finished':''}">
  <span class="save-mode ${s.mode}">${icon(MODE_ICON[s.mode]||'board')}</span>
  <div class="save-copy"><b>${esc(s.title)}</b><small>${esc(modeName(s.mode))} · ${esc(status)}</small><small class="save-date">${esc(s.created.slice(0,16).replace('T',' '))}</small></div>
  ${btn(over?'复盘':'继续','load','small'+(over?'':' primary'),`data-id="${esc(s.id)}"`)}
 </article>`;
}

export function homeHtml(state){
 const {info,saves,g}=state,cast=['shrine_maiden','girl_student','office_worker','idol','doctor'];
 const side=(mode,num,title,text,cta,cls)=>`<article class="stance ${cls}"><span class="stance-icon">${icon(MODE_ICON[mode])}</span><span class="num">${num}</span><h3>${title}</h3><p>${text}</p>${btn(cta+icon('next'),'new-'+mode,mode==='heroes'?'primary':'')}</article>`;
 return `<main class="wrap home">
  <section class="home-hero">
   <div class="hero-copy">
    <div class="eyebrow">THE NEXT LOOP IS YOURS</div>
    <h1>这一次，<br>改写惨剧的结局。</h1>
    <p class="lead">剧作家知道一切真相，你只有有限的轮回。观察人物、推理配役，在时间归零之前，找到通往明天的那条路。</p>
    <div class="row">${btn(icon('loop')+'开启新轮回','new','primary big')}${g&&!g.winner?btn('继续当前对局'+icon('next'),'nav-game','big'):btn(icon('help')+'五分钟学会玩法','guide','big')}</div>
    <div class="pills"><span class="pill${info.configured?' on':''}">${icon('bot')}${info.configured?'DeepSeek AI 对手已就绪':'离线练习机器人'}</span><span class="pill">自动存档</span><span class="pill">完整回放</span><span class="pill">剧本工坊</span></div>
   </div>
   <div class="hero-art" aria-hidden="true"><div class="hero-ring"><i></i><i></i><i></i></div>${cast.map((id,i)=>`<img class="p${i}" src="/${char(id).portrait}" alt="">`).join('')}</div>
  </section>
  <div class="section-line"><h2>选择你的立场</h2><span class="eyebrow">ONE STORY · TWO SIDES</span></div>
  <div class="stances">
   ${side('heroes','01','成为主人公','操控三名主人公的手牌，与知晓真相的剧作家对抗。失败了也没关系——带着记忆回到第一天。','以主人公开始','hero-side')}
   ${side('mastermind','02','坐在幕布之后','你就是剧作家。布置杀机，掩藏意图，让三名 AI 主人公看见线索却来不及阻止。','以剧作家开始','mm-side')}
   ${side('observe','03','旁观一场推理','让 AI 剧作家与 AI 主人公完整对弈，观察每一张牌背后的思路。','开始观战','')}
  </div>
  <div class="section-line"><h2>最近的时间线</h2>${btn(icon('sync')+'刷新','refresh','small ghost')}</div>
  <div class="saves">${saves.length?saves.slice(0,9).map(saveCard).join(''):'<p class="hint empty-saves">还没有存档。开始一局，每一步都会自动保存。</p>'}</div>
 </main>`;
}

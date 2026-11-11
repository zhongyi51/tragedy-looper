import {esc,icon,btn} from '../html.mjs';
import {char,modeName,phaseLabel} from '../lookup.mjs';

const MODE_ICON={heroes:'users',mastermind:'mask',observe:'eye'};

function saveCard(s){
 const over=s.phase==='over',status=over?`已结束${s.winner?' · '+(s.winner==='heroes'?'主人公获胜':'剧作家获胜'):''}`:`第 ${s.loop} 轮回 · 第 ${s.day} 日 · ${phaseLabel(s.phase)}`;
 return `<article class="save${over?' finished':''}">
  <span class="save-mode ${s.mode}">${icon(MODE_ICON[s.mode]||'board')}</span>
  <div class="save-copy"><b>${esc(s.title)}</b><small>${esc(modeName(s.mode))} · ${esc(status)}</small><small class="save-date">${esc(s.created.slice(0,16).replace('T',' '))}</small></div>
  ${btn(over?'查看':'继续','load','small'+(over?'':' primary'),`data-id="${esc(s.id)}"`)}
 </article>`;
}

export function homeHtml(state){
 const {info,saves,g}=state,cast=['shrine_maiden','girl_student','office_worker','idol','doctor'];
 const side=(mode,num,title,text,cta,cls)=>`<article class="stance ${cls}"><span class="stance-icon">${icon(MODE_ICON[mode])}</span><span class="num">${num}</span><h3>${title}</h3><p>${text}</p>${btn(cta+icon('next'),'new-'+mode,mode==='heroes'?'primary':'')}</article>`;
 return `<main class="wrap home">
  <section class="home-hero">
   <div class="hero-copy">
    <h1>这一次，<br>改写惨剧的结局。</h1>
    <p class="lead">在有限的轮回里找出真相，阻止惨剧。</p>
    <div class="row">${btn(icon('loop')+'开始游戏','new','primary big')}${g&&!g.winner?btn('继续对局'+icon('next'),'nav-game','big'):btn(icon('help')+'怎么玩','guide','big')}</div>
    <div class="pills"><span class="pill${info.configured?' on':''}">${icon('bot')}${info.configured?'AI 对手已就绪':'离线机器人对手'}</span></div>
   </div>
   <div class="hero-art" aria-hidden="true"><div class="hero-ring"><i></i><i></i><i></i></div>${cast.map((id,i)=>`<img class="p${i}" src="/${char(id).portrait}" alt="">`).join('')}</div>
  </section>
  <div class="section-line"><h2>选择身份</h2></div>
  <div class="stances">
   ${side('heroes','01','主人公','在轮回中找出真相，阻止惨剧。','开始','hero-side')}
   ${side('mastermind','02','剧作家','你知道一切。让惨剧发生。','开始','mm-side')}
   ${side('observe','03','观战','看 AI 之间对局。','开始','')}
  </div>
  <div class="section-line"><h2>存档</h2>${btn(icon('sync')+'刷新','refresh','small ghost')}</div>
  <div class="saves">${saves.length?saves.slice(0,9).map(saveCard).join(''):'<p class="hint empty-saves">还没有存档。对局会自动保存。</p>'}</div>
 </main>`;
}

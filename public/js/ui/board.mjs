import {esc,icon} from '../html.mjs';
import {cat,char,name,seatName,seatMark,cardLabel,cardMeta,cardPreview,PLACING} from '../lookup.mjs';

const ZONES={hospital:{latin:'HOSPITAL',mark:'院'},shrine:{latin:'SHRINE',mark:'社'},city:{latin:'CITY',mark:'都'},school:{latin:'SCHOOL',mark:'校'}};
const placementKey=p=>p.seat+':'+p.target;

export function cardFace(card){
 const meta=cardMeta(card);
 return `<span class="face">${icon(meta.icon)}${meta.forbid?icon('ban','ban'):''}${meta.value?`<i>${meta.value}</i>`:''}</span>`;
}

// faceUp: publicly revealed. own: only this viewer knows the face. resolved: already applied today.
export function miniCard(p,{faceUp=false,own=false,resolved=false}={}){
 const meta=p.card?cardMeta(p.card):null,label=p.card?cardLabel(p.card):'',who=seatName(p.seat);
 const text=faceUp?label+(resolved?'（已结算）':''):own?label+'（对手看不到牌面）':'牌面未公开';
 const cls=['mini',p.seat==='M'?'mm':'hero',faceUp&&'face-up',own&&'own',resolved&&'resolved',meta&&'fam-'+meta.family,meta?.forbid&&'forbid'].filter(Boolean).join(' ');
 return `<span class="${cls}" data-placement="${esc(placementKey(p))}" role="img" aria-label="${esc(who+'：'+text)}" title="${esc(who+' · '+text)}"><span class="mini-inner"><span class="mini-back"><b>${esc(seatMark(p.seat))}</b></span><span class="mini-front">${p.card?cardFace(p.card):''}<b class="mini-seat">${esc(seatMark(p.seat))}</b></span></span></span>`;
}

// Cards stay on the board, face up and dimmed, for the rest of the day they were played.
export function cardsOn(v,target){
 if(v.placements.length){
  const open=!PLACING.includes(v.phaseId);
  return v.placements.filter(p=>p.target===target).map(p=>{
   const shown=open?v.revealedCards?.find(q=>q.seat===p.seat&&q.target===p.target):null;
   return miniCard({...p,card:shown?.card||p.card},{faceUp:Boolean(shown?.card),own:!shown?.card&&Boolean(p.card)});
  }).join('');
 }
 return (v.revealedCards||[]).filter(p=>p.target===target&&p.card).map(p=>miniCard(p,{faceUp:true,resolved:true})).join('');
}

function token(v,c,ctx){
 const d=char(c.id),limit=d.paranoiaLimit,label=name(c.id);
 const secretRole=v.secret?.roles?.[c.id],knownRole=v.knownRoles[c.id],role=secretRole&&secretRole!=='person'?secretRole:knownRole;
 const culpritDays=(v.secret?.incidents||[]).filter(e=>e.culprit===c.id).map(e=>e.day).concat(v.secret?[]:Object.entries(v.knownCulprits||{}).filter(([,id])=>id===c.id).map(([day])=>+day));
 const danger=c.alive&&limit>0&&c.paranoia>=limit,warn=c.alive&&!danger&&limit>1&&c.paranoia===limit-1;
 const targetable=ctx.targets?.has(c.id),preview=targetable?cardPreview(ctx.selected,c.id,v):'';
 const pips=Array.from({length:Math.max(limit,c.paranoia)},(_,i)=>`<i class="${i<c.paranoia?'on':''}${i>=limit?' over':''}"></i>`).join('');
 const title=`${label}：友好 ${c.goodwill} · 不安 ${c.paranoia}/${limit} · 暗跃 ${c.intrigue}${c.guard?' · 护卫 '+c.guard:''}${danger?' · 已达不安临界':''}${c.alive?'':' · 已死亡'}`;
 const cls=['tok',!c.alive&&'dead',danger&&'danger',warn&&'warn',targetable&&'targetable',ctx.selected&&!targetable&&'muted'].filter(Boolean).join(' ');
 const stat=(key,n,suffix='')=>`<span class="st ${key}${n?'':' zero'}">${icon(key==='g'?'heart':key==='p'?'unrest':'intrigue')}<b>${n}</b>${suffix}</span>`;
 return `<button type="button" class="${cls}" data-character="${c.id}" title="${esc(title)}">
  <span class="tok-art"><img src="/${d.portrait}" alt="" loading="lazy" draggable="false"></span>
  <span class="tok-tags">${role?`<span class="tag role ${knownRole?'known':'secret'}">${esc(name(role))}</span>`:''}${culpritDays.map(day=>`<span class="tag culprit" title="第 ${day} 日事件的犯人">犯·D${day}</span>`).join('')}${c.guard?`<span class="tag guard" title="护卫">${icon('shield')}${c.guard}</span>`:''}</span>
  <span class="tok-cards">${cardsOn(v,c.id)}</span>
  ${preview?`<span class="tok-preview">${esc(preview)}</span>`:''}
  ${c.alive?'':`<span class="tok-dead">${icon('skull')}死亡</span>`}
  <span class="tok-body"><strong>${esc(label)}</strong>
   <span class="pips" aria-label="不安 ${c.paranoia}，临界 ${limit}">${pips}</span>
   <span class="tok-stats">${stat('g',c.goodwill)}${stat('p',c.paranoia,`<small>/${limit}</small>`)}${stat('i',c.intrigue)}</span>
  </span>
 </button>`;
}

function zone(v,loc,ctx){
 const people=Object.values(v.board).filter(c=>c.present&&c.location===loc.id),n=v.locations[loc.id];
 const targetable=ctx.targets?.has(loc.id),preview=targetable?cardPreview(ctx.selected,loc.id,v):'';
 // Rows the cast is laid out in, for a wide zone (desktop) and a narrow one (phone); the CSS sizes tokens to fit.
 const count=people.length,wideRows=count<=5?1:count<=10?2:3,narrowRows=count<=2?1:count<=6?2:count<=9?3:4;
 const fit=`--wr:${wideRows};--wc:${Math.max(1,Math.ceil(count/wideRows))};--tr:${narrowRows};--tc:${Math.max(1,Math.ceil(count/narrowRows))}`;
 return `<section class="zone zone-${loc.id}${targetable?' targetable':''}${preview==='佯动'?' bluff':''}" data-zone="${loc.id}" data-mark="${ZONES[loc.id].mark}">
  <header class="zone-head">
   <button type="button" class="zone-name" data-target="${loc.id}" aria-label="地点 ${esc(loc.name_zh)}，暗跃 ${n}">${esc(loc.name_zh)}<small>${ZONES[loc.id].latin}</small></button>
   <span class="zone-cards">${cardsOn(v,loc.id)}</span>
   ${preview?`<span class="zone-preview">${esc(preview)}</span>`:''}
   <span class="zone-intrigue${n?' has':''}" title="地点暗跃 ${n}">${icon('intrigue')}<b>${n}</b></span>
  </header>
  <div class="zone-cast${Math.ceil(count/narrowRows)>=3?' dense':''}" style="${fit}">${people.map(c=>token(v,c,ctx)).join('')||'<span class="zone-empty">无人在此</span>'}</div>
 </section>`;
}

// ctx: {selected, targets:Set<string>} when the viewer is choosing where to put a card.
export function boardHtml(v,ctx={}){
 const absent=Object.values(v.board).filter(c=>!c.present);
 return `<div class="board${ctx.selected?' choosing':''}">${cat().locations.map(loc=>zone(v,loc,ctx)).join('')}
  ${absent.length?`<div class="board-absent" title="尚未到场的人物">未到场：${absent.map(c=>esc(name(c.id))).join('、')}</div>`:''}
 </div>`;
}

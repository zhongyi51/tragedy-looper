import {esc,icon,iconBtn} from '../html.mjs';
import {name} from '../lookup.mjs';

const STEPS=[['mm_cards','剧作家出牌'],['hero_cards','主人公出牌'],['cultist','翻牌结算'],['mm_ability','剧作家能力'],['hero_ability','主人公能力'],['incident','事件'],['end','日结束']];
const STEP_OF={end_area:'end',refusal:'hero_ability',reveal_plot:'hero_ability',setup:'mm_cards'};

export function stepper(v){
 const current=STEP_OF[v.phaseId]||v.phaseId,at=STEPS.findIndex(([id])=>id===current);
 if(at<0)return `<div class="stepper special"><span>${esc(v.phase)}</span></div>`;
 return `<ol class="stepper" aria-label="当日流程">${STEPS.map(([,label],i)=>`<li class="${i<at?'done':i===at?'current':''}"${i===at?' aria-current="step"':''}><span>${label}</span></li>`).join('')}</ol>`;
}

const viewLabel=v=>v.mode==='mastermind'?'剧作家':v.seat==='public'?'观战':'主人公';

function tracks(v){
 const loops=Array.from({length:v.script.loops},(_,i)=>`<i class="${i+1<v.loop?'past':i+1===v.loop?'now':''}">${i+1}</i>`).join('');
 const days=Array.from({length:v.script.days},(_,i)=>{
  const day=i+1,event=v.script.incidents.find(e=>e.day===day),happened=v.occurred?.includes(day);
  const what=event?(event.type?name(event.type):'有事件')+(happened?'（已发生）':day<v.day?'（未发生）':''):'';
  return `<i class="${day<v.day?'past':day===v.day?'now':''}${event?' event':''}${happened?' happened':''}" title="第 ${day} 日${what?' · '+esc(what):''}">${day}</i>`;
 }).join('');
 return `<div class="track loops" title="第 ${v.loop} 轮回，共 ${v.script.loops} 轮回"><span>轮回</span>${loops}</div>
  <div class="track days" title="第 ${v.day} 日，共 ${v.script.days} 日；红点表示当天有事件"><span>日期</span>${days}</div>
  <div class="leader" title="今天的领导者：主人公 ${esc(v.leader)}">${icon('crown')}<b>${esc(v.leader)}</b></div>`;
}

// ctx: {autoPlay, readOnly}
export function hudHtml(v,ctx={}){
 const tools=ctx.readOnly?'':`<div class="hud-tools">
   ${v.winner?'':`<label class="switch" title="对手自动行动"><input type="checkbox" id="autoplay"${ctx.autoPlay?' checked':''}><span class="switch-track"></span><span class="switch-label">对手自动</span></label>`}
   ${iconBtn('help','guide','怎么玩')}${iconBtn('download','save-replay','导出回放')}${iconBtn('plus','new','新对局')}${iconBtn('panel','toggle-side','情报与推理','side-toggle')}
  </div>`;
 return `<div class="hud">
  <div class="hud-title"><small>${esc(v.script.ruleset)} · ${ctx.readOnly?'回放':esc(viewLabel(v))}</small><b>${esc(v.script.title)}</b></div>
  <div class="hud-tracks">${tracks(v)}</div>
  ${stepper(v)}${tools}
 </div>`;
}

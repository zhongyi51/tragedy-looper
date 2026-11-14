// Pure decisions about whose turn it is, what the prompt says and how legal actions are grouped.
import {char,name,seatName,cardLabel,PLACING,SEATS,COUNTERS} from './lookup.mjs';

export const humanTurn=v=>v.mode==='heroes'?v.turn!==null&&v.turn!=='M':v.mode==='mastermind'?v.turn==='M':false;

// The table the moment the player puts down one of their own cards, known without asking the server:
// the card has left the hand for the board and the next card to choose, if any, is on offer.
// Empty `actions` mean the turn has left the player and the server has to say what follows.
export function afterPlacing(v,{card,target}){
 const seat=v.turn,placements=[...v.placements,{seat,card,target}],hand=v.hand.map(c=>c.id===card?{...c,available:false}:c);
 const next={...v,revision:v.revision+1,placements,hand,actions:[],
  log:[...v.log,{n:v.log.length+1,loop:v.loop,day:v.day,phase:v.phaseId,type:'placed',who:target,by:seat,text:`${seat==='M'?'剧作家':seatName(seat)+' '}出牌：${name(target)}`}]};
 const open=o=>o.command.target!==target;
 if(seat==='M'){if(placements.length<3)next.actions=v.actions.filter(o=>open(o)&&o.command.card!==card);return next;}
 next.hands={...v.hands,[seat]:hand};
 if(placements.length<6){
  const to=SEATS[(SEATS.indexOf(seat)+1)%3],targets=[...new Set(v.actions.filter(open).map(o=>o.command.target))];
  Object.assign(next,{turn:to,seat:to,hand:next.hands[to],actions:next.hands[to].filter(c=>c.available).flatMap(c=>targets.map(t=>({command:{type:'place',card:c.id,target:t}})))});
 }
 return next;
}

// Seat names read as a sentence subject: 「主人公 A 思考中」.
const actor=seat=>seat==='M'?'剧作家':seatName(seat)+' ';
const PROMPTS={setup:'选择手下从哪里登场。',cultist:'选择邪教徒是否无视暗跃禁止。',mm_ability:'可以使用角色能力，也可以直接结束。',hero_ability:'友好够了的人物可以使用能力，也可以直接结束。',reveal_plot:'选择公开哪一条副规则。',incident:'事件发生了，选择它的结果。',end_area:'选择大人物按哪个地点结算。',end:'可以使用日结束能力，也可以直接结束这一天。'};
const WORKING={sync:'同步中',animation:'结算中',rules:'结算中',human:'提交中'};

// ctx: {working, requestKind, syncRequired, actionError, auto, selected}
export function turnGuidance(v,ctx={},readOnly=false){
 if(v.winner&&!ctx.working)return {title:'对局结束',detail:'可以查看真相，或回放整局。',kind:'finished'};
 if(readOnly)return {title:v.phase,detail:'',kind:'replay'};
 if(ctx.working){
  if(ctx.requestKind==='ai')return {title:actor(v.turn)+'思考中',detail:'',kind:'ai'};
  return {title:WORKING[ctx.requestKind]||WORKING.human,detail:'',kind:ctx.requestKind||'busy'};
 }
 if(ctx.syncRequired||v.busy)return {title:v.busy?'还在处理中':'需要同步',detail:ctx.actionError||'点“同步”取回最新局面。',kind:'reconnect'};
 if(ctx.actionError)return {title:'已暂停',detail:ctx.actionError,kind:'paused'};
 if(humanTurn(v)){
  if(v.phaseId==='between')return {title:'轮回失败',detail:'先整理线索，再开始下一个轮回。',kind:'human'};
  if(v.phaseId==='guess')return {title:'最后的战斗',detail:'说出每个人物的角色，错一个就输。',kind:'human'};
  if(PLACING.includes(v.phaseId))return ctx.selected
   ?{title:'选择目标',detail:cardLabel(ctx.selected)+'：点亮起的人物或地点。',kind:'human'}
   :{title:'轮到你出牌',detail:seatName(v.turn)+'：先选一张牌，再点目标。',kind:'human'};
  if(v.phaseId==='refusal'){
   const request=v.pending?.action,ability=request&&char(request.actor)?.abilities[request.index];
   return {title:'同意还是拒绝？',detail:ability?`${name(request.actor)}：${ability.effect_zh}${request.target?'目标：'+name(request.target)+'。':''}`:'',kind:'human'};
  }
  const idle=v.actions?.length===1&&v.actions[0].command.type==='pass';
  return {title:'轮到你',detail:idle?'现在没有能用的能力，点“结束阶段”继续。':PROMPTS[v.phaseId]||seatName(v.turn)+' · '+v.phase,kind:'human'};
 }
 if(ctx.auto)return {title:actor(v.turn)+'行动中',detail:'',kind:'ai'};
 return {title:'对手回合',detail:'点“继续”，让'+actor(v.turn)+'行动。',kind:'ai-ready'};
}

// The single primary control beside the prompt, or null when the board/hand is the control.
export function turnControl(v,ctx={}){
 if(v.winner)return null;
 if(ctx.syncRequired||v.busy)return {action:'sync-state',label:ctx.working?'同步中…':'同步',disabled:Boolean(ctx.working)};
 if(!humanTurn(v))return {action:'auto',label:ctx.auto?'暂停':ctx.working?'处理中…':'继续',disabled:Boolean(ctx.working&&!ctx.auto),icon:ctx.auto?'pause':'play'};
 if(PLACING.includes(v.phaseId))return ctx.selected?{action:'clear-selection',label:'取消',quiet:true,disabled:Boolean(ctx.working)}:null;
 if(v.actions?.length===1&&!['between','guess'].includes(v.phaseId))return {action:'execute-first',label:v.actions[0].command.type==='pass'?'结束阶段':'下一步',disabled:Boolean(ctx.working)};
 return null;
}

export function optionText(o){
 const a=o.command,parts=[];
 if(a.target)parts.push(name(a.target));
 if(a.to)parts.push('→ '+name(a.to));
 if(a.counter)parts.push(COUNTERS[a.counter]?.label||a.counter);
 if(a.amount)parts.push('不安 '+(a.amount>0?'+1':'−1'));
 if(a.day)parts.push('第 '+a.day+' 日');
 if(a.card)parts.push('收回 '+cardLabel(a.card));
 return parts.join(' ')||o.label;
}

// Groups legal non-placement actions by the thing that offers them (an ability, a character to accuse…).
// sheet: the deduction sheet's analysis, used to mark the player's own picks in the final battle.
export function choiceGroups(v,sheet){
 const groups=new Map();
 const add=(key,title,detail,item,actor='')=>{if(!groups.has(key))groups.set(key,{title,detail,actor,items:[]});groups.get(key).items.push(item);};
 v.actions.forEach((o,i)=>{
  const a=o.command,item={i,o};
  if(a.type==='pass')return;
  if(a.type==='goodwill'){
   const ability=char(a.actor).abilities[a.index];
   add(a.actor+a.index,`${name(a.actor)} · 能力 ${a.index+1}`,`需要友好 ${ability.minGoodwill} · ${ability.limit==='loop'?'每轮回一次':'每天一次'} · ${ability.effect_zh}`,{...item,text:optionText(o)||'使用',hl:a.target||a.actor},a.actor);
  }else if(a.type==='mm')add(a.actor+a.ability,o.label.split(' → ')[0],'',{...item,text:optionText(o),hl:a.target},char(a.actor)?a.actor:'');
  else if(a.type==='guess'){
   const known=v.knownRoles[a.character],mine=sheet?.rows.find(r=>r.id===a.character),mark=mine?.cells[a.role]?.mark,picked=mine?.pick;
   add(a.character,name(a.character),known?'已确认：'+name(known):picked?'你的推理：'+name(picked):'',
    {...item,text:name(a.role)+(known===a.role?' ✓':''),hl:a.character,cls:known===a.role?'known':known?'':mark==='yes'?'picked':mark==='no'?'ruled':''},a.character);
  }else if(a.type==='refusal'){
   const actor=v.pending?.action?.actor||'';
   add('refusal',actor?'主人公想用'+name(actor)+'的能力':'主人公想用能力','',{...item,text:o.label,hl:actor},actor);
  }else if(a.type==='incident')add('incident',v.choiceTitle||'选择事件的结果','',{...item,text:o.label,hl:a.target});
  else add(a.type,'','',{...item,text:o.label,hl:a.target||a.actor});
 });
 return [...groups.values()];
}

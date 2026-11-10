// Pure decisions about whose turn it is, what the prompt says and how legal actions are grouped.
import {char,name,seatName,cardLabel,PLACING,COUNTERS} from './lookup.mjs';

export const humanTurn=v=>v.mode==='heroes'?v.turn!==null&&v.turn!=='M':v.mode==='mastermind'?v.turn==='M':false;

const WORKING={
 sync:['正在同步局面','只读取最新状态，不会重复发送行动。'],
 animation:['规则自动结算','正在展示翻牌、移动与计数变化。'],
 rules:['正在进行规则结算','正在保存结果并更新棋盘，请稍候。'],
 human:['正在处理你的行动','正在保存结果并更新棋盘，请稍候。']
};

// ctx: {working, requestKind, syncRequired, actionError, auto, selected}
export function turnGuidance(v,ctx={},readOnly=false){
 if(v.winner&&!ctx.working)return {title:'对局已结束',detail:'这条时间线已经归档。查看真相，或回放每一步验证推理。',kind:'finished'};
 if(readOnly)return {title:v.phase,detail:'拖动时间线，查看当时已经公开的事实。',kind:'replay'};
 if(ctx.working){
  if(ctx.requestKind==='ai')return {title:seatName(v.turn)+'正在思考',detail:'对手正在从合法选项中作出决定，你可以随时暂停。',kind:'ai'};
  const [title,detail]=WORKING[ctx.requestKind]||WORKING.human;
  return {title,detail,kind:ctx.requestKind||'busy'};
 }
 if(ctx.syncRequired||v.busy)return {title:v.busy?'这一步仍在处理中':'先核对当前局面',detail:ctx.actionError||'请先同步已保存的状态，再决定下一步。',kind:'reconnect'};
 if(ctx.actionError)return {title:'当前行动已暂停',detail:ctx.actionError,kind:'paused'};
 if(humanTurn(v)){
  if(v.phaseId==='between')return {title:'轮回失败 · 时之狭间',detail:'时间倒流回第一天。整理线索与已确认的角色，然后开始下一轮回。',kind:'human'};
  if(v.phaseId==='guess')return {title:'最后的战斗',detail:'逐一指认每个人物的角色。只要错一次，剧作家就赢了。',kind:'human'};
  if(PLACING.includes(v.phaseId))return ctx.selected
   ?{title:'选择盖牌目标',detail:cardLabel(ctx.selected)+' 已选中。点击棋盘上高亮的人物或地点，再点一次手牌可取消。',kind:'human'}
   :{title:'轮到你盖牌',detail:seatName(v.turn)+' · 选一张手牌，再点击棋盘上的目标。盖放后不能撤回。',kind:'human'};
  if(v.phaseId==='refusal'){
   const request=v.pending?.action,ability=request&&char(request.actor)?.abilities[request.index];
   return {title:'主人公请求友好能力',detail:ability?`${name(request.actor)} · ${ability.effect_zh}${request.target?'（目标：'+name(request.target)+'）':''}　该人物的角色决定你能否拒绝。`:'该人物的角色决定你能否拒绝。',kind:'human'};
  }
  return {title:'轮到你作出选择',detail:v.phaseId==='cultist'?'六张牌已揭示，请选择结算方式。':seatName(v.turn)+' · '+v.phase+'，从选项中决定下一步。',kind:'human'};
 }
 if(ctx.auto)return {title:seatName(v.turn)+'正在行动',detail:'对手会自动行动到你的回合，可以随时暂停。',kind:'ai'};
 return {title:'等待你启动 AI',detail:seatName(v.turn)+'的行动已就绪。强制效果自动结算，需要选择时才调用 AI。',kind:'ai-ready'};
}

// The single primary control beside the prompt, or null when the board/hand is the control.
export function turnControl(v,ctx={}){
 if(v.winner)return null;
 if(ctx.syncRequired||v.busy)return {action:'sync-state',label:ctx.working?'同步中…':'同步局面',disabled:Boolean(ctx.working)};
 if(!humanTurn(v))return {action:'auto',label:ctx.auto?'暂停对手':ctx.working?'处理中…':ctx.actionError?'继续当前局面':'让 AI 继续',disabled:Boolean(ctx.working&&!ctx.auto),icon:ctx.auto?'pause':'play'};
 if(PLACING.includes(v.phaseId))return ctx.selected?{action:'clear-selection',label:'取消选牌',quiet:true,disabled:Boolean(ctx.working)}:null;
 if(v.actions?.length===1&&!['between','guess'].includes(v.phaseId))return {action:'execute-first',label:v.actions[0].command.type==='pass'?'结束当前阶段':'执行下一步',disabled:Boolean(ctx.working)};
 return null;
}

export function optionText(o){
 const a=o.command,parts=[];
 if(a.target)parts.push(name(a.target));
 if(a.to)parts.push('→ '+name(a.to));
 if(a.counter)parts.push(COUNTERS[a.counter]?.label||a.counter);
 if(a.amount)parts.push('不安'+(a.amount>0?'+1':'−1'));
 if(a.day)parts.push('第 '+a.day+' 日');
 if(a.card)parts.push('收回 '+cardLabel(a.card));
 return parts.join(' ')||o.label;
}

// Groups legal non-placement actions by the thing that offers them (an ability, a character to accuse…).
export function choiceGroups(v){
 const groups=new Map();
 const add=(key,title,detail,item,actor='')=>{if(!groups.has(key))groups.set(key,{title,detail,actor,items:[]});groups.get(key).items.push(item);};
 v.actions.forEach((o,i)=>{
  const a=o.command,item={i,o};
  if(a.type==='pass')return;
  if(a.type==='goodwill'){
   const ability=char(a.actor).abilities[a.index];
   add(a.actor+a.index,`${name(a.actor)} · 能力 ${a.index+1}`,`友好≥${ability.minGoodwill} · ${ability.limit==='loop'?'每轮回一次':'每天一次'} · ${ability.effect_zh}`,{...item,text:optionText(o)||'使用',hl:a.target||a.actor},a.actor);
  }else if(a.type==='mm')add(a.actor+a.ability,o.label.split(' → ')[0],'',{...item,text:optionText(o),hl:a.target},char(a.actor)?a.actor:'');
  else if(a.type==='guess'){
   const known=v.knownRoles[a.character];
   add(a.character,name(a.character),known?'已确认：'+name(known):'',{...item,text:name(a.role)+(known===a.role?' ✓':''),hl:a.character,cls:known===a.role?'known':''},a.character);
  }else if(a.type==='refusal'){
   const actor=v.pending?.action?.actor||'';
   add('refusal',actor?name(actor)+' · 友好能力请求':'友好能力请求','',{...item,text:o.label,hl:actor},actor);
  }else if(a.type==='incident')add('incident',v.choiceTitle||'选择事件效果','',{...item,text:o.label,hl:a.target});
  else add(a.type,'','',{...item,text:o.label,hl:a.target||a.actor});
 });
 return [...groups.values()];
}

// Server-only design references. Model prose is never used as a rules authority.
import {catalog,chars,roles,plots,incidents,name,validateScript} from './content.mjs';

export const DESIGN_VERSION='catalog-design-1';
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fields=['focus','threats','counterplay','clues','loopFacts'];
const sectionFields=['threats','counterplay','clues','loopFacts'];
const fail=(message,code='DESIGN_SELECTION')=>{throw Object.assign(Error(message),{code});};
const countText=count=>typeof count==='number'?String(count):`${count.min}–${count.max}`;
const informationAbility=(id,index)=>({shrine_maiden:[1],police:[0],office_worker:[0],informer:[0],irregular:[0],godly_being:[0],boss:[0],forensic:[1],teacher:[1]})[id]?.includes(index)===true;
const roleInfo=role=>['friend','ninja'].includes(role);
const abilityWindow=(script,id,ability)=>{
 const minLoop=Math.max(ability.minLoop||1,id==='godly_being'?script.settings.godlyLoop:1);
 const day=id==='transfer_student'?script.settings.transferDay:1;
 return `${minLoop>1?`第 ${minLoop} 轮回起，`:''}${day>1?`第 ${day} 日登场后，`:''}友好至少 ${ability.minGoodwill}，${ability.limit==='loop'?'每轮回一次':'每天一次'}，主人公能力阶段`;
};
function inspect(script){
 const validation=validateScript(script);
 if(validation.errors.length)fail('设计引用只接受合法剧本：'+validation.errors.slice(0,3).map(error=>error.path+'：'+error.message).join('；'),'INVALID_SCRIPT_DESIGN');
}

export function designOptions(script){
 inspect(script);
 const facts=[],selected=[script.mainPlot,...script.subPlots],has=id=>script.characters.includes(id);
 const add=(id,kind,text,sections,extra={})=>facts.push({id,kind,text,sections,...extra});
 for(const id of selected){
  const plot=plots[id],added=Object.entries(plot.addedRoles).map(([role,count])=>`${name(role)} ${countText(count)}`).join('、');
  const bindings=Object.keys(plot.addedRoles).map(role=>`${name(role)}＝${script.characters.filter(character=>script.roles[character]===role).map(name).join('、')||'本稿未配役'}`).join('；');
  add(`plot:${id}`,'plot',`规则 ${plot.kind}「${name(id)}」：${plot.effect_zh||`本规则引入配役：${added}；效果由这些角色的能力决定。`}${bindings?` 本稿初始配役：${bindings}。`:''}`,['threats',...( /轮回开始/.test(plot.effect_zh)?['loopFacts']:[])],{plot:id});
 }
 for(const id of script.characters){
  const role=script.roles[id],def=roles[role],introducedBy=selected.filter(plot=>Object.hasOwn(plots[plot].addedRoles,role));
  if(def.effects_zh.length)add(`role:${id}`,'role',`${name(id)}的初始角色为${name(role)}：${def.effects_zh.join(' ')}`,['threats',...(roleInfo(role)?['clues']:[])],{character:id,role,refusal:def.goodwillRefusal,introducedBy});
  for(const [index,ability] of chars[id].abilities.entries()){
   const refusal=ability.cannotRefuse?'none':def.goodwillRefusal;
   const noStudentTarget=(ability.target==='other_student_same_location'&&!script.characters.some(other=>other!==id&&chars[other].tags.includes('student')))||(id==='teacher'&&!script.characters.some(other=>chars[other].tags.includes('student')));
   const unavailable=refusal==='mandatory'?'初始角色必须拒绝此能力':id==='doctor'&&index===1&&!has('patient')?'本稿没有住院患者，不能据此安排解放路线':(ability.minLoop||1)>script.loops?'本稿没有足够轮回来使用此能力':noStudentTarget?'本稿没有符合该能力条件的学生目标':null;
   const refusalText=unavailable?`本稿限制：${unavailable}。`:ability.cannotRefuse?'此能力不能被拒绝。':refusal==='optional'?'初始角色可以拒绝，此能力不能视为保证成功的反制。':'初始角色没有友好拒绝。';
   add(`ability:${id}:${index}`,'ability',`${name(id)}：${abilityWindow(script,id,ability)}。${ability.effect_zh} ${refusalText}`,
    unavailable?[]:['counterplay',...(informationAbility(id,index)?['clues']:[])],
    {character:id,role,minGoodwill:ability.minGoodwill,limit:ability.limit,timing:ability.timing,target:ability.target,refusal,...(unavailable?{unavailable}:{})});
  }
  if(id==='doctor'&&def.goodwillRefusal!=='none')add('doctor:mastermind','ability',`医生的初始角色为${name(role)}，${def.goodwillRefusal==='mandatory'?'必须拒绝':'可以拒绝'}友好能力；医生友好达到 2 时，剧作家可在自己的能力阶段令同地点另一个人物不安 +1 或 −1，每天一次。这不是主人公可保证使用的能力。`,['threats'],{character:id,role,refusal:def.goodwillRefusal});
 }
 for(const [index,event] of script.incidents.entries()){
  const publicType=event.type==='fake_incident'?event.publicType??event.type:event.type;
  add(`incident:${index}`,'incident',`第 ${event.day} 日公开为「${name(publicType)}」，实际为「${name(event.type)}」，犯人为${name(event.culprit)}。实际效果：${incidents[event.type].effect_zh}${event.culprit==='black_cat'?'本稿犯人为黑猫，实际发生也没有事件效果。':''}`,['threats'],{day:event.day,type:event.type,publicType,culprit:event.culprit});
 }
 add('public:schedule','information',script.incidents.length?`公开日程：${script.incidents.map(event=>`第 ${event.day} 日${name(event.type==='fake_incident'?event.publicType??event.type:event.type)}`).join('、')}。公开名称与日期不会自动揭露犯人或配役；明确揭露信息的事件另按事件效果结算。`:'本稿没有排定事件；可观察线索须来自能力、行动与结算记录。',['clues']);
 const finalGuess=catalog.sets.find(set=>set.id===script.ruleset).finalGuess;
 add('rule:victory','rule',finalGuess?'主人公活过任一轮回即可获胜；也可进入最后的战斗，逐一正确指认全部人物角色。首次指认错误即失败；查明部分真相本身不算获胜。':'FS 没有最后的战斗；主人公必须平安活过至少一个轮回。知道角色或查明真相本身不会获胜。',['loopFacts','clues']);
 add('rule:reset','rule','每轮回开始时重置位置、计数与轮回内使用次数，再处理实际规则及角色的轮回开始效果。不能假设上一轮的友好直接保留。',['loopFacts']);
 if(script.subPlots.includes('threads_fate'))add('rule:threads-fate','rule','因果之线记录上一轮结束时哪些人物有友好，并令这些人物在新轮回不安 +2；它不继承友好计数。',['loopFacts']);
 if(script.ruleset==='MZ'){
  add('rule:mz-disclosure','rule','MZ 中角色宣告可能受到忍者伪装影响；若发生 EX 转役，应按当时角色核对能力与友好拒绝，初始配役不能替代当前状态。',['clues','loopFacts']);
  if(script.mainPlot==='fated_connections'||script.subPlots.includes('dice_of_gods'))add('rule:mz-ex','rule',`从第二轮回起，EX 候选来自上一轮结束时已死亡、且本轮可登场的人物；由剧作家从中选择一名，不是将所有死者转换。${script.mainPlot==='fated_connections'?'本稿因果之绊令带 EX 者变为关键人物并失去原角色。':'本稿诸神之骰不自行改变带 EX 者的角色。'}首轮没有上轮死者可供这个选择。`,['loopFacts']);
 }
 if(script.ruleset==='MC')for(const [index,text] of catalog.sets.find(set=>set.id==='MC').extraRules_zh.entries())add(`rule:mc-ex:${index}`,'rule',text,['loopFacts']);
 if(has('ai_character')){
  add('rule:ai-simulation','rule','人工智能友好能力只模拟所选日程事件的效果，不作该事件的发生检查，不算实际事件发生，也不会仅因模拟而增加 MC 的 EX；伪装事件按公开名称对应的效果模拟。身上全部计数视为不安的特性只用于它担任真实事件犯人的发生判断。',['clues','loopFacts']);
 }
 for(const card of catalog.actionDeckEntries.filter(card=>card.side==='protagonist')){
  add(`card:${card.actionType}`,'card',`主人公行动牌「${card.name_zh}」：每人每手牌 ${card.copiesPerHand} 张，${card.oncePerLoop?'每轮回一次':'可每日使用'}。实际目标、禁止与抵消须按局面合法选项核对。`,['counterplay'],{actionType:card.actionType,oncePerLoop:card.oncePerLoop});
 }
 const focuses=[{id:'survival',label:'人物安全与轮回生存'},{id:'information',label:'公开证据与身份辨别'}];
 if(script.incidents.length)focuses.push({id:'incident_timing',label:'事件日期与发生条件'});
 if(selected.some(id=>/地点|神社|学校|都市|医院/.test(plots[id].effect_zh))||Object.values(script.roles).includes('brain'))focuses.push({id:'location_pressure',label:'位置与地点计数'});
 if(script.ruleset==='MC'||script.ruleset==='MZ'&&(script.mainPlot==='fated_connections'||script.subPlots.includes('dice_of_gods')))focuses.push({id:'ex_state',label:'EX 与轮回状态变化'});
 return {version:DESIGN_VERSION,focuses,facts,selectionSchema:{focus:focuses.map(focus=>focus.id),threats:'1–4 个 sections 含 threats 的事实 ID',counterplay:'1–4 个 sections 含 counterplay 的事实 ID',clues:'1–4 个 sections 含 clues 的事实 ID',loopFacts:'0–3 个 sections 含 loopFacts 的事实 ID'}};
}

export function compileDesign(script,selection,{difficulty=script.difficulty??'standard'}={}){
 const options=designOptions(script),byId=new Map(options.facts.map(fact=>[fact.id,fact]));
 if(!['beginner','standard','hard'].includes(difficulty))fail('设计难度无效');
 if(selection===undefined)selection={focus:options.focuses[0].id,...Object.fromEntries(sectionFields.map(section=>[section,options.facts.filter(fact=>fact.sections.includes(section)).slice(0,section==='loopFacts'?2:3).map(fact=>fact.id)]))};
 if(!record(selection)||Object.keys(selection).some(key=>!fields.includes(key)))fail('设计只能选择已提供的重点和事实 ID，不能附加自由规则说明');
 const focus=options.focuses.find(focus=>focus.id===selection.focus);
 if(!focus)fail('设计重点不属于本稿提供的选项');
 for(const section of sectionFields){
  const ids=selection[section],max=section==='loopFacts'?3:4,min=section==='loopFacts'?0:1;
  if(!Array.isArray(ids)||ids.length<min||ids.length>max||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!byId.get(id)?.sections.includes(section)))fail(`${section} 必须选择本稿该章节中的 ${min}–${max} 个不重复事实 ID`);
 }
 const text=(ids)=>ids.map(id=>byId.get(id).text).join('\n');
 const mandatoryPlots=[script.mainPlot,...script.subPlots].map(id=>`plot:${id}`);
 const mandatoryLoops=['rule:victory','rule:reset',...(script.subPlots.includes('threads_fate')?['rule:threads-fate']:[]),...(byId.has('rule:mz-ex')?['rule:mz-ex']:[]),...(byId.has('rule:ai-simulation')?['rule:ai-simulation']:[])];
 const selected=structuredClone(selection);
 return {design:{
  premise:`以${focus.label}为观察重点。本稿包含 ${script.characters.length} 位人物、每轮回 ${script.days} 天、最多 ${script.loops} 轮回。以下内容由实际配役与规则目录生成，是需要结合局面检验的设计依据，不是已证明的获胜路线。`,
  threatPlan:text([...new Set([...mandatoryPlots,...selected.threats])]),
  counterplay:'以下是可核对的行动资源与能力条件；拥有这些能力不代表它们必定能阻止本稿的败北条件，仍须在实际局面中验证。\n'+text(selected.counterplay),
  cluePlan:byId.get('public:schedule').text+'\n'+text(selected.clues.filter(id=>id!=='public:schedule')),
  loopPlan:text([...new Set([...mandatoryLoops,...selected.loopFacts])]),
  intendedDifficulty:difficulty,intentionalExceptions:[]
 },grounding:{version:DESIGN_VERSION,selection:selected}};
}

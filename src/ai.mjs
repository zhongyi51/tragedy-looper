import {catalog} from './content.mjs';
import {rulesForPrompt,gameRulesPrefix} from './game-prompt.mjs';
import {view,legalActions,sameCommand,VISIBILITY_POLICY,automaticCommand,strategicBriefing,applyCommand,turn,botPlan,tacticalOptions,publicRuleBeliefs,publicUrgency,strategyPlans} from './engine.mjs';
import {requestJson,AiError,modelFor,providerLabel} from './model-provider.mjs';
export {configureKey,configured,model,rates,estimateUsage,reserveFor,requestJson,AiError,parseModelJson} from './model-provider.mjs';
export {generateWithAi,polishWithAi} from './author.mjs';

export const AI_MEMORY_VERSION=1;
export const AI_DECISION_VERSION='decision-6';
const aiSeats=['A','B','C'];
const aiRecord=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const aiText=(value,max)=>typeof value==='string'&&value.length<=max;
const aiTexts=(value,count,max)=>Array.isArray(value)&&value.length<=count&&value.every(x=>aiText(x,max));
const aiEmptyMemory=()=>({hypotheses:[],goals:[],questions:[]});

// Kept as a public inspection API; neither the seat nor the secret script may
// prune alternatives. The immutable dictionary is reused instead of rebuilt.
export function rulesForDecision(s,_seat='public'){return rulesForPrompt(s.script.ruleset);}

const DECISION_PROTOCOL=`【决策协议】你负责当前 seat 的一次选择。当前状况完整提供在 observation（剧本、盘面、阶段、资源、已揭示信息与合法 actions），visibleHistory 是截至现在本席可见的完整日志；secret 仅可能授予剧作家。
【当前阶段检查】先读取 phaseId、turn、loop/day、日程与剩余资源，再判断行动能影响哪一个尚未结算的时点。盖牌比较共同作用后的局面及对手常见反制；初始三张尚未盖放时优先用 choices 选完整协同三牌。剧作家能力按计数改变前后→事件触发值与临界→EX→轮回末条件核对。能力/事件比较全部目标、放弃与提前结束的实际收益。最后的战斗联合核对所有未猜人物、角色配额及公开证据，不能对未知者统一猜普通人。
【局势简报与参考】urgency 提供公开日程、剩余出牌机会和有条件的即时风险，不证明隐藏身份。briefing、suggestion、tacticalOptions 是启发式提示，可能漏算，不是规则裁定或必胜证明。ruleBeliefs 是公开约束的候选筛选，不是秘密答案或概率；contradiction 时不得采信其排除结果。strategyPlans 只模拟列出的少数应对，不能代表全部反制；先核对事实与规则，再比较计划，不要因 suggestion 忽略可获胜能力或救命动作。
【证据与记忆】observation.evidence 是从公开记录提取的事实/宣告。privateNote、privateMemory 和讨论里的旧计划都不是规则事实；先按当前位置、计数、日程和可用资源复核，再决定延续或改换目标。新证据矛盾时修正或丢弃旧假说，不把自己的未揭牌面写进共享假说；剧作家记忆绝不与主人公共享。permittedDiscussion 只包含讨论设置允许共享的结构化笔记；仅轮回间讨论时，本轮新私有笔记不共享。
【候选编码】observation.actions 中的盖牌候选用三元组 [choice,card,target] 表示，对应 command={type:"place",card,target}；choice 仍是原候选编号，牌与人物/地点名称、效果见完整词典。地点只有暗跃及暗跃禁止有效，其余牌均是合法无效果佯动。非盖牌候选保留完整对象。两种表示的选择方式相同，不得把三元组误当成要输出的 choices。
【输出】只返回短 JSON：{"choice":0,"reason":"不超过100字的行动依据"}。choice 是 observation.actions 的整数编号，从0开始；observation.batch 存在时可用 "choices":[a,b,c] 替代 choice，牌和目标均须不同且按顺序全部合法。先完成选择，再简述其对本方胜负的作用；不要返回 command、自造候选或思维链。memory 非必填；没有新增证据或目标时省略 memory 和 note。必要时 memory 为 {"hypotheses":[],"goals":[],"questions":[]}：hypotheses 最多8条，每条 {"claim":"最多160字","evidence":[公开日志编号],"confidence":"low|medium|high"}，evidence 最多8个，必须引用 visibleHistory 已有 n；无证据时 evidence 可空但 confidence 必须 low。goals 最多3条、questions 最多4条，每条最多160字。
【修复协议】仅当后续消息明确标记 repairMode="compiled-plan" 并提供顶层 plans 时，上一段 choice/choices 输出协议由计划选择协议取代：只返回 {"plan":0,"reason":"不超过100字的依据"}，plan 为所给完整合法方案编号。其余正常请求不得返回 plan。`;
const decisionSystems=new Map();
function aiSystem(s){
 const set=s.script.ruleset;
 if(!decisionSystems.has(set))decisionSystems.set(set,`${gameRulesPrefix(set)}\n${DECISION_PROTOCOL}`);
 return decisionSystems.get(set);
}

function aiValidMemory(data,visibleHistory){
 if(!aiRecord(data)||Object.keys(data).some(k=>!['hypotheses','goals','questions'].includes(k)))return false;
 if(!Array.isArray(data.hypotheses)||data.hypotheses.length>8||!aiTexts(data.goals,3,160)||!aiTexts(data.questions,4,160))return false;
 const refs=new Set(visibleHistory.map(e=>e.n));
 return data.hypotheses.every(h=>aiRecord(h)&&Object.keys(h).every(k=>['claim','evidence','confidence'].includes(k))&&aiText(h.claim,160)&&Array.isArray(h.evidence)&&h.evidence.length<=8&&h.evidence.every(n=>Number.isInteger(n)&&refs.has(n))&&['low','medium','high'].includes(h.confidence)&&(h.evidence.length>0||h.confidence==='low'));
}
function aiStoredMemory(s,seat,visibleHistory){
 const saved=s.aiMemory?.[seat];
 if(saved?.version!==AI_MEMORY_VERSION||saved.policy!==VISIBILITY_POLICY||!aiValidMemory(saved.data,visibleHistory))return null;
 return structuredClone(saved);
}
function aiDiscussion(s,seat,visibleHistory){
 if(seat==='M'||s.visibilityPolicy!==VISIBILITY_POLICY)return null;
 const anytime=s.script.communication==='allowed_during_loop';
 const participants={};
 // A frozen start-of-loop discussion survives other seats replacing their own
 // notes during this loop. Only structured hypotheses are shared, never notes.
 for(const member of Object.values(s.heroDiscussion?.participants||{})){
  if(!aiSeats.includes(member.seat)||member.version!==AI_MEMORY_VERSION||member.policy!==VISIBILITY_POLICY||member.loop>=s.loop||!aiValidMemory(member.data,visibleHistory))continue;
  participants[member.seat]=structuredClone(member);
 }
 for(const who of aiSeats){const member=aiStoredMemory(s,who,visibleHistory);if(!member||(!anytime&&member.loop>=s.loop))continue;participants[who]={...member,seat:who};}
 return {version:AI_MEMORY_VERSION,loop:s.loop,mode:anytime?'allowed_during_loop':'between_loops_only',participants};
}
function aiEvidence(v,history){
 return {roles:Object.entries(v.knownRoles||{}).map(([character,role])=>({character,role,status:v.script.ruleset==='MZ'?'declared_may_be_disguised':v.script.ruleset==='BTX'&&role==='serial_killer'?'revealed_role_may_be_transformed':'confirmed'})),
  correctGuesses:structuredClone(v.guessed||{}),
  culprits:structuredClone(v.knownCulprits||{}),plots:[...(v.knownPlots||[])],incidentTypes:structuredClone(v.knownIncidentTypes||{}),
  recentClues:history.filter(e=>['death','incident','reveal','refused','ignored','failed','victory'].includes(e.type)).slice(-18)};
}
const textFields=answer=>(answer.reason===undefined||aiText(answer.reason,240))&&(answer.note===undefined||aiText(answer.note,2400));
const validIndex=(i,actions)=>Number.isInteger(i)&&i>=0&&i<actions.length;
function chosenIndexes(answer,actions,batch,history){
 if(!aiRecord(answer)||!textFields(answer)||Object.keys(answer).some(k=>!['choice','choices','reason','note','memory'].includes(k)))return null;
 if(answer.memory!==undefined&&!aiValidMemory(answer.memory,history))return null;
 if(batch&&Array.isArray(answer.choices)&&answer.choice===undefined){const list=answer.choices;return list.length>=1&&list.length<=batch&&list.every(i=>validIndex(i,actions))&&new Set(list).size===list.length?list:null;}
 return answer.choices===undefined&&validIndex(answer.choice,actions)?[answer.choice]:null;
}
function sequentialCommands(s,seat,actions,indexes){
 const out=[];let current=s;
 for(const i of indexes){const command=actions[i].command;if(turn(current)!==seat||current.phase!==s.phase||!legalActions(current,seat).some(a=>sameCommand(a.command,command)))return null;out.push(structuredClone(command));current=applyCommand(current,seat,command);}
 return out;
}
function decisionOption(a,choice){
 if(a.command.type!=='place')return {choice,...a};
 const {target,card}=a.command,type=card.split('#')[0],location=catalog.locations.some(l=>l.id===target);
 return {choice,...a,...(location?{effectHint:['intrigue_1','intrigue_2','forbid_intrigue'].includes(type)?'地点暗跃效果':'合法佯动：地点无对应效果'}:{})};
}

// Exported for deterministic input audits; this performs no request or mutation.
export function decisionContext(s,seat,actions=legalActions(s,seat)){
 const observation=view(s,seat),visibleHistory=observation.log;delete observation.log;
 const policyCurrent=seat==='M'||s.visibilityPolicy===VISIBILITY_POLICY;
 const privateNote=policyCurrent?s.notes?.[seat]||'':'';
 const privateMemory=policyCurrent?aiStoredMemory(s,seat,visibleHistory)?.data||aiEmptyMemory():aiEmptyMemory();
 const discussion=aiDiscussion(s,seat,visibleHistory);
 const permittedDiscussion=discussion?{mode:discussion.mode,participants:Object.values(discussion.participants).filter(x=>x.seat!==seat).map(({seat,loop,day,data})=>({seat,loop,day,...data}))}:null;
 const batch=seat==='M'&&s.phase==='mm_cards'&&s.placements.length===0?3:0;
 observation.actions=actions.map(decisionOption);observation.urgency=publicUrgency(observation);observation.briefing=strategicBriefing(s,seat);observation.evidence=aiEvidence(observation,visibleHistory);
 if(seat!=='M'){
  const {candidates,...beliefs}=publicRuleBeliefs(observation);
  observation.ruleBeliefs={...beliefs,candidateCount:candidates.length,...(candidates.length<=12?{candidates}:{})};
 }
 const plan=botPlan(s,seat,batch||1).map(command=>actions.findIndex(a=>sameCommand(a.command,command))).filter(i=>i>=0);
 if(plan.length)observation.suggestion={...(batch?{choices:plan}:{choice:plan[0]}),kind:'heuristic',guaranteed:false};
 if(batch)observation.strategyPlans=strategyPlans(s,seat,3).map(({commands,...details})=>({choices:commands.map(command=>actions.findIndex(a=>sameCommand(a.command,command))),...details,kind:'bounded_simulation',guaranteed:false})).filter(plan=>plan.choices.every(i=>i>=0));
 observation.tacticalOptions=tacticalOptions(s,seat,3).map(({command,score,summary})=>({choice:actions.findIndex(a=>sameCommand(a.command,command)),score,summary,kind:'heuristic'})).filter(x=>x.choice>=0);
 if(batch)observation.batch=batch;
 const payload={observation,visibleHistory,privateNote,privateMemory,permittedDiscussion};
 // Author prose is retained in the script for review, but is not strategic
 // evidence. Both sides decide from the engine's seat-scoped facts and rules.
 // The secret is sent exactly once in its own seat-scoped message. Keeping the
 // public payload separate makes the boundary auditable without duplicating it.
 const {secret,script,...currentObservation}=observation;
 const publicObservation={script,...currentObservation,actions:observation.actions.map(action=>action.command.type==='place'?[action.choice,action.command.card,action.command.target]:action)};
 const messages=[{role:'system',content:aiSystem(s)},{role:'user',content:JSON.stringify({seat,...(seat==='M'?{secret}:{})})},{role:'user',content:JSON.stringify({visibleHistory,observation:publicObservation,privateNote,privateMemory,permittedDiscussion})}];
 return {messages,payload,batch,discussion,policyCurrent};
}

export function decisionProfile(s,actions,batch,provider='deepseek'){
 // Sol always uses low reasoning and its concise JSON decisions need a smaller
 // total output allowance. Preserve the complete input; only bound output.
 if(provider==='openrouter')return {thinking:'enabled',reasoningEffort:'low',maxTokens:2048};
 // Few targets can still require counter -> incident -> EX -> loop-end
 // reasoning. Use public timing/set facts, never a hidden protagonist answer.
 const abilityPhase=['hero_ability','ai_target','incident','mm_ability'].includes(s.phase);
 const crossPhaseRisk=abilityPhase&&(s.script.ruleset==='MC'||s.day===s.script.days||s.script.incidents.some(e=>e.day===s.day&&!s.occurred?.includes(e.day)));
 const complex=actions.length>1&&(batch>0||s.phase==='guess'||['hero_cards','mm_cards'].includes(s.phase)||crossPhaseRisk||abilityPhase&&actions.length>8);
 return complex?{thinking:'enabled',reasoningEffort:'low',maxTokens:8192}:{thinking:'disabled',maxTokens:1800};
}
function compiledPlanRepair(s,seat,actions,payload,batch,originalMessages){
 if(seat!=='M'||batch!==3||s.phase!=='mm_cards'||s.placements.length)return null;
 const plans=[];
 for(const {choices,...details}of payload.observation.strategyPlans||[]){
  if(choices.length!==3||!choices.every(i=>validIndex(i,actions)))continue;
  const commands=sequentialCommands(s,seat,actions,choices);
  if(commands?.length===3)plans.push({indexes:choices,plan:plans.length,commands,...details});
  if(plans.length===3)break;
 }
 if(!plans.length)return null;
 // Preserve the entire original input byte-for-byte, including all visible
 // evidence and current state. Only the output contract and bounded choices
 // change. The retry can reuse cached input instead of relearning a tiny game.
 const messages=[...originalMessages,{role:'user',content:`此前自由组牌没有产出可执行的完整方案；当前局面未改变。本次输出协议改为只选一个已验证合法的完整三牌方案，不拆分或改牌。仍依据完整规则、全部可见历史和当前事实比较整局胜负；observedOutcomes 只是有限应对样本，complete=false 表示未结算完，不代表必胜。只返回 JSON {"plan":0,"reason":"不超过100字的选择依据"}，plan 是 plans 中的整数编号；不要返回 choice、choices、command、memory、note 或思维链。\n${JSON.stringify({repairMode:"compiled-plan",plans:plans.map(({indexes,...plan})=>plan)})}`}];
 return {plans,messages};
}
export async function decide(s,seat,options={}){
 const actions=legalActions(s,seat);if(!actions.length)throw new AiError('NO_CHOICE','现在没有需要决定的行动');
 const revision=s.revision,phase=s.phase,policyCurrent=seat==='M'||s.visibilityPolicy===VISIBILITY_POLICY;
 const privateNote=policyCurrent?s.notes?.[seat]||'':'';
 function currentCommand(chosen){if(s.revision!==revision||s.phase!==phase||!legalActions(s,seat).some(a=>sameCommand(a.command,chosen.command)))throw new AiError('STALE_MODEL_ACTION','等模型回答的时候局面已经变了，这一步没有执行，请同步后重试。');return structuredClone(chosen.command);}
 const forced=automaticCommand(s,seat);
 if(forced){const command=currentCommand({command:forced});return {command,commands:[command],reason:'按规则自动结算。',note:privateNote,automatic:true,repairCauses:[],resetHeroMemory:!policyCurrent};}
 const {messages,payload,batch,discussion}=decisionContext(s,seat,actions),history=payload.visibleHistory;
 const format=batch?`{"choices":[整数,整数,整数],"reason":"简短理由"}，choices 是 1–${batch} 个互不相同、位于0至${actions.length-1}的候选编号`:`{"choice":整数,"reason":"简短理由"}，choice 必须为0至${actions.length-1}`;
 const requestOptions={...decisionProfile(s,actions,batch,options.provider),...options,userId:(options.userId||'local')+'_'+seat};
 const repairProfile=requestOptions.provider==='openrouter'?{thinking:'enabled',reasoningEffort:'low',maxTokens:2048}:requestOptions.thinking==='enabled'?{thinking:'enabled',reasoningEffort:'low',maxTokens:8192}:{thinking:'disabled',maxTokens:1800},repairCauses=[];
 let compiledRepair=null,directJsonRepair=false;
 for(let attempt=0;attempt<2;attempt++){
  // Malformed choices retain their bounded reasoning profile. A DeepSeek
  // reasoning-budget exhaustion is different: repeating the same thinking
  // budget can exhaust it again without returning JSON. Its sole repair uses
  // fast mode with the full unchanged game context and all legal candidates.
  let answer;try{
   const retry=attempt?(compiledRepair||directJsonRepair?{thinking:'disabled',maxTokens:1200}:repairProfile):{};
   answer=await requestJson(compiledRepair?.messages||messages,{...requestOptions,...retry});
  }catch(e){
   if(attempt===0&&['BAD_JSON','TRUNCATED'].includes(e.code)){
    repairCauses.push(e.code);compiledRepair=compiledPlanRepair(s,seat,actions,payload,batch,messages);
    directJsonRepair=!compiledRepair&&e.code==='TRUNCATED'&&requestOptions.provider!=='openrouter';
    if(!compiledRepair)messages.push({role:'user',content:`上一次输出不可解析或被截断。${directJsonRepair?'此次仅作最终候选选择：保留上文完整规则、全部可见历史、当前事实和所有合法候选，按本方整局胜负直接选出一个行动；不要再次展开长计划。':''}重新核对当前阶段与本方胜负目标，只输出短JSON对象 ${format}，reason少于100字；省略memory和note，不得输出command。`});
    continue;
   }
   throw e;
  }
  const indexes=compiledRepair?(aiRecord(answer)&&Object.keys(answer).every(k=>['plan','reason'].includes(k))&&Number.isInteger(answer.plan)&&answer.plan>=0&&answer.plan<compiledRepair.plans.length&&(answer.reason===undefined||aiText(answer.reason,100))?compiledRepair.plans[answer.plan].indexes:null):chosenIndexes(answer,actions,batch,history);
  let invalidCause='INVALID_DECISION';
  if(indexes){
   const command=currentCommand(actions[indexes[0]]),commands=sequentialCommands(s,seat,actions,indexes);
   // Validate the complete plan against each successive state. Accepting only
   // a prefix would execute a different plan from the one the model evaluated.
   if(commands)return {provider:options.provider||'deepseek',model:modelFor(options.provider||'deepseek'),modelLabel:providerLabel(options.provider||'deepseek'),command,commands,reason:answer.reason||'',note:answer.note||'',memory:answer.memory,memoryContext:{loop:s.loop,day:s.day,revision:s.revision},discussion,resetHeroMemory:!policyCurrent,repairAttempts:attempt,repairCauses,...(compiledRepair?{repairMode:'compiled-plan'}:directJsonRepair?{repairMode:'direct-json'}:{})};
   invalidCause='INVALID_BATCH';
  }
  if(attempt===0){repairCauses.push(invalidCause);if(invalidCause==='INVALID_BATCH')compiledRepair=compiledPlanRepair(s,seat,actions,payload,batch,messages);if(!compiledRepair)messages.push({role:'assistant',content:JSON.stringify(answer).slice(0,5000)},{role:'user',content:`输出结构、证据编号或候选无效。${batch?'整组计划已拒绝，没有执行任何一张；编号不同仍可能重复同一张牌或目标。choices 必须按顺序全部合法，card 与 target 均不能重复；重新规划整组三张协同的合法选择。':''}仅返回短JSON对象 ${format}；先省略memory和note。不要输出command或额外字段，reason少于100字。局面未改变，请从原候选重新选择。`});}
 }
 throw new AiError('ILLEGAL_MODEL_ACTION','模型两次都没有选出合法的行动，局面没有变化。请重试，或换成离线机器人。');
}

// Called by the adapter after a legal model action is applied. This is private
// session state; view() deliberately does not include any of these fields.
export function rememberDecision(s,seat,answer){
 if(answer.resetHeroMemory){s.aiMemory=Object.fromEntries(Object.entries(s.aiMemory||{}).filter(([who])=>who==='M'));delete s.heroDiscussion;}
 s.notes||={};if(answer.note)s.notes[seat]=answer.note;
 if(answer.memory){s.aiMemory||={};s.aiMemory[seat]={version:AI_MEMORY_VERSION,policy:VISIBILITY_POLICY,loop:answer.memoryContext?.loop??s.loop,day:answer.memoryContext?.day??s.day,revision:answer.memoryContext?.revision??s.revision,data:structuredClone(answer.memory)};}
 if(seat!=='M'&&answer.discussion)s.heroDiscussion=structuredClone(answer.discussion);
}
// Protagonist reasons are public table talk; mastermind reasons stay private.
export function decisionSummary(route,seat,answer){
 if(route==='advance')return {controller:'规则引擎'};
 if(route==='bot-step')return {controller:'练习机器人',seat};
 if(!answer)return null;
 return {controller:answer.automatic?'规则引擎':answer.modelLabel||'DeepSeek',automatic:!!answer.automatic,seat,...(seat!=='M'&&!answer.automatic&&answer.reason?{reason:answer.reason}:{})};
}

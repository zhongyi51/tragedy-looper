// These checks detect design risks, not game-theoretic balance. Detailed results
// contain hidden script facts and must stay on the server until the game ends.
import {validateScript,chars,roles,incidents} from './content.mjs';

export function evaluateScriptQuality(script,{design=script?.privateDesign}={}){
 const validation=validateScript(script),issues=[];
 const issue=(code,message,penalty=0,severity='warning')=>issues.push({code,message,severity,penalty});
 for(const error of validation.errors)issue('INVALID_SCRIPT',error.path+'：'+error.message,100,'error');
 if(validation.errors.length)return {accepted:false,score:0,issues,metrics:{structurallyValid:false},review:'static'};
 const cast=script.characters,events=script.incidents,st=script.settings||{},roleList=Object.values(script.roles);
 const presentDay=c=>c==='transfer_student'?(st.transferDay||1):1;
 const eventActive=e=>e.day>=presentDay(e.culprit);
 const active=events.filter(eventActive),inert=events.filter(e=>!eventActive(e));
 for(const e of inert)issue('CULPRIT_NOT_PRESENT',`第 ${e.day} 日事件的犯人尚未登场，所有轮回都无法发生。`,22);
 for(const e of events.filter(e=>e.culprit==='black_cat'))issue('BLACK_CAT_NO_EFFECT',`第 ${e.day} 日事件由黑猫担任犯人，没有事件效果${script.ruleset==='MC'?'，但仍可增加 EX':''}。`,script.ruleset==='MC'?4:12);
 for(const e of active.filter(e=>e.type==='suicide'&&['time_traveler','immortal','private_investigator'].includes(script.roles[e.culprit])))issue('IMMUNE_SUICIDE',`第 ${e.day} 日自杀的犯人不会因该效果死亡，需要有意图地利用这条线索。`,8);
 if(script.days<=2)issue('SHORT_DISCOVERY_WINDOW','每轮回至多两天，留给积累友好、观察与反制的时间很短。',12);
 if(script.loops===1)issue('NO_LEARNING_LOOP','只有一个轮回，无法利用失败后的跨轮回学习。',10);
 if(events.length===0)issue('NO_INCIDENTS','日程没有事件，悬念与信息主要依赖角色能力和规则。',8);
 if(events.length&&active.length===0)issue('NO_ACTIVE_INCIDENTS','全部事件都因犯人未登场而无法发生，需要重新安排日程。',28);
 if(script.subPlots.includes('showtime_death')&&cast.length<=6)issue('FORCED_FINAL_GUESS','死亡真人秀在初始人数下就满足败北条件；只能依赖最后的战斗，需要明确可推导的身份线索。',22);
 if(script.mainPlot==='black_school'&&script.loops===1)issue('FORCED_FINAL_GUESS','黑之学园的首轮必败，而本剧本只有一轮，需要明确可推导的最终战线索。',22);
 const maxGauge=active.reduce((n,e)=>n+(e.culprit==='black_cat'?1:incidents[e.type].extraGaugeIncrement??1),0)+(script.subPlots.includes('isolated_psycho')&&script.loops>1?1:0);
 if(script.mainPlot==='tightrope_plan'&&maxGauge<2)issue('FORCED_FINAL_GUESS','全部可发生事件累计仍不足 2 EX，钢丝上的计划无法通过轮回存活获胜。',22);
 const revealCharacters=new Set(['office_worker','shrine_maiden','informer','teacher','boss','forensic','police','godly_being','irregular']);
 const informationSources=cast.filter(c=>revealCharacters.has(c)&&chars[c].abilities.some(a=>a.cannotRefuse||roles[script.roles[c]]?.goodwillRefusal!=='mandatory'));
 const revealIncidents=active.filter(e=>(e.type==='fake_incident'?e.publicType:e.type)==='confession'&&e.type!=='fake_incident');
 if(informationSources.length+revealIncidents.length===0)issue('INDIRECT_CLUES_ONLY','没有可用的直接身份/规则调查能力；推理必须依靠事件、死亡时序和角色行为。',12);
 if(script.ruleset==='FS'&&cast.every(c=>chars[c].abilities.length===0))issue('NO_PROTAGONIST_ABILITIES','FS 没有最后的战斗，且出演人物都没有友好能力；须重新设计可操作的反制。',45);
 if(roleList.filter(r=>r==='person').length>cast.length*.7)issue('SPARSE_ROLES','普通人超过七成，角色互动可能稀疏。',8);
 // Structural facts, not the model's confidence, decide acceptance. Design text
 // explains warning tradeoffs but cannot suppress a failed hard validation.
 const explanationFields=['threatPlan','counterplay','cluePlan','loopPlan'];
 if(design&&explanationFields.some(k=>typeof design[k]!=='string'||design[k].trim().length<12))issue('INCOMPLETE_DESIGN','设计说明缺少可执行威胁、反制、线索或轮回安排。',25);
 const score=Math.max(0,100-issues.reduce((n,x)=>n+x.penalty,0));
 return {accepted:!issues.some(x=>x.severity==='error')&&score>=55,score,issues,
  metrics:{structurallyValid:true,characters:cast.length,activeIncidents:active.length,inactiveIncidents:inert.length,informationSources:informationSources.length+revealIncidents.length,maximumScheduledEX:script.ruleset==='MC'?maxGauge:null,forcedFinalGuess:issues.some(x=>x.code==='FORCED_FINAL_GUESS')},review:'static'};
}

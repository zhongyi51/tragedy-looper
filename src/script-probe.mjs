// Bounded engine witnesses, not a solver or a balance estimate. Keep this entire
// result server-side: even aggregate failure timing can reveal a hidden script.
import {createGame,applyCommand,legalActions,turn,view} from './engine.mjs';
import {catalog,chars,roles,validateScript} from './content.mjs';

export const PROBE_VERSION='engine-probe-1';
const profiles=['pressure-defense','quiet-exploration','varied-defense','pressure-exploration'];
const locations=new Set(catalog.locations.map(x=>x.id));
const note='有限策略试跑只记录已观察到的路径；没有观察到胜利不代表无解，样本胜负不代表平衡或最优对抗。';
const random=(seed,index)=>{let x=(seed^Math.imul(index+1,0x9e3779b1))>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);return ((x^(x>>>16))>>>0)/4294967296;};
const digest=(value,text)=>{for(let i=0;i<text.length;i++)value=Math.imul(value^text.charCodeAt(i),16777619)>>>0;return value;};
const living=v=>Object.values(v.board).filter(c=>c.present&&c.alive);
const knownRoles=v=>({...((v.script.ruleset==='MZ')?{}:v.knownRoles),...v.guessed});
const cardType=a=>a.card?.split('#')[0];
function moved(v,id,type){const at=catalog.locations.find(l=>l.id===v.board[id]?.location);if(!at)return null;const to=catalog.locations.find(l=>l.x===(at.x^Number(type==='move_h'||type==='move_d'))&&l.y===(at.y^Number(type==='move_v'||type==='move_d')))?.id;return to&&(!(chars[id]?.forbiddenLocations||[]).includes(to)||id==='patient'&&v.flags?.patientFree)?to:null;}
function priority(v,a,exploration){
 const known=knownRoles(v),target=v.board[a.target],type=cardType(a),all=living(v);
 if(a.type==='next_loop')return 100;
 if(a.type==='final_battle')return -100;
 if(a.type==='guess'){
  if(known[a.character])return known[a.character]===a.role?100:-100;
  if(a.character==='ai_character'&&a.role==='person')return -100;
  // Unknown identities remain guesses. No hidden role map or correct-answer oracle.
  return a.role==='person'?1:0;
 }
 if(a.type==='pass')return 0;
 if(a.type==='place'){
  if(!target)return type==='forbid_intrigue'&&v.seat===v.leader?(v.locations[a.target]||0)*4+1:-2;
  if(type==='goodwill_1'||type==='goodwill_2'){
   if(roles[known[target.id]]?.goodwillRefusal==='mandatory')return -.5;
   const next=target.goodwill+(type==='goodwill_2'?2:1),thresholds=chars[target.id].abilities.filter(x=>x.minGoodwill>target.goodwill&&x.minGoodwill<=next);
   return 2+(thresholds.length?exploration?8:5:0)-target.goodwill*.15;
  }
  if(type==='forbid_intrigue')return v.seat===v.leader?target.intrigue*4+(v.placements.some(p=>p.seat==='M'&&p.target===a.target)?3:0):-2;
  if(type==='paranoia_minus_1')return target.paranoia>0&&target.paranoia>=chars[target.id].paranoiaLimit-1?(exploration?3:8):-.5;
  if(type==='paranoia_1')return v.knownPlots.includes('tightrope_plan')&&(v.extraGauge||0)<2&&Object.values(v.knownCulprits).includes(a.target)?5:-1;
  if(type?.startsWith('move_')){
   const to=moved(v,a.target,type);if(!to)return -2;
   const near=all.filter(c=>c.id!==a.target&&c.location===target.location),there=all.filter(c=>c.id!==a.target&&c.location===to);
   const escaping=near.length===1&&known[near[0].id]==='serial_killer';
   const arriving=there.length===1&&known[there[0].id]==='serial_killer';
   return (escaping?12:0)-(arriving?15:0)+.1;
  }
  return -.1;
 }
 if(a.type==='goodwill'){
  const ability=chars[a.actor]?.abilities[a.index];
  if(!ability?.cannotRefuse&&roles[known[a.actor]]?.goodwillRefusal==='mandatory')return -2;
  if(['office_worker','irregular','boss'].includes(a.actor)||['shrine_maiden','teacher','forensic'].includes(a.actor)&&a.index===1)return a.target&&known[a.target]?-1:exploration?10:6;
  if(['police','godly_being'].includes(a.actor)&&a.index===0)return v.knownCulprits[a.day]?-1:8;
  if(a.actor==='informer')return v.knownPlots.includes(a.target)?-1:8;
  if(a.actor==='ai_character'){
   const incident=v.script.incidents.find(e=>e.day===a.day)?.type;
   if(incident==='breakthrough')return 5;
   if(incident==='silver_bullet')return v.day===v.script.days?1:-1;
   if(['murder','serial_murder','suicide','faraway_murder','bestial_murder','terrorism','hospital_incident'].includes(incident))return -2;
   return .5;
  }
  if(a.actor==='shrine_maiden'&&a.index===0)return (v.locations.shrine||0)>0?5:-1;
  if(['boy_student','girl_student','nurse'].includes(a.actor)||a.actor==='idol'&&a.index===0||['doctor','teacher'].includes(a.actor)&&a.index===0)return a.amount===1?-2:target?.paranoia>0?4+target.paranoia:-1;
  if(a.actor==='doctor'&&a.index===1)return v.flags.patientFree?-1:3;
  return 1;
 }
 if(a.type==='incident'||a.type==='ai_target')return Math.min(4,target?.intrigue??v.locations[a.target]??0);
 return 0;
}
// Exported for counterfactual tests. This policy takes only a seat projection;
// unrelated hidden fields, if a caller adds them, never enter its scoring.
export function probeHeroCommand(observation,{seed=0,exploration=false}={}){
 const actions=observation.actions||[];if(!actions.length)return null;
 let best=actions[0].command,score=-Infinity;
 for(const [index,{command}]of actions.entries()){
  const value=priority(observation,command,exploration)+random(seed,index)*.01;
  if(value>score){score=value;best=command;}
 }
 return structuredClone(best);
}
function pressure(s,a){
 const role=id=>s.script.mainPlot==='fated_connections'&&s.board[id]?.extra?'key_person':s.script.roles[id],type=cardType(a),c=s.board[a.target];
 const goalLocations=new Set();
 if(['protect_place','black_school'].includes(s.script.mainPlot))goalLocations.add('school');
 if(s.script.mainPlot==='sealed_item')goalLocations.add('shrine');
 if(['avenger','time_bomb'].includes(s.script.mainPlot))for(const [id,r]of Object.entries(s.script.roles))if(r===(s.script.mainPlot==='avenger'?'brain':'witch'))goalLocations.add(s.board[id].initial);
 const incident=s.script.incidents.find(e=>e.culprit===a.target&&e.day>=s.day);
 const countScore=(counter,amount=1)=>{
  if(!c)return counter==='intrigue'&&goalLocations.has(a.target)?8+amount:0;
  if(counter==='paranoia')return s.script.mainPlot==='tightrope_plan'?-2:incident&&c.paranoia<chars[c.id].paranoiaLimit?9+(incident.day===s.day?2:0):role(c.id)==='loved_one'?4:.2;
  return role(c.id)==='key_person'&&c.intrigue<2?9:role(c.id)==='killer'&&c.intrigue<4?7:role(c.id)==='ninja'&&s.script.mainPlot==='male_confrontation'?8:.3;
 };
 if(a.type==='place'){
  if(type==='intrigue_1'||type==='intrigue_2')return countScore('intrigue',type==='intrigue_2'?2:1);
  if(type==='paranoia_1')return countScore('paranoia');
  if(type==='forbid_goodwill')return c?.goodwill>=1?2+c.goodwill:.1;
  if(type?.startsWith('move_')&&c){const to=moved(s,a.target,type),there=Object.values(s.board).filter(t=>t.present&&t.alive&&t.id!==c.id&&t.location===to);if(there.length===1&&role(c.id)==='serial_killer')return ['key_person','friend'].includes(role(there[0].id))?12:4;if(role(c.id)==='killer'&&there.some(t=>role(t.id)==='key_person'))return 8;return .1;}
  return -.1;
 }
 if(a.type==='mm'){
  if(a.ability==='therapist'||a.amount===-1)return s.script.mainPlot==='tightrope_plan'?(c?.paranoia||0)+1:-(c?.paranoia||0);
  return countScore(a.ability==='brain'||a.ability==='rumor'||a.counter==='intrigue'?'intrigue':'paranoia');
 }
 if(a.type==='refusal')return a.refuse?2:0;
 if(a.type==='cultist')return a.mask;
 if(a.type==='end_ability')return a.ability==='heroes'?100:['key_person','friend'].includes(role(a.target))?50:5;
 if(['incident','end_forced'].includes(a.type))return ['key_person','friend'].includes(role(a.target))?30:1;
 if(a.type==='pass')return -1;
 return 0;
}
function mastermindCommand(s,actions,profile,seed){
 const quiet=profile==='quiet-exploration',varied=profile==='varied-defense';let best=actions[0].command,bestScore=-Infinity;
 for(const [i,{command:a}]of actions.entries()){
  let score=pressure(s,a);
  if(quiet)score=a.type==='pass'?20:a.type==='refusal'&&!a.refuse?20:a.type==='place'&&locations.has(a.target)&&!['intrigue_1','intrigue_2'].includes(cardType(a))?20:0;
  if(varied)score=random(seed,i)*8+(a.type==='pass'?-2:0);
  score+=random(seed,i)*.01;if(score>bestScore){bestScore=score;best=a;}
 }
 return best;
}
function boundedInteger(value,name,min,max){if(!Number.isInteger(value)||value<min||value>max)throw new RangeError(`${name} must be an integer in ${min}..${max}`);return value;}
export function probeScript(script,{profiles:count=2,maxCommands=400,maxCommandsPerTrace=200,maxMs=300,seed=0}={}){
 boundedInteger(count,'profiles',1,4);boundedInteger(maxCommands,'maxCommands',0,1600);boundedInteger(maxCommandsPerTrace,'maxCommandsPerTrace',0,800);boundedInteger(maxMs,'maxMs',0,5000);boundedInteger(seed,'seed',0,Number.MAX_SAFE_INTEGER);
 const started=Date.now(),deadline=started+maxMs,limits={profiles:count,maxCommands,maxCommandsPerTrace,maxMs};
 const base={version:PROBE_VERSION,scope:'private',limits,clockGuard:'best_effort',note};
 const valid=validateScript(script);
 if(valid.errors.length)return {...base,status:'invalid',commands:0,elapsedMs:Math.max(0,Date.now()-started),limitedBy:null,traces:[],errors:valid.errors.map(e=>({path:e.path,message:e.message})),observations:{completedTraces:0,heroSurvivalObserved:false,mastermindWinObserved:false,eventsObserved:0,informationObserved:0},rankingEvidence:{completedTraces:0,observedSurvival:0,observedThreat:0,observedEvents:0,observedInformation:0,coverage:0}};
 const traces=profiles.slice(0,count).map((profile,index)=>({profile,index,state:null,status:'pending',commands:0,digest:2166136261,events:new Set(),roleReveals:new Set(),culpritReveals:new Set(),plotReveals:new Set(),days:new Set(),loops:new Set(),failedLoops:new Set(),maxEX:0,heroSurvivalObserved:false}));
 let commands=0,limitedBy=null,error=null;
 // Cloudflare freezes Date.now during pure CPU work. Command caps, not this
 // cooperative clock guard, are the hard workload bound in that runtime.
 // Round robin gives every profile a chance before a slow path exhausts the
 // shared budget. Checks surround atomic engine operations; one synchronous
 // operation cannot be preempted mid-resolution.
 outer:for(;;){
  let pending=false;
  for(const trace of traces){
   if(['terminal','error','command_limit'].includes(trace.status))continue;
   pending=true;
   if(commands>=maxCommands){limitedBy='total_commands';break outer;}
   if(Date.now()>=deadline){limitedBy='time';break outer;}
   if(trace.commands>=maxCommandsPerTrace){trace.status='command_limit';continue;}
   try{
    if(!trace.state)trace.state=createGame(script);
    if(Date.now()>=deadline){limitedBy='time';break outer;}
    const s=trace.state,seat=turn(s),actions=legalActions(s,seat);
    if(!seat||!actions.length){if(s.winner){trace.status='terminal';continue;}throw Error('NO_LEGAL_ACTION');}
    const noise=(seed+trace.index*104729+trace.commands*8191)>>>0;
    const command=seat==='M'?mastermindCommand(s,actions,trace.profile,noise):probeHeroCommand(view(s,seat),{seed:noise,exploration:trace.profile.endsWith('exploration')});
    if(Date.now()>=deadline){limitedBy='time';break outer;}
    const next=applyCommand(s,seat,command);trace.state=next;trace.commands++;commands++;
    trace.digest=digest(trace.digest,JSON.stringify([seat,command]));trace.loops.add(next.loop);trace.days.add(`${next.loop}:${next.day}`);
    for(const day of next.occurred)trace.events.add(`${next.loop}:${day}`);
    for(const [id,role]of Object.entries(next.knownRoles))trace.roleReveals.add(`${id}:${role}`);
    for(const [day,id]of Object.entries(next.knownCulprits))trace.culpritReveals.add(`${day}:${id}`);
    for(const plot of next.knownPlots)trace.plotReveals.add(plot);
    for(const entry of next.log.slice(s.log.length)){if(entry.type==='failed')trace.failedLoops.add(entry.loop);if(entry.type==='victory')trace.heroSurvivalObserved=true;}
    trace.maxEX=Math.max(trace.maxEX,next.extraGauge||0);trace.status=next.winner?'terminal':'running';
   }catch(cause){trace.status='error';trace.error=String(cause?.message||cause).slice(0,200);error='ENGINE_PROBE_ERROR';}
  }
  if(!pending||traces.every(t=>['terminal','error','command_limit'].includes(t.status)))break;
 }
 const summaries=traces.map(t=>({profile:t.profile,status:t.status==='running'||t.status==='pending'?t.commands>=maxCommandsPerTrace?'command_limit':'budget_limit':t.status,commands:t.commands,winner:t.state?.winner||null,loopsReached:t.loops.size,daysReached:t.days.size,failedLoops:t.failedLoops.size,occurredIncidents:t.events.size,declaredRoleReveals:t.roleReveals.size,culpritReveals:t.culpritReveals.size,plotReveals:t.plotReveals.size,maxEX:t.maxEX,heroSurvivalObserved:t.heroSurvivalObserved,commandDigest:t.digest.toString(16).padStart(8,'0'),...(t.error?{error:t.error}:{})}));
 const completed=summaries.filter(t=>t.status==='terminal'),events=summaries.reduce((n,t)=>n+t.occurredIncidents,0),information=summaries.reduce((n,t)=>n+t.declaredRoleReveals+t.culpritReveals+t.plotReveals,0),survival=summaries.some(t=>t.heroSurvivalObserved),threat=summaries.some(t=>t.failedLoops>0);
 return {...base,status:error?'error':completed.length===count?'completed':'limited',commands,elapsedMs:Math.max(0,Date.now()-started),limitedBy:limitedBy||(summaries.some(t=>t.status==='command_limit')?'trace_commands':null),traces:summaries,
  observations:{completedTraces:completed.length,heroSurvivalObserved:survival,mastermindWinObserved:completed.some(t=>t.winner==='mastermind'),eventsObserved:events,informationObserved:information},
  rankingEvidence:{completedTraces:completed.length,observedSurvival:Number(survival),observedThreat:Number(threat),observedEvents:Math.min(8,events),observedInformation:Math.min(8,information),coverage:Math.min(24,summaries.reduce((n,t)=>n+t.daysReached,0))}};
}

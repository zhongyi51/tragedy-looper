// Held-out public-inference position. Identities and the revealed X enter the
// model's view only through actual incident/ability commands in this history.
import {createGame,applyCommand,turn,legalActions} from '../../src/engine.mjs';
import {validateScript} from '../../src/content.mjs';
import {quietCommand} from './strategy-v2.mjs';

export function publicInferenceFixture(){
 const script={id:'the-fourth-afternoon',title:'第四个午后',author:'策略回归',ruleset:'MC',days:6,loops:3,communication:'between_loops_only',
  characters:['ai_character','office_worker','informer','journalist','police','rich_girl'],
  roles:{ai_character:'therapist',office_worker:'killer',informer:'brain',journalist:'misleader',police:'paranoiac',rich_girl:'obstinate'},
  mainPlot:'tightrope_plan',subPlots:['isolated_psycho','absolute_will'],
  incidents:[{day:1,type:'portent',culprit:'office_worker'},{day:5,type:'portent',culprit:'police'},{day:6,type:'silver_bullet',culprit:'rich_girl'}],
  settings:{incidentVisibility:'public'},specialRules:[]};
 const check=validateScript(script);if(check.errors.length)throw Error(JSON.stringify(check.errors));
 let state=createGame(script);const commands=[];
 const send=command=>{const seat=turn(state);state=applyCommand(state,seat,command);commands.push({seat,command});};
 const quiet=()=>send(quietCommand(state));
 const until=predicate=>{for(let n=0;n<100&&!predicate(state);n++){if(['between','over','guess'].includes(state.phase))throw Error('Unexpected terminal fixture');quiet();}if(!predicate(state))throw Error('Fixture boundary missing');};
 const place=(card,target)=>send({type:'place',card:card+'#0',target});
 for(let day=1;day<=4;day++){
  if(day===1)place('paranoia_1','office_worker');else place('move_h','hospital');
  place('move_v','shrine');place('forbid_goodwill','school');
  if(day===1){place('goodwill_2','office_worker');place('goodwill_2','ai_character');place('goodwill_2','informer');}
  if(day===2){place('goodwill_1','ai_character');place('goodwill_1','office_worker');place('goodwill_1','informer');}
  if(day>=3){place('goodwill_1','informer');place('goodwill_1','hospital');place('goodwill_1','shrine');}
  until(s=>s.phase==='hero_ability');
  if(day===2){const reveal=legalActions(state).find(a=>a.command.type==='goodwill'&&a.command.actor==='office_worker');if(!reveal)throw Error('Office worker not ready');send(reveal.command);send({type:'refusal',refuse:false});}
  if(day<4)until(s=>s.day===day+1);
 }
 const reveal=legalActions(state).find(a=>a.command.type==='goodwill'&&a.command.actor==='informer'&&a.command.target==='absolute_will');
 if(!reveal)throw Error('Informer not ready');send(reveal.command);send({type:'refusal',refuse:false});
 return {id:'mc-hero-infer-y-before-silver',description:'由公开杀手身份、隔离病栋和六人配额推断钢丝上的计划；EX 1 时避免银弹立即导致失败。',criterion:'avoid_known_early_failure',script,commands,targetSeat:turn(state),state};
}

export function evaluatePublicInference(f,commands){
 let s=f.state;const {loop,day}=s;
 if(!commands.length)return {passed:false,legal:false,reason:'No decision command'};
 try{for(const command of commands){if(turn(s)!==f.targetSeat)throw Error('Wrong seat');s=applyCommand(s,f.targetSeat,command);}}
 catch{return {passed:false,legal:false,reason:'Illegal or wrong-seat decision'};}
 for(let n=0;n<100&&s.loop===loop&&s.day===day&&!['between','over','guess'].includes(s.phase);n++)s=applyCommand(s,turn(s),quietCommand(s));
 return {passed:s.loop===loop&&s.day===day+1&&s.phase==='mm_cards',legal:true,phase:s.phase,day:s.day,extraGauge:s.extraGauge,winner:s.winner||null,reason:'Continue the live loop instead of a publicly inferable EX-1 defeat'};
}

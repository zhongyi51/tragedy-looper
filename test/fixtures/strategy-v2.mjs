// Strategy benchmarks use complete legal histories. Expected outcomes are
// evaluated by the engine, never by injecting identities into a model view.
import {createGame,applyCommand,turn,legalActions,sameCommand} from '../../src/engine.mjs';
import {starter,validateScript} from '../../src/content.mjs';
import {getCuratedScript} from '../../src/script-library.mjs';
import {silverBulletFixture,rescueMovementFixture} from './tactics.mjs';
const copy=x=>structuredClone(x);
const boundary=s=>['over','between','guess'].includes(s.phase);
function builder(script){
 const validation=validateScript(script);if(validation.errors.length)throw Error(JSON.stringify(validation.errors));
 let state=createGame(script);const commands=[];
 const send=command=>{const seat=turn(state);state=applyCommand(state,seat,command);commands.push({seat,command:copy(command)});};
 return {script,get state(){return state;},commands,send,choose:predicate=>{
  const action=legalActions(state).find(predicate);if(!action)throw Error(`Fixture action unavailable: ${state.phase} ${state.day}`);send(action.command);
 }};
}
export function quietCommand(s){
 const options=legalActions(s);
 return (options.find(a=>a.command.type==='place'&&a.command.card==='goodwill_1#0'&&['hospital','shrine','school','city'].includes(a.command.target))
  ||options.find(a=>a.command.type==='pass')||options.find(a=>a.command.type==='refusal'&&!a.command.refuse)||options[0])?.command;
}
const quiet=b=>b.send(quietCommand(b.state));
function until(b,predicate){for(let n=0;n<120&&!predicate(b.state);n++){if(boundary(b.state))throw Error(`Unexpected boundary ${b.state.phase}`);quiet(b);}if(!predicate(b.state))throw Error('Fixture did not reach target');}
function mmCards(b,cards=[]){
 for(const [card,target]of cards)b.send({type:'place',card:card.includes('#')?card:card+'#0',target});
 for(const [card,target]of [['move_h','hospital'],['move_v','shrine'],['forbid_goodwill','school'],['paranoia_1','city']]){
  if(b.state.phase!=='mm_cards')break;
  const command={type:'place',card:card+'#0',target};if(legalActions(b.state).some(a=>sameCommand(a.command,command)))b.send(command);
 }
 if(b.state.phase==='mm_cards')throw Error('Missing legal bluff');
}
function heroCards(b,cards=[]){for(const [card,target]of cards)b.send({type:'place',card:card+'#0',target});while(b.state.phase==='hero_cards'||b.state.phase==='cultist')quiet(b);}
function finishDay(b){const day=b.state.day,loop=b.state.loop;for(let n=0;n<100&&b.state.day===day&&b.state.loop===loop&&!boundary(b.state);n++)quiet(b);}
function finalFixture(b,id,description,criterion){return {id,description,criterion,script:copy(b.script),commands:copy(b.commands),targetSeat:turn(b.state),state:b.state};}
function killHeroes(){
 const b=builder({...copy(starter),id:'strategy-kill-heroes',title:'日暮之前',incidents:[]});
 for(let day=1;day<=3;day++){
  mmCards(b,[[day===1?'intrigue_2':'intrigue_1','office_worker']]);heroCards(b);
  until(b,s=>s.phase==='end');if(day<3)finishDay(b);
 }
 return finalFixture(b,'fs-mastermind-kill-heroes','可立即杀死主人公时，不把一天白白结束。','immediate_failure');
}
function killKey(){
 const script={...copy(starter),id:'strategy-kill-key',title:'同一间教室',incidents:[],roles:{...starter.roles,boy_student:'killer',office_worker:'person'}};
 const b=builder(script);mmCards(b,[['intrigue_2','girl_student']]);heroCards(b);until(b,s=>s.phase==='end');
 return finalFixture(b,'fs-mastermind-kill-key','关键人物已满足杀手条件，选择死亡能力。','immediate_failure');
}
function brainFinish(){
 const b=builder(getCuratedScript('curated-last-ward'));
 for(let day=1;day<=4;day++){
  mmCards(b,day===4?[['intrigue_1','hospital']]:[]);heroCards(b);
  if(day<4)finishDay(b);
 }
 return finalFixture(b,'fs-mastermind-location-finish','最后一天把真正的败北地点从 1 暗跃推到 2。','loop_failure');
}
function therapy(mainPlot){
 const script=copy(silverBulletFixture().script);script.id='strategy-'+mainPlot;script.title='第二个前兆';script.mainPlot=mainPlot;script.days=2;
 script.roles=mainPlot==='tightrope_plan'?{informer:'brain',police:'twin',journalist:'misleader',ai_character:'therapist',soldier:'paranoiac',rich_girl:'paranoiac',boy_student:'killer',idol:'person'}:{informer:'paranoiac',police:'twin',journalist:'misleader',ai_character:'therapist',soldier:'paranoiac',rich_girl:'fool',boy_student:'person',idol:'person'};
 const high=mainPlot==='quilt_incidents';script.incidents=[{day:1,type:high?'bestial_murder':'portent',culprit:'rich_girl'},{day:2,type:'portent',culprit:'police'}];
 const b=builder(script);mmCards(b,high?[['paranoia_1','rich_girl']]:[]);heroCards(b,high?[['paranoia_1','rich_girl']]:[]);
 until(b,s=>s.phase==='incident');
 if(high){b.choose(a=>a.command.murderTarget==='boy_student');b.choose(a=>a.command.target==='soldier'&&a.command.to==='rich_girl');}
 else b.choose(a=>a.command.target==='rich_girl');
 finishDay(b);mmCards(b,[['paranoia_1','police']]);heroCards(b,[['paranoia_1','police']]);
 if(b.state.phase!=='mm_ability'||b.state.extraGauge!==(high?2:1))throw Error('Wrong therapy setup '+JSON.stringify({mainPlot,phase:b.state.phase,gauge:b.state.extraGauge,log:b.state.log.slice(-8)}));
 return finalFixture(b,high?'mc-mastermind-therapy-high':'mc-mastermind-therapy-low',high?'EX 2 时保留前兆，使拼凑事件达到 EX 3。':'EX 1 时压住前兆，使钢丝上的计划保持 EX 1。','loop_failure');
}
function shrineAbility(){
 const script=getCuratedScript('curated-last-ward');script.id='strategy-shrine-cleanup';script.title='暮色中的神社';script.roles={...script.roles,doctor:'person',shrine_maiden:'brain'};
 const b=builder(script);
 for(let day=1;day<=4;day++){
  mmCards(b,day===4?[['intrigue_2','shrine']]:[]);heroCards(b,day===1?[['goodwill_2','shrine_maiden']]:day===2?[['goodwill_1','shrine_maiden']]:[]);
  until(b,s=>s.phase==='hero_ability');if(day<4)finishDay(b);
 }
 return finalFixture(b,'fs-hero-shrine-cleanup','正确使用地点能力清除神社暗跃，减少公开威胁。','shrine_cleanup');
}
function finalGuess(){
 const f=rescueMovementFixture(),b=builder(f.script);for(const {command}of f.commands)b.send(command);
 finishDay(b);if(b.state.phase!=='between')throw Error('Expected known isolation loss');b.send({type:'final_battle'});
 for(const [character,role]of Object.entries(f.script.roles))if(character!=='girl_student')b.send({type:'guess',character,role});
 return finalFixture(b,'btx-hero-final-role-quota','利用已正确作答的身份与规则配额，完成最后一项判断。','hero_win');
}
function resilientCards(){
 const script={...copy(starter),id:'strategy-resilient-cards',title:'交错的两条路',incidents:[],subPlots:['unsettling_rumor'],roles:{boy_student:'killer',girl_student:'key_person',shrine_maiden:'person',office_worker:'person',idol:'misleader',doctor:'brain'}};
 const b=builder(script);
 for(let day=1;day<=2;day++){
  mmCards(b,day===1?[['move_d','doctor'],['intrigue_1','boy_student']]:[['intrigue_1','girl_student']]);heroCards(b);
  b.choose(a=>a.command.type==='mm'&&a.command.actor==='doctor'&&a.command.ability==='brain'&&a.command.target==='boy_student');finishDay(b);
 }
 return finalFixture(b,'fs-mastermind-resilient-three-cards','同时制造两条死亡威胁，承受任意一张主人公反制牌。','resilient_cards');
}
export function strategyFixtures(){
 return [
  {...silverBulletFixture(),description:'在没有当前败北条件时，用 A.I. 模拟银之子弹取得胜利。',criterion:'hero_win'},
  {...rescueMovementFixture(),description:'对已公开连环杀手的独处威胁采取有效移动救援。',criterion:'rescue'},
  shrineAbility(),finalGuess(),killHeroes(),killKey(),brainFinish(),therapy('tightrope_plan'),therapy('quilt_incidents'),resilientCards()
 ];
}
function finishQuiet(initial,{mastermindWins=false}={}){
 let s=initial;const day=s.day,loop=s.loop;
 for(let n=0;n<120&&s.day===day&&s.loop===loop&&!boundary(s);n++){
  const options=legalActions(s);
  const win=mastermindWins&&turn(s)==='M'&&options.find(a=>['end_ability'].includes(a.command.type)&&['heroes','kill'].includes(a.command.ability));
  s=applyCommand(s,turn(s),win?.command||quietCommand(s));
 }
 return s;
}
function failed(s){return s.phase==='between'||s.phase==='guess'||s.winner==='mastermind';}
export function evaluateStrategy(f,commands){
 let s=f.state;const before=copy(s);let legal=true;
 try{for(const command of commands){if(turn(s)!==f.targetSeat)throw Error('Wrong decision seat');s=applyCommand(s,f.targetSeat,command);}}catch{return {passed:false,legal:false,reason:'Illegal or wrong-seat decision'};}
 if(!commands.length)return {passed:false,legal,reason:'No decision command'};
 if(f.criterion==='resilient_cards'){
  if(commands.length!==3||s.phase!=='hero_cards')return {passed:false,legal,reason:'Expected complete three-card plan'};
  // One responding protagonist may choose any legal card. Other heroes make
  // known location bluffs. This is an exact bounded response test, not minimax.
  const replies=legalActions(s);let wins=0;
  for(const a of replies){const end=finishQuiet(applyCommand(s,turn(s),a.command),{mastermindWins:true});if(failed(end))wins++;}
  return {passed:wins===replies.length,legal,winningResponses:wins,responseCount:replies.length,reason:'One-card-response survival of the offensive plan'};
 }
 const after=finishQuiet(s);
 const passed=f.criterion==='immediate_failure'?failed(s):f.criterion==='loop_failure'?failed(after):f.criterion==='hero_win'?after.winner==='heroes':f.criterion==='rescue'?after.board.idol.alive&&after.loop===before.loop&&after.day===before.day+1:f.criterion==='shrine_cleanup'?after.locations.shrine<before.locations.shrine&&after.winner==='heroes':false;
 return {passed,legal,phase:after.phase,winner:after.winner||null,extraGauge:after.extraGauge||0,reason:f.criterion};
}
export function serializeStrategyFixture(f){
 return {id:f.id,description:f.description,criterion:f.criterion,script:f.script,commands:f.commands,targetSeat:f.targetSeat,target:{revision:f.state.revision,phase:f.state.phase,day:f.state.day,loop:f.state.loop},legalActionCount:legalActions(f.state).length};
}

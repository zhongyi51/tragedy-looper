// Reproducible positions reached only through legal commands. These are owned
// regression scripts, not saved games or snapshots with hidden fields patched.
import {createGame,applyCommand,turn,legalActions} from '../../src/engine.mjs';
const silverScript={id:'tactic-mc-silver',title:'未尽的暮色',author:'策略回归',ruleset:'MC',days:3,loops:3,communication:'between_loops_only',characters:['informer','journalist','boy_student','police','idol','rich_girl','soldier','ai_character'],roles:{informer:'paranoiac',police:'twin',journalist:'misleader',ai_character:'therapist',soldier:'paranoiac',rich_girl:'fool',boy_student:'poisoner',idol:'key_person'},mainPlot:'strychnine',subPlots:['isolated_psycho','tricky_twins'],incidents:[{day:1,type:'serial_murder',culprit:'rich_girl'},{day:2,type:'terrorism',culprit:'police'},{day:3,type:'silver_bullet',culprit:'journalist'}],settings:{incidentVisibility:'public'},specialRules:[]};
const rescueScript={id:'tactic-btx-rescue',title:'护卫之后',author:'策略回归',ruleset:'BTX',days:5,loops:3,communication:'between_loops_only',characters:['office_worker','police','idol','boy_student','girl_student','shrine_maiden','doctor'],roles:{office_worker:'serial_killer',police:'person',idol:'key_person',boy_student:'brain',girl_student:'killer',shrine_maiden:'misleader',doctor:'friend'},mainPlot:'murder_plan',subPlots:['hidden_killer','unsettling_rumor'],incidents:[{day:3,type:'missing',culprit:'police'}],settings:{incidentVisibility:'public'},specialRules:[]};
function builder(script){let state=createGame(script);const commands=[];const send=command=>{const seat=turn(state);state=applyCommand(state,seat,command);commands.push({seat,command});};return {get state(){return state;},commands,send,choose:predicate=>{const action=legalActions(state).find(predicate);if(!action)throw Error('Fixture action unavailable in '+state.phase);send(action.command);}};}
const by=command=>a=>JSON.stringify(a.command)===JSON.stringify(command);
function quiet(b){const options=legalActions(b.state);const a=options.find(a=>a.command.type==='pass')||options.find(a=>a.command.type==='refusal'&&!a.command.refuse)||options[0];if(!a)throw Error('Unexpected terminal fixture');b.send(a.command);}
function mastermindBluff(b,paranoiaTarget){
 const cards=paranoiaTarget?[['paranoia_1#0',paranoiaTarget],['move_h#0','hospital'],['move_v#0','shrine']]:[['move_h#0','hospital'],['move_v#0','shrine'],['forbid_goodwill#0','school']];
 for(const [card,target] of cards)b.send({type:'place',card,target});
}
function heroCards(b,desired){
 while(b.state.phase==='hero_cards'){
  const seat=turn(b.state),next=desired[seat];
  if(next)b.send({type:'place',...next});
  else b.choose(a=>a.command.type==='place'&&a.command.card==='goodwill_1#0'&&['hospital','shrine','school','city'].includes(a.command.target));
 }
}
function finishDay(b){const day=b.state.day;while(b.state.day===day&&b.state.phase!=='over'&&b.state.phase!=='between')quiet(b);}
export function silverBulletFixture(){
 const b=builder(silverScript);
 for(let day=1;day<=2;day++){
  mastermindBluff(b);heroCards(b,{[turn(b.state)]:{card:day===1?'goodwill_2#0':'goodwill_1#0',target:'ai_character'}});
  while(b.state.phase!=='hero_ability')quiet(b);
  if(day===1)finishDay(b);
 }
 return {id:'mc-silver-bullet',script:structuredClone(silverScript),commands:b.commands,targetSeat:turn(b.state),expected:{type:'goodwill',actor:'ai_character',day:3},state:b.state};
}
export function rescueMovementFixture(){
 const b=builder(rescueScript);
 for(let day=1;day<=3;day++){
  mastermindBluff(b,'police');
  const desired=day===1?{A:{card:'goodwill_2#0',target:'office_worker'},B:{card:'goodwill_2#0',target:'police'}}:day===2?{B:{card:'goodwill_1#0',target:'office_worker'},C:{card:'goodwill_2#0',target:'police'}}:{C:{card:'goodwill_1#0',target:'police'}};
  heroCards(b,desired);while(b.state.phase!=='hero_ability')quiet(b);
  if(day===2){b.choose(a=>a.command.type==='goodwill'&&a.command.actor==='office_worker');quiet(b);}
  if(day===3){b.choose(a=>a.command.type==='goodwill'&&a.command.actor==='police'&&a.command.index===1&&a.command.target==='idol');quiet(b);b.send({type:'pass'});b.choose(a=>a.command.type==='incident'&&a.command.target==='hospital');}
  finishDay(b);
 }
 mastermindBluff(b);
 return {id:'btx-rescue-movement',script:structuredClone(rescueScript),commands:b.commands,targetSeat:turn(b.state),expected:{type:'place',effect:'idol_survives_tonight'},state:b.state};
}
export const tacticalFixtures=()=>[silverBulletFixture(),rescueMovementFixture()];

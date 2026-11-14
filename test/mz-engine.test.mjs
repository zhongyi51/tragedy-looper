import test from 'node:test';
import assert from 'node:assert/strict';
import {starter} from '../src/content.mjs';
import {createGame,applyCommand,legalActions,turn,view,advanceAutomatic} from '../src/engine.mjs';

// A controlled board isolates expansion mechanics from randomized script generation.
const fresh=()=>{
 const s=createGame(starter);s.script.ruleset='MZ';s.script.mainPlot='sealed_item';s.script.subPlots=[];
 for(const id of s.script.characters)s.script.roles[id]='person';
 s.script.incidents=[];s.script.days=3;s.script.loops=3;s.script.settings.incidentVisibility='public';return s;
};
const act=(s,command)=>applyCommand(s,turn(s),command);
const choose=(s,predicate)=>{
 const found=legalActions(s).find(o=>predicate(o.command,o));
 assert.ok(found,`Expected a legal choice during ${s.phase}: ${JSON.stringify(legalActions(s).map(o=>o.command))}`);
 return act(s,found.command);
};
const add=(s,id,role,location='city')=>{
 s.script.characters.push(id);s.script.roles[id]=role;
 s.board[id]={id,initial:location,location,present:true,alive:true,goodwill:0,paranoia:0,intrigue:0,guard:0};return s;
};
const incident=(s,type,culprit='boy_student',publicType)=>{
 s.phase='hero_ability';s.script.incidents=[{day:s.day,type,culprit,...(publicType?{publicType}:{})}];
 return act(s,{type:'pass'});
};
const finish=s=>{s.phase='end';s.day=s.script.days;return act(s,{type:'pass'});};
const askRole=s=>{
 s.phase='hero_ability';s.board.office_worker.goodwill=3;
 s=choose(s,a=>a.type==='goodwill'&&a.actor==='office_worker');
 return act(s,{type:'refusal',refuse:false});
};

test('MZ prophet forbids mastermind cards, without preventing protagonist cards',()=>{
 let s=fresh();s.script.roles.boy_student='prophet';s.phase='mm_cards';
 assert.ok(!legalActions(s).some(o=>o.command.target==='boy_student'));
 assert.ok(legalActions(s).some(o=>o.command.target==='school'));
 s.phase='hero_cards';assert.ok(legalActions(s).some(o=>o.command.target==='boy_student'));
});

test('MZ prophet suppresses another culprit even when that culprit is obstinate',()=>{
 const s=fresh();s.script.roles.boy_student='obstinate';s.script.roles.girl_student='prophet';
 s.board.girl_student.location=s.board.boy_student.location;s.board.boy_student.paranoia=99;
 const result=incident(s,'suicide');assert.equal(result.board.boy_student.alive,true);assert.deepEqual(result.occurred,[]);
});

test('MZ prophet does not suppress its own incident',()=>{
 const s=fresh();s.script.roles.boy_student='prophet';s.board.boy_student.paranoia=2;
 const result=incident(s,'suicide');assert.equal(result.board.boy_student.alive,false);assert.deepEqual(result.occurred,[1]);
});

test('MZ obstinate triggers below its paranoia limit but respects death and suppression',()=>{
 for(const blocked of [false,'dead','suppressed','absent']){
  const s=fresh();s.script.roles.boy_student='obstinate';s.board.boy_student.paranoia=0;
  if(blocked==='dead')s.board.boy_student.alive=false;
  if(blocked==='absent')s.board.boy_student.present=false;
  if(blocked==='suppressed')s.suppressed.push('boy_student');
  const result=incident(s,'unease');assert.deepEqual(result.occurred,blocked?[]:[1]);
 }
});

test('MZ worshippers lower only an ordinary Person culprit limit while a prophet lives',()=>{
 for(const [role,alive,expected] of [['person',true,true],['brain',true,false],['person',false,false]]){
  const s=fresh();s.script.subPlots=['worship_apocalypse'];s.script.roles.boy_student=role;s.script.roles.office_worker='prophet';
  s.board.office_worker.alive=alive;s.board.office_worker.location='city';s.board.boy_student.location='school';s.board.boy_student.paranoia=1;
  const result=incident(s,'suicide');assert.equal(result.occurred.length===1,expected);
 }
});

test('MZ immortal survives murder without consuming a guard counter',()=>{
 let s=fresh();s.script.roles.girl_student='immortal';s.board.girl_student.guard=1;s.board.boy_student.paranoia=99;
 s=incident(s,'serial_murder');s=choose(s,a=>a.target==='girl_student');
 assert.equal(s.board.girl_student.alive,true);assert.equal(s.board.girl_student.guard,1);
});

test('MZ magician can move paranoid characters to adjacent locations, not diagonally',()=>{
 const s=fresh();s.script.roles.boy_student='magician';s.phase='mm_ability';s.board.girl_student.paranoia=1;
 const choices=legalActions(s).map(o=>o.command).filter(a=>a.actor==='boy_student'&&a.target==='girl_student');
 assert.equal(choices.length,2);assert.ok(choices.every(a=>!Object.values(a).includes('hospital')));
});

test('MZ magician movement shares a once-per-loop limit across all magicians',()=>{
 let s=fresh();s.script.roles.boy_student='magician';s.script.roles.girl_student='magician';s.phase='mm_ability';
 s.board.boy_student.paranoia=1;s.board.girl_student.paranoia=1;
 s=choose(s,a=>a.actor==='boy_student'&&a.target==='girl_student');
 assert.ok(!legalActions(s).some(o=>['boy_student','girl_student'].includes(o.command.actor)));
 s.day++;assert.ok(!legalActions(s).some(o=>['boy_student','girl_student'].includes(o.command.actor)));
});

test('MZ magician removes all paranoia on death',()=>{
 const s=fresh();s.script.roles.boy_student='magician';s.board.boy_student.paranoia=5;
 const result=incident(s,'suicide');assert.equal(result.board.boy_student.alive,false);assert.equal(result.board.boy_student.paranoia,0);
});

test('MZ unsafe trigger gives the living Factor location one intrigue once per loop',()=>{
 let s=fresh();s.script.roles.boy_student='factor';s.script.subPlots=['unsafe_trigger'];s.phase='mm_ability';
 const options=legalActions(s).filter(o=>o.command.type!=='pass');assert.equal(options.length,1);
 s=act(s,options[0].command);assert.equal(s.locations.school,1);
 assert.equal(legalActions(s).filter(o=>o.command.type!=='pass').length,0);
 s.day++;assert.equal(legalActions(s).filter(o=>o.command.type!=='pass').length,0);
});

test('MZ ninja can kill any same-location character with two intrigue, not only Key Person',()=>{
 let s=fresh();s.phase='end';s.script.roles.boy_student='ninja';s.board.girl_student.intrigue=2;
 s=choose(s,a=>a.type==='end_ability'&&a.actor==='boy_student'&&a.target==='girl_student');
 assert.equal(s.board.girl_student.alive,false);assert.notEqual(s.phase,'between');
});

test('MZ ninja role declaration can use another non-Person role assigned in this script',()=>{
 let s=fresh();s.script.roles.office_worker='ninja';s.script.roles.doctor='brain';s.script.roles.idol='witch';
 s=askRole(s);assert.equal(s.phase,'reveal_role');assert.equal(turn(s),'M');
 const claims=legalActions(s).map(o=>o.command.role);
 assert.ok(claims.includes('ninja'));assert.ok(claims.includes('brain'));assert.ok(claims.includes('witch'));
 assert.ok(!claims.includes('person'));assert.ok(!claims.includes('magician'));
 s=act(s,{type:'reveal_role',role:'brain'});assert.equal(s.knownRoles.office_worker,'brain');assert.equal(s.phase,'hero_ability');
});

test('MZ ordinary role revelation uses the same public declaration stage as ninja',()=>{
 let s=fresh();s.script.roles.office_worker='brain';s=askRole(s);
 assert.equal(s.phase,'reveal_role');assert.deepEqual(legalActions(s).map(o=>o.command.role),['brain']);
 assert.equal(view(s,'A').phaseId,'reveal_role');assert.equal(view(s,'A').pending,undefined);
});

test('MZ male confrontation checks the ninja corpse intrigue at loop end',()=>{
 const s=fresh();s.script.mainPlot='male_confrontation';s.script.roles.office_worker='ninja';
 s.board.office_worker.alive=false;s.board.office_worker.intrigue=2;
 assert.equal(finish(s).phase,'between');
});

test('MZ showtime of death loses with six living characters but not seven',()=>{
 let six=fresh();six.script.subPlots=['showtime_death'];assert.equal(finish(six).phase,'between');
 let seven=fresh();seven.script.subPlots=['showtime_death'];add(seven,'nurse','person','hospital');
 assert.equal(finish(seven).winner,'heroes');
});

test('MZ EX setup chooses a previous-loop corpse and does not stack the two EX plots',()=>{
 let s=fresh();s.script.mainPlot='fated_connections';s.script.subPlots=['dice_of_gods'];
 s.board.boy_student.alive=false;s.board.girl_student.alive=false;s.phase='between';
 s=act(s,{type:'next_loop'});assert.equal(s.phase,'extra_setup');
 assert.deepEqual(legalActions(s).map(o=>o.command.target).sort(),['boy_student','girl_student']);
 s=act(s,{type:'setup_extra',target:'boy_student'});assert.equal(s.board.boy_student.extra,true);
 assert.equal(Object.values(s.board).filter(c=>c.extra).length,1);assert.equal(s.phase,'mm_cards');
});

test('MZ EX markers clear on new loops and are absent without previous-loop deaths',()=>{
 let s=fresh();s.script.mainPlot='fated_connections';s.board.boy_student.extra=true;s.phase='between';
 s=act(s,{type:'next_loop'});assert.ok(Object.values(s.board).every(c=>!c.extra));assert.equal(s.phase,'mm_cards');
});

test('MZ fated connections changes an EX character into Key Person immediately',()=>{
 let s=fresh();s.script.mainPlot='fated_connections';s.script.roles.boy_student='immortal';s.board.boy_student.extra=true;s.board.boy_student.paranoia=99;
 s=incident(s,'suicide');assert.equal(s.board.boy_student.alive,false);assert.equal(s.phase,'between');
});

test('MZ final battle clears EX role changes and guesses original assignments',()=>{
 let s=fresh();s.script.mainPlot='fated_connections';s.script.roles.boy_student='immortal';s.board.boy_student.extra=true;s.phase='between';
 assert.ok(legalActions(s).some(o=>o.command.type==='final_battle'));
 s=act(s,{type:'final_battle'});assert.ok(Object.values(s.board).every(c=>!c.extra));
 s=act(s,{type:'guess',character:'boy_student',role:'immortal'});assert.equal(s.guessed.boy_student,'immortal');
});

test('MZ conspiracies checks intrigue instead of paranoia and offers both resolutions',()=>{
 let s=fresh();s.board.boy_student.paranoia=99;s.board.boy_student.intrigue=1;
 assert.deepEqual(incident(structuredClone(s),'conspiracies').occurred,[]);
 s.board.boy_student.paranoia=0;s.board.boy_student.intrigue=2;s=incident(s,'conspiracies');
 assert.deepEqual(s.occurred,[1]);const text=JSON.stringify(legalActions(s));
 assert.match(text,/serial_murder/);assert.match(text,/missing/);
});

test('MZ uproar kills School and City occupants only when each location has intrigue',()=>{
 const s=fresh();s.board.boy_student.paranoia=99;s.locations.school=1;s.locations.city=0;
 const result=incident(s,'uproar');assert.equal(result.board.boy_student.alive,false);assert.equal(result.board.girl_student.alive,false);
 assert.equal(result.board.office_worker.alive,true);assert.equal(result.board.doctor.alive,true);
});

test('MZ breakthrough gives the protagonist leader the target choice',()=>{
 let s=fresh();s.board.boy_student.paranoia=99;s.locations.school=3;
 s=incident(s,'breakthrough');assert.equal(turn(s),'A');
 s=choose(s,a=>a.target==='school');assert.equal(s.locations.school,1);assert.equal(s.phase,'end_area');
});

test('MZ confession reveals the culprit and lets a ninja choose a claimed role',()=>{
 let s=fresh();s.script.roles.boy_student='ninja';s.script.roles.doctor='brain';s.board.boy_student.paranoia=99;
 s=incident(s,'confession');assert.equal(s.knownCulprits[1],'boy_student');assert.equal(s.phase,'reveal_role');
 s=act(s,{type:'reveal_role',role:'brain'});assert.equal(s.knownRoles.boy_student,'brain');assert.equal(s.phase,'end_area');
});

test('MZ fake incident uses culprit starting location, not its current location',()=>{
 let s=fresh();s.board.boy_student.location='city';s.board.boy_student.paranoia=99;s.locations.school=2;
 s=incident(s,'fake_incident','boy_student','suicide');assert.equal(s.phase,'between');assert.equal(s.board.boy_student.alive,true);
 let t=fresh();t.board.boy_student.location='city';t.board.boy_student.paranoia=99;t.locations.city=2;
 t=incident(t,'fake_incident','boy_student','suicide');assert.notEqual(t.phase,'between');
});

test('MZ fake incident announces only its public disguise, never its hidden type',()=>{
 const s=fresh();s.board.boy_student.paranoia=99;
 const result=incident(s,'fake_incident','boy_student','suicide');
 const publicLog=JSON.stringify(view(result,'A').log);
 assert.match(publicLog,/自杀/);assert.ok(!publicLog.includes('伪装事件'));assert.ok(!publicLog.includes('fake_incident'));
});

test('A.I. declares all simulated event targets before the mastermind refusal',()=>{
 let s=fresh();add(s,'ai_character','brain');s.board.ai_character.goodwill=3;s.phase='hero_ability';
 s.script.incidents=[{day:3,type:'unease',culprit:'boy_student'}];
 const action=legalActions(s).find(o=>o.command.actor==='ai_character'&&o.command.effectTarget==='boy_student'&&o.command.effectTo==='girl_student');
 assert.ok(action,'A.I. legal action must already name both event targets');
 s=act(s,action.command);assert.equal(s.phase,'refusal');assert.equal(s.pending.action.effectTarget,'boy_student');
 s=act(s,{type:'refusal',refuse:false});assert.equal(s.phase,'hero_ability');
 assert.equal(s.board.boy_student.paranoia,2);assert.equal(s.board.girl_student.intrigue,1);assert.deepEqual(s.occurred,[]);
});

test('A.I. simulates the public disguise of a fake incident, using itself as culprit',()=>{
 let s=fresh();add(s,'ai_character','brain');s.board.ai_character.goodwill=3;s.phase='hero_ability';s.locations.city=2;
 s.script.incidents=[{day:3,type:'fake_incident',publicType:'suicide',culprit:'boy_student'}];
 s=choose(s,a=>a.actor==='ai_character');s=act(s,{type:'refusal',refuse:false});
 assert.equal(s.board.ai_character.alive,false);assert.notEqual(s.phase,'between');assert.deepEqual(s.occurred,[]);
});

test('MZ deterministic revelation keeps the same response boundary as a disguise',()=>{
 let s=fresh();s.script.roles.office_worker='brain';s=askRole(s);
 const result=advanceAutomatic(s);assert.equal(result.reason,'boundary');assert.equal(result.state.phase,'reveal_role');s=act(s,legalActions(s)[0].command);assert.equal(s.knownRoles.office_worker,'brain');
});

test('MZ Secret Record counts a ninja publicly claiming Brain during this loop',()=>{
 let s=fresh();s.script.mainPlot='secret_record';s.script.roles.office_worker='ninja';s.script.roles.doctor='brain';
 s=askRole(s);s=act(s,{type:'reveal_role',role:'brain'});assert.equal(finish(s).phase,'between');
});

test('MZ Secret Record forgets previous-loop declarations even when public memory retains them',()=>{
 let s=fresh();s.script.mainPlot='secret_record';s.script.roles.office_worker='brain';
 s=askRole(s);s=act(s,{type:'reveal_role',role:'brain'});s=finish(s);s=act(s,{type:'next_loop'});
 assert.equal(s.knownRoles.office_worker,'brain');assert.equal(finish(s).winner,'heroes');
});

test('MZ Unanswered Heart makes Forbid Goodwill stop movement on the same character',()=>{
 let s=fresh();s.script.subPlots=['unanswered_heart'];
 for(const [card,target] of [['forbid_goodwill','girl_student'],['intrigue_1','hospital'],['paranoia_1','doctor'],['move_h','girl_student'],['goodwill_1','idol'],['goodwill_1','boy_student']]){
  s=act(s,{type:'place',card:card+'#0',target});
 }
 assert.equal(s.board.girl_student.location,'school');
 assert.ok(s.log.some(e=>e.type==='blocked'&&e.what==='move'&&e.who==='girl_student'));
});

test('MZ faked suicide places an EX card publicly and prevents protagonist action cards',()=>{
 let s=fresh();s.board.boy_student.paranoia=99;s=incident(s,'faked_suicide');
 assert.equal(s.board.boy_student.extra,true);assert.equal(view(s,'public').board.boy_student.extra,true);
 s.phase='hero_cards';assert.ok(!legalActions(s).some(o=>o.command.target==='boy_student'));
 s.phase='mm_cards';assert.ok(legalActions(s).some(o=>o.command.target==='boy_student'));
});

test('MZ Factor borrows abilities without changing its revealed role',()=>{
 let s=fresh();s.script.roles.office_worker='factor';s.locations.school=2;s.phase='mm_ability';
 assert.ok(legalActions(s).some(o=>o.command.actor==='office_worker'&&o.command.ability==='misleader'));
 s=askRole(s);s=act(s,{type:'reveal_role',role:'factor'});assert.equal(s.knownRoles.office_worker,'factor');
 s.locations.city=2;s.board.office_worker.paranoia=99;s=incident(s,'suicide','office_worker');assert.equal(s.phase,'between');
});

test('A.I. simulation of a disguised incident outside MZ has no effect',()=>{
 let s=fresh();add(s,'ai_character','brain');s.board.ai_character.goodwill=3;s.phase='hero_ability';s.locations.city=2;
 s.script.incidents=[{day:3,type:'fake_incident',publicType:'evil',culprit:'boy_student'}];
 s=choose(s,a=>a.actor==='ai_character');s=act(s,{type:'refusal',refuse:false});
 assert.equal(s.locations.shrine,0);assert.equal(s.phase,'hero_ability');assert.deepEqual(s.occurred,[]);
});

test('A.I. refusal cannot be followed by changing a previously declared event target',()=>{
 let s=fresh();add(s,'ai_character','brain');s.board.ai_character.goodwill=3;s.phase='hero_ability';
 s.script.incidents=[{day:3,type:'unease',culprit:'boy_student'}];
 s=choose(s,a=>a.actor==='ai_character'&&a.effectTarget==='boy_student'&&a.effectTo==='girl_student');
 s=act(s,{type:'refusal',refuse:true});assert.equal(s.phase,'hero_ability');
 assert.equal(s.board.boy_student.paranoia,0);assert.equal(s.board.girl_student.intrigue,0);
 assert.ok(!legalActions(s).some(o=>o.command.actor==='ai_character'));
});

test('MZ conspiracies can choose a murder with no available target and still finish',()=>{
 let s=fresh();s.board.boy_student.location='shrine';s.board.shrine_maiden.location='hospital';s.board.boy_student.intrigue=2;
 s=incident(s,'conspiracies');s=choose(s,a=>a.effect==='serial_murder');assert.equal(s.phase,'end_area');
 assert.ok(Object.values(s.board).every(c=>c.alive));
});

test('MZ magician shared movement becomes available again in the next loop',()=>{
 let s=fresh();s.script.roles.boy_student='magician';s.phase='mm_ability';s.board.girl_student.paranoia=1;
 s=choose(s,a=>a.actor==='boy_student'&&a.target==='girl_student');s.phase='between';s=act(s,{type:'next_loop'});
 s.phase='mm_ability';s.board.girl_student.paranoia=1;
 assert.ok(legalActions(s).some(o=>o.command.actor==='boy_student'&&o.command.target==='girl_student'));
});

test('MZ fated EX Friend dies as Key Person, without a false Friend declaration',()=>{
 let s=fresh();s.script.mainPlot='fated_connections';s.script.roles.boy_student='friend';s.board.boy_student.extra=true;s.board.boy_student.paranoia=99;
 s=incident(s,'suicide');assert.equal(s.phase,'between');assert.equal(s.knownRoles.boy_student,undefined);
 assert.ok(!s.log.some(e=>e.type==='reveal'&&e.who==='boy_student'));
});

test('MZ a previously revealed Friend gets its loop-start goodwill before EX role change',()=>{
 let s=fresh();s.script.mainPlot='fated_connections';s.script.roles.boy_student='friend';s.knownRoles.boy_student='friend';
 s.board.boy_student.alive=false;s.phase='between';s=act(s,{type:'next_loop'});
 assert.equal(s.board.boy_student.goodwill,1);s=act(s,{type:'setup_extra',target:'boy_student'});
 assert.equal(s.board.boy_student.extra,true);assert.equal(s.board.boy_student.goodwill,1);
});

test('MZ empty fake incidents are still occurrences but do not reveal a culprit',()=>{
 const s=fresh();s.board.boy_student.paranoia=99;
 const result=incident(s,'fake_incident','boy_student','suicide');assert.deepEqual(result.occurred,[1]);
 assert.deepEqual(view(result,'A').knownCulprits,{});assert.notEqual(result.phase,'between');
});

test('MZ an EX card alone does not forbid protagonist action cards before faked suicide',()=>{
 const s=fresh();s.script.subPlots=['dice_of_gods'];s.board.boy_student.extra=true;s.phase='hero_cards';
 assert.ok(legalActions(s).some(o=>o.command.target==='boy_student'));
});

test('MZ faked suicide also locks other EX cards already on the board',()=>{
 let s=fresh();s.board.girl_student.extra=true;s.board.boy_student.paranoia=99;
 s=incident(s,'faked_suicide');s.phase='hero_cards';
 assert.ok(!legalActions(s).some(o=>['boy_student','girl_student'].includes(o.command.target)));
 s.phase='between';s=act(s,{type:'next_loop'});s.phase='hero_cards';
 assert.ok(legalActions(s).some(o=>o.command.target==='boy_student'));
 assert.ok(legalActions(s).some(o=>o.command.target==='girl_student'));
 assert.equal(view(s,'A').flags.extraCardLock,false);
});

test('MZ EX placement cannot target a transfer student that is not yet on the new-loop board',()=>{
 let s=fresh();add(s,'transfer_student','person','school');s.script.settings.transferDay=2;
 s.script.mainPlot='fated_connections';s.board.transfer_student.alive=false;s.board.boy_student.alive=false;s.phase='between';
 s=act(s,{type:'next_loop'});assert.equal(s.board.transfer_student.present,false);
 assert.ok(!legalActions(s).some(o=>o.command.target==='transfer_student'));
 assert.ok(legalActions(s).some(o=>o.command.target==='boy_student'));
});

const hiddenAi=()=>{
 const s=fresh();s.script.settings.incidentVisibility='hidden';add(s,'ai_character','brain');
 s.board.ai_character.goodwill=3;s.phase='hero_ability';
 s.script.incidents=[{day:2,type:'unease',culprit:'boy_student'},{day:3,type:'suicide',culprit:'girl_student'}];
 return s;
};

test('hidden schedule A.I. initial menu is independent of every unselected incident type',()=>{
 const s=hiddenAi(),t=structuredClone(s);t.script.incidents[0].type='serial_murder';t.script.incidents[1].type='breakthrough';
 assert.deepEqual(view(s,'A'),view(t,'A'));
 const choices=legalActions(s).filter(o=>o.command.actor==='ai_character');assert.equal(choices.length,2);
 assert.ok(choices.every(o=>!Object.keys(o.command).some(k=>k.startsWith('effect'))));
 const rendered=JSON.stringify(view(s,'A'));assert.ok(!rendered.includes('unease'));assert.ok(!rendered.includes('suicide'));
});

test('hidden schedule A.I. chooses the day, then all targets, then allows refusal',()=>{
 let s=hiddenAi();s=choose(s,a=>a.actor==='ai_character'&&a.day===2);
 assert.equal(s.phase,'ai_target');assert.equal(turn(s),'A');assert.equal(s.knownIncidentTypes[2],'unease');
 assert.equal(s.board.boy_student.paranoia,0);
 s=choose(s,a=>a.target==='boy_student'&&a.to==='girl_student');assert.equal(s.phase,'refusal');
 assert.equal(s.pending.action.effectTarget,'boy_student');assert.equal(s.pending.action.effectTo,'girl_student');
 s=act(s,{type:'refusal',refuse:false});assert.equal(s.phase,'hero_ability');
 assert.equal(s.board.boy_student.paranoia,2);assert.equal(s.board.girl_student.intrigue,1);assert.deepEqual(s.occurred,[]);
});

test('hidden schedule A.I. selecting one day cannot reveal another day or either culprit',()=>{
 let s=hiddenAi();s=choose(s,a=>a.actor==='ai_character'&&a.day===2);
 const v=view(s,'A');assert.equal(v.knownIncidentTypes[2],'unease');
 assert.equal(v.script.incidents.find(e=>e.day===3).type,undefined);
 assert.ok(v.script.incidents.every(e=>e.culprit===undefined));assert.equal(v.secret,undefined);assert.equal(v.pending,undefined);
 assert.deepEqual(s.knownIncidentTypes,{2:'unease'});
 const t=structuredClone(s);t.script.incidents[1].type='hospital_incident';t.script.incidents[1].culprit='doctor';
 assert.deepEqual(view(s,'A'),view(t,'A'));
});

test('hidden schedule A.I. reveals the disguise, never the actual fake incident',()=>{
 let s=hiddenAi();s.script.incidents[0]={day:2,type:'fake_incident',publicType:'suicide',culprit:'boy_student'};
 s=choose(s,a=>a.actor==='ai_character'&&a.day===2);assert.equal(s.knownIncidentTypes[2],'suicide');
 const v=view(s,'A');assert.equal(v.knownIncidentTypes[2],'suicide');
 assert.ok(!JSON.stringify(v).includes('fake_incident'));
 if(s.phase==='ai_target')s=act(s,legalActions(s)[0].command);
 assert.equal(s.phase,'refusal');s=act(s,{type:'refusal',refuse:false});
 assert.equal(s.board.ai_character.alive,false);assert.deepEqual(s.occurred,[]);
});

test('hidden schedule target declaration remains visible even if A.I. refuses the request',()=>{
 let s=hiddenAi();s=choose(s,a=>a.actor==='ai_character'&&a.day===2);
 s=choose(s,a=>a.target==='boy_student'&&a.to==='girl_student');
 s=act(s,{type:'refusal',refuse:true});assert.equal(s.board.boy_student.paranoia,0);
 assert.equal(view(s,'A').knownIncidentTypes[2],'unease');
 assert.ok(!legalActions(s).some(o=>o.command.actor==='ai_character'));
});

const bossProphet=(role='prophet')=>{
 const s=fresh();add(s,'boss',role,'city');s.script.settings.bossTerritory='school';
 s.board.boy_student.paranoia=99;return s;
};

test('MZ Boss Prophet chooses its actual location or territory when checking an incident',()=>{
 let s=incident(bossProphet(),'unease');assert.equal(s.phase,'incident_check');assert.equal(turn(s),'M');
 const allowed=act(structuredClone(s),{type:'incident_check',territory:false});assert.deepEqual(allowed.occurred,[1]);
 const blocked=act(structuredClone(s),{type:'incident_check',territory:true});assert.deepEqual(blocked.occurred,[]);
 assert.equal(allowed.board.boss.location,'city');assert.equal(blocked.board.boss.location,'city');
});

test('MZ Boss Prophet may use its territory to avoid suppressing its actual location',()=>{
 const s=bossProphet();s.board.boy_student.location='city';const checking=incident(s,'unease');
 const blocked=act(structuredClone(checking),{type:'incident_check',territory:false});assert.deepEqual(blocked.occurred,[]);
 const allowed=act(structuredClone(checking),{type:'incident_check',territory:true});assert.deepEqual(allowed.occurred,[1]);
});

test('MZ Boss incident-check stage does not itself reveal whether the Boss is Prophet',()=>{
 const ordinary=incident(bossProphet('person'),'unease'),prophet=incident(bossProphet(),'unease');
 assert.equal(ordinary.phase,'incident_check');assert.equal(prophet.phase,'incident_check');
 assert.deepEqual(view(ordinary,'A'),view(prophet,'A'));
});

test('MZ equivalent Boss incident checks preserve the common public response boundary',()=>{
 const s=incident(bossProphet('person'),'unease');assert.equal(s.phase,'incident_check');
 const result=advanceAutomatic(s);assert.equal(result.reason,'boundary');assert.equal(result.state.phase,'incident_check');const next=act(s,legalActions(s)[0].command);assert.deepEqual(next.occurred,[1]);
});

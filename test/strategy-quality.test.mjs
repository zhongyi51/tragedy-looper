import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,applyCommand,turn,botCommand,botPlan,tacticalOptions,strategicBriefing,legalActions,view,sameCommand} from '../src/engine.mjs';
import {starter,generateScript,chars} from '../src/content.mjs';
import {silverBulletFixture,rescueMovementFixture,tacticalFixtures} from './fixtures/tactics.mjs';

const quietStep=s=>{
 const options=legalActions(s),choice=options.find(a=>a.command.type==='place'&&a.command.card==='goodwill_1#0'&&['hospital','shrine','school','city'].includes(a.command.target))
  ||options.find(a=>a.command.type==='pass')||options.find(a=>a.command.type==='refusal'&&!a.command.refuse)||options[0];
 assert.ok(choice);return applyCommand(s,turn(s),choice.command);
};
const finishDay=s=>{const day=s.day,loop=s.loop;for(let n=0;n<80&&s.day===day&&s.loop===loop&&!['over','between','guess'].includes(s.phase);n++)s=quietStep(s);return s;};

test('final-loop briefing retains Final Guess objectives for BTX, MZ and MC',()=>{
 for(const ruleset of ['BTX','MZ','MC']){
  const s=createGame(generateScript({ruleset,seed:31,loops:1,days:4}));
  for(const seat of ['M','A'])assert.match(strategicBriefing(s,seat).join('\n'),/最后的战斗/);
  assert.doesNotMatch(strategicBriefing(s,'M').join('\n'),/只要本轮回失败就能获胜/);
 }
 const s=createGame({...starter,loops:1});assert.doesNotMatch(strategicBriefing(s,'M').join('\n'),/最后的战斗/);
});

test('tactical fixtures are reproducible from complete legal histories, not patched positions',()=>{
 for(const fixture of tacticalFixtures()){
  let replay=createGame(fixture.script);
  for(const {seat,command} of fixture.commands){assert.equal(turn(replay),seat);replay=applyCommand(replay,seat,command);}
  assert.deepEqual(replay,fixture.state);assert.equal(turn(replay),fixture.targetSeat);
 }
});

test('MC A.I. recognizes a legal Silver Bullet opportunity and the engine confirms the win',()=>{
 const f=silverBulletFixture();let s=f.state;
 assert.equal(s.day,2);assert.equal(s.board.ai_character.goodwill,3);
 const command=botCommand(s);assert.equal(command.type,'goodwill');assert.equal(command.actor,'ai_character');assert.equal(command.day,3);
 s=applyCommand(s,turn(s),command);s=quietStep(s);s=applyCommand(s,turn(s),{type:'pass'});
 assert.equal(s.winner,'heroes');assert.match(tacticalOptions(f.state)[0].summary,/未知.*败北条件/);
});

test('known serial-killer isolation is answered with movement instead of irrelevant counter cleanup',()=>{
 const f=rescueMovementFixture(),s=f.state;
 assert.equal(s.knownRoles.office_worker,'serial_killer');assert.equal(s.board.idol.guard,0);
 const command=botCommand(s);assert.match(command.card,/^move_/);
 const rescued=finishDay(applyCommand(s,turn(s),command));assert.equal(rescued.board.idol.alive,true);assert.equal(rescued.loop,s.loop);assert.equal(rescued.day,s.day+1);
 const ignored=finishDay(quietStep(s));assert.equal(ignored.board.idol.alive,false);assert.equal(ignored.phase,'between');
});

test('hero tactics and references are invariant under a hidden-script counterfactual',()=>{
 const original=silverBulletFixture().state,other=structuredClone(original);
 [other.script.roles.informer,other.script.roles.journalist]=[other.script.roles.journalist,other.script.roles.informer];other.script.mainPlot='quilt_incidents';other.script.subPlots=['hidden_freak','absolute_will'];
 for(const e of other.script.incidents)e.culprit=other.script.characters.at(-1);
 assert.deepEqual(view(original,turn(original)),view(other,turn(other)));
 assert.deepEqual(tacticalOptions(original),tacticalOptions(other));assert.deepEqual(botCommand(original),botCommand(other));
});

test('MZ declared identities do not become certain final-battle answers',()=>{
 const s=createGame(generateScript({ruleset:'MZ',seed:83,days:4}));s.phase='guess';s.guessed={};
 const baseline=botCommand(s),refs=tacticalOptions(s),c=s.script.characters[0];s.knownRoles[c]='killer';
 assert.deepEqual(botCommand(s),baseline);assert.deepEqual(tacticalOptions(s),refs);
 s.guessed[c]='killer';assert.ok(legalActions(s).every(a=>a.command.character!==c));
});

test('final-battle quota inference can identify the last role instead of always guessing Person',()=>{
 const s=rescueMovementFixture().state;s.phase='guess';s.guessed={...s.script.roles};delete s.guessed.girl_student;
 const command=botCommand(s);assert.deepEqual(command,{type:'guess',character:'girl_student',role:'killer'});
 const result=applyCommand(s,turn(s),command);assert.equal(result.winner,'heroes');
});

test('journalist can trigger an identified informative incident rather than always passing',()=>{
 const script=generateScript({ruleset:'MZ',seed:7,days:5,incidentCount:3,characters:['journalist','girl_student','boy_student','office_worker','shrine_maiden','doctor','police','idol','soldier'],incidentVisibility:'public'});
 const e=script.incidents.find(e=>e.type!=='suicide');e.type='confession';delete e.publicType;if(e.culprit==='journalist'){const swap=script.incidents.find(x=>x!==e&&x.culprit!=='journalist');[e.culprit,swap.culprit]=[swap.culprit,e.culprit];}
 const s=createGame(script);s.phase='hero_ability';s.day=e.day;s.board.journalist.goodwill=2;s.knownCulprits[e.day]=e.culprit;s.board[e.culprit].paranoia=chars[e.culprit].paranoiaLimit-1;
 const command=botCommand(s);assert.equal(command.actor,'journalist');assert.equal(command.target,e.culprit);assert.equal(command.index,0);
});

test('tactical references are bounded legal commands and leave their source state unchanged',()=>{
 for(const fixture of tacticalFixtures()){
  const before=structuredClone(fixture.state),options=legalActions(before),refs=tacticalOptions(before,turn(before),200);
  assert.ok(refs.length<=5&&refs.length>0);for(const r of refs){assert.ok(options.some(o=>sameCommand(o.command,r.command)));assert.ok(Number.isFinite(r.score));assert.equal(typeof r.summary,'string');}
  assert.deepEqual(before,fixture.state);
 }
});

test('mastermind response-aware card planning remains a legal three-card sequence',()=>{
 const s=createGame(silverBulletFixture().script),before=structuredClone(s),plan=botPlan(s,'M',3);
 assert.equal(plan.length,3);assert.equal(new Set(plan.map(a=>a.card)).size,3);assert.equal(new Set(plan.map(a=>a.target)).size,3);
 let current=s;for(const command of plan)current=applyCommand(current,'M',command);
 assert.equal(current.phase,'hero_cards');assert.deepEqual(s,before);
});

test('MC mandatory Therapist chooses differently when the known script needs low versus high EX',()=>{
 const base=silverBulletFixture().script;
 const make=mainPlot=>{
  const script=structuredClone(base);script.mainPlot=mainPlot;
  script.roles=mainPlot==='tightrope_plan'?{informer:'brain',police:'twin',journalist:'misleader',ai_character:'therapist',soldier:'paranoiac',rich_girl:'paranoiac',boy_student:'killer',idol:'person'}:{informer:'paranoiac',police:'twin',journalist:'misleader',ai_character:'therapist',soldier:'paranoiac',rich_girl:'fool',boy_student:'person',idol:'person'};
  script.incidents=[{day:1,type:'portent',culprit:'police'},{day:2,type:'terrorism',culprit:'rich_girl'},{day:3,type:'silver_bullet',culprit:'journalist'}];
  const s=createGame(script);s.phase='mm_ability';s.extraGauge=mainPlot==='tightrope_plan'?1:2;s.board.police.paranoia=2;return s;
 };
 const low=make('tightrope_plan'),high=make('quilt_incidents');
 assert.equal(botCommand(low).ability,'therapist');assert.equal(botCommand(low).target,'police');
 assert.equal(botCommand(high).ability,'therapist');assert.notEqual(botCommand(high).target,'police');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,starter,generateScript,validateScript,publicScript} from '../src/content.mjs';
import {createGame,applyCommand,legalActions,view,turn,botCommand,hash} from '../src/engine.mjs';
const clone=x=>structuredClone(x),fresh=()=>createGame(starter);
const act=(s,a)=>applyCommand(s,turn(s),a);
const place=(s,card,target)=>act(s,{type:'place',card:card+'#0',target});
function round(cards){let s=fresh();for(const [c,t]of cards)s=place(s,c,t);if(s.phase==='cultist')s=act(s,{type:'cultist',mask:0});return s;}
test('all generated FS and BTX scripts validate and simulations terminate',()=>{for(let i=0;i<80;i++){const sc=generateScript({ruleset:i%2?'BTX':'FS',seed:i});assert.deepEqual(validateScript(sc).errors,[]);let s=createGame(sc),n=0;while(s.phase!=='over'&&n++<450)s=act(s,botCommand(s));assert.equal(s.phase,'over');}});
test('legal command equality is independent of JSON property order',()=>{const s=applyCommand(fresh(),'M',{target:'girl_student',card:'intrigue_1#0',type:'place'});assert.equal(s.placements.length,1);});
test('commands immutable; illegal target/repeated own targets rejected',()=>{const s=fresh(),before=hash(s);const next=place(s,'move_h','girl_student');assert.equal(hash(s),before);assert.throws(()=>place(next,'move_v','girl_student'));assert.throws(()=>place(s,'move_h','no_such_character'));});
test('movement horizontal + vertical combines into diagonal',()=>{const s=round([['move_h','girl_student'],['intrigue_1','hospital'],['paranoia_1','doctor'],['move_v','girl_student'],['goodwill_1','idol'],['goodwill_1','boy_student']]);assert.equal(s.board.girl_student.location,'hospital');});
test('same movement is applied only once',()=>{const s=round([['move_h','girl_student'],['intrigue_1','hospital'],['paranoia_1','doctor'],['move_h','girl_student'],['goodwill_1','idol'],['goodwill_1','boy_student']]);assert.equal(s.board.girl_student.location,'city');});
test('forbidden final destination prevents movement',()=>{const s=round([['move_h','office_worker'],['intrigue_1','hospital'],['paranoia_1','doctor'],['goodwill_1','girl_student'],['goodwill_1','idol'],['goodwill_1','boy_student']]);assert.equal(s.board.office_worker.location,'city');});
test('two forbid intrigue cards cancel globally across different targets',()=>{const s=round([['intrigue_1','girl_student'],['intrigue_2','hospital'],['paranoia_1','doctor'],['forbid_intrigue','girl_student'],['forbid_intrigue','hospital'],['goodwill_1','boy_student']]);assert.equal(s.board.girl_student.intrigue,1);assert.equal(s.locations.hospital,2);});
test('one prohibit intrigue blocks only its target',()=>{const s=round([['intrigue_1','girl_student'],['intrigue_2','hospital'],['paranoia_1','doctor'],['forbid_intrigue','girl_student'],['goodwill_1','idol'],['goodwill_1','boy_student']]);assert.equal(s.board.girl_student.intrigue,0);assert.equal(s.locations.hospital,2);});
test('once per loop card consumed even when cancelled',()=>{const s=round([['forbid_goodwill','girl_student'],['intrigue_1','hospital'],['paranoia_1','doctor'],['goodwill_2','girl_student'],['goodwill_1','idol'],['goodwill_1','boy_student']]);assert.equal(s.board.girl_student.goodwill,0);assert.ok(s.usedCards.A.includes('goodwill_2#0'));});
test('goodwill threshold is not a payment and separate skills available',()=>{let s=fresh();s.phase='hero_ability';s.board.idol.goodwill=4;const a=legalActions(s).filter(x=>x.command.actor==='idol');assert.ok(a.some(x=>x.command.index===0));assert.ok(a.some(x=>x.command.index===1));s=act(s,a[0].command);s=act(s,{type:'refusal',refuse:false});assert.equal(s.board.idol.goodwill,4);assert.ok(legalActions(s).some(x=>x.command.actor==='idol'&&x.command.index===1));});
test('refused once-per-loop ability consumes its use',()=>{let s=fresh();s.phase='hero_ability';s.board.shrine_maiden.goodwill=5;s.script.roles.shrine_maiden='killer';s=act(s,legalActions(s).find(x=>x.command.actor==='shrine_maiden'&&x.command.index===1).command);assert.equal(s.phase,'refusal');s=act(s,{type:'refusal',refuse:true});assert.ok(!legalActions(s).some(x=>x.command.actor==='shrine_maiden'&&x.command.index===1));});
test('serial killers kill each other simultaneously',()=>{let s=fresh();s.phase='hero_ability';s.script.incidents=[];s.script.roles.doctor='serial_killer';s.board.doctor.location='shrine';s=act(s,{type:'pass'});s=act(s,{type:'end_area',territory:false});assert.equal(s.board.doctor.alive,false);assert.equal(s.board.shrine_maiden.alive,false);});
test('dead culprit does not trigger a scheduled incident',()=>{let s=fresh();s.day=3;s.phase='hero_ability';s.board.girl_student.alive=false;s.board.girl_student.paranoia=3;s=act(s,{type:'pass'});assert.deepEqual(s.occurred,[]);assert.ok(s.log.some(e=>e.text.includes('没有发生')));});
test('First Steps never enters final battle',()=>{let s=fresh();s.loop=3;s.day=3;s.phase='hero_ability';s.board.girl_student.paranoia=3;s=act(s,{type:'pass'});assert.equal(s.phase,'over');assert.equal(s.winner,'mastermind');});
test('BTX final guesses are sequential and first wrong guess loses',()=>{let s=createGame(generateScript({ruleset:'BTX',seed:9}));s.phase='between';s=act(s,{type:'final_battle'});const c=s.script.characters[0],correct=s.script.roles[c];s=act(s,{type:'guess',character:c,role:correct});assert.equal(s.phase,'guess');const d=s.script.characters[1],wrong=s.script.roles[d]==='person'?'key_person':'person';s=act(s,{type:'guess',character:d,role:wrong});assert.equal(s.winner,'mastermind');});
test('loop reset restores cards/counters but keeps revealed knowledge',()=>{let s=fresh();s.phase='between';s.board.girl_student.goodwill=5;s.usedCards.A=['goodwill_2#0'];s.knownRoles.girl_student='key_person';s=act(s,{type:'next_loop'});assert.equal(s.loop,2);assert.equal(s.board.girl_student.goodwill,0);assert.deepEqual(s.usedCards.A,[]);assert.equal(s.knownRoles.girl_student,'key_person');});
test('hidden roles and culprit changes do not alter protagonist observations',()=>{let s=fresh(),t=fresh();[t.script.roles.girl_student,t.script.roles.boy_student]=[t.script.roles.boy_student,t.script.roles.girl_student];t.script.incidents[0].culprit='doctor';assert.deepEqual(view(s,'A'),view(t,'A'));assert.equal(view(s,'public').secret,undefined);assert.equal(publicScript(s.script).roles,undefined);});
test('placed secret faces do not enter opponent or public views',()=>{let s=place(fresh(),'intrigue_1','girl_student');assert.equal(view(s,'A').placements[0].card,undefined);assert.equal(view(s,'M').placements[0].card,'intrigue_1#0');assert.equal(view(s,'A').actions.length,0);});
test('replaying commands reproduces exact state hash without model calls',()=>{let s=fresh(),commands=[];while(s.phase!=='over'&&commands.length<250){const seat=turn(s),a=botCommand(s);commands.push({seat,a});s=applyCommand(s,seat,a);}let t=fresh();for(const {seat,a}of commands)t=applyCommand(t,seat,a);assert.equal(hash(s),hash(t));});
test('script validator rejects illegal cast and hidden custom rules',()=>{const s=clone(starter);s.roles.girl_student='person';assert.ok(validateScript(s).errors.length);const t=clone(starter);t.specialRules=['eval()'];assert.ok(validateScript(t).errors.length);});
test('all 24 characters expose only implemented ability candidates',()=>{let s=fresh();s.script.characters=catalog.characters.map(c=>c.id);s.script.roles=Object.fromEntries(s.script.characters.map(id=>[id,'person']));s.script.settings={godlyLoop:1,transferDay:1,bossTerritory:'school'};s.board=Object.fromEntries(s.script.characters.map(id=>[id,{id,initial:'school',location:'school',present:true,alive:true,goodwill:7,paranoia:5,intrigue:1,guard:1}]));s.phase='hero_ability';s.loop=2;s.usedCards.A=['goodwill_2#0'];s.occurred=[3];const options=legalActions(s);for(const o of options){const next=act(s,o.command);assert.equal(next.revision,1);}assert.ok(options.length>100);});
test('every resolved or cancelled card effect is logged with its subject and source, and traced as a beat',()=>{
 let s=fresh();const cards=[['forbid_goodwill','girl_student'],['move_h','office_worker'],['paranoia_1','doctor'],['goodwill_2','girl_student'],['goodwill_1','idol'],['goodwill_1','hospital']];
 for(const [c,t] of cards.slice(0,5))s=place(s,c,t);
 const before=s.log.length,beats=[];s=applyCommand(s,turn(s),{type:'place',card:'goodwill_1#0',target:'hospital'},beats);if(s.phase==='cultist')s=applyCommand(s,turn(s),{type:'cultist',mask:0},beats);
 const added=s.log.slice(before),of=type=>added.filter(e=>e.type===type).map(e=>[e.who,e.by].filter(Boolean).join('<'));
 assert.deepEqual(added.map(e=>e.type).slice(0,2),['placed','cards']);
 assert.deepEqual(of('blocked').sort(),['girl_student<M','office_worker']);assert.deepEqual(of('counter').sort(),['doctor<M','idol<B']);assert.deepEqual(of('card_effect'),['hospital<C']);
 assert.equal(beats.length,added.length);assert.deepEqual(beats.map(b=>b.log),added.map(e=>e.n));
 const flip=beats[1],tick=beats[added.findIndex(e=>e.type==='counter'&&e.who==='doctor')];
 assert.equal(flip.phase,'cultist');assert.equal(flip.dayRevealed.length,6);assert.equal(flip.board.doctor.paranoia,0);assert.equal(tick.board.doctor.paranoia,1);
});
test('a day ends with its own log entry and a failed loop is marked as such',()=>{
 let s=fresh();s.phase='end';s=act(s,{type:'pass'});
 assert.deepEqual(s.log.slice(-2).map(e=>[e.type,e.day]),[['dayend',1],['day',2]]);
 s.day=s.script.days;s.phase='end';s.loopFailed=true;s=act(s,{type:'pass'});
 assert.deepEqual(s.log.slice(-2).map(e=>e.type),['dayend','failed']);assert.equal(s.phase,'between');
});
test('every entry records the phase it happened in',()=>{
 let s=round([['intrigue_1','doctor'],['paranoia_1','idol'],['move_h','office_worker'],['goodwill_1','girl_student'],['goodwill_1','idol'],['goodwill_1','boy_student']]);
 const phaseOf=type=>[...new Set(s.log.filter(e=>e.type===type).map(e=>e.phase))];
 assert.deepEqual(phaseOf('loop'),['setup']);assert.deepEqual(phaseOf('placed'),['mm_cards','hero_cards']);
 for(const type of ['cards','blocked','counter'])assert.deepEqual(phaseOf(type),['cultist'],type);
 s=act(s,{type:'mm',actor:'doctor',ability:'brain',target:'doctor'});assert.equal(s.log.at(-1).phase,'mm_ability');
 // The incident check and what follows from it belong to the incident phase, not the one that was passed.
 s.day=3;s.phase='hero_ability';s.board.girl_student.paranoia=3;s=act(s,{type:'pass'});
 assert.deepEqual(s.log.slice(-3).map(e=>[e.type,e.phase]),[['incident','incident'],['death','incident'],['failed','incident']]);
});
test('a failed loop says when it ended and what the table saw, without naming the hidden rule',()=>{
 let s=fresh();s.day=3;s.phase='hero_ability';s.board.girl_student.paranoia=3;s=act(s,{type:'pass'});
 let failed=s.log.at(-1);assert.equal(failed.when,'death');assert.deepEqual(failed.dead,['girl_student']);assert.match(failed.text,/^第 1 轮回失败：女学生死亡，轮回立即结束。$/);
 s=fresh();s.day=3;s.phase='end';s.loopFailed=true;s.locations.school=2;s.board.doctor.intrigue=1;s=act(s,{type:'pass'});
 failed=s.log.at(-1);assert.equal(failed.when,'end');assert.equal(failed.phase,'end');assert.deepEqual(failed.intrigue,{school:2,doctor:1});assert.match(failed.text,/最后一天结束时判定/);
 s=fresh();s.phase='end';s.board.office_worker.intrigue=4;s=act(s,{type:'end_ability',actor:'office_worker',ability:'heroes'});
 assert.deepEqual(s.log.slice(-2).map(e=>[e.type,e.when]),[['death',undefined],['failed','heroes']]);
 // The entry names who died, never the role that made the death matter.
 s=fresh();s.phase='end_area';for(const id of ['girl_student','boy_student'])s.board[id].location='shrine';s.board.shrine_maiden.location='shrine';s.board.boy_student.location='city';
 s=act(s,{type:'end_area',territory:false});assert.deepEqual(s.log.at(-1).dead,['girl_student']);
 for(const e of s.log)assert.doesNotMatch(e.text,/关键人物|连环杀手|杀手/);
});
test('cards that end up doing nothing are marked, and a cancelled or ignored Forbid Intrigue is logged',()=>{
 const voids=s=>view(s,'A').revealedCards.filter(p=>p.void).map(p=>p.seat+'@'+p.target).sort();
 // One Forbid Intrigue works: the mastermind's Intrigue under it is cancelled.
 let s=round([['intrigue_1','doctor'],['paranoia_1','idol'],['move_h','office_worker'],['forbid_intrigue','doctor'],['goodwill_1','idol'],['goodwill_1','boy_student']]);
 let entry=s.log.find(e=>e.type==='blocked'&&e.who==='doctor');
 assert.deepEqual([entry.what,entry.by,entry.hit],['intrigue','A',['M']]);assert.equal(s.board.doctor.intrigue,0);assert.ok(voids(s).includes('M@doctor'));assert.ok(!voids(s).includes('A@doctor'));
 // Two on the same day cancel each other, and the Intrigue goes through.
 s=round([['intrigue_1','doctor'],['paranoia_1','idol'],['move_h','office_worker'],['forbid_intrigue','doctor'],['forbid_intrigue','hospital'],['goodwill_1','idol']]);
 assert.deepEqual(s.log.filter(e=>e.type==='voided').map(e=>[e.who,e.hit[0]]),[['doctor','A'],['hospital','B']]);assert.match(s.log.find(e=>e.type==='voided').text,/同一天出了 2 张/);
 assert.equal(s.board.doctor.intrigue,1);assert.ok(['A@doctor','B@hospital'].every(x=>voids(s).includes(x)));assert.ok(!voids(s).includes('M@doctor'));
 // A hidden ability that ignores the ban is visible on the table as the ban failing.
 s=fresh();for(const [c,t] of [['intrigue_1','doctor'],['paranoia_1','idol'],['move_h','office_worker'],['forbid_intrigue','doctor'],['goodwill_1','idol'],['goodwill_1','boy_student']])s=place(s,c,t);
 s.cultists=['doctor'];s=act(s,{type:'cultist',mask:1});entry=s.log.find(e=>e.type==='ignored');
 assert.deepEqual([entry.who,entry.what,entry.hit],['doctor','intrigue',['A']]);assert.equal(s.board.doctor.intrigue,1);assert.deepEqual(voids(s).filter(x=>x.endsWith('@doctor')),['A@doctor']);
 // A move that cannot be made and a card wasted on a location are marked too.
 s=round([['move_h','office_worker'],['paranoia_1','idol'],['intrigue_1','doctor'],['goodwill_1','hospital'],['goodwill_1','idol'],['goodwill_1','boy_student']]);
 assert.ok(['A@hospital','M@office_worker'].every(x=>voids(s).includes(x)),voids(s).join());
});

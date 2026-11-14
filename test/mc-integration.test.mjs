import test from 'node:test';
import assert from 'node:assert/strict';
import {generateScript} from '../src/content.mjs';
import {createGame,applyCommand,legalActions,turn,view,hash,advanceAutomatic} from '../src/engine.mjs';
import {playStep,stepReport,project} from '../src/play.mjs';

const cast=['boy_student','girl_student','shrine_maiden','office_worker','idol','doctor','police','patient'];
const fresh=(options={})=>createGame(generateScript({ruleset:'MC',seed:2026111441,title:'MC 集成验证',
 mainPlot:'strychnine',subPlots:['dance_fools','master_detective'],characters:cast,
 days:5,loops:3,incidentCount:3,incidentVisibility:'hidden',...options}));
const act=(s,command)=>applyCommand(s,turn(s),command);
const role=(s,id)=>Object.keys(s.script.roles).find(c=>s.script.roles[c]===id);
const sanitize=v=>{
 assert.equal(v.secret,undefined);assert.equal(v.pending,undefined);
 assert.equal(v.script.roles,undefined);assert.equal(v.script.mainPlot,undefined);assert.equal(v.script.subPlots,undefined);
 for(const event of v.script.incidents){assert.equal(event.culprit,undefined);if(v.script.settings.incidentVisibility==='hidden')assert.equal(event.type,undefined);}
};

// These two controlled states have the same visible board. Their private role
// maps deliberately differ to isolate an information-boundary counterfactual.
function poisonBoundary(present){
 let s=fresh();
 if(!present)s.script.roles[role(s,'poisoner')]='person';
 for(const c of Object.values(s.board))c.location='city';
 s.day=Array.from({length:s.script.days},(_,i)=>i+1).find(day=>!s.script.incidents.some(e=>e.day===day));
 s.extraGauge=2;s.phase='hero_ability';
 s=act(s,{type:'pass'});assert.equal(s.phase,'end_area');
 s=act(s,{type:'end_area',territory:false});assert.equal(s.phase,'end_forced');
 return s;
}

test('MC poisoner and empty forced queues expose the same public response boundary',()=>{
 const yes=poisonBoundary(true),no=poisonBoundary(false);
 for(const s of [yes,no]){
  const advance=advanceAutomatic(s);
  assert.equal(advance.reason,'boundary');assert.equal(advance.steps.length,0);
  sanitize(view(s,'A'));
 }
 assert.deepEqual(view(yes,'A'),view(no,'A'));
 assert.deepEqual(view(yes,'public'),view(no,'public'));
});

test('MC public decision metadata does not distinguish forced, optional, or no-effect mastermind work',()=>{
 for(const phase of ['mm_ability','end_area','end_forced'])for(const mode of ['heroes','observe']){
  const initial=fresh();initial.phase=phase;
  const base={initial,frames:[],seat:'M',mode};
  for(const [route,answer] of [['ai-step',{automatic:true}],['ai-step',{automatic:false,reason:'秘密角色决策'}],['bot-step',null],['advance',null]]){
   const report=stepReport({...base,route,answer});
   assert.deepEqual(report.decision,{controller:'剧作家',seat:'M'});
  }
 }
});

test('MC zero-effect therapy cannot add an observable request or revision to consecutive responses',async t=>{
 let yes=fresh({mainPlot:'black_school',subPlots:['isolated_psycho','tricky_twins']});
 yes.extraGauge=1;for(const c of Object.values(yes.board)){c.location='city';c.paranoia=0;}
 let no=structuredClone(yes);const source=role(yes,'therapist');no.script.roles[source]='person';
 const placements=[['move_h#0','hospital'],['move_v#0','shrine'],['move_d#0','city'],['move_h#0','hospital'],['move_h#0','shrine']];
 for(const [card,target] of placements){yes=act(yes,{type:'place',card,target});no=act(no,{type:'place',card,target});}
 assert.deepEqual(view(yes,'A'),view(no,'A'));
 let calls=0;t.mock.method(globalThis,'fetch',async(_url,init)=>{
  calls++;const observation=JSON.parse(JSON.parse(init.body).messages[2].content).observation;
  const pass=observation.actions.find(a=>a.command.type==='pass');assert.ok(pass,'no hidden therapist response should be required before the ordinary pass');
  return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify({choice:pass.choice,note:'日常决策'})}}]}),{status:200});
 });
 const phases=[];
 for(const route of ['command','ai-step']){
  const params={mode:'heroes',route,command:{type:'place',card:'move_h#0',target:'city'},ai:{apiKey:'mc_test_fake_key'}};
  const a=await playStep({...params,state:yes}),b=await playStep({...params,state:no});
  const va=project('heroes',a.frames.at(-1).state),vb=project('heroes',b.frames.at(-1).state);
  assert.deepEqual(va,vb,'same public board must produce the same next response, including phase and revision');
  assert.deepEqual(stepReport({initial:yes,...a,...params}),stepReport({initial:no,...b,...params}));
  yes=a.frames.at(-1).state;no=b.frames.at(-1).state;phases.push(yes.phase);
 }
 assert.equal(phases[0],'mm_ability');assert.notEqual(phases[1],'mm_ability');assert.equal(calls,2);
 assert.ok(!legalActions({...yes,phase:'mm_ability'}).some(a=>a.command.ability==='therapist'&&a.command.actor===source),'the forced no-effect ability is still consumed');
});

test('MC no-effect poisoner selection is saved and replayed without naming the hidden poisoner',async t=>{
 const initial=poisonBoundary(true),target=role(initial,'private_investigator'),source=role(initial,'poisoner');
 const chosen=legalActions(initial).find(a=>a.command.type==='end_forced'&&a.command.target===target);
 assert.ok(chosen,'the immortal investigator is a legal poison target');
 let calls=0;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  calls++;const observation=JSON.parse(JSON.parse(init.body).messages[2].content).observation;
  const selected=observation.actions.find(a=>a.command.type==='end_forced'&&a.command.target===target);assert.ok(selected);
  return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify({choice:selected.choice,note:'已处理'})}}]}),{status:200});
 });
 const result=await playStep({state:initial,mode:'heroes',route:'ai-step',ai:{apiKey:'mc_test_fake_key'}});
 assert.equal(calls,1);assert.ok(result.frames.length);
 const settled=result.frames.at(-1).state;assert.equal(settled.board[target].alive,true);
 const added=settled.log.slice(initial.log.length);
 assert.ok(!added.some(e=>e.who===source||/毒杀|毒使/.test(e.text||'')),'a failed hidden poison attempt must not identify its source');
 let restored=JSON.parse(JSON.stringify(initial));
 for(const f of result.frames)restored=applyCommand(restored,f.seat,f.command);
 // AI private notes are deliberately persisted outside engine commands.
 restored.notes=structuredClone(settled.notes);assert.equal(hash(restored),hash(settled));
 const report=stepReport({initial,...result,mode:'heroes',route:'ai-step'});
 assert.deepEqual(report.decision,{controller:'剧作家',seat:'M'});
 for(const frame of report.transitionFrames)sanitize(frame);
 sanitize(project('heroes',settled));
});

for(const mode of ['heroes','mastermind','observe'])for(const incidentVisibility of ['hidden','public'])test(`MC playStep completes and replays ${mode}/${incidentVisibility} without a provider`,async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('offline MC game unexpectedly invoked a provider');});
 const initial=fresh({seed:2026111450+(mode==='heroes'?0:mode==='mastermind'?10:20)+(incidentVisibility==='public'?1:0),
  mainPlot:'black_school',subPlots:['isolated_psycho','tricky_twins'],incidentVisibility});
 let state=initial,commands=[],steps=0;
 while(!state.winner){
  assert.ok(steps++<500,'play adapter did not reach a terminal outcome');
  const before=state,result=await playStep({state,mode,route:'bot-step'});
  assert.ok(result.frames.length,'bot step must make progress');
  for(const f of result.frames){assert.ok(f.state.revision>state.revision);state=f.state;commands.push({seat:f.seat,command:f.command});}
  const response=stepReport({initial:before,...result,mode,route:'bot-step'});
  if(mode!=='mastermind'){sanitize(project(mode,state));for(const frame of response.transitionFrames)sanitize(frame);}
  const restored=JSON.parse(JSON.stringify(state));assert.equal(hash(restored),hash(state));
  assert.deepEqual(legalActions(restored),legalActions(state));state=restored;
 }
 assert.equal(calls,0);assert.ok(['heroes','mastermind'].includes(state.winner));
 let replay=initial;for(const {seat,command} of commands)replay=applyCommand(replay,seat,command);
 assert.equal(hash(replay),hash(state));
 assert.equal(turn(state),null);assert.deepEqual(legalActions(state),[]);
});

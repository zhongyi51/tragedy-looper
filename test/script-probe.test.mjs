import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame,applyCommand,view} from '../src/engine.mjs';
import {getCuratedScript,listCuratedScripts} from '../src/script-library.mjs';
import {probeScript,probeHeroCommand,PROBE_VERSION} from '../src/script-probe.mjs';

const thorough={profiles:4,maxCommands:1600,maxCommandsPerTrace:400,maxMs:5000,seed:23};
const stable=result=>{const {elapsedMs,...rest}=result;return rest;};

test('bounded engine probes execute every curated set without changing the script',()=>{
 for(const {id}of listCuratedScripts()){
  const script=getCuratedScript(id),before=structuredClone(script),r=probeScript(script,thorough);
  assert.deepEqual(script,before);assert.equal(r.version,PROBE_VERSION);assert.equal(r.scope,'private');
  assert.notEqual(r.status,'invalid');assert.notEqual(r.status,'error',JSON.stringify(r));
  assert.ok(r.commands>0&&r.commands<=thorough.maxCommands);
  assert.equal(r.traces.length,4);assert.ok(r.traces.every(t=>t.commands<=thorough.maxCommandsPerTrace&&!t.error));
  assert.ok(r.traces.some(t=>t.status==='terminal'),id+' has an observed engine terminal');
  assert.ok(r.traces.every(t=>!('state' in t)&&!('board' in t)&&!('script' in t)&&!('history' in t)));
  assert.match(r.note,/不代表无解/);assert.match(r.note,/不代表平衡/);
  assert.equal(r.accepted,undefined);assert.equal(r.balanceScore,undefined);
 }
});

test('identical seeds and fixed command budgets give identical legal probe paths',()=>{
 const script=getCuratedScript('curated-second-chime'),limits={profiles:3,maxCommands:150,maxCommandsPerTrace:50,maxMs:5000,seed:97};
 const a=probeScript(script,limits),b=probeScript(script,limits);
 assert.deepEqual(stable(a),stable(b));assert.equal(a.commands,150);assert.equal(a.status,'limited');
 assert.ok(a.traces.every(t=>t.status==='command_limit'&&t.commands===50&&t.winner===null));
 assert.equal(a.observations.completedTraces,0);
});

test('total, per-trace and wall-clock limits remain explicit instead of passing unfinished games',t=>{
 const script=getCuratedScript('curated-shrine-echo');
 for(const maxCommands of [0,1,7]){
  const r=probeScript(script,{profiles:4,maxCommands,maxCommandsPerTrace:100,maxMs:5000});
  assert.equal(r.commands,maxCommands);assert.equal(r.status,'limited');assert.equal(r.limitedBy,'total_commands');
  assert.equal(r.observations.completedTraces,0);assert.ok(r.traces.every(t=>t.winner===null));
 }
 const per=probeScript(script,{profiles:3,maxCommands:100,maxCommandsPerTrace:2,maxMs:5000});
 assert.equal(per.commands,6);assert.equal(per.limitedBy,'trace_commands');assert.ok(per.traces.every(t=>t.status==='command_limit'));
 const zero=probeScript(script,{maxMs:0});assert.equal(zero.commands,0);assert.equal(zero.status,'limited');assert.equal(zero.limitedBy,'time');
 let tick=0;t.mock.method(Date,'now',()=>tick++);
 const timed=probeScript(script,{profiles:2,maxCommands:100,maxCommandsPerTrace:100,maxMs:7});
 assert.equal(timed.limitedBy,'time');assert.ok(timed.commands<=2);assert.ok(timed.elapsedMs<=9);
});

test('frozen Worker clocks still terminate at the hard command cap',t=>{
 t.mock.method(Date,'now',()=>1000);
 const result=probeScript(getCuratedScript('curated-shrine-echo'),{profiles:4,maxCommands:12,maxCommandsPerTrace:100,maxMs:1});
 assert.equal(result.status,'limited');assert.equal(result.commands,12);assert.equal(result.limitedBy,'total_commands');
 assert.equal(result.elapsedMs,0);assert.equal(result.clockGuard,'best_effort');
});

test('hero probe choices are invariant under hidden assignments and ignore misleading private design',()=>{
 const first=getCuratedScript('curated-last-ward'),second=structuredClone(first);
 [second.roles.doctor,second.roles.office_worker]=[second.roles.office_worker,second.roles.doctor];
 second.privateDesign={counterplay:'SECRET_FALSE_PLAN',mainPlot:'SECRET_FAKE_RULE'};
 const heroState=script=>{let s=createGame(script);for(const [card,target]of [['move_h#0','hospital'],['move_v#0','shrine'],['forbid_goodwill#0','city']])s=applyCommand(s,'M',{type:'place',card,target});return s;};
 const a=view(heroState(first),'A'),b=view(heroState(second),'A');
 assert.deepEqual(a,b);
 for(const seed of [0,1,37,999])for(const exploration of [false,true]){
  assert.deepEqual(probeHeroCommand(a,{seed,exploration}),probeHeroCommand(b,{seed,exploration}));
  assert.deepEqual(probeHeroCommand(a,{seed,exploration}),probeHeroCommand({...a,secret:{roles:second.roles},privateDesign:second.privateDesign},{seed,exploration}));
 }
 assert.doesNotMatch(JSON.stringify(a),/SECRET_FALSE_PLAN|SECRET_FAKE_RULE/);
});

test('MZ declarations do not act as a correct-role oracle in final guesses',()=>{
 const v={script:{ruleset:'MZ'},phaseId:'guess',board:{},knownRoles:{doctor:'brain'},guessed:{},knownPlots:[],knownCulprits:{},actions:[{command:{type:'guess',character:'doctor',role:'brain'}},{command:{type:'guess',character:'doctor',role:'person'}}]};
 assert.equal(probeHeroCommand(v).role,'person');
 v.guessed={doctor:'brain'};assert.equal(probeHeroCommand(v).role,'brain');
});

test('invalid scripts and execution errors are distinguishable from limited coverage',()=>{
 const script=getCuratedScript('curated-last-ward'),broken=structuredClone(script);broken.roles.doctor='not-a-role';
 const invalid=probeScript(broken);assert.equal(invalid.status,'invalid');assert.equal(invalid.commands,0);assert.ok(invalid.errors.length);assert.deepEqual(invalid.traces,[]);
 // Unsupported non-JSON metadata forces createGame's clone to fail without
 // touching valid rules; the probe must report an execution error, not success.
 const uncloneable={...script,privateDesign:{callback(){}}};
 const error=probeScript(uncloneable,{maxMs:5000});assert.equal(error.status,'error');assert.equal(error.commands,0);assert.ok(error.traces.every(t=>t.status==='error'&&t.error));
});

test('live-authored regression samples are probed as actual scripts without trusting their prose',()=>{
 for(const [file,sets]of [['v06-reviewed-completion-qa.json',['BTX','MZ']],['v06-reviewed-fs-completion-qa.json',['FS']],['v06-constrained-mc-qa.json',['MC']]]){
  const report=JSON.parse(readFileSync(new URL('../reports/'+file,import.meta.url),'utf8'));
  for(const set of sets){const script=report.play[set].authoredScript,original=structuredClone(script);const result=probeScript(script,{profiles:2,maxCommands:120,maxCommandsPerTrace:60,maxMs:5000,seed:18});assert.ok(['limited','completed'].includes(result.status),set);assert.deepEqual(script,original);assert.equal(result.commands,result.traces.reduce((n,t)=>n+t.commands,0));}
 }
});

test('probe option limits cannot request an unbounded workload',()=>{
 const script=getCuratedScript('curated-last-ward');
 for(const options of [{profiles:0},{profiles:5},{maxCommands:1601},{maxCommandsPerTrace:801},{maxMs:5001},{maxMs:-1},{seed:Infinity},{seed:-1},{maxCommands:1.5}])assert.throws(()=>probeScript(script,options),RangeError);
});

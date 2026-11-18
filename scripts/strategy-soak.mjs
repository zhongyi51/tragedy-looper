// Offline legality, termination and planning-budget soak. No model/API calls.
// node scripts/strategy-soak.mjs --games-per-set=60 --seed-start=500 --days=4 --loops=2
import {generateScript} from '../src/content.mjs';
import {VERSION,STRATEGY_PLAN_LIMITS,createGame,turn,botCommand,botPlan,applyCommand,strategyPlans} from '../src/engine.mjs';

const flags=new Map();
for(const arg of process.argv.slice(2)){
 const match=arg.match(/^--(games-per-set|seed-start|days|loops|max-commands|sets)=(.+)$/);
 if(!match)throw Error('Use --games-per-set=N --seed-start=N --days=N --loops=N --max-commands=N --sets=FS,BTX,MZ,MC');
 flags.set(match[1],match[2]);
}
const integer=(key,fallback,min,max)=>{
 const value=Number(flags.get(key)??fallback);
 if(!Number.isInteger(value)||value<min||value>max)throw Error(`Invalid --${key}: expected an integer in ${min}..${max}`);
 return value;
};
const parameters={gamesPerSet:integer('games-per-set',60,1,10000),seedStart:integer('seed-start',500,0,1e9),days:integer('days',4,1,10),loops:integer('loops',2,1,8),maxCommands:integer('max-commands',700,1,10000),sets:(flags.get('sets')||'FS,BTX,MZ,MC').split(',')};
if(new Set(parameters.sets).size!==parameters.sets.length||parameters.sets.some(set=>!['FS','BTX','MZ','MC'].includes(set)))throw Error('Invalid --sets');
const start=performance.now(),stats={games:0,commands:0,maxGameMs:0,maxDecisionMs:0,maxPlanCommands:0,truncatedResponses:0,bySet:{}};
for(const ruleset of parameters.sets){
 const group={games:0,heroes:0,mastermind:0,maxCommands:0};
 for(let i=0;i<parameters.gamesPerSet;i++){
  const seed=parameters.seedStart+i;
  let s=createGame(generateScript({ruleset,seed,days:parameters.days,loops:parameters.loops})),steps=0;
  const began=performance.now();
  while(s.phase!=='over'&&steps<parameters.maxCommands){
   const seat=turn(s),deciding=performance.now();let commands;
   if(s.phase==='mm_cards'){
    const plans=strategyPlans(s,seat,3);
    stats.maxPlanCommands=Math.max(stats.maxPlanCommands,plans[0]?.budget.commandsApplied||0);
    if(plans.some(plan=>plan.budget.commandsApplied>STRATEGY_PLAN_LIMITS.maxCommands))throw Error(`Planning budget exceeded: ${ruleset} seed ${seed}`);
    stats.truncatedResponses+=plans.reduce((n,p)=>n+p.observedOutcomes.filter(o=>!o.complete).length,0);
    commands=botPlan(s,seat,3);
   }else commands=[botCommand(s,seat)];
   stats.maxDecisionMs=Math.max(stats.maxDecisionMs,performance.now()-deciding);
   if(!commands.length)throw Error(`Empty plan: ${ruleset} seed ${seed}`);
   // applyCommand performs the real engine's legality validation on every move.
   for(const command of commands){s=applyCommand(s,seat,command);steps++;}
  }
  if(s.phase!=='over')throw Error(`Did not terminate: ${ruleset} seed ${seed}, phase ${s.phase}, ${steps} commands`);
  stats.commands+=steps;stats.games++;stats.maxGameMs=Math.max(stats.maxGameMs,performance.now()-began);
  group.games++;group[s.winner]++;group.maxCommands=Math.max(group.maxCommands,steps);
 }
 stats.bySet[ruleset]=group;
}
console.log(JSON.stringify({engineVersion:VERSION,nodeVersion:process.version,parameters,planningLimits:STRATEGY_PLAN_LIMITS,...stats,elapsedMs:Math.round(performance.now()-start)},null,2));

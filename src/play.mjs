// Table logic shared by the local server and the hosted Worker: who may act,
// what each player may see, and how one step turns into saved frames.
import {view,turn,applyCommand,botCommand,advanceAutomatic,transitionFrames} from './engine.mjs';
import {decide,decisionSummary} from './ai.mjs';

export const MODES=['heroes','mastermind','observe'];
export const STEP_ROUTES=['command','ai-step','bot-step','advance'];

export class PlayError extends Error{
 constructor(status,message,code='HTTP_'+status){super(message);this.status=status;this.code=code;}
}

const heroSeat=state=>{const seat=turn(state);return seat&&seat!=='M'?seat:'A';};
const viewerSeat=(mode,state)=>mode==='mastermind'?'M':mode==='observe'?'public':heroSeat(state);
export const humanControls=(mode,seat)=>mode==='heroes'?seat!=='M':mode==='mastermind'?seat==='M':false;

// A human protagonist holds all three hands, so they get the team view.
export const project=(mode,state)=>view(state,viewerSeat(mode,state),{team:mode==='heroes'});

// One row of the saved-games list. Spend stays hidden until the end, like the usage log.
export function saveSummary(row){
 const state=JSON.parse(row.state),over=state.phase==='over';
 return {id:row.id,mode:row.mode,created:row.created,title:state.script.title,phase:state.phase,loop:state.loop,day:state.day,winner:state.winner,spent:over?row.spent:null};
}

// Returns the frames to persist. Throws before any model request when the
// route does not match whoever controls the active seat.
export async function playStep({state,mode,route,command,ai={}}){
 const seat=turn(state);
 if(!seat)throw new PlayError(400,'这一局已经结束','GAME_OVER');
 const human=humanControls(mode,seat);
 if(route==='command'&&!human)throw new PlayError(403,'现在轮到对手','NOT_YOUR_TURN');
 if(route==='ai-step'&&human)throw new PlayError(403,'现在轮到你；想让机器人替你走，请点“代走”','HUMAN_TURN');
 const automatic={includeBetween:mode!=='heroes',trace:true};
 if(route==='advance')return {seat,frames:advanceAutomatic(state,automatic).steps,answer:null};
 let answer=null,commands;
 if(route==='ai-step'){answer=await decide(state,seat,ai);commands=answer.commands;}
 else commands=[route==='bot-step'?botCommand(state,seat):command];
 const frames=[];let current=state;
 for(const next of commands){const beats=[];current=applyCommand(current,seat,next,beats);frames.push({seat,command:next,state:current,beats});}
 if(answer)current.notes[seat]=answer.note||current.notes[seat];
 frames.push(...advanceAutomatic(current,automatic).steps);
 return {seat,frames,answer};
}

// What the acting client receives besides the new projection: the visible
// intermediate frames and who decided.
export const stepReport=({mode,route,seat,answer,initial,frames,decorate=v=>v})=>({
 transitionFrames:transitionFrames(state=>decorate(project(mode,state)),initial,frames),
 // True reveals and Ninja disguises share a public response boundary; do not
 // disclose whether the mastermind had an optional choice through metadata.
 decision:['reveal_role','incident_check'].includes(initial.phase)&&mode!=='mastermind'?{controller:'剧作家',seat:'M'}:decisionSummary(route,seat,answer)
});

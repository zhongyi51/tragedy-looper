// Only the chosen constraints travel to the server. Random plots and roles stay there.
import {plotsFor} from './lookup.mjs';

export const randomSetup=script=>['FS','BTX','MZ'].includes(script);
export function normalizeGameSetup(script,values={}){
 const ruleset=randomSetup(script)?script:'FS',allowed=kind=>plotsFor(ruleset,kind).map(p=>p.id),xs=allowed('X');
 const subPlots=Array.from({length:ruleset==='FS'?1:2},(_,i)=>xs.includes(values.subPlots?.[i])?values.subPlots[i]:'');
 // Changing the set keeps any compatible choices, but never duplicates a rule X.
 for(let i=1;i<subPlots.length;i++)if(subPlots[i]&&subPlots.slice(0,i).includes(subPlots[i]))subPlots[i]='';
 return {days:ruleset==='FS'?4:5,loops:3,incidentCount:2,seed:Date.now(),characterPool:'standard',includeAI:false,
  communication:'between_loops_only',incidentVisibility:'hidden',opponent:'',budget:.5,advancedOpen:false,...values,
  ruleset,mainPlot:allowed('Y').includes(values.mainPlot)?values.mainPlot:'',subPlots};
}

export function generationOptions(script,values){
 const s=normalizeGameSetup(script,values);
 const options={ruleset:s.ruleset,title:'未曾发生的明天',days:Number(s.days),loops:Number(s.loops),incidentCount:Number(s.incidentCount),
  seed:Number(s.seed),characterPool:s.characterPool,includeAI:Boolean(s.includeAI),communication:s.communication,incidentVisibility:s.incidentVisibility};
 if(s.mainPlot)options.mainPlot=s.mainPlot;
 if(s.subPlots.some(Boolean))options.subPlots=s.subPlots;
 return options;
}

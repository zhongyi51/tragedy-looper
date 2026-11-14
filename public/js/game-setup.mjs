// Only chosen constraints travel to the server. Unfilled numeric fields follow the length preset.
import {plotsFor} from './lookup.mjs';

export const RULESETS=['FS','BTX','MZ','MC'];
export const randomSetup=script=>RULESETS.includes(script)||['random','ai'].includes(script);
export const freshSeed=previous=>{
 let value=globalThis.crypto?.getRandomValues?globalThis.crypto.getRandomValues(new Uint32Array(1))[0]:Date.now();
 if(value===Number(previous))value=(value+1)%4294967296;
 return value;
};
export function normalizeGameSetup(script,values={}){
 const ruleset=RULESETS.includes(script)?script:RULESETS.includes(values.ruleset)?values.ruleset:'FS';
 const allowed=kind=>plotsFor(ruleset,kind).map(p=>p.id),xs=allowed('X');
 const subPlots=Array.from({length:ruleset==='FS'?1:2},(_,i)=>xs.includes(values.subPlots?.[i])?values.subPlots[i]:'');
 for(let i=1;i<subPlots.length;i++)if(subPlots[i]&&subPlots.slice(0,i).includes(subPlots[i]))subPlots[i]='';
 return {days:'',loops:'',incidentCount:'',lengthPreset:'standard',seed:'',characterPool:'standard',includeAI:false,
  communication:'between_loops_only',opponent:'',budget:.5,advancedOpen:false,theme:'',difficulty:'standard',libraryId:'',...values,
  incidentVisibility:'public',ruleset,mainPlot:allowed('Y').includes(values.mainPlot)?values.mainPlot:'',subPlots};
}

export function generationOptions(script,values){
 const s=normalizeGameSetup(script,values);
 const options={ruleset:s.ruleset,lengthPreset:s.lengthPreset,characterPool:s.characterPool,
  includeAI:Boolean(s.includeAI),communication:s.communication,incidentVisibility:'public'};
 for(const key of ['days','loops','incidentCount','seed'])if(s[key]!==''&&s[key]!==undefined&&s[key]!==null)options[key]=Number(s[key]);
 if(s.mainPlot)options.mainPlot=s.mainPlot;
 if(s.subPlots.some(Boolean))options.subPlots=s.subPlots;
 if(script==='ai'){options.generation='ai';options.difficulty=s.difficulty;if(s.theme.trim())options.theme=s.theme.trim();}
 return options;
}

export function libraryItems(value){return Array.isArray(value)?value:Array.isArray(value?.scripts)?value.scripts:[];}

// An uncertain billed request is resumed with its original ID while its settings stay unchanged.
export function creationAttempt(request,previous,uuid=()=>crypto.randomUUID()){
 const signature=JSON.stringify(request);
 return previous?.signature===signature?previous:{signature,requestId:uuid()};
}

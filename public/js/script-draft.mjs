// Pure edits on a script draft for the workshop form. Each edit returns a new draft that stays
// structurally coherent (no roles for absent characters, no incidents past the last day…).
import {cat,rolesFor,plotsFor,incidentsFor} from './lookup.mjs';

const SUB_PLOTS={FS:1,BTX:2};
const SPECIAL_DEFAULTS={godly_being:['godlyLoop',1],transfer_student:['transferDay',1],boss:['bossTerritory','city']};
const NUMERIC_SETTINGS=['godlyLoop','transferDay'];

export function parseDraft(text){
 try{const d=JSON.parse(text);return d&&typeof d==='object'&&!Array.isArray(d)?d:null;}catch{return null;}
}

export function blankDraft(){
 return {id:'custom-'+Date.now().toString(36),title:'未命名的剧本',author:'',ruleset:'FS',days:4,loops:3,communication:'between_loops_only',
  characters:[],mainPlot:plotsFor('FS','Y')[0].id,subPlots:[plotsFor('FS','X')[0].id],roles:{},incidents:[],settings:{},specialRules:[]};
}

// How many of each role the chosen plots demand, next to how many the cast currently has.
export function roleNeeds(d){
 const catalog=cat(),min={},max={},count={};
 for(const id of [d.mainPlot,...(d.subPlots||[])]){
  const plot=catalog.plots.find(p=>p.id===id);
  for(const [r,n] of Object.entries(plot?.addedRoles||{})){min[r]=(min[r]||0)+(typeof n==='number'?n:n.min);max[r]=(max[r]||0)+(typeof n==='number'?n:n.max);}
 }
 for(const c of d.characters||[]){const r=d.roles?.[c];if(r&&r!=='person'&&c!=='irregular')count[r]=(count[r]||0)+1;}
 return [...new Set([...Object.keys(max),...Object.keys(count)])].map(role=>{
  const cap=catalog.roles.find(r=>r.id===role)?.maxCount??99,lo=Math.min(min[role]||0,cap),hi=Math.min(max[role]||0,cap),n=count[role]||0;
  return {role,min:lo,max:hi,count:n,ok:n>=lo&&n<=hi};
 });
}

function withRuleset(d,ruleset){
 const mains=plotsFor(ruleset,'Y').map(p=>p.id),subs=plotsFor(ruleset,'X').map(p=>p.id),roleIds=new Set(rolesFor(ruleset).map(r=>r.id)),events=incidentsFor(ruleset).map(e=>e.id);
 const subPlots=(d.subPlots||[]).filter(p=>subs.includes(p)).slice(0,SUB_PLOTS[ruleset]);
 for(const p of subs)if(subPlots.length<SUB_PLOTS[ruleset]&&!subPlots.includes(p))subPlots.push(p);
 return {...d,ruleset,mainPlot:mains.includes(d.mainPlot)?d.mainPlot:mains[0],subPlots,
  roles:Object.fromEntries(Object.entries(d.roles||{}).map(([c,r])=>[c,roleIds.has(r)?r:'person'])),
  incidents:(d.incidents||[]).map(e=>events.includes(e.type)?e:{...e,type:events[0]})};
}

function toggleCast(d,id){
 const settings={...d.settings},special=SPECIAL_DEFAULTS[id];
 if(d.characters.includes(id)){
  const roles={...d.roles};delete roles[id];if(special)delete settings[special[0]];
  return {...d,characters:d.characters.filter(c=>c!==id),roles,incidents:d.incidents.filter(e=>e.culprit!==id),settings};
 }
 if(special)settings[special[0]]=special[1];
 return {...d,characters:[...d.characters,id],roles:{...d.roles,[id]:'person'},settings};
}

function setIncident(d,day,type){
 const rest=d.incidents.filter(e=>e.day!==day),existing=d.incidents.find(e=>e.day===day);
 if(!type)return {...d,incidents:rest};
 const taken=new Set(rest.map(e=>e.culprit)),culprit=existing?.culprit||d.characters.find(c=>!taken.has(c))||'';
 return {...d,incidents:[...rest,{day,type,culprit}].sort((a,b)=>a.day-b.day)};
}

// edit: {kind, key, value} as produced by the form controls.
export function editDraft(draft,{kind,key,value}){
 const d={settings:{},specialRules:[],roles:{},characters:[],incidents:[],subPlots:[],...draft};
 switch(kind){
  case 'field':
   if(key==='ruleset')return withRuleset(d,value);
   if(key==='days'||key==='loops'){
    const n=Math.max(1,Math.min(key==='days'?10:8,Math.round(Number(value))||1)),next={...d,[key]:n};
    if(key==='days'){next.incidents=d.incidents.filter(e=>e.day<=n);if(next.settings.transferDay>n)next.settings={...next.settings,transferDay:n};}
    else if(next.settings.godlyLoop>n)next.settings={...next.settings,godlyLoop:n};
    return next;
   }
   return {...d,[key]:value};
  case 'sub':{const subPlots=[...d.subPlots];subPlots[+key]=value;return {...d,subPlots};}
  case 'cast':return toggleCast(d,key);
  case 'role':return {...d,roles:{...d.roles,[key]:value}};
  case 'incident':return setIncident(d,+key,value);
  case 'culprit':return {...d,incidents:d.incidents.map(e=>e.day===+key?{...e,culprit:value}:e)};
  case 'setting':return {...d,settings:{...d.settings,[key]:NUMERIC_SETTINGS.includes(key)?Math.round(Number(value))||1:value}};
  default:return d;
 }
}
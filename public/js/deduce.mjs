// The deduction sheet's logic: what the player's marks and the public record still leave possible.
import {char,name,phaseLabel,rolesFor,plotsFor,plotRoles} from './lookup.mjs';

const SUB_PLOTS={FS:1,BTX:2,MZ:2,MC:2};
export const MARKS={no:'✗',yes:'✓',maybe:'?'};
// Results worth reading back: at the end of a day, and loop by loop on the sheet.
export const NOTABLE=['death','incident','reveal','refused','ignored'];
const CLUES=[...NOTABLE,'failed','victory'];

export const emptyMarks=()=>({roles:{},plots:{},culprits:{}});
const copy=marks=>JSON.parse(JSON.stringify({...emptyMarks(),...marks}));
const choose=(list,n)=>n?list.flatMap((x,i)=>choose(list.slice(i+1),n-1).map(rest=>[x,...rest])):[[]];

// Clicking with the tool a cell already carries clears it. A character holds one ✓ at a time.
export function markRole(marks,character,role,tool){
 const next=copy(marks),row=next.roles[character]||={};
 if(row[role]===tool)delete row[role];
 else{if(tool==='yes')for(const r of Object.keys(row))if(row[r]==='yes')delete row[r];row[role]=tool;}
 if(!Object.keys(row).length)delete next.roles[character];
 return next;
}
export function markPlot(marks,plot,tool){
 const next=copy(marks);
 if(next.plots[plot]===tool)delete next.plots[plot];else next.plots[plot]=tool;
 return next;
}
export function markCulprit(marks,day,character){
 const next=copy(marks);
 if(character)next.culprits[day]=character;else delete next.culprits[day];
 return next;
}

// Who has turned a goodwill request down, and who has granted one they could have refused.
function requests(v){
 const refused=new Set(),granted=new Set();
 v.log.forEach((e,i)=>{
  if(e.type!=='ability'||!e.who)return;
  const answer=v.log[i+1];
  if(answer?.type==='refused'&&answer.who===e.who)refused.add(e.who);
  else if((answer||v.phaseId!=='refusal')&&char(e.who)?.abilities[e.ability]&&!char(e.who).abilities[e.ability].cannotRefuse)granted.add(e.who);
 });
 return {refused,granted};
}

// Notable public events, newest loop first, for reading back what each loop revealed.
export function clues(v){
 const loops=new Map();
 for(const e of v.log)if(CLUES.includes(e.type)){if(!loops.has(e.loop))loops.set(e.loop,[]);loops.get(e.loop).push(e);}
 return [...loops].map(([loop,items])=>({loop,items})).reverse();
}

// What the table saw of a failed loop: when it ended and what had just happened. The rule behind it stays hidden.
export function failure(v,loop=v.loop){
 const e=v.log.findLast(e=>e.type==='failed'&&e.loop===loop);
 if(!e?.when)return null;
 const tally=Object.entries(e.intrigue||{}).map(([id,n])=>`${name(id)} ${n}`).join('、');
 return {stamp:`第 ${e.day} 日 · ${phaseLabel(e.phase)}`,
  cause:e.when==='death'?`${e.dead.map(name).join('、')}死亡，轮回立即结束`:e.when==='heroes'?'主人公死亡':'最后一天结束时，失败条件成立',
  detail:e.when==='end'?(tally?'当时的暗跃：'+tally:'当时场上没有暗跃'):''};
}

export function analyze(v,marks){
 marks={...emptyMarks(),...marks};
 const set=v.script.ruleset,manualOnly=set==='MZ',roles=rolesFor(set),def=new Map(roles.map(r=>[r.id,r])),cast=v.script.characters;
 // In Midnight Zone a Ninja may lie about its role and EX can change a role during a loop.
 // Keep declarations visible, but never treat them as proof of the original script assignment.
 const known=manualOnly?{}:v.knownRoles||{},knownPlots=v.knownPlots||[],{refused,granted}=manualOnly?{refused:new Set(),granted:new Set()}:requests(v);
 const picked=c=>Object.keys(marks.roles[c]||{}).find(r=>marks.roles[c][r]==='yes'&&def.has(r));

 // 1. Each cell from confirmed roles, the player's marks and how the character answered requests.
 const cells={};
 for(const c of cast){
  cells[c]={};
  for(const {id:r,goodwillRefusal} of roles){
   const own=marks.roles[c]?.[r];
   cells[c][r]=known[c]?{mark:known[c]===r?'yes':'no',locked:true}
    :own?{mark:own}
    :refused.has(c)&&goodwillRefusal==='none'?{mark:'no',auto:'拒绝过能力'}
    :granted.has(c)&&goodwillRefusal==='mandatory'?{mark:'no',auto:'接受过能力'}
    :picked(c)?{mark:'no',auto:'已认定为'+name(picked(c))}
    :{mark:''};
  }
 }
 const tally=test=>Object.fromEntries(roles.map(r=>[r.id,cast.filter(c=>test(cells[c][r.id],c,r.id)).length]));
 const yes=tally(cell=>cell.mark==='yes'),open=tally(cell=>cell.mark!=='no');
 const sure=tally((cell,c,r)=>known[c]===r),free=tally((cell,c,r)=>!known[c]||known[c]===r);

 // 2. Rule combinations that fit: strictly with the player's marks, loosely with confirmed facts only.
 const all=plotsFor(set,'Y').flatMap(y=>choose(plotsFor(set,'X'),SUB_PLOTS[set]).map(xs=>{
  const plots=[y,...xs],quota={};
  for(const p of plots)for(const [r,n] of Object.entries(p.addedRoles||{})){
   const [lo,hi]=typeof n==='number'?[n,n]:[n.min,n.max],cap=def.get(r)?.maxCount??99;
   quota[r]=[Math.min((quota[r]?.[0]||0)+lo,cap),Math.min((quota[r]?.[1]||0)+hi,cap)];
  }
  return {ids:plots.map(p=>p.id),quota};
 }));
 const fits=(combo,strict)=>knownPlots.every(p=>combo.ids.includes(p))
  &&(!strict||Object.entries(marks.plots).every(([p,m])=>m==='maybe'||(m==='yes')===combo.ids.includes(p)))
  &&(manualOnly||roles.every(({id:r})=>{
   if(r==='person')return true;
   const [lo,hi]=combo.quota[r]||[0,0];
   return (strict?yes:sure)[r]<=hi&&(strict?open:free)[r]>=lo;
  }));
 let combos=all.filter(c=>fits(c,true));
 const conflict=!combos.length;
 if(conflict)combos=all.filter(c=>fits(c,false));
 if(!combos.length)combos=all;
 const range=Object.fromEntries(roles.map(({id:r})=>[r,r==='person'||manualOnly?[0,cast.length]:[Math.min(...combos.map(c=>c.quota[r]?.[0]||0)),Math.max(...combos.map(c=>c.quota[r]?.[1]||0))]]));

 // 3. Cells the rules settle: roles no remaining combination has, and roles already fully cast.
 for(const c of cast)for(const {id:r} of roles){
  if(cells[c][r].mark||r==='person')continue;
  if(!range[r][1])cells[c][r]={mark:'no',auto:'这一局没有这个角色'};
  else if(!manualOnly&&yes[r]>=range[r][1])cells[c][r]={mark:'no',auto:'人数已满'};
 }

 // 4. What follows: a role with exactly enough candidates left, a character with one role left.
 const hints=[],warns=conflict?['这些标记互相矛盾，没有哪种规则组合能同时满足。']:[];
 const lead=(c,r,text)=>{if(cells[c][r].lead)return;cells[c][r].lead=true;hints.push({character:c,role:r,text});};
 for(const {id:r} of roles){
  if(manualOnly||r==='person'||range[r][0]<1)continue;
  const need=range[r][0]-yes[r],left=cast.filter(c=>['','maybe'].includes(cells[c][r].mark));
  if(need>0&&left.length===need)for(const c of left)lead(c,r,`只剩${name(c)}能当${name(r)}`);
  else if(need>0&&left.length<need)warns.push(`能当${name(r)}的人不够了。`);
 }
 for(const c of cast){
  if(known[c]||picked(c))continue;
  const left=roles.filter(r=>cells[c][r.id].mark!=='no');
  if(left.length===1)lead(c,left[0].id,`${name(c)}只能是${name(left[0].id)}`);
  else if(!left.length)warns.push(`${name(c)}的角色全被排除了。`);
 }
 // Public events that point at a role: a loop that ends the moment one person dies, a ban that fails on someone.
 const points=(c,r,text)=>{if(def.has(r)&&range[r][1]&&!known[c]&&!picked(c)&&['','maybe'].includes(cells[c][r].mark))lead(c,r,text);};
 for(const e of manualOnly?[]:v.log){
  if(e.type==='failed'&&e.when==='death'&&e.dead.length===1)points(e.dead[0],'key_person',`${name(e.dead[0])}一死，轮回就结束了，多半是${name('key_person')}`);
  if(e.type==='ignored'&&e.what==='goodwill')points(e.who,'time_traveler',`${name(e.who)}不受友好禁止影响，多半是${name('time_traveler')}`);
 }

 const plot=p=>{
  const inAll=combos.every(c=>c.ids.includes(p.id)),inSome=combos.some(c=>c.ids.includes(p.id)),own=marks.plots[p.id];
  const state=knownPlots.includes(p.id)?{mark:'yes',locked:true}:own?{mark:own}:!inSome?{mark:'no',auto:'和线索对不上'}:inAll?{mark:'yes',auto:'只剩这一种可能'}:{mark:''};
  return {id:p.id,name:p.name_zh_working,roles:plotRoles(p),effect:p.effect_zh||'',...state};
 };
 return {
  manualOnly,
  roles:roles.map(({id:r})=>({id:r,name:name(r),uncertain:manualOnly,min:range[r][0],max:range[r][1],yes:yes[r],hidden:r!=='person'&&!range[r][1]&&!yes[r]})),
  rows:cast.map(c=>({id:c,cells:cells[c],confirmed:Boolean(known[c]),pick:known[c]?null:picked(c)||null,note:manualOnly&&v.knownRoles?.[c]?'已宣告：'+name(v.knownRoles[c])+'（可能是伪装）':refused.has(c)?'拒绝过能力':granted.has(c)?'接受过能力':''})),
  plots:{main:plotsFor(set,'Y').map(plot),sub:plotsFor(set,'X').map(plot),subCount:SUB_PLOTS[set]},
  combos:combos.length,only:combos.length===1?combos[0].ids.map(name):null,
  culprits:v.script.incidents.map(e=>({day:e.day,known:v.knownCulprits?.[e.day]||null,guess:cast.includes(marks.culprits[e.day])?marks.culprits[e.day]:null})),
  hints,warns
 };
}

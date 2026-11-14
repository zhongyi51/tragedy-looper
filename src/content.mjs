import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const catalog=JSON.parse(readFileSync(new URL('../data/catalog.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
export const contentHash=createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
const index=items=>Object.assign(Object.create(null),Object.fromEntries(items.map(c=>[c.id,c])));
export const chars=index(catalog.characters);
export const roles=index(catalog.roles);
export const plots=index(catalog.plots);
export const incidents=index(catalog.incidents);
export const locs=catalog.locations.map(c=>c.id);
const mustBeCulprit=role=>roles[role]?.castingConstraints?.includes('mustBeCulprit')===true;
const cannotBeCulprit=role=>roles[role]?.castingConstraints?.includes('cannotBeCulprit')===true;
export const name=id=>chars[id]?.name_zh_working||roles[id]?.name_zh_working||plots[id]?.name_zh_working||incidents[id]?.name_zh_working||catalog.locations.find(c=>c.id===id)?.name_zh||id;
export const starter={id:'first-script',title:'起始剧本',author:'BakaFire',ruleset:'FS',days:3,loops:3,communication:'between_loops_only',characters:['boy_student','girl_student','shrine_maiden','office_worker','idol','doctor'],mainPlot:'murder_plan',subPlots:['ripper_shadow'],roles:{boy_student:'person',girl_student:'key_person',shrine_maiden:'serial_killer',office_worker:'killer',idol:'misleader',doctor:'brain'},incidents:[{day:3,type:'suicide',culprit:'girl_student'}],settings:{incidentVisibility:'public'},specialRules:[],provenance:'官方起始剧本；讨论规则是本地练习用的设置。'};
// Standard play publishes the schedule, never its culprits. Explicit legacy
// hidden schedules remain readable for old saves and custom variants.
export function publicScript(s,{includeIncidentTypes=s.settings?.incidentVisibility!=='hidden'}={}){
 const schedule=s.incidents.map(({day,type,publicType})=>{
  // The rules permit an undisguised Fake Incident. Once an alias is supplied,
  // never fall back to its true name if unvalidated/stale data has a bad alias.
  const visibleType=type==='fake_incident'
   ?publicType===undefined?type:typeof publicType==='string'&&incidents[publicType]&&publicType!==type?publicType:undefined
   :typeof type==='string'&&incidents[type]?type:undefined;
  return {day,...(includeIncidentTypes&&visibleType?{type:visibleType}:{})};
 });
 const settings=Object.fromEntries(['incidentVisibility','godlyLoop','transferDay','bossTerritory'].filter(k=>s.settings?.[k]!==undefined).map(k=>[k,s.settings[k]]));
 settings.incidentVisibility??='public';
 // A generated ID used to contain the seed, from which the whole secret script
 // could be reconstructed. Public clients need a label, not the generator input.
 const id=s.source==='random'||String(s.id||'').startsWith('generated-')?'generated':s.id;
 return structuredClone({id,title:s.title,author:s.author,ruleset:s.ruleset,days:s.days,loops:s.loops,communication:s.communication,characters:s.characters,incidents:schedule,settings,specialRules:s.specialRules||[],
  ...(typeof s.intro==='string'?{intro:s.intro.slice(0,600)}:{}),
  ...(['random','curated','ai','imported'].includes(s.source)?{source:s.source}:{}),
  ...(['beginner','standard','hard'].includes(s.difficulty)?{difficulty:s.difficulty}:{})});
}
export function validateScript(s){
 const errors=[],warnings=[];const err=(path,message)=>errors.push({path,message});
 if(!s||typeof s!=='object')return {errors:[{path:'script',message:'剧本必须是 JSON 对象'}],warnings};
 if(Array.isArray(s))return {errors:[{path:'script',message:'剧本必须是对象，不能是数组'}],warnings};
 for(const k of ['subPlots','characters','incidents'])if(!Array.isArray(s[k]))err(k,'必须是数组');
 if(!s.roles||typeof s.roles!=='object'||Array.isArray(s.roles))err('roles','必须是“人物: 角色”的对照表');
 if(s.settings!==undefined&&(!s.settings||typeof s.settings!=='object'||Array.isArray(s.settings)))err('settings','必须是对象');
 if(s.specialRules!==undefined&&!Array.isArray(s.specialRules))err('specialRules','必须是数组');
 if(Array.isArray(s.incidents)&&s.incidents.some(e=>!e||typeof e!=='object'||Array.isArray(e)))err('incidents','每个事件都必须是对象');
 if(errors.length)return {errors,warnings};
 if(!catalog.sets.some(set=>set.id===s.ruleset))err('ruleset','不支持这个惨剧集合');
 for(const k of ['days','loops'])if(!Number.isInteger(s[k])||s[k]<1||s[k]>(k==='days'?10:8))err(k,'天数须在 1–10 之间，轮回数须在 1–8 之间');
 if(typeof s.title!=='string'||!s.title.trim()||s.title.length>120)err('title','标题须在 1–120 字之间');
 if(!['between_loops_only','allowed_during_loop'].includes(s.communication))err('communication','请选择主人公何时可以讨论');
 if(!Array.isArray(s.characters)||s.characters.length<4||s.characters.length>24||new Set(s.characters).size!==s.characters.length||s.characters.some(x=>typeof x!=='string'||!chars[x]))err('characters','请选 4–24 个不重复的人物');
 if(!Array.isArray(s.subPlots)||s.subPlots.length!==(catalog.sets.find(set=>set.id===s.ruleset)?.subPlots??2)||new Set(s.subPlots).size!==s.subPlots.length)err('subPlots','规则 X 的数量须符合惨剧集合，且不能重复');
 if(typeof s.mainPlot!=='string'||!plots[s.mainPlot]||plots[s.mainPlot].kind!=='Y'||!plots[s.mainPlot].sets.includes(s.ruleset))err('mainPlot','这个惨剧集合里没有这条规则 Y');
 for(const p of s.subPlots||[])if(typeof p!=='string'||!plots[p]||plots[p].kind!=='X'||!plots[p].sets.includes(s.ruleset))err('subPlots','这个惨剧集合里没有这条规则 X');
 if((s.specialRules||[]).length)err('specialRules','暂不支持自定义的特殊规则');
 if(errors.length)return {errors,warnings};
 const min={},max={};for(const p of [s.mainPlot,...s.subPlots])for(const [r,n] of Object.entries(plots[p].addedRoles)){min[r]=(min[r]||0)+(typeof n==='number'?n:n.min);max[r]=(max[r]||0)+(typeof n==='number'?n:n.max);}
 for(const r of Object.keys(max)){min[r]=Math.min(min[r],roles[r].maxCount??99);max[r]=Math.min(max[r],roles[r].maxCount??99);}
 for(const c of Object.keys(s.roles))if(!s.characters.includes(c))err('roles.'+c,'配役人物不在出演名单中');
 const counts={};for(const c of s.characters){const role=s.roles?.[c];if(typeof role!=='string'||!roles[role]||!roles[role].sets.includes(s.ruleset)){err('roles.'+c,'这个规则集里没有这个角色');continue;}
  if(c==='irregular'){if(role==='person'||max[role])err('roles.irregular','异常少年的角色必须是本规则集里未被采用的角色，且不能是普通人');continue;}
  if(c==='ai_character'&&role==='person')err('roles.ai_character','人工智能不能是普通人');counts[role]=(counts[role]||0)+1;
  if(s.mainPlot==='contract'&&role==='key_person'&&!chars[c].tags.includes('girl'))err('roles.'+c,'「与我缔结契约」的关键人物必须是少女');
  if(s.mainPlot==='male_confrontation'&&role==='ninja'&&!chars[c].tags.includes('male'))err('roles.'+c,'「男子汉的战争」的忍者必须是男性，不能是少年');
 }
 for(const r of new Set([...Object.keys(counts),...Object.keys(max)])){if(r==='person')continue;if((counts[r]||0)<(min[r]||0)||(counts[r]||0)>(max[r]||0))err('roles.'+r,'人数和所选的规则对不上');}
 if(!Array.isArray(s.incidents))err('incidents','事件必须是数组');
 const days=new Set(),culprits=new Map();for(const [i,e] of (s.incidents||[]).entries()){
  if(!Number.isInteger(e.day)||e.day<1||e.day>s.days||days.has(e.day))err(`incidents.${i}.day`,'事件的日期超出范围，或和别的事件重复');days.add(e.day);
  if(typeof e.type!=='string'||!incidents[e.type]?.sets.includes(s.ruleset))err(`incidents.${i}.type`,'这个规则集里没有这个事件');
  if(!s.characters.includes(e.culprit))err(`incidents.${i}.culprit`,'犯人不在剧本里');
  if(cannotBeCulprit(s.roles[e.culprit]))err(`incidents.${i}.culprit`,'私家侦探不能成为事件犯人');
  if(culprits.has(e.culprit)&&!(e.type==='serial_murder'&&culprits.get(e.culprit)==='serial_murder'))err(`incidents.${i}.culprit`,'同一犯人只可重复用于连续杀人事件');
  culprits.set(e.culprit,e.type);
  if(e.publicType!==undefined&&(e.type!=='fake_incident'||typeof e.publicType!=='string'||!incidents[e.publicType]||e.publicType==='fake_incident'))err(`incidents.${i}.publicType`,'只有伪装事件可以指定其他已知事件作为公开名称');
  if(e.culprit==='black_cat')warnings.push({path:`incidents.${i}`,message:'黑猫当犯人的事件不会有效果'});
 }
 for(const c of s.characters)if(mustBeCulprit(s.roles[c])&&!culprits.has(c))err('roles.'+c,`${name(s.roles[c])}必须被指定为事件犯人`);
 if(s.subPlots.includes('worship_apocalypse')&&!s.incidents.some(e=>e.type==='suicide'))err('incidents','「灭亡讴歌」必须包含至少一个自杀事件');
 const st=s.settings||{};
 if(st.incidentVisibility!==undefined&&!['hidden','public'].includes(st.incidentVisibility))err('settings.incidentVisibility','事件日程须选择隐藏名称或公开名称');
 if(s.characters.includes('godly_being')&&(!Number.isInteger(st.godlyLoop)||st.godlyLoop<1||st.godlyLoop>s.loops))err('settings.godlyLoop','请指定神格从第几个轮回登场');
 if(s.characters.includes('transfer_student')&&(!Number.isInteger(st.transferDay)||st.transferDay<1||st.transferDay>s.days))err('settings.transferDay','请指定转学生第几天登场');
 if(s.characters.includes('boss')&&!locs.includes(st.bossTerritory))err('settings.bossTerritory','请指定大人物的领地');
 for(const [i,e] of (s.incidents||[]).entries())if(e.culprit==='transfer_student'&&e.day<st.transferDay)warnings.push({path:`incidents.${i}`,message:'到事件那天，转学生还没登场'});
 return {errors,warnings};
}
export const LENGTH_PRESETS=Object.freeze({quick:{label:'短局',loops:2},standard:{label:'标准',loops:3},long:{label:'长局',loops:4}});
const seedMix=(seed,salt)=>{let n=(Number(seed)>>>0)^salt;n=Math.imul(n^(n>>>16),0x7feb352d);n=Math.imul(n^(n>>>15),0x846ca68b);return (n^(n>>>16))>>>0;};
export function generationLength(ruleset='FS',preset='standard',seed=0){
 if(!Object.hasOwn(LENGTH_PRESETS,preset))throw setupError('请选择短局、标准或长局');
 const introductory=ruleset==='FS',ranges=preset==='quick'?[3,4]:preset==='long'?(introductory?[5,6]:[6,7]):(introductory?[4,5]:[4,6]);
 const days=ranges[0]+seedMix(seed,0x4c454e47)%(ranges[1]-ranges[0]+1);
 const incidentCount=ruleset==='MC'?(preset==='long'?4:3):preset==='long'?3+(introductory?0:1):preset==='standard'&&!introductory?2+seedMix(seed,0x45564e54)%2:2;
 return {days,loops:LENGTH_PRESETS[preset].loops,incidentCount:Math.min(days,incidentCount)};
}
export function generatedTitle(seed){
 const times=['雨停之前','黎明之后','落日尽头','雪落之夜','钟声未歇','灯火将熄','薄雾深处','末班车后','潮声渐远','回声散尽','长夜将明','繁星沉默','晚风初起','花落之时','月光背面','落叶归处'];
 const traces=['的来信','的约定','的旧照片','的陌生人','的回廊','的脚步声','的空座位','的留声机','的钥匙','的纸飞机','的剪影','的窗灯','的无人站台','的风铃','的失物','的第三页'];
 return times[seedMix(seed,0x5449544c)%times.length]+traces[seedMix(seed,0x4e414d45)%traces.length];
}
const standardCharacters=['boy_student','girl_student','rich_girl','shrine_maiden','police','office_worker','informer','doctor','patient','class_rep','alien','idol','journalist','nurse','teacher','soldier'];
const setupError=message=>Object.assign(Error(message),{code:'INVALID_SETUP'});
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const integer=(value,min,max,label)=>{if(!Number.isInteger(value)||value<min||value>max)throw setupError(`${label}须在 ${min}–${max} 之间`);return value;};
export function scriptForGame(body={}){
 if(body.setup!==undefined&&body.script!==undefined)throw setupError('生成设置和已有剧本不能同时提交');
 const script=body.setup!==undefined?generateScript(body.setup):structuredClone(body.script===undefined?starter:body.script);
 if(record(script)&&script.settings===undefined)script.settings={incidentVisibility:'public'};
 if(body.incidentVisibility!==undefined){
  if(!['hidden','public'].includes(body.incidentVisibility))throw setupError('事件日程须选择隐藏名称或公开名称');
  if(!record(script)||script.settings!==undefined&&!record(script.settings))throw setupError('剧本或剧本设置无效');
  script.settings={...script.settings,incidentVisibility:body.incidentVisibility};
 }
 return script;
}
export function generateScript(options={}){
 if(!record(options))throw setupError('生成设置必须是对象');
 let {ruleset='FS',seed=globalThis.crypto.getRandomValues(new Uint32Array(1))[0],title,mainPlot,subPlots,days,loops,lengthPreset='standard',communication='between_loops_only',characters,characterPool='standard',includeAI=false,settings={},incidentVisibility=settings?.incidentVisibility??'public',incidentCount}=options;
 if(!Number.isSafeInteger(seed))throw setupError('种子须为安全整数');
 const length=generationLength(ruleset,lengthPreset,seed);if(days===undefined)days=length.days;if(loops===undefined)loops=length.loops;
 if(incidentCount===undefined)incidentCount=Math.min(days,length.incidentCount,characters?.length??24);
 if(title===undefined)title=generatedTitle(seed);
 const set=catalog.sets.find(set=>set.id===ruleset);if(!set)throw setupError('不支持这个惨剧集合');
 if(typeof title!=='string'||!title.trim()||title.length>120)throw setupError('标题须在 1–120 字之间');
 if(!Number.isSafeInteger(seed))throw setupError('种子须为安全整数');
 integer(days,1,10,'天数');integer(loops,1,8,'轮回数');
 if(!['between_loops_only','allowed_during_loop'].includes(communication))throw setupError('请选择主人公何时可以讨论');
 if(!['standard','all'].includes(characterPool))throw setupError('请选择默认人物池或全部基础人物池');
 if(typeof includeAI!=='boolean')throw setupError('人工智能入选选项须为布尔值');
 if(!record(settings))throw setupError('人物设置必须是对象');
 if(!['hidden','public'].includes(incidentVisibility))throw setupError('事件日程须选择隐藏名称或公开名称');
 const validCharacters=catalog.characters.filter(c=>c.scope==='base5').map(c=>c.id);
 if(characters!==undefined&&(!Array.isArray(characters)||characters.length<4||characters.length>24||new Set(characters).size!==characters.length||characters.some(c=>!validCharacters.includes(c))))throw setupError('请指定 4–24 个不重复的基础人物');
 if(characters&&includeAI&&!characters.includes('ai_character'))throw setupError('指定出演名单时，请将人工智能加入名单');
 if(incidentCount!==undefined)integer(incidentCount,0,ruleset==='MC'?days:Math.min(days,characters?.length??24),'事件数');
 // mulberry32: neighbouring seeds must not share their first draws.
 let x=seed>>>0;const rand=()=>{x=(x+0x6D2B79F5)>>>0;let t=Math.imul(x^x>>>15,x|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
 const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
 const ys=catalog.plots.filter(p=>p.kind==='Y'&&p.sets.includes(ruleset)).map(p=>p.id),xs=catalog.plots.filter(p=>p.kind==='X'&&p.sets.includes(ruleset)).map(p=>p.id),xCount=set.subPlots;
 if(mainPlot!==undefined&&mainPlot!==''&&!ys.includes(mainPlot))throw setupError('这个惨剧集合里没有这条规则 Y');
 const chosenY=mainPlot;
 if(subPlots!==undefined&&(!Array.isArray(subPlots)||subPlots.length!==xCount||subPlots.some(p=>p!==''&&!xs.includes(p))||new Set(subPlots.filter(Boolean)).size!==subPlots.filter(Boolean).length))throw setupError(`请选择 ${xCount} 条不重复的规则 X；空位可随机生成`);
 // Filter expansion choices against the requested event budget. Explicit
 // incompatible combinations fail instead of silently changing the user's rules.
 if(['MZ','MC'].includes(ruleset)){
  const eventLimit=incidentCount===undefined?Math.min(ruleset==='MC'?3:2,days,characters?.length??24):integer(incidentCount,0,ruleset==='MC'?days:Math.min(days,characters?.length??24),'事件数');
  const choices=[];
  for(const y of chosenY?[chosenY]:ys)for(let i=0;i<xs.length;i++)for(let j=i+1;j<xs.length;j++){
   const pair=[xs[i],xs[j]];
   if(subPlots?.some(p=>p&&!pair.includes(p)))continue;
   const required={};for(const id of [y,...pair])for(const [r,n] of Object.entries(plots[id].addedRoles))required[r]=Math.min((required[r]||0)+(typeof n==='number'?n:n.min),roles[r].maxCount??99);
   const requiredEvents=Math.max(Object.entries(required).reduce((n,[r,count])=>n+(mustBeCulprit(r)?count:0),0),pair.includes('worship_apocalypse')?1:0);
   if(requiredEvents>eventLimit)continue;
   if(characters&&Object.values(required).reduce((a,b)=>a+b,0)>characters.length-(characters.includes('irregular')?1:0))continue;
   if(characters&&y==='male_confrontation'&&!characters.some(c=>chars[c].tags.includes('male')))continue;
   choices.push({y,pair});
  }
  if(!choices.length)throw setupError(ruleset==='MC'?'所选规则与出演名单或事件数不兼容：愚者、双子和绝对者须分别担任犯人':'所选规则与出演名单或事件数不兼容：绝对者必须是犯人，灭亡讴歌须有自杀事件，忍者须符合男性限制');
  const chosen=shuffle(choices)[0];mainPlot=chosen.y;
  if(subPlots){const remaining=chosen.pair.filter(p=>!subPlots.includes(p));subPlots=subPlots.map(p=>p||remaining.shift());}else subPlots=chosen.pair;
 }else mainPlot=mainPlot||shuffle(ys)[0];
 if(subPlots===undefined)subPlots=shuffle(xs).slice(0,xCount);
 else {const remaining=shuffle(xs.filter(p=>!subPlots.includes(p)));subPlots=subPlots.map(p=>p||remaining.shift());}
 const min={},max={},slots=[];
 for(const p of [mainPlot,...subPlots])for(const [r,n]of Object.entries(plots[p].addedRoles)){
  const low=typeof n==='number'?n:n.min,high=typeof n==='number'?n:n.max;
  min[r]=Math.min((min[r]||0)+low,roles[r].maxCount??99);max[r]=Math.min((max[r]||0)+high,roles[r].maxCount??99);
  const count=typeof n==='number'?n:low+Math.floor(rand()*(high-low+1));
  for(let i=0;i<count;i++)if(slots.filter(z=>z===r).length<(roles[r].maxCount??99))slots.push(r);
 }
 const pool=characterPool==='all'?validCharacters:standardCharacters;
 let cast=characters?[...characters]:shuffle(pool).slice(0,Math.max(ruleset==='FS'?6:8,slots.length,incidentCount??0));
 if(includeAI&&!cast.includes('ai_character'))cast[cast.length-1]='ai_character';
 const irregular=cast.includes('irregular');
 if(!characters&&irregular&&slots.length>=cast.length)cast.push(shuffle(pool.filter(c=>!cast.includes(c)))[0]);
 if(mainPlot==='male_confrontation'&&!cast.some(c=>chars[c].tags.includes('male'))){
  if(characters)throw setupError('「男子汉的战争」需要至少一名男性出演（不能是少年）');
  cast[cast.findIndex(c=>c!=='ai_character'&&c!=='irregular')]='office_worker';
 }
 if(mainPlot==='contract'&&!cast.some(c=>chars[c].tags.includes('girl'))){
  if(characters)throw setupError('「与我缔结契约」需要至少一名少女出演');
  cast[cast.findIndex(c=>c!=='ai_character'&&c!=='irregular')]='girl_student';
 }
 const capacity=cast.length-(irregular?1:0);
 if(Object.values(min).reduce((a,b)=>a+b,0)>capacity)throw setupError('出演人数不足以分配所选规则要求的角色');
 while(slots.length>capacity){const i=slots.findIndex(r=>slots.filter(x=>x===r).length>min[r]);slots.splice(i,1);}
 const assigned={};
 if(irregular){const extra=shuffle(catalog.roles.filter(r=>r.id!=='person'&&r.sets.includes(ruleset)&&!max[r.id]&&(!mustBeCulprit(r.id)||slots.filter(mustBeCulprit).length<(incidentCount??Math.min(ruleset==='MC'?3:2,days)))));if(!extra.length)throw setupError('所选规则没有可分配给异常少年的额外角色');assigned.irregular=extra[0].id;}
 const free=shuffle(cast.filter(c=>c!=='irregular'));
 // Match role slots to compatible characters. In particular A.I. is never a
 // Person, and the contract's Key Person must be a Girl, regardless of seed.
 const allSlots=[...slots,...Array(capacity-slots.length).fill('person')],occupied=new Map();
 const allowed=(role,c)=>!(c==='ai_character'&&role==='person')&&!(mainPlot==='contract'&&role==='key_person'&&!chars[c].tags.includes('girl'))&&!(mainPlot==='male_confrontation'&&role==='ninja'&&!chars[c].tags.includes('male'));
 function place(slot,visited){for(const c of free){if(visited.has(c)||!allowed(allSlots[slot],c))continue;visited.add(c);if(!occupied.has(c)||place(occupied.get(c),visited)){occupied.set(c,slot);return true;}}return false;}
 for(let i=0;i<allSlots.length;i++)if(!place(i,new Set()))throw setupError('这些人物无法满足所选规则的配役要求，请调整出演名单');
 for(const [c,slot] of occupied)assigned[c]=allSlots[slot];
 const st={...settings,incidentVisibility};
 if(cast.includes('godly_being'))st.godlyLoop??=1;
 if(cast.includes('transfer_student'))st.transferDay??=Math.min(2,days);
 if(cast.includes('boss'))st.bossTerritory??='city';
 if(st.godlyLoop!==undefined)integer(st.godlyLoop,1,loops,'神格登场轮回');
 if(st.transferDay!==undefined)integer(st.transferDay,1,days,'转学生登场日期');
 if(st.bossTerritory!==undefined&&!locs.includes(st.bossTerritory))throw setupError('请指定有效的大人物领地');
 const count=incidentCount===undefined?Math.min(ruleset==='MC'?3:2,days,cast.length):integer(incidentCount,0,ruleset==='MC'?days:Math.min(days,cast.length),'事件数');
 const requiredCulprits=cast.filter(c=>mustBeCulprit(assigned[c]));
 if(requiredCulprits.length>count)throw setupError('事件数不足：每名愚者、双子和绝对者都必须成为事件犯人');
 if(subPlots.includes('worship_apocalypse')&&count===0)throw setupError('「灭亡讴歌」至少需要一个自杀事件');
 const evs=shuffle(catalog.incidents.filter(e=>e.sets.includes(ruleset))),cul=[...shuffle(requiredCulprits),...shuffle(cast.filter(c=>!requiredCulprits.includes(c)&&!cannotBeCulprit(assigned[c])))];
 if(subPlots.includes('worship_apocalypse')){const suicide=evs.findIndex(e=>e.id==='suicide');[evs[0],evs[suicide]]=[evs[suicide],evs[0]];}
 // Keep a preparation window when the schedule has room, but vary every date.
 // Dense schedules may begin on day one; no hard-coded second/final-day pair.
 const possibleDays=Array.from({length:days-(days>=4&&count<days-1?1:0)},(_,i)=>i+(days>=4&&count<days-1?2:1));
 const eventDays=shuffle(possibleDays).slice(0,count).sort((a,b)=>a-b);
 const schedule=eventDays.map((day,i)=>{const type=evs[i%evs.length].id;return {day,type,culprit:cul[i]??cul[0],...(type==='fake_incident'?{publicType:shuffle(evs.filter(e=>e.id!==type))[0].id}:{})};});
 // A fixed MC cast can have fewer eligible culprits than scheduled days.
 // Repeated culprits are legal only when all of their events are Serial Murder.
 if(count>cul.length){if(!cul.length)throw setupError('出演名单中没有可担任事件犯人的人物');for(const event of schedule)if(event.culprit===cul[0]){event.type='serial_murder';delete event.publicType;}}
 const s={id:`generated-${seed}`,title:title.trim(),author:'随机生成',source:'random',generatorVersion:'2',ruleset,days,loops,communication,characters:cast,roles:assigned,mainPlot,subPlots,incidents:schedule,settings:st,specialRules:[],seed,validationStatus:'规则上成立，但没有试玩平衡过'};
 const errors=validateScript(s).errors;if(errors.length)throw setupError(errors.map(e=>e.message).join('；'));return s;
}

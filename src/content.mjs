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
export const name=id=>chars[id]?.name_zh_working||roles[id]?.name_zh_working||plots[id]?.name_zh_working||incidents[id]?.name_zh_working||catalog.locations.find(c=>c.id===id)?.name_zh||id;
export const starter={id:'first-script',title:'起始剧本',author:'BakaFire',ruleset:'FS',days:3,loops:3,communication:'between_loops_only',characters:['boy_student','girl_student','shrine_maiden','office_worker','idol','doctor'],mainPlot:'murder_plan',subPlots:['ripper_shadow'],roles:{boy_student:'person',girl_student:'key_person',shrine_maiden:'serial_killer',office_worker:'killer',idol:'misleader',doctor:'brain'},incidents:[{day:3,type:'suicide',culprit:'girl_student'}],settings:{},specialRules:[],provenance:'官方 quickset；交流选择为本地练习设置。'};
// This site's hidden-incident schedule keeps only dates in protagonist/public
// payloads. Incident effects may still become observable when they happen.
export function publicScript(s,{includeIncidentTypes=false}={}){return structuredClone({id:s.id,title:s.title,author:s.author,ruleset:s.ruleset,days:s.days,loops:s.loops,communication:s.communication,characters:s.characters,incidents:s.incidents.map(({day,type})=>({day,...(includeIncidentTypes?{type}:{})})),settings:s.settings,specialRules:s.specialRules||[]});}
export function validateScript(s){
 const errors=[],warnings=[];const err=(path,message)=>errors.push({path,message});
 if(!s||typeof s!=='object')return {errors:[{path:'script',message:'需要剧本对象'}],warnings};
 if(Array.isArray(s))return {errors:[{path:'script',message:'需要剧本对象而非数组'}],warnings};
 for(const k of ['subPlots','characters','incidents'])if(!Array.isArray(s[k]))err(k,'必须为数组');
 if(!s.roles||typeof s.roles!=='object'||Array.isArray(s.roles))err('roles','必须为角色映射');
 if(s.settings!==undefined&&(!s.settings||typeof s.settings!=='object'||Array.isArray(s.settings)))err('settings','必须为设置对象');
 if(s.specialRules!==undefined&&!Array.isArray(s.specialRules))err('specialRules','必须为数组');
 if(Array.isArray(s.incidents)&&s.incidents.some(e=>!e||typeof e!=='object'||Array.isArray(e)))err('incidents','每项事件必须为对象');
 if(errors.length)return {errors,warnings};
 if(!['FS','BTX'].includes(s.ruleset))err('ruleset','只支持 FS / BTX');
 for(const k of ['days','loops'])if(!Number.isInteger(s[k])||s[k]<1||s[k]>(k==='days'?10:8))err(k,'天数 1–10，轮回 1–8');
 if(typeof s.title!=='string'||!s.title.trim()||s.title.length>120)err('title','标题需为1–120字符');
 if(!['between_loops_only','allowed_during_loop'].includes(s.communication))err('communication','必须指定交流规则');
 if(!Array.isArray(s.characters)||s.characters.length<4||s.characters.length>24||new Set(s.characters).size!==s.characters.length||s.characters.some(x=>!chars[x]))err('characters','选择4–24个不重复的基础人物');
 if(!Array.isArray(s.subPlots)||s.subPlots.length!==(s.ruleset==='FS'?1:2)||new Set(s.subPlots).size!==s.subPlots.length)err('subPlots','FS选择1项X；BTX选择2项不同X');
 if(!plots[s.mainPlot]||plots[s.mainPlot].kind!=='Y'||!plots[s.mainPlot].sets.includes(s.ruleset))err('mainPlot','主规则不属于此集合');
 for(const p of s.subPlots||[])if(!plots[p]||plots[p].kind!=='X'||!plots[p].sets.includes(s.ruleset))err('subPlots','副规则不属于此集合');
 if((s.specialRules||[]).length)err('specialRules','当前版本不执行任意特殊规则，请使用标准规则');
 if(errors.length)return {errors,warnings};
 const min={},max={};for(const p of [s.mainPlot,...s.subPlots])for(const [r,n] of Object.entries(plots[p].addedRoles)){min[r]=(min[r]||0)+(typeof n==='number'?n:n.min);max[r]=(max[r]||0)+(typeof n==='number'?n:n.max);}
 for(const r of Object.keys(max)){min[r]=Math.min(min[r],roles[r].maxCount??99);max[r]=Math.min(max[r],roles[r].maxCount??99);}
 const counts={};for(const c of s.characters){const role=s.roles?.[c];if(!roles[role]||!roles[role].sets.includes(s.ruleset)){err('roles.'+c,'角色不属于此集合');continue;}
  if(c==='irregular'){if(role==='person'||max[role])err('roles.irregular','异常少年须取本集合中未加入的非普通角色');continue;}
  if(c==='ai_character'&&role==='person')err('roles.ai_character','A.I.不能为普通人');counts[role]=(counts[role]||0)+1;
  if(s.mainPlot==='contract'&&role==='key_person'&&!chars[c].tags.includes('girl'))err('roles.'+c,'契约关键人物须有少女属性');
 }
 for(const r of new Set([...Object.keys(counts),...Object.keys(max)])){if(r==='person')continue;if((counts[r]||0)<(min[r]||0)||(counts[r]||0)>(max[r]||0))err('roles.'+r,'配役数量不符合主副规则及人数上限');}
 if(!Array.isArray(s.incidents))err('incidents','事件必须为数组');
 const days=new Set(),culprits=new Set();for(const [i,e] of (s.incidents||[]).entries()){
  if(!Number.isInteger(e.day)||e.day<1||e.day>s.days||days.has(e.day))err(`incidents.${i}.day`,'日期越界或重复');days.add(e.day);
  if(!incidents[e.type]?.sets.includes(s.ruleset))err(`incidents.${i}.type`,'事件不属于此集合');
  if(!s.characters.includes(e.culprit)||culprits.has(e.culprit))err(`incidents.${i}.culprit`,'犯人不存在或重复');culprits.add(e.culprit);
  if(e.culprit==='black_cat')warnings.push({path:`incidents.${i}`,message:'黑猫会将事件效果替换为空'});
 }
 const st=s.settings||{};
 if(s.characters.includes('godly_being')&&(!Number.isInteger(st.godlyLoop)||st.godlyLoop<1||st.godlyLoop>s.loops))err('settings.godlyLoop','神格须指定有效到场轮回');
 if(s.characters.includes('transfer_student')&&(!Number.isInteger(st.transferDay)||st.transferDay<1||st.transferDay>s.days))err('settings.transferDay','转学生须指定有效到场日');
 if(s.characters.includes('boss')&&!locs.includes(st.bossTerritory))err('settings.bossTerritory','指定大人物领地');
 for(const [i,e] of (s.incidents||[]).entries())if(e.culprit==='transfer_student'&&e.day<st.transferDay)warnings.push({path:`incidents.${i}`,message:'事件发生时转学生尚未到场'});
 return {errors,warnings};
}
export function generateScript({ruleset='FS',seed=Date.now(),title='未命名的轮回',mainPlot,subPlots}={}){
 // mulberry32: neighbouring seeds must not share their first draws.
 let x=Number(seed)>>>0;const rand=()=>{x=(x+0x6D2B79F5)>>>0;let t=Math.imul(x^x>>>15,x|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){let j=Math.floor(rand()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
 mainPlot=mainPlot||shuffle(catalog.plots.filter(p=>p.kind==='Y'&&p.sets.includes(ruleset)))[0].id;subPlots=subPlots||shuffle(catalog.plots.filter(p=>p.kind==='X'&&p.sets.includes(ruleset))).slice(0,ruleset==='FS'?1:2).map(p=>p.id);
 if(!plots[mainPlot]||subPlots.some(p=>!plots[p]))throw Error('未知规则');
 const rs=[];for(const p of [mainPlot,...subPlots])for(const [r,n]of Object.entries(plots[p].addedRoles)){const count=typeof n==='number'?n:Math.floor(rand()*(n.max-n.min+1))+n.min;for(let i=0;i<count;i++)if(rs.filter(z=>z===r).length<(roles[r].maxCount??99))rs.push(r);}
 const cast=shuffle(['boy_student','girl_student','rich_girl','shrine_maiden','police','office_worker','informer','doctor','patient','class_rep','alien','idol','journalist','nurse','teacher','soldier']).slice(0,Math.max(ruleset==='FS'?6:8,rs.length));
 if(mainPlot==='contract'&&!cast.some(c=>chars[c].tags.includes('girl')))cast[0]='girl_student';
 const assigned=Object.fromEntries(cast.map(c=>[c,'person']));let free=shuffle(cast);
 for(const r of rs.sort((a,b)=>(a==='key_person'?-1:0)-(b==='key_person'?-1:0))){let idx=mainPlot==='contract'&&r==='key_person'?free.findIndex(c=>chars[c].tags.includes('girl')):0;assigned[free.splice(idx,1)[0]]=r;}
 const days=ruleset==='FS'?4:5,evs=shuffle(catalog.incidents.filter(e=>e.sets.includes(ruleset))),cul=shuffle(cast);
 const s={id:`generated-${seed}`,title,author:'本地约束生成器',ruleset,days,loops:3,communication:'between_loops_only',characters:cast,roles:assigned,mainPlot,subPlots,incidents:[{day:2,type:evs[0].id,culprit:cul[0]},{day:days,type:evs[1].id,culprit:cul[1]}],settings:{},specialRules:[],seed,validationStatus:'结构合法，尚未平衡试玩'};
 if(validateScript(s).errors.length)throw Error('生成约束失败');return s;
}

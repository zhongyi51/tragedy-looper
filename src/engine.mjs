import {createHash} from 'node:crypto';
import {catalog,chars,roles,plots,incidents,locs,name,publicScript,validateScript,contentHash} from './content.mjs';
export const VERSION='0.3.0';
export const VISIBILITY_POLICY='hidden_incident_names_v1';
export const phases={setup:'轮回准备',mm_cards:'剧作家行动',hero_cards:'主人公行动',cultist:'行动结算',mm_ability:'剧作家能力',hero_ability:'主人公能力',refusal:'主人公能力',reveal_plot:'主人公能力',incident:'事件',end_area:'日结束',end:'日结束',between:'时之狭间',guess:'最后的战斗',over:'对局结束'};
const cp=x=>structuredClone(x);export const sameCommand=(a,b)=>a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>a[k]===b[k]);const eq=sameCommand;
export const hash=s=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
const living=s=>Object.values(s.board).filter(c=>c.alive&&c.present);
const person=(s,id)=>s.board[id];
const currentRole=(s,id)=>s.script.subPlots.includes('paranoia_virus')&&s.script.roles[id]==='person'&&s.board[id].paranoia>=3?'serial_killer':s.script.roles[id];
const hasRole=(s,id,r)=>currentRole(s,id)===r||(currentRole(s,id)==='factor'&&((r==='misleader'&&s.locations.school>=2)||(r==='key_person'&&s.locations.city>=2)));
const effectiveLocationCards=new Set(['intrigue_1','intrigue_2','forbid_intrigue']);
const locationBluff=(card,target)=>locs.includes(target)&&!effectiveLocationCards.has(card.split('#')[0]);
function log(s,text,type='notice',extra={}){s.log.push({n:s.log.length+1,loop:s.loop,day:s.day,text,type,...extra});}
// Older saves recorded the hidden name even when an incident did not happen.
// Sanitize at the observation boundary too, including historical replay frames.
function visibleLog(s,isM){return s.log.map(entry=>{const e=cp(entry);if(!isM&&e.type==='incident'&&/^预告的「[^」]+」没有发生。$/.test(e.text))e.text=`第 ${e.day} 日预告的事件没有发生。`;return e;});}
function counter(s,id,type,n){if(locs.includes(id)){if(type!=='intrigue')return;s.locations[id]=Math.max(0,s.locations[id]+n);}else{if(!s.board[id])return;s.board[id][type]=Math.max(0,(s.board[id][type]||0)+n);}log(s,`${name(id)} · ${{goodwill:'友好',paranoia:'不安',intrigue:'暗跃',guard:'护卫'}[type]} ${n>0?'+':''}${n}`,'counter');}
function reveal(s,id){s.knownRoles[id]=currentRole(s,id);log(s,`${name(id)}的角色是「${name(currentRole(s,id))}」`,'reveal');}
function revealCulprit(s,day){let e=s.script.incidents.find(e=>e.day===day);if(e){s.knownCulprits[day]=e.culprit;log(s,`第${day}日事件犯人：${name(e.culprit)}`,'reveal');}}
function addUsage(s,key,scope='day'){s.usage[`${scope==='loop'?'L'+s.loop:'D'+s.loop+'.'+s.day}:${key}`]=true;}
function used(s,key,scope='day'){return !!s.usage[`${scope==='loop'?'L'+s.loop:'D'+s.loop+'.'+s.day}:${key}`];}
function stopped(s){return ['between','guess','over'].includes(s.phase);}
function finishLoop(s,forced=false){
 if(stopped(s))return;
 let failed=forced||s.loopFailed;
 for(const c of Object.values(s.board))if(c.present&&!c.alive&&hasRole(s,c.id,'friend')){reveal(s,c.id);failed=true;}
 const sc=s.script;const initial=r=>Object.keys(sc.roles).filter(c=>sc.roles[c]===r).map(c=>s.board[c].initial);
 if(sc.mainPlot==='avenger'&&initial('brain').some(l=>s.locations[l]>=2))failed=true;
 if(sc.mainPlot==='protect_place'&&s.locations.school>=2)failed=true;
 if(sc.mainPlot==='sealed_item'&&s.locations.shrine>=2)failed=true;
 if(sc.mainPlot==='contract'&&Object.keys(sc.roles).some(id=>sc.roles[id]==='key_person'&&s.board[id].intrigue>=2))failed=true;
 if(sc.mainPlot==='time_bomb'&&initial('witch').some(l=>s.locations[l]>=2))failed=true;
 if(sc.mainPlot==='change_future'&&s.occurred.some(day=>sc.incidents.find(e=>e.day===day)?.type==='butterfly'))failed=true;
 s.placements=[];s.pending=null;
 if(!failed){s.phase='over';s.winner='heroes';log(s,'成功跨越惨剧，主人公获胜。','victory');return;}
 log(s,`第 ${s.loop} 轮回失败。`,'loop');
 if(s.loop<sc.loops)s.phase='between';else if(sc.ruleset==='FS'){s.phase='over';s.winner='mastermind';log(s,'所有轮回失败，剧作家获胜。First Steps 没有最后的战斗。','defeat');}else enterGuess(s);
}
function kill(s,ids){
 const died=[];for(const id of new Set(ids)){let c=person(s,id);if(!c?.alive||!c.present||hasRole(s,id,'time_traveler'))continue;if(c.guard>0){counter(s,id,'guard',-1);continue;}c.alive=false;died.push(id);log(s,`${name(id)}死亡。`,'death');}
 // Trigger the whole forced batch before ending a loop; never let iteration order decide casualties.
 for(const c of living(s)){if((hasRole(s,c.id,'lover')&&died.some(id=>hasRole(s,id,'loved_one')))||(hasRole(s,c.id,'loved_one')&&died.some(id=>hasRole(s,id,'lover'))))counter(s,c.id,'paranoia',6);}
 if(died.some(id=>hasRole(s,id,'key_person')))finishLoop(s,true);
}
function killHeroes(s){if(s.heroImmortal){log(s,'主人公的死亡被阻止。');return;}log(s,'主人公死亡。','death');finishLoop(s,true);}
function canMove(s,id,loc){return locs.includes(loc)&&(id==='patient'&&s.patientFree||!chars[id].forbiddenLocations.includes(loc));}
function move(s,id,loc){let c=person(s,id);if(canMove(s,id,loc)&&c.location!==loc){c.location=loc;log(s,`${name(id)}移动至${name(loc)}。`,'move');}}
function enterGuess(s){s.phase='guess';s.pending=null;s.guessed={};s.placements=[];s.dayRevealed=[];s.locations=Object.fromEntries(locs.map(l=>[l,0]));for(const c of Object.values(s.board))Object.assign(c,{goodwill:0,paranoia:0,intrigue:0,guard:0,alive:true,present:true,location:c.initial});log(s,'进入最后的战斗：逐人指认，首次错误即失败。','loop');}
function startLoop(s){
 const old=s.board||{},fate=Object.values(old).filter(c=>c.goodwill>0).map(c=>c.id);
 s.day=1;s.phase='mm_cards';s.placements=[];s.usedCards={M:[],A:[],B:[],C:[]};s.locations=Object.fromEntries(locs.map(l=>[l,0]));s.heroImmortal=false;s.patientFree=false;s.suppressed=[];s.occurred=[];s.loopFailed=false;s.pending=null;s.board={};
 for(const id of s.script.characters){const def=chars[id],initial=locs.includes(def.start)?def.start:'city';s.board[id]={id,initial,location:initial,alive:true,present:id!=='transfer_student'&&(id!=='godly_being'||s.loop>=s.script.settings.godlyLoop),goodwill:0,paranoia:0,intrigue:0,guard:0};}
 log(s,`第 ${s.loop} 轮回开始。`,'loop');
 for(const c of living(s)){if(hasRole(s,c.id,'friend')&&s.knownRoles[c.id]==='friend')counter(s,c.id,'goodwill',1);if(c.id==='black_cat')counter(s,'shrine','intrigue',1);}
 if(s.script.subPlots.includes('threads_fate'))for(const id of fate)counter(s,id,'paranoia',2);
 if(s.board.henchman)s.phase='setup';else startDay(s);
}
function startDay(s){s.phase='mm_cards';s.placements=[];s.dayRevealed=[];if(s.board.transfer_student&&s.day===s.script.settings.transferDay){s.board.transfer_student.present=true;log(s,'转学生到场。');}log(s,`第 ${s.day} 日。`,'day');}
export function createGame(script){const v=validateScript(script);if(v.errors.length)throw Error(v.errors.map(e=>e.path+': '+e.message).join('\n'));const s={version:VERSION,visibilityPolicy:VISIBILITY_POLICY,contentHash,script:cp(script),revision:0,loop:1,leader:0,log:[],knownRoles:{},knownCulprits:{},knownPlots:[],usage:{},winner:null,notes:{A:'',B:'',C:'',M:''}};startLoop(s);return s;}
export function turn(s){if(s.phase==='over')return null;if(['mm_cards','mm_ability','cultist','refusal','reveal_plot','setup','end_area','end'].includes(s.phase))return 'M';if(s.phase==='incident')return s.pending.chooser;return ['A','B','C'][(s.leader+(s.phase==='hero_cards'?s.placements.filter(p=>p.seat!=='M').length:0))%3];}
export function deck(s,seat){const out=[];for(const d of catalog.actionDeckEntries.filter(d=>d.side===(seat==='M'?'mastermind':'protagonist')))for(let i=0;i<d.copiesPerHand;i++){const id=d.actionType+'#'+i;out.push({id,type:d.actionType,label:d.name_zh,once:d.oncePerLoop,available:!s.usedCards[seat].includes(id)&&!s.placements.some(p=>p.seat===seat&&p.card===id)});}return out;}
const option=(command,label)=>({command,label});
export function legalActions(s,seat=turn(s)){
 if(!seat||turn(s)!==seat)return [];
 const out=[],add=(command,label)=>out.push(option(command,label));
 if(s.phase==='setup'){for(const l of locs)add({type:'setup',location:l},`手下初始地点：${name(l)}`);return out;}
 if(s.phase==='between'){add({type:'next_loop'},'开始下一轮回');if(s.script.ruleset==='BTX')add({type:'final_battle'},'共同放弃剩余轮回，进入最后的战斗');return out;}
 if(s.phase==='guess'){for(const c of s.script.characters.filter(c=>!s.guessed[c]))for(const r of catalog.roles.filter(r=>r.sets.includes(s.script.ruleset)))add({type:'guess',character:c,role:r.id},`${name(c)} → ${name(r.id)}`);return out;}
 if(['mm_cards','hero_cards'].includes(s.phase)){const placed=s.placements.filter(p=>(p.seat==='M')===(seat==='M')).map(p=>p.target);for(const card of deck(s,seat).filter(c=>c.available))for(const target of [...living(s).map(c=>c.id),...locs].filter(t=>!placed.includes(t)))add({type:'place',card:card.id,target},`${card.label} → ${name(target)}${locationBluff(card.id,target)?'（佯动：地点上无效果）':''}`);return out;}
 if(s.phase==='cultist'){for(let mask=0;mask<2**s.cultists.length;mask++){const label=mask?'无视暗跃禁止：'+s.cultists.filter((_,i)=>mask&(1<<i)).map(name).join('、'):'按通常禁止效果结算';add({type:'cultist',mask},label);const boss=s.cultists.indexOf('boss');if(boss>=0&&(mask&(1<<boss))&&s.script.settings.bossTerritory!==s.board.boss.location)add({type:'cultist',mask,bossArea:'territory'},label+'（使用领地）');}return out;}
 if(s.phase==='end_area'){add({type:'end_area',territory:false},'按实际地点结算日结束强制能力');if(s.board.boss?.alive&&s.board.boss.present&&hasRole(s,'boss','serial_killer'))add({type:'end_area',territory:true},'大人物以领地位置使用日结束能力');return out;}
 if(s.phase==='refusal'){const a=s.pending.action,def=chars[a.actor].abilities[a.index],r=def.cannotRefuse?'none':roles[currentRole(s,a.actor)].goodwillRefusal;if(r!=='mandatory')add({type:'refusal',refuse:false},'接受友好能力');if(r!=='none')add({type:'refusal',refuse:true},'拒绝友好能力');return out;}
 if(s.phase==='reveal_plot'){for(const p of s.script.subPlots.filter(p=>p!==s.pending.exclude))add({type:'reveal_plot',plot:p},`公开${name(p)}`);return out;}
 if(s.phase==='incident')return incidentOptions(s);
 if(s.phase==='mm_ability'){
  for(const c of living(s)){
   const areas=[c.location];if(c.id==='boss')areas.push(s.script.settings.bossTerritory);
   if(hasRole(s,c.id,'brain')&&!used(s,c.id+':brain'))for(const area of new Set(areas))for(const target of [...living(s).filter(t=>t.location===area).map(t=>t.id),area])add({type:'mm',actor:c.id,ability:'brain',target},`${name(c.id)}：暗跃+1 → ${name(target)}`);
   if(hasRole(s,c.id,'misleader')&&!used(s,c.id+':misleader'))for(const t of living(s).filter(t=>areas.includes(t.location)))add({type:'mm',actor:c.id,ability:'misleader',target:t.id},`${name(c.id)}：不安+1 → ${name(t.id)}`);
   if(c.id==='doctor'&&c.goodwill>=2&&roles[currentRole(s,c.id)].goodwillRefusal!=='none'&&!used(s,'doctor:mm'))for(const t of living(s).filter(t=>t.id!==c.id&&t.location===c.location))for(const amount of [-1,1])add({type:'mm',actor:c.id,ability:'doctor',target:t.id,amount},`医生：不安${amount>0?'+':''}${amount} → ${name(t.id)}`);
  }
  if(s.script.subPlots.includes('unsettling_rumor')&&!used(s,'rumor','loop'))for(const l of locs)add({type:'mm',actor:'plot',ability:'rumor',target:l},`不安的传闻 → ${name(l)}暗跃+1`);
  add({type:'pass'},'结束剧作家能力阶段');return out;
 }
 if(s.phase==='hero_ability'){
  for(const c of living(s))for(const [i,a]of chars[c.id].abilities.entries()){
   if(c.goodwill<a.minGoodwill||s.loop<(a.minLoop||1)||used(s,`${c.id}:g${i}`,a.limit))continue;
   const same=living(s).filter(t=>t.location===c.location),other=same.filter(t=>t.id!==c.id),students=same.filter(t=>chars[t.id].tags.includes('student'));
   const addG=(target='',extra={})=>add({type:'goodwill',actor:c.id,index:i,target,...extra},`${name(c.id)} · ${i+1}：${a.effect_zh} ${target?' → '+name(target):''}${extra.amount?' ('+extra.amount+')':''}`);
   switch(c.id){
    case 'boy_student':case 'girl_student':students.filter(t=>t.id!==c.id).forEach(t=>addG(t.id));break;
    case 'rich_girl':if(['city','school'].includes(c.location))same.forEach(t=>addG(t.id));break;
    case 'shrine_maiden':if(i===0){if(c.location==='shrine')addG('shrine');}else same.forEach(t=>addG(t.id));break;
    case 'police':if(i===0)s.occurred.forEach(day=>addG('',{day}));else same.forEach(t=>addG(t.id));break;
    case 'office_worker':case 'irregular':case 'henchman':addG(c.id);break;
    case 'informer':catalog.plots.filter(p=>p.kind==='X'&&p.sets.includes(s.script.ruleset)).forEach(p=>addG(p.id));break;
    case 'doctor':if(i===0)other.forEach(t=>[-1,1].forEach(amount=>addG(t.id,{amount})));else if(s.board.patient)addG('patient');break;
    case 'class_rep':s.usedCards[seat].forEach(card=>addG('',{card}));break;
    case 'alien':(i===0?other:Object.values(s.board).filter(t=>t.present&&!t.alive&&t.location===c.location)).forEach(t=>addG(t.id));break;
    case 'godly_being':if(i===0)s.script.incidents.forEach(e=>addG('',{day:e.day}));else [...same.map(t=>t.id),c.location].forEach(t=>addG(t));break;
    case 'idol':other.forEach(t=>addG(t.id));break;
    case 'journalist':(i===0?living(s).filter(t=>t.id!==c.id).map(t=>t.id):[...same.map(t=>t.id),c.location]).forEach(t=>addG(t));break;
    case 'boss':living(s).filter(t=>t.location===s.script.settings.bossTerritory&&t.id!==c.id).forEach(t=>addG(t.id));break;
    case 'nurse':other.filter(t=>t.paranoia>=chars[t.id].paranoiaLimit).forEach(t=>addG(t.id));break;
    case 'forensic':if(i===0){for(const a of other)for(const b of other.filter(t=>t.id!==a.id)){const counters=['goodwill','paranoia','intrigue','guard'].filter(k=>a[k]>0);for(const counter of counters.length?counters:['goodwill'])addG(a.id,{to:b.id,counter});}}else Object.values(s.board).filter(t=>t.present&&!t.alive).forEach(t=>addG(t.id));break;
    case 'ai_character':s.script.incidents.forEach(e=>addG('',{day:e.day}));break;
    case 'teacher':if(i===0)students.forEach(t=>[-1,1].forEach(amount=>addG(t.id,{amount})));else students.forEach(t=>addG(t.id));break;
    case 'transfer_student':other.forEach(t=>addG(t.id));break;
    case 'soldier':if(i===0)same.forEach(t=>addG(t.id));else addG();break;
   }
  }
  add({type:'pass'},'结束主人公能力阶段');return out;
 }
 if(s.phase==='end'){
  for(const c of living(s)){
   const areas=[c.location];if(c.id==='boss')areas.push(s.script.settings.bossTerritory);
   if(hasRole(s,c.id,'killer')){
    if(!used(s,c.id+':kill'))for(const t of living(s).filter(t=>areas.includes(t.location)&&hasRole(s,t.id,'key_person')&&t.intrigue>=2))add({type:'end_ability',actor:c.id,ability:'kill',target:t.id},`${name(c.id)}杀死${name(t.id)}`);
    if(c.intrigue>=4&&!used(s,c.id+':heroes'))add({type:'end_ability',actor:c.id,ability:'heroes'},`${name(c.id)}杀死主人公`);
   }
   if(hasRole(s,c.id,'loved_one')&&c.paranoia>=3&&c.intrigue>=1&&!used(s,c.id+':heroes'))add({type:'end_ability',actor:c.id,ability:'heroes'},`${name(c.id)}杀死主人公`);
   if(hasRole(s,c.id,'time_traveler')&&s.day===s.script.days&&c.goodwill<=2&&!used(s,c.id+':travel'))add({type:'end_ability',actor:c.id,ability:'travel'},'时间旅行者结束轮回并使主人公失败');
  }
  add({type:'pass'},'结束本日');return out;
 }
 return out;
}
function resolveMovement(s){
 s.dayRevealed=cp(s.placements);log(s,'全部行动牌揭示。','cards',{cards:cp(s.placements)});
 // Any action card may legally be placed on a location as a bluff (official
 // FAQ Ca02). Only Intrigue cards affect locations; never move the location or
 // a character merely because its portrait appears inside that location.
 for(const p of s.placements.filter(p=>locationBluff(p.card,p.target))){const card=deck(s,p.seat).find(c=>c.id===p.card);log(s,`${name(p.target)}上的「${card.label}」为佯动：地点上无效果。`,'card_effect');}
 for(const c of living(s)){const types=s.placements.filter(p=>p.target===c.id).map(p=>p.card.split('#')[0]);if(types.includes('forbid_move'))continue;const h=types.includes('move_h'),v=types.includes('move_v'),d=types.includes('move_d');const def=catalog.locations.find(l=>l.id===c.location);const x=def.x^Number(d?!h:h),y=def.y^Number(d?!v:v);move(s,c.id,catalog.locations.find(l=>l.x===x&&l.y===y).id);}
 for(const p of s.placements){const c=deck(s,p.seat).find(c=>c.id===p.card);if(c.once)s.usedCards[p.seat].push(p.card);}
 s.cultists=living(s).filter(c=>hasRole(s,c.id,'cultist')).map(c=>c.id);s.ignoredAreas=[];
 const prohibits=s.placements.filter(p=>p.card.startsWith('forbid_intrigue')).length;
 if(prohibits!==1)s.cultists=[];
 // Every day has one resolution acknowledgement, even without any secret ability.
 s.phase='cultist';
}
function resolveCounters(s){
 const multiple=s.placements.filter(p=>p.card.startsWith('forbid_intrigue')).length>1;
 for(const target of [...living(s).map(c=>c.id),...locs]){
  const ts=s.placements.filter(p=>p.target===target).map(p=>p.card.split('#')[0]);const area=locs.includes(target)?target:s.board[target].location;
  const goodBlock=ts.includes('forbid_goodwill')&&!(s.board[target]&&hasRole(s,target,'time_traveler'));
  if(!goodBlock)for(const t of ts)if(t==='goodwill_1'||t==='goodwill_2')counter(s,target,'goodwill',Number(t.at(-1)));
  if(!ts.includes('forbid_paranoia')){for(const t of ts.filter(t=>t==='paranoia_1'))counter(s,target,'paranoia',1);for(const t of ts.filter(t=>t==='paranoia_minus_1'))counter(s,target,'paranoia',-1);}
  if(!ts.includes('forbid_intrigue')||multiple||s.ignoredAreas.includes(area))for(const t of ts)if(t==='intrigue_1'||t==='intrigue_2')counter(s,target,'intrigue',Number(t.at(-1)));
 }
 s.placements=[];s.phase='mm_ability';s.cultists=[];s.ignoredAreas=[];
}
function executeGoodwill(s,a){
 const {actor:id,index:i,target:t}=a;
 switch(id){
  case 'boy_student':case 'girl_student':case 'nurse':counter(s,t,'paranoia',-1);break;
  case 'rich_girl':counter(s,t,'goodwill',1);break;
  case 'shrine_maiden':if(i===0)counter(s,'shrine','intrigue',-1);else reveal(s,t);break;
  case 'police':if(i===0)revealCulprit(s,a.day);else counter(s,t,'guard',1);break;
  case 'office_worker':case 'irregular':reveal(s,id);break;
  case 'informer':{const ps=s.script.subPlots.filter(p=>p!==t);if(ps.length===1){s.knownPlots.push(ps[0]);log(s,`副规则公开：${name(ps[0])}`,'reveal');}else if(ps.length>1){s.pending={exclude:t};s.phase='reveal_plot';}break;}
  case 'doctor':if(i===0)counter(s,t,'paranoia',a.amount);else{s.patientFree=true;log(s,'住院患者本轮回可以自由移动。');}break;
  case 'class_rep':{const seat=['A','B','C'][s.leader];s.usedCards[seat]=s.usedCards[seat].filter(c=>c!==a.card);log(s,'领导者收回一张一次性行动牌。');break;}
  case 'alien':if(i===0)kill(s,[t]);else{s.board[t].alive=true;log(s,`${name(t)}复活。`);}break;
  case 'godly_being':if(i===0)revealCulprit(s,a.day);else counter(s,t,'intrigue',-1);break;
  case 'idol':counter(s,t,i===0?'paranoia':'goodwill',i===0?-1:1);break;
  case 'journalist':counter(s,t,i===0?'paranoia':'intrigue',1);break;
  case 'boss':reveal(s,t);break;
  case 'henchman':s.suppressed.push(id);log(s,'手下本轮回不会引发事件。');break;
  case 'forensic':if(i===1)reveal(s,t);else if(s.board[t][a.counter]>0){counter(s,t,a.counter,-1);counter(s,a.to,a.counter,1);}break;
  case 'ai_character':beginIncident(s,s.script.incidents.find(e=>e.day===a.day).type,id,['A','B','C'][s.leader],true);break;
  case 'teacher':if(i===0)counter(s,t,'paranoia',a.amount);else reveal(s,t);break;
  case 'transfer_student':counter(s,t,'intrigue',-1);counter(s,t,'goodwill',1);break;
  case 'soldier':if(i===0)counter(s,t,'paranoia',2);else{s.heroImmortal=true;log(s,'本轮回主人公不会死亡。');}break;
 }
}
function incidentOptions(s){const p=s.pending;if(!p)return [];const all=living(s),cul=s.board[p.culprit],out=[];const add=(args,label)=>out.push(option({type:'incident',...args},label));
 switch(p.incident){
 case 'murder':all.filter(c=>c.id!==cul.id&&c.location===cul.location).forEach(c=>add({target:c.id},`死亡 → ${name(c.id)}`));break;
 case 'unease':case 'spreading':for(const c of all)for(const d of all.filter(d=>d.id!==c.id))add({target:c.id,to:d.id},p.incident==='unease'?`${name(c.id)}不安+2；${name(d.id)}暗跃+1`:`${name(c.id)}友好−2；${name(d.id)}友好+2`);break;
 case 'faraway_murder':all.filter(c=>c.intrigue>=2).forEach(c=>add({target:c.id},`死亡 → ${name(c.id)}`));break;
 case 'missing':locs.filter(l=>canMove(s,cul.id,l)).forEach(l=>add({target:l},`行踪不明 → ${name(l)}`));break;
 case 'butterfly':for(const c of all.filter(c=>c.location===cul.location))for(const counter of ['goodwill','paranoia','intrigue'])add({target:c.id,counter},`${name(c.id)} ${counter}+1`);break;
 }
 return out;
}
function afterIncident(s,simulated){s.pending=null;if(stopped(s))return;if(simulated){s.phase='hero_ability';return;}startEnd(s);}
function beginIncident(s,type,culprit,chooser='M',simulated=false){
 s.pending={incident:type,culprit,chooser,simulated};s.phase='incident';
 if(!simulated&&culprit==='black_cat'){log(s,'事件发生，但没有可见效果。','incident');afterIncident(s,simulated);return;}
 if(type==='suicide')kill(s,[culprit]);
 else if(type==='evil')counter(s,'shrine','intrigue',2);
 else if(type==='hospital_incident'){const n=s.locations.hospital;if(n>=1)kill(s,living(s).filter(c=>c.location==='hospital').map(c=>c.id));if(n>=2&&!stopped(s))killHeroes(s);}
 else if(incidentOptions(s).length)return;
 else log(s,'事件没有可以结算的对象，未产生效果。','incident');
 afterIncident(s,simulated);
}
function checkIncident(s){const e=s.script.incidents.find(e=>e.day===s.day);if(!e){startEnd(s);return;}const c=s.board[e.culprit];const n=e.culprit==='ai_character'?c.goodwill+c.paranoia+c.intrigue+c.guard:c.paranoia;
 if(!c.present||!c.alive||s.suppressed.includes(e.culprit)||n<chars[e.culprit].paranoiaLimit){log(s,`第 ${e.day} 日预告的事件没有发生。`,'incident');startEnd(s);return;}s.occurred.push(e.day);log(s,`「${name(e.type)}」发生。`,'incident');beginIncident(s,e.type,e.culprit);
}
function startEnd(s){s.leader=(s.leader+1)%3;s.phase='end_area';}
function resolveEnd(s,territory){
 s.phase='end';const victims=[];
 for(const c of living(s).filter(c=>hasRole(s,c.id,'serial_killer'))){const area=c.id==='boss'&&territory?s.script.settings.bossTerritory:c.location;const others=living(s).filter(t=>t.id!==c.id&&t.location===area);if(others.length===1)victims.push(others[0].id);}
 kill(s,victims);
}
export function applyCommand(state,seat,command){
 const legal=legalActions(state,seat);if(!legal.some(o=>eq(o.command,command)))throw Error('ILLEGAL_ACTION');
 const s=cp(state),a=command;
 // Previous versions gave protagonist models the named incident schedule.
 // Their persisted notes may retain those secrets: clear only the three AI
 // protagonist notes once, preserving all board state and mastermind notes.
 if(s.visibilityPolicy!==VISIBILITY_POLICY){s.notes={...(s.notes||{}),A:'',B:'',C:''};s.visibilityPolicy=VISIBILITY_POLICY;s.version=VERSION;}
 switch(a.type){
  case 'setup':s.board.henchman.location=a.location;s.board.henchman.initial=a.location;log(s,`手下在${name(a.location)}入场。`);startDay(s);break;
  case 'place':s.placements.push({seat,card:a.card,target:a.target});log(s,`${seat==='M'?'剧作家':'主人公 '+seat}向${name(a.target)}盖放一张牌。`,'placed');if(seat==='M'&&s.placements.length===3)s.phase='hero_cards';if(s.placements.length===6)resolveMovement(s);break;
  case 'cultist':{s.cultists.forEach((id,i)=>{if(a.mask&(1<<i))s.ignoredAreas.push(id==='boss'&&a.bossArea==='territory'?s.script.settings.bossTerritory:s.board[id].location);});resolveCounters(s);break;}
  case 'end_area':resolveEnd(s,a.territory);break;
  case 'mm':addUsage(s,a.ability==='rumor'?'rumor':a.actor+':'+(a.ability==='doctor'?'mm':a.ability),a.ability==='rumor'?'loop':'day');counter(s,a.target,a.ability==='brain'||a.ability==='rumor'?'intrigue':'paranoia',a.amount??1);break;
  case 'goodwill':{const def=chars[a.actor].abilities[a.index];addUsage(s,`${a.actor}:g${a.index}`,def.limit);log(s,`请求${name(a.actor)}的友好能力 ${a.index+1}。`,'ability');s.phase='refusal';s.pending={action:a};break;}
  case 'refusal':{const pending=s.pending.action;s.pending=null;s.phase='hero_ability';if(a.refuse)log(s,'友好能力被拒绝。','refused');else executeGoodwill(s,pending);break;}
  case 'reveal_plot':s.knownPlots.push(a.plot);log(s,`副规则公开：${name(a.plot)}`,'reveal');s.pending=null;s.phase='hero_ability';break;
  case 'incident':{const p=cp(s.pending);switch(p.incident){case 'murder':case 'faraway_murder':kill(s,[a.target]);break;case 'unease':counter(s,a.target,'paranoia',2);counter(s,a.to,'intrigue',1);break;case 'spreading':counter(s,a.target,'goodwill',-2);counter(s,a.to,'goodwill',2);break;case 'missing':move(s,p.culprit,a.target);counter(s,s.board[p.culprit].location,'intrigue',1);break;case 'butterfly':counter(s,a.target,a.counter,1);break;}afterIncident(s,p.simulated);break;}
  case 'end_ability':addUsage(s,a.actor+':'+a.ability);if(a.ability==='kill')kill(s,[a.target]);else if(a.ability==='heroes')killHeroes(s);else finishLoop(s,true);break;
  case 'pass':if(s.phase==='mm_ability')s.phase='hero_ability';else if(s.phase==='hero_ability')checkIncident(s);else if(s.phase==='end'){if(s.day===s.script.days)finishLoop(s);else{s.day++;startDay(s);}}break;
  case 'next_loop':s.loop++;startLoop(s);break;
  case 'final_battle':enterGuess(s);break;
  case 'guess':{const correct=a.role===currentRole(s,a.character);log(s,`${name(a.character)} → ${name(a.role)}：${correct?'正确':'错误'}`,'guess');if(!correct){s.phase='over';s.winner='mastermind';}else{s.guessed[a.character]=a.role;if(Object.keys(s.guessed).length===s.script.characters.length){s.phase='over';s.winner='heroes';}}break;}
 }
 s.revision++;return s;
}
// Acknowledgements and forced rules are engine work, even if the active seat
// normally belongs to an AI. Preserve optional choices whenever they can affect
// the game; a choice between aliases for the same resolution needs no player.
export function automaticCommand(s,seat=turn(s)){
 const actions=legalActions(s,seat);
 if(actions.length===1)return cp(actions[0].command);
 if(actions.length<2)return null;
 if(s.phase==='cultist'){
  const blocks=s.placements.filter(p=>p.card.split('#')[0]==='forbid_intrigue');
  // No active prohibition, no matching Intrigue addition, or no cultist in
  // its area: every mask resolves identically, including old saved states.
  const target=blocks.length===1?blocks[0].target:null;
  const receivesIntrigue=target&&(locs.includes(target)||s.board[target]?.alive&&s.board[target]?.present)
   &&s.placements.some(p=>p.target===target&&['intrigue_1','intrigue_2'].includes(p.card.split('#')[0]));
  const area=locs.includes(target)?target:s.board[target]?.location;
  const canIgnore=receivesIntrigue&&s.cultists.some(id=>s.board[id]?.location===area||id==='boss'&&s.script.settings.bossTerritory===area);
  if(!canIgnore)return cp(actions[0].command);
 }
 if(s.phase==='end_area'){
  const first=hash(applyCommand(s,seat,actions[0].command));
  if(actions.slice(1).every(a=>hash(applyCommand(s,seat,a.command))===first))return cp(actions[0].command);
 }
 return null;
}
const automaticBoundaries=new Set(['setup','mm_cards','hero_cards','between','guess']);
// Pure bounded transition chain. Return each intermediate frame so adapters
// can persist/replay the exact rules without another HTTP or model request.
export function advanceAutomatic(initial,{maxSteps=64,stopBefore,includeBetween=false}={}){
 if(!Number.isInteger(maxSteps)||maxSteps<0||maxSteps>128)throw Error('INVALID_AUTOMATIC_LIMIT');
 if(stopBefore!==undefined&&typeof stopBefore!=='function')throw Error('INVALID_AUTOMATIC_BOUNDARY');
 let state=initial;const steps=[];
 for(;;){
  const seat=turn(state);
  if(!seat)return {state,steps,reason:'terminal'};
  if(automaticBoundaries.has(state.phase)&&!(state.phase==='between'&&includeBetween)||stopBefore?.(state,seat))return {state,steps,reason:'boundary'};
  const command=automaticCommand(state,seat);
  if(!command)return {state,steps,reason:'decision'};
  if(steps.length>=maxSteps)return {state,steps,reason:'limit'};
  state=applyCommand(state,seat,command);
  steps.push({seat,command,state});
 }
}
// `team` is for one human holding all three protagonist hands: every protagonist
// card face and hand is theirs to see. AI protagonists keep per-seat views.
export function view(s,seat='public',{team=false}={}){
 const isM=seat==='M',hero=['A','B','C'].includes(seat),own=p=>p.seat===seat||team&&hero&&p.seat!=='M';
 const v={version:s.version,revision:s.revision,script:publicScript(s.script,{includeIncidentTypes:isM}),loop:s.loop,day:s.day,leader:['A','B','C'][s.leader],phase:phases[s.phase],phaseId:s.phase,turn:turn(s),winner:s.winner,board:cp(s.board),locations:cp(s.locations),knownRoles:cp(s.knownRoles),knownCulprits:cp(s.knownCulprits),knownPlots:cp(s.knownPlots),guessed:s.guessed||{},occurred:cp(s.occurred||[]),flags:{heroImmortal:!!s.heroImmortal,patientFree:!!s.patientFree,suppressed:cp(s.suppressed||[])},log:visibleLog(s,isM),placements:s.placements.map(p=>({seat:p.seat,target:p.target,...(own(p)?{card:p.card}:{})})),revealedCards:cp(s.dayRevealed||[]),hand:isM||hero?deck(s,seat):[],actions:legalActions(s,seat),seat};
 if(team&&hero&&s.usedCards)v.hands=Object.fromEntries(['A','B','C'].map(x=>[x,deck(s,x)]));
 if(isM){v.secret={roles:cp(s.script.roles),mainPlot:s.script.mainPlot,subPlots:cp(s.script.subPlots),incidents:cp(s.script.incidents)};if(s.pending)v.pending=cp(s.pending);}
 // A controller sees requests but never hidden refusal causes or pending culprit ids.
 if(seat===turn(s)&&s.phase==='incident')v.choiceTitle='选择事件效果';
 return v;
}
const moveNames={move_h:'横移',move_v:'纵移',move_d:'斜移'};
function moveDestination(s,id,type){const c=s.board[id],def=catalog.locations.find(l=>l.id===c.location),h=type==='move_h'||type==='move_d',v=type==='move_v'||type==='move_d';const to=catalog.locations.find(l=>l.x===(def.x^Number(h))&&l.y===(def.y^Number(v))).id;return canMove(s,id,to)?to:null;}
function moveHint(s,id,types){return types.map(t=>{const to=moveDestination(s,id,t);return `${moveNames[t]}→${to?name(to):'禁入'}`;}).join('，');}
function upcomingIncidents(s){return s.script.incidents.filter(e=>e.day>=s.day&&!s.occurred.includes(e.day)).sort((a,b)=>a.day-b.day);}
// Seat-scoped summary: the mastermind sees concrete loss paths derived from the
// secret script; protagonists only get facts already visible on their board.
export function transitionFrames(project,initial,states){
 const signature=v=>JSON.stringify([v.board,v.locations,v.log,v.placements,v.revealedCards,v.loop,v.day,v.winner]);
 let last=signature(project(initial));const frames=[];
 for(const state of states){
  const {actions,hand,hands,secret,pending,choiceTitle,...frame}=project(state),key=signature(frame);
  if(key!==last){frame.busy=false;frames.push(frame);last=key;}
 }
 return frames;
}
export function strategicBriefing(s,seat=turn(s)){
 if(!seat||['between','guess','over'].includes(s.phase))return [];
 const out=[],live=living(s),daysLeft=s.script.days-s.day+1,loopsLeft=s.script.loops-s.loop;
 out.push(`第 ${s.loop}/${s.script.loops} 轮回，第 ${s.day}/${s.script.days} 日；本轮回含今日还剩 ${daysLeft} 次出牌机会。${seat==='M'?(loopsLeft?`还需再让 ${loopsLeft+1} 个轮回全部失败。`:'这是最后一个轮回：只要本轮回失败就能获胜。'):(loopsLeft?`本轮回失败后还剩 ${loopsLeft} 次重来机会。`:'这是最后一个轮回，必须阻止所有惨剧。')}`);
 if(seat!=='M'){
  const pending=s.script.incidents.filter(e=>e.day>=s.day&&!s.occurred.includes(e.day)).map(e=>e.day);
  if(pending.length)out.push(`尚未到来的事件日：${pending.map(d=>'第'+d+'日').join('、')}。事件在犯人不安达到临界时发生。`);
  const tense=live.filter(c=>c.paranoia>=chars[c.id].paranoiaLimit-1).map(c=>`${name(c.id)} 不安 ${c.paranoia}/${chars[c.id].paranoiaLimit}${c.paranoia>=chars[c.id].paranoiaLimit?'（已达临界）':'（差1）'}`);
  if(tense.length)out.push('接近不安临界：'+tense.join('；')+'。不安−1 每轮回只能用一次，优先用于今日或明日的高危人物。');
  const plotted=[...live.filter(c=>c.intrigue>=1).map(c=>`${name(c.id)} 暗跃 ${c.intrigue}`),...locs.filter(l=>s.locations[l]>=1).map(l=>`${name(l)} 暗跃 ${s.locations[l]}`)];
  if(plotted.length)out.push('已有暗跃：'+plotted.join('；')+'。暗跃常是失败条件，暗跃禁止同日只能有一张生效，三名主人公不要重复放暗跃禁止。');
  const alone=locs.map(l=>live.filter(c=>c.location===l)).filter(g=>g.length===2).map(g=>g.map(c=>name(c.id)).join('与'));
  if(alone.length)out.push('两人独处的地点（若一方是连环杀手，另一方日结束会死亡）：'+alone.join('；')+'。');
  const known=Object.entries(s.knownRoles).map(([c,r])=>`${name(c)}=${name(r)}`);if(known.length)out.push('已确认角色：'+known.join('、')+'。');
  out.push('提升友好可解锁人物能力（如公开角色、减少不安）。观察剧作家把不安+1/暗跃+1放在谁身上，通常就是犯人或关键角色。');
  return out;
 }
 const sc=s.script,roleOf=r=>live.filter(c=>hasRole(s,c.id,r));
 for(const e of upcomingIncidents(s)){
  const c=s.board[e.culprit],limit=chars[e.culprit].paranoiaLimit,value=e.culprit==='ai_character'?c.goodwill+c.paranoia+c.intrigue+c.guard:c.paranoia,need=Math.max(0,limit-value),chances=e.day-s.day+1;
  const state=!c.alive||!c.present?'犯人已死亡或未到场，无法发生':s.suppressed.includes(e.culprit)?'已被手下能力压制':need===0?'已达到临界，当天必定发生':`还差 ${need} 点不安，距该日还有 ${chances} 次出牌${need>chances*2?'（很难达成）':''}`;
  let effect='';
  if(e.type==='suicide')effect=hasRole(s,e.culprit,'key_person')?'；犯人是关键人物，自杀会直接令轮回失败':hasRole(s,e.culprit,'friend')?'；犯人是朋友，死亡会令轮回失败':'';
  else if(e.type==='murder')effect='；可杀死与犯人同地点的一人，若能杀关键人物则轮回失败';
  else if(e.type==='hospital_incident')effect=`；医院暗跃 ${s.locations.hospital}：≥1 医院内全员死亡，≥2 主人公死亡`;
  else if(e.type==='faraway_murder')effect='；可杀死任意一名暗跃≥2的人物';
  else if(e.type==='evil')effect='；神社暗跃+2';
  out.push(`第 ${e.day} 日「${name(e.type)}」犯人 ${name(e.culprit)}（${name(c.location)}，不安 ${value}/${limit}）：${state}${effect}。`);
 }
 const keys=roleOf('key_person'),killers=roleOf('killer');
 for(const k of keys){out.push(`关键人物 ${name(k.id)}（${name(k.location)}，暗跃 ${k.intrigue}）死亡即轮回失败。移动：${moveHint(s,k.id,['move_h','move_v','move_d'])}。`);}
 for(const k of killers){const victims=keys.filter(t=>t.location===k.location);out.push(`杀手 ${name(k.id)}（${name(k.location)}，暗跃 ${k.intrigue}）：日结束可杀死同地点且暗跃≥2的关键人物${victims.length?'（当前同处：'+victims.map(t=>name(t.id)+' 暗跃 '+t.intrigue).join('、')+'）':'（当前不同处，可用移动牌让双方会合）'}；自身暗跃≥4 时可杀死主人公。移动：${moveHint(s,k.id,['move_h','move_v','move_d'])}。`);}
 for(const k of roleOf('serial_killer')){const others=live.filter(t=>t.id!==k.id&&t.location===k.location);out.push(`连环杀手 ${name(k.id)}（${name(k.location)}）：日结束若同地点恰好只有一人，此人死亡。当前同地点 ${others.length} 人${others.length===1?'（'+name(others[0].id)+'将死亡）':''}。移动：${moveHint(s,k.id,['move_h','move_v','move_d'])}。`);}
 for(const k of roleOf('brain'))out.push(`幕后黑手 ${name(k.id)}（${name(k.location)}）：剧作家能力阶段每日一次，可给同地点人物或该地点暗跃+1。`);
 for(const k of roleOf('misleader'))out.push(`误导者 ${name(k.id)}（${name(k.location)}）：剧作家能力阶段每日一次，可给同地点人物不安+1，适合推高犯人不安。`);
 for(const k of roleOf('cultist'))out.push(`邪教徒 ${name(k.id)}（${name(k.location)}）：可无视其所在地点的暗跃禁止。`);
 const initial=r=>Object.keys(sc.roles).filter(c=>sc.roles[c]===r).map(c=>s.board[c].initial);
 if(sc.mainPlot==='avenger')out.push(`主规则：幕后黑手初始地点（${initial('brain').map(name).join('、')}）暗跃≥2 时轮回失败；当前 ${initial('brain').map(l=>s.locations[l]).join('、')}。`);
 if(sc.mainPlot==='protect_place')out.push(`主规则：学校暗跃≥2 时轮回失败；当前学校暗跃 ${s.locations.school}。`);
 if(sc.mainPlot==='sealed_item')out.push(`主规则：神社暗跃≥2 时轮回失败；当前神社暗跃 ${s.locations.shrine}。`);
 if(sc.mainPlot==='time_bomb')out.push(`主规则：魔女初始地点（${initial('witch').map(name).join('、')}）暗跃≥2 时轮回失败；当前 ${initial('witch').map(l=>s.locations[l]).join('、')}。`);
 if(sc.mainPlot==='contract')out.push(`主规则：关键人物暗跃≥2 时轮回失败；当前 ${keys.map(k=>name(k.id)+' '+k.intrigue).join('、')||'无'}。`);
 if(sc.mainPlot==='change_future')out.push('主规则：本轮回发生过「蝴蝶振翅」则轮回失败。');
 for(const f of Object.values(s.board).filter(c=>c.present&&hasRole(s,c.id,'friend')))out.push(`朋友 ${name(f.id)}${f.alive?'':'（已死亡）'}：轮回结束时若已死亡则轮回失败。`);
 for(const k of roleOf('loved_one'))out.push(`主恋人 ${name(k.id)}：不安≥3 且暗跃≥1 时日结束可杀死主人公；当前不安 ${k.paranoia}、暗跃 ${k.intrigue}。`);
 for(const k of roleOf('time_traveler'))out.push(`时间旅行者 ${name(k.id)}：最后一日友好≤2 时可令轮回失败；当前友好 ${k.goodwill}。友好禁止可阻止主人公加友好。`);
 const blocked=live.filter(c=>c.goodwill>0).map(c=>`${name(c.id)} 友好 ${c.goodwill}`);if(blocked.length)out.push('主人公正在积累友好：'+blocked.join('；')+'。必要时用友好禁止阻止能力解锁。');
 out.push('策略：集中资源推进 1–2 条最快的失败路径，再用其他牌制造干扰。主人公每天最多 3 张牌，且同日两张以上暗跃禁止会全部失效；移动牌只作用于人物，不能移动地点。');
 return out;
}
function incidentWeight(s,e){
 switch(e.type){
  case 'suicide':return hasRole(s,e.culprit,'key_person')||hasRole(s,e.culprit,'friend')?12:2;
  case 'murder':return 8;
  case 'hospital_incident':return s.locations.hospital>=1?9:4;
  case 'faraway_murder':return 6;
  case 'evil':return s.script.mainPlot==='sealed_item'?10:3;
  case 'butterfly':return s.script.mainPlot==='change_future'?12:3;
  default:return 4;
 }
}
function plotLocations(s){
 const sc=s.script,initial=r=>Object.keys(sc.roles).filter(c=>sc.roles[c]===r).map(c=>s.board[c].initial),out=new Set();
 if(sc.mainPlot==='protect_place')out.add('school');if(sc.mainPlot==='sealed_item')out.add('shrine');
 if(sc.mainPlot==='avenger')initial('brain').forEach(l=>out.add(l));if(sc.mainPlot==='time_bomb')initial('witch').forEach(l=>out.add(l));
 if(upcomingIncidents(s).some(e=>e.type==='hospital_incident'))out.add('hospital');
 return [...out];
}
// Mastermind-side evaluation of a full state; only the mastermind bot may use it.
function mastermindValue(s){
 if(s.winner==='mastermind'||s.phase==='between'||s.phase==='guess')return 1000;
 if(s.winner==='heroes')return -1000;
 const live=living(s),keys=live.filter(c=>hasRole(s,c.id,'key_person')),killers=live.filter(c=>hasRole(s,c.id,'killer'));let v=0;
 for(const e of upcomingIncidents(s)){const c=s.board[e.culprit];if(!c.alive||!c.present||s.suppressed.includes(e.culprit))continue;const limit=Math.max(1,chars[e.culprit].paranoiaLimit);v+=incidentWeight(s,e)*Math.min(c.paranoia,limit)/limit;}
 for(const k of keys)v+=Math.min(k.intrigue,2)*3+(killers.some(x=>x.location===k.location)?3:0);
 for(const l of plotLocations(s))v+=Math.min(s.locations[l],2)*4;
 for(const k of killers)v+=Math.min(k.intrigue,4);
 for(const k of live.filter(c=>hasRole(s,c.id,'loved_one')))v+=Math.min(k.paranoia,3)+Math.min(k.intrigue,1)*2;
 v+=Object.values(s.board).filter(c=>c.present&&!c.alive&&hasRole(s,c.id,'friend')).length*50;
 v-=live.reduce((n,c)=>n+c.goodwill*.4+c.guard*2,0)+Object.keys(s.knownRoles).length*2+Object.keys(s.knownCulprits).length*1.5+s.knownPlots.length*2;
 return v;
}
function mastermindPlacement(s,a){
 const type=a.card.split('#')[0],t=a.target,c=s.board[t];
 if(!c)return ['intrigue_1','intrigue_2'].includes(type)?(plotLocations(s).includes(t)&&s.locations[t]<2?(type==='intrigue_2'?9:8):1):.2;
 const live=living(s),is=r=>hasRole(s,t,r),keys=live.filter(k=>hasRole(s,k.id,'key_person')),killers=live.filter(k=>hasRole(s,k.id,'killer'));
 const incidents=upcomingIncidents(s).filter(e=>e.culprit===t&&!s.suppressed.includes(t)),limit=chars[t].paranoiaLimit;
 if(type==='paranoia_1'){let n=is('loved_one')&&c.paranoia<3?5:.5;for(const e of incidents){const need=limit-c.paranoia;if(need>0&&need<=(e.day-s.day+1)*2)n=Math.max(n,incidentWeight(s,e)+(e.day===s.day?2:0));}return n;}
 if(type==='intrigue_1'||type==='intrigue_2'){
  if(is('key_person')&&c.intrigue<2&&(killers.length||s.script.mainPlot==='contract'||upcomingIncidents(s).some(e=>e.type==='faraway_murder')))return type==='intrigue_2'&&c.intrigue===0?9:7;
  if(is('killer'))return c.intrigue<4?3:.5;if(is('loved_one')&&c.intrigue<1)return 5;return .8;
 }
 if(type.startsWith('move')){
  const to=moveDestination(s,t,type);if(!to||to===c.location)return .1;
  const there=live.filter(x=>x.location===to&&x.id!==t);
  if(is('killer')&&keys.some(k=>k.location===to))return 9+(keys.some(k=>k.location===to&&k.intrigue>=2)?2:0);
  if(is('key_person')&&killers.some(k=>k.location===to))return 9+(c.intrigue>=2?2:0);
  if((is('key_person')||is('friend'))&&there.length===1&&hasRole(s,there[0].id,'serial_killer'))return 10;
  if(is('serial_killer')&&there.length===1)return hasRole(s,there[0].id,'key_person')||hasRole(s,there[0].id,'friend')?11:4;
  if(upcomingIncidents(s).some(e=>e.culprit===t&&e.type==='murder')&&keys.some(k=>k.location===to))return 6;
  return .5;
 }
 if(type==='forbid_goodwill')return is('time_traveler')&&s.day>=s.script.days-1?8:c.goodwill>=1?2+c.goodwill:.3;
 if(type==='forbid_paranoia')return incidents.some(e=>e.day<=s.day+1)&&c.paranoia>=limit?5:.2;
 return .3;
}
const reducesParanoia=(a,i)=>['boy_student','girl_student','nurse'].includes(a)||a==='idol'&&i===0;
// Protagonist bot: only its own observation. Mastermind card targets are public
// and are the main signal for where a threat is being built.
function revealedHistory(v){
 const h={paranoia:{},intrigue:{}};
 for(const e of v.log)for(const p of e.type==='cards'&&e.cards||[]){if(p.seat!=='M')continue;const t=p.card.split('#')[0];if(t==='paranoia_1')h.paranoia[p.target]=(h.paranoia[p.target]||0)+1;if(t.startsWith('intrigue'))h.intrigue[p.target]=(h.intrigue[p.target]||0)+1;}
 return h;
}
function heroScore(v,a,history){
 const c=v.board[a.target];
 if(a.type==='place'){
  const type=a.card.split('#')[0],mmTargets=v.placements.filter(p=>p.seat==='M').map(p=>p.target),targeted=mmTargets.includes(a.target);
  const soon=v.script.incidents.some(e=>e.day>=v.day&&e.day<=v.day+1);
  // Shared convention: once a teammate answers a mastermind target, others avoid a second Forbid Intrigue that would cancel it.
  const answered=v.placements.some(p=>p.seat!=='M'&&p.seat!==v.seat&&mmTargets.includes(p.target))?.3:1;
  if(!c)return type==='forbid_intrigue'?(targeted?7+v.locations[a.target]+(history.intrigue[a.target]||0):v.locations[a.target]>=1?2:.2)*answered:.1;
  const limit=chars[c.id].paranoiaLimit,gap=limit-c.paranoia,suspect=history.paranoia[c.id]||0;
  if(type==='paranoia_minus_1')return c.paranoia>0&&gap<=1?(soon?11:7)+(targeted?2:0)+suspect:targeted&&c.paranoia>0&&gap<=2?4+suspect:.1;
  if(type==='forbid_intrigue')return (targeted?6+c.intrigue+(history.intrigue[c.id]||0):c.intrigue>=1?2:.2)*answered;
  if(type==='goodwill_1'||type==='goodwill_2'){const min=Math.min(...chars[c.id].abilities.map(x=>x.minGoodwill),99);if(min===99)return .3;if(c.goodwill>=min)return 1;return 4.5-Math.max(0,min-c.goodwill-(type==='goodwill_2'?2:1))*.6-(targeted?.4:0);}
  if(type==='forbid_move')return targeted?3:.3;
  return type==='paranoia_1'?.05:.4;
 }
 if(a.type==='goodwill'){
  const t=a.target&&v.board[a.target],ratio=t?t.paranoia/Math.max(1,chars[t.id].paranoiaLimit):0,unknown=t&&!v.knownRoles[t.id];
  if(reducesParanoia(a.actor,a.index)||a.actor==='doctor'&&a.index===0||a.actor==='teacher'&&a.index===0)return a.amount===1?-1:t?.paranoia>0?3+ratio*5:-1;
  if(['office_worker','irregular','boss'].includes(a.actor)||['shrine_maiden','forensic','teacher'].includes(a.actor)&&a.index===1)return unknown?4:-1;
  if(a.actor==='shrine_maiden')return v.locations.shrine>0?5:-1;
  if(a.actor==='transfer_student'||a.actor==='godly_being'&&a.index===1)return t?.intrigue>0||(!t&&v.locations[a.target]>0)?5:-1;
  if(a.actor==='soldier')return a.index===1?5:-1;
  if(a.actor==='alien')return a.index===1?5:-2;
  if(a.actor==='journalist'||a.actor==='ai_character')return -1;
  if(a.actor==='police'||a.actor==='godly_being')return a.index===0?(v.knownCulprits[a.day]?-1:4):2;
  if(a.actor==='henchman')return 4;
  if(a.actor==='forensic')return .2;
  return 1;
 }
 if(a.type==='pass')return 0;if(a.type==='next_loop')return 10;if(a.type==='final_battle')return 0;
 if(a.type==='guess')return v.knownRoles[a.character]===a.role?10:a.role==='person'?1:0;
 return 1;
}
// The next `count` commands the practice bot would give this seat in a row.
export function botPlan(s,seat=turn(s),count=1){
 const out=[];let current=s;
 while(out.length<count&&turn(current)===seat&&current.phase===s.phase){const command=botCommand(current,seat);out.push(command);current=applyCommand(current,seat,command);}
 return out;
}
// Deterministic per-day variety: the same state always gives the same choice,
// but equal-looking days in different loops do not replay move for move.
function dayNoise(s,i){let h=(Math.imul(s.loop,0x9E3779B1)^Math.imul(s.day,0x85EBCA6B)^Math.imul(i+1,0xC2B2AE35)^(Number(s.script.seed)|0))>>>0;h^=h>>>15;h=Math.imul(h,0x2C1B3C6D);h^=h>>>12;return (h>>>0)/4294967296;}
const mastermindWon=s=>s.winner==='mastermind'||s.phase==='between'||s.phase==='guess';
function bestByValue(s,options){let best=options[0],score=-Infinity;for(const [i,o] of options.entries()){const n=mastermindValue(applyCommand(s,'M',o.command))+(i%7)*.001;if(n>score){score=n;best=o;}}return best;}
// Plays today out with the given mastermind cards, assuming the protagonists
// do nothing useful, to see whether the loop already fails tonight.
function winsToday(s,cards){
 let sim=cp({...s,log:[]});
 sim.placements=[...cards.map(c=>({seat:'M',card:c.card,target:c.target})),...['A','B','C'].map((seat,i)=>({seat,card:'goodwill_1#0',target:locs[i]}))];
 resolveMovement(sim);
 for(let n=0;n<40&&!stopped(sim)&&sim.loop===s.loop&&sim.day===s.day;n++){
  const seat=turn(sim),options=legalActions(sim,seat);
  sim=applyCommand(sim,seat,(seat==='M'?bestByValue(sim,options):options.find(o=>o.command.type==='pass')||options[0]).command);
 }
 return mastermindWon(sim);
}
const outcomeMemo=new Map();
const daySignature=s=>hash([s.script,s.loop,s.day,s.board,s.locations,s.usedCards,s.usage,s.suppressed,s.heroImmortal,s.patientFree]);
function winsTodayMemo(s,signature,cards){
 const key=signature+cards.map(c=>c.card+'>'+c.target).sort().join();
 if(!outcomeMemo.has(key)){if(outcomeMemo.size>4000)outcomeMemo.clear();outcomeMemo.set(key,winsToday(s,cards));}
 return outcomeMemo.get(key);
}
// Heuristic priority picks the cards; a short search over the best few
// combinations catches plans that end the loop today if left unanswered.
function mastermindCard(s,options){
 const mine=s.placements.filter(p=>p.seat==='M').map(p=>({card:p.card,target:p.target})),need=3-mine.length;
 const scored=options.map((o,i)=>({o,score:mastermindPlacement(s,o.command)*(1+.15*dayNoise(s,i))})).sort((a,b)=>b.score-a.score);
 const top=scored.slice(0,6),signature=need>0?daySignature(s):'';let best=null;
 const search=(start,picked)=>{
  if(picked.length===need){const sum=picked.reduce((n,x)=>n+x.score,0);if((!best||sum>best.sum)&&winsTodayMemo(s,signature,[...mine,...picked.map(x=>x.o.command)]))best={sum,first:picked[0]};return;}
  for(let i=start;i<top.length;i++){const c=top[i].o.command;if(picked.some(x=>x.o.command.card===c.card||x.o.command.target===c.target))continue;search(i+1,[...picked,top[i]]);}
 };
 if(need>0)search(0,[]);
 return (best?best.first:scored[0]).o;
}
export function botCommand(s,seat=turn(s)){
 const options=legalActions(s,seat);if(!options.length)throw Error('NO_ACTION');
 if(options.length===1)return options[0].command;
 if(seat==='M')return (options[0].command.type==='place'?mastermindCard(s,options):bestByValue(s,options)).command;
 let best=options[0],score=-Infinity;
 const v=view(s,seat),history=revealedHistory(v);
 for(const [i,o] of options.entries()){const n=heroScore(v,o.command,history)*(o.command.type==='place'?1+.1*dayNoise(s,i):1)+(i%7)*.001;if(n>score){score=n;best=o;}}
 return best.command;
}

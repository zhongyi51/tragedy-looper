import {createHash} from 'node:crypto';
import {catalog,chars,roles,plots,incidents,locs,name,publicScript,validateScript,contentHash} from './content.mjs';
export const VERSION='0.2.1';
export const VISIBILITY_POLICY='hidden_incident_names_v1';
export const phases={setup:'轮回准备',mm_cards:'剧作家行动',hero_cards:'主人公行动',cultist:'行动结算',mm_ability:'剧作家能力',hero_ability:'主人公能力',refusal:'主人公能力',reveal_plot:'主人公能力',incident:'事件',end_area:'日结束',end:'日结束',between:'时之狭间',guess:'最后的战斗',over:'对局结束'};
const cp=x=>structuredClone(x);export const sameCommand=(a,b)=>a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>a[k]===b[k]);const eq=sameCommand;
export const hash=s=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
const living=s=>Object.values(s.board).filter(c=>c.alive&&c.present);
const person=(s,id)=>s.board[id];
const currentRole=(s,id)=>s.script.subPlots.includes('paranoia_virus')&&s.script.roles[id]==='person'&&s.board[id].paranoia>=3?'serial_killer':s.script.roles[id];
const hasRole=(s,id,r)=>currentRole(s,id)===r||(currentRole(s,id)==='factor'&&((r==='misleader'&&s.locations.school>=2)||(r==='key_person'&&s.locations.city>=2)));
const labelTarget=id=>name(id);
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
function enterGuess(s){s.phase='guess';s.pending=null;s.guessed={};s.locations=Object.fromEntries(locs.map(l=>[l,0]));for(const c of Object.values(s.board))Object.assign(c,{goodwill:0,paranoia:0,intrigue:0,guard:0,alive:true,present:true,location:c.initial});log(s,'进入最后的战斗：逐人指认，首次错误即失败。','loop');}
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
export function view(s,seat='public'){
 const isM=seat==='M',v={version:s.version,revision:s.revision,script:publicScript(s.script,{includeIncidentTypes:isM}),loop:s.loop,day:s.day,leader:['A','B','C'][s.leader],phase:phases[s.phase],phaseId:s.phase,turn:turn(s),winner:s.winner,board:cp(s.board),locations:cp(s.locations),knownRoles:cp(s.knownRoles),knownCulprits:cp(s.knownCulprits),knownPlots:cp(s.knownPlots),guessed:s.guessed||{},log:visibleLog(s,isM),placements:s.placements.map(p=>({seat:p.seat,target:p.target,...(p.seat===seat?{card:p.card}:{})})),revealedCards:cp(s.dayRevealed||[]),hand:['M','A','B','C'].includes(seat)?deck(s,seat):[],actions:legalActions(s,seat),seat};
 if(isM){v.secret={roles:cp(s.script.roles),mainPlot:s.script.mainPlot,subPlots:cp(s.script.subPlots),incidents:cp(s.script.incidents)};if(s.pending)v.pending=cp(s.pending);}
 // A controller sees requests but never hidden refusal causes or pending culprit ids.
 if(seat===turn(s)&&s.phase==='incident')v.choiceTitle='选择事件效果';
 return v;
}
export function botCommand(s,seat=turn(s)){
 const options=legalActions(s,seat);if(!options.length)throw Error('NO_ACTION');
 // Baseline bot uses exactly its permitted observation. Its strength is intentionally modest.
 const v=view(s,seat),ls=Object.values(v.board).filter(c=>c.alive&&c.present);let best=options[0],score=-Infinity;
 for(let i=0;i<options.length;i++){const o=options[i],a=o.command;let n=0;const c=v.board[a.target];
  if(a.type==='place'){
   const type=a.card.split('#')[0];n=(i%7)*.001;
   if(seat==='M'){
    const role=v.secret.roles[a.target];if(type==='intrigue_1'||type==='intrigue_2')n=c?(role==='key_person'?8:role==='killer'?7:1):4;
    if(type==='paranoia_1'&&c)n=v.secret.incidents.some(e=>e.culprit===c.id&&e.day>=v.day)?10-c.paranoia:1;
    if(type.startsWith('move')&&c){n=2;const ser=ls.find(t=>v.secret.roles[t.id]==='serial_killer');if(ser&&role==='key_person')n=4;}
   }else{if(c&&type==='paranoia_minus_1')n=c.paranoia>=chars[c.id].paranoiaLimit?12:0;if(c&&type==='goodwill_1')n=7-c.goodwill;if(c&&type==='goodwill_2')n=6-c.goodwill;if(c&&type==='forbid_move')n=1;if(c&&type==='forbid_intrigue')n=c.intrigue?5:0;}
  }else if(a.type==='pass')n=-10;else if(a.type==='next_loop')n=10;else if(a.type==='refusal')n=a.refuse?5:0;else if(a.type==='guess')n=v.knownRoles[a.character]===a.role?10:a.role==='person'?1:0;else n=1;
  if(n>score){score=n;best=o;}
 }
 return best.command;
}

// Catalog-backed names and card metadata shared by every screen.
let catalog=null,names=new Map(),characters=new Map();

export function setCatalog(value){
 catalog=value;names=new Map();characters=new Map(value.characters.map(c=>[c.id,c]));
 for(const list of [value.plots,value.incidents,value.roles,value.characters])for(const x of list)names.set(x.id,x.name_zh_working);
 for(const l of value.locations)names.set(l.id,l.name_zh);
}
export const cat=()=>catalog;
export const char=id=>characters.get(id);
export const name=id=>names.get(id)??id;

export const PLACING=['mm_cards','hero_cards'];
export const SEATS=['A','B','C'];
export const seatName=seat=>seat==='M'?'剧作家':seat==='public'?'观众':'主人公 '+seat;
export const seatMark=seat=>seat==='M'?'幕':seat;
export const modeName=mode=>mode==='heroes'?'主人公':mode==='mastermind'?'剧作家':'观战';
const PHASES={setup:'轮回准备',dawn:'日开始',mm_cards:'剧作家出牌',hero_cards:'主人公出牌',cultist:'翻牌结算',mm_ability:'剧作家能力',hero_ability:'主人公能力',refusal:'主人公能力',reveal_plot:'主人公能力',incident:'事件',end_area:'日结束',end:'日结束',between:'时之狭间',guess:'最后的战斗',over:'已结束'};
export const phaseLabel=id=>PHASES[id]||id;
export const COUNTERS={goodwill:{label:'友好',icon:'heart',cls:'g'},paranoia:{label:'不安',icon:'unrest',cls:'p'},intrigue:{label:'暗跃',icon:'intrigue',cls:'i'},guard:{label:'护卫',icon:'shield',cls:'gd'}};

const CARDS={
 move_h:{icon:'moveH',family:'move',info:'左右移动。',move:[1,0]},
 move_v:{icon:'moveV',family:'move',info:'上下移动。',move:[0,1]},
 move_d:{icon:'moveD',family:'move',info:'斜向移动。',move:[1,1]},
 forbid_move:{icon:'moveH',family:'move',forbid:true,info:'今天不能移动。'},
 goodwill_1:{icon:'heart',family:'goodwill',value:'+1',info:'友好 +1。',counter:['goodwill',1]},
 goodwill_2:{icon:'heart',family:'goodwill',value:'+2',info:'友好 +2。',counter:['goodwill',2]},
 forbid_goodwill:{icon:'heart',family:'goodwill',forbid:true,info:'今天友好不能增加。'},
 paranoia_1:{icon:'unrest',family:'paranoia',value:'+1',info:'不安 +1。',counter:['paranoia',1]},
 paranoia_minus_1:{icon:'unrest',family:'paranoia',value:'−1',info:'不安 −1。',counter:['paranoia',-1]},
 forbid_paranoia:{icon:'unrest',family:'paranoia',forbid:true,info:'今天不安不会变化。'},
 intrigue_1:{icon:'intrigue',family:'intrigue',value:'+1',info:'暗跃 +1，可放在地点上。',counter:['intrigue',1],location:true},
 intrigue_2:{icon:'intrigue',family:'intrigue',value:'+2',info:'暗跃 +2，可放在地点上。',counter:['intrigue',2],location:true},
 forbid_intrigue:{icon:'intrigue',family:'intrigue',forbid:true,info:'今天暗跃不能增加。同一天出两张则都无效。',location:true}
};
export const cardType=card=>card?.split('#')[0];
export const cardMeta=card=>CARDS[cardType(card)]||{icon:'intrigue',family:'intrigue',info:''};
export const cardLabel=card=>catalog.actionDeckEntries.find(d=>d.actionType===cardType(card))?.name_zh||card||'待揭示';

const locationAt=(x,y)=>catalog.locations.find(l=>l.x===x&&l.y===y)?.id;
export function moveDestination(card,from){
 const step=cardMeta(card).move,at=catalog.locations.find(l=>l.id===from);
 return step&&at?locationAt(step[0]?1-at.x:at.x,step[1]?1-at.y:at.y):null;
}
// What a selected card would do to one target, shown on the board before the card is committed.
export function cardPreview(card,target,v){
 const meta=cardMeta(card),person=v.board[target];
 if(!person)return meta.location?(meta.forbid?'禁暗跃':'暗跃 '+meta.value):'无效';
 if(meta.move){
  const to=moveDestination(card,person.location),barred=char(target).forbiddenLocations.includes(to)&&!(target==='patient'&&v.flags?.patientFree);
  return barred?'禁入'+name(to):'→ '+name(to);
 }
 if(meta.forbid)return '禁'+({move:'移动',goodwill:'友好',paranoia:'不安',intrigue:'暗跃'})[meta.family];
 return COUNTERS[meta.counter[0]].label+' '+meta.value;
}

export const inSet=(x,ruleset)=>x.sets.includes(ruleset);
export const rolesFor=ruleset=>catalog.roles.filter(r=>inSet(r,ruleset));
export const plotsFor=(ruleset,kind)=>catalog.plots.filter(p=>inSet(p,ruleset)&&p.kind===kind);
export const incidentsFor=ruleset=>catalog.incidents.filter(e=>inSet(e,ruleset));
// "关键人物、杀手 ×2": the roles a plot adds, with ranges where the plot allows a choice.
export const plotRoles=p=>Object.entries(p.addedRoles||{}).map(([r,n])=>name(r)+(typeof n==='number'?(n>1?' ×'+n:''):` ×${n.min}–${n.max}`)).join('、');

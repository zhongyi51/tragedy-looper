// Original, fixed scripts designed around a small set of learnable interactions.
// Private design notes are returned only to the server / full-truth editor.
import {validateScript,publicScript} from './content.mjs';
import {evaluateScriptQuality} from './script-quality.mjs';

const common={author:'时隙 · 原创',source:'curated',communication:'between_loops_only',loops:3,settings:{incidentVisibility:'public'},specialRules:[],libraryVersion:'1'};
const curatedScripts=[
 {...common,id:'curated-last-ward',title:'长夜未熄的灯',ruleset:'FS',days:4,difficulty:'beginner',
  intro:'医院的窗灯一直亮着。有人迟迟没有归来，留下的几句话却指向了不同的地方。',
  characters:['boy_student','girl_student','shrine_maiden','office_worker','doctor','police'],
  mainPlot:'avenger',subPlots:['unsettling_rumor'],
  roles:{boy_student:'person',girl_student:'person',shrine_maiden:'person',office_worker:'misleader',doctor:'brain',police:'person'},
  incidents:[{day:2,type:'missing',culprit:'office_worker'},{day:4,type:'hospital_incident',culprit:'girl_student'}],
  privateDesign:{premise:'第一条线索不在尸体，而在反复增加暗跃的地点。',threatPlan:'医生是幕后黑手，医院是复仇者之灯的初始地点。用暗跃牌、医生能力和一次不安的传闻把医院推到 2；医院事件是第二条公开压力线。',counterplay:'观察暗跃能力的作用范围，用移动改变医生所在地点，并用暗跃禁止抵消对医院的行动牌。要为一次性的传闻留下余量；女学生不安接近临界时可以另行压制事件。',cluePlan:'上班族的调查能力可测试其误导者身份，医生离开医院后能力作用范围改变，可缩小幕后黑手与地点败北条件的范围。事件日程从开局公开。',loopPlan:'首轮观察暗跃在哪里增长和上班族行踪不明的效果；第二轮尝试移动医生；第三轮集中保护真正的地点，不必拯救所有无关计数。',intendedDifficulty:'beginner',intentionalExceptions:[]}},
 {...common,id:'curated-shrine-echo',title:'风铃背后的回声',ruleset:'BTX',days:5,difficulty:'standard',
  intro:'风铃响过两次，旧街上的人都说自己没有听见。学校和神社之间，一条熟悉的路忽然变得漫长。',
  characters:['boy_student','girl_student','shrine_maiden','office_worker','doctor','police','informer','idol'],
  mainPlot:'sealed_item',subPlots:['hidden_killer','threads_fate'],
  roles:{boy_student:'friend',girl_student:'person',shrine_maiden:'person',office_worker:'brain',doctor:'cultist',police:'serial_killer',informer:'person',idol:'person'},
  incidents:[{day:2,type:'missing',culprit:'doctor'},{day:4,type:'evil',culprit:'idol'}],
  privateDesign:{premise:'地点威胁与保护朋友分散主人公的注意力，跨轮回友好又会留下不安。',threatPlan:'医生可借行踪不明进入神社并制造暗跃，邪教徒令暗跃禁止失效。偶像的邪气污染和上班族的幕后黑手能力提供另一条神社压力线；警察与男学生独处会杀死朋友。',counterplay:'培养巫女清除神社暗跃，在医生进入前利用移动干预；不要让警察与男学生单独相处。控制偶像不安可以阻止邪气污染，避免只用一张暗跃禁止应付所有威胁。',cluePlan:'暗跃禁止失效提示邪教徒可能位于神社；朋友死亡的轮回末公开和上班族的身份调查是可验证线索。情报贩子可缩小规则 X，跨轮回不安说明因果之线。',loopPlan:'前两轮识别地点威胁与独处死亡的区别，保留记录来辨认因果之线。若无法同时保护地点和朋友，最后的战斗仍可利用已确认的身份与规则配额。',intendedDifficulty:'standard',intentionalExceptions:[]}},
 {...common,id:'curated-wrong-envelope',title:'没有署名的信封',ruleset:'MZ',days:5,difficulty:'standard',
  intro:'一封没有署名的信，被分别送到了两个地址。公开的日程很清楚，发生过的事却未必与它同名。',
  characters:['ai_character','office_worker','teacher','doctor','shrine_maiden','girl_student','boy_student','police'],
  mainPlot:'sealed_item',subPlots:['unsafe_trigger','unanswered_heart'],
  roles:{ai_character:'brain',office_worker:'cultist',teacher:'factor',doctor:'misleader',shrine_maiden:'person',girl_student:'magician',boy_student:'person',police:'person'},
  incidents:[{day:2,type:'fake_incident',publicType:'unease',culprit:'teacher'},{day:4,type:'breakthrough',culprit:'boy_student'},{day:5,type:'serial_murder',culprit:'office_worker'}],
  privateDesign:{premise:'公开表中的不安扩大是伪装；学校暗跃与神社暗跃形成两条需要辨别的威胁。',threatPlan:'教师的因子可以在学校增加暗跃，伪装事件按其初始地点暗跃判定主人公死亡。人工智能的幕后黑手能力与邪教徒移动则推进神社的真正轮回末条件。',counterplay:'第二日前控制教师不安或学校暗跃以拦截伪装事件，之后培养巫女并保护神社。公开日程的突破可以移除 2 暗跃，人工智能模拟时也按公开事件名称产生相应效果。',cluePlan:'预告不安扩大却没有对应计数并出现死亡，是识别伪装的重要证据。教师、上班族和警察的友好能力可提供身份与犯人线索；不能把 MZ 的单次身份宣告自动当作真相。',loopPlan:'首轮区分立即死亡与轮回末败北；第二轮利用学校线索尝试突破；第三轮检验幕后黑手活动地点，必要时进入最后的战斗。',intendedDifficulty:'standard',intentionalExceptions:[]}},
 {...common,id:'curated-second-chime',title:'第二次钟声之后',ruleset:'MC',days:5,difficulty:'standard',
  intro:'第一次钟声过后，街道依然安静。有人希望第二次钟声永远不要响起，也有人一直在等。',
  characters:['ai_character','police','office_worker','doctor','boy_student','shrine_maiden','girl_student','patient'],
  mainPlot:'tightrope_plan',subPlots:['isolated_psycho','master_detective'],
  roles:{ai_character:'brain',police:'killer',office_worker:'paranoiac',doctor:'therapist',boy_student:'misleader',shrine_maiden:'private_investigator',girl_student:'friend',patient:'person'},
  incidents:[{day:2,type:'portent',culprit:'boy_student'},{day:3,type:'unease',culprit:'office_worker'},{day:5,type:'closed_circle',culprit:'patient'}],
  privateDesign:{premise:'主人公要学会允许足够的事件发生，同时防止杀手的独立威胁。',threatPlan:'EX 不超过 1 即满足钢丝上的计划。剧作家可以压住事件，同时把警察暗跃推到 4 杀死主人公，或让作为朋友的女学生死亡；治疗师与名侦探改变事件能否发生，不能只按不安数静态推断。',counterplay:'利用公开日程放行前兆和不安扩大，把 EX 提到至少 2；与此同时用暗跃禁止限制警察，并避免不安扩大给杀手补上最后一枚暗跃。不能把人工智能模拟效果当作 EX 增长。',cluePlan:'首轮在低 EX 下结束而没有死亡，提示事件不足的可能；治疗师强制减少不安与名侦探在零 EX 时强制发生提供位置线索。警察能力和公开的事件记录可帮助确认犯人。',loopPlan:'首轮记录事件与 EX 的关系；下一轮隔离病栋可能带来初始 1 EX，重新计算需要放行几起事件。若事件都被抑制，利用三轮位置和能力线索准备最后的战斗。',intendedDifficulty:'standard',intentionalExceptions:[]}}
];

export function getCuratedScript(id){
 const script=curatedScripts.find(s=>s.id===id);
 if(!script)throw Object.assign(Error('没有这份精选剧本'),{code:'INVALID_SETUP'});
 const result=structuredClone(script),check=validateScript(result);
 if(check.errors.length)throw Error('精选剧本验证失败：'+check.errors.map(e=>e.message).join('；'));
 return result;
}
export function listCuratedScripts(){
 return curatedScripts.map(s=>({id:s.id,title:s.title,ruleset:s.ruleset,days:s.days,loops:s.loops,difficulty:s.difficulty,source:'curated',description:s.intro}));
}
export function curatedPublicScript(id){return publicScript(getCuratedScript(id));}
// Startup and tests can audit the library without exposing its private reports.
export function validateCuratedLibrary(){return curatedScripts.map(s=>({id:s.id,...evaluateScriptQuality(s)}));}

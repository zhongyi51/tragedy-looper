import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,starter,generateScript} from '../src/content.mjs';
import {setCatalog} from '../public/js/lookup.mjs';
import {generationOptions,normalizeGameSetup,freshSeed,creationAttempt} from '../public/js/game-setup.mjs';
import {newGameModal,reviewModal} from '../public/js/ui/modals.mjs';
import {editorHtml} from '../public/js/ui/editor.mjs';
import {publicDraft} from '../public/js/exporters.mjs';
setCatalog(catalog);
const state={info:{configured:true},library:[{id:'curated-mc',title:'不透露答案的标题',ruleset:'MC',days:5,loops:3,description:'一场新的谜局'}],
 editor:{text:'',generator:{ruleset:'FS',seed:42,theme:'',lockSeed:false}}};

test('new games use standard public schedules and never send the old fixed title',()=>{
 for(const set of ['FS','BTX','MZ','MC']){
  const request=generationOptions(set,{seed:42});
  assert.equal(request.incidentVisibility,'public');assert.equal(request.title,undefined);
  assert.equal(request.lengthPreset,'standard');
  assert.equal(request.days,undefined);assert.equal(request.loops,undefined);assert.equal(request.incidentCount,undefined);
  const changed=normalizeGameSetup('MC',normalizeGameSetup('BTX'));
  assert.equal(changed.incidentCount,'');
  const html=newGameModal(state,'heroes',set);assert.match(html,/按原版公开日期和名称/);assert.doesNotMatch(html,/new-visibility|隐藏名称/);
 }
});

test('blind openings leave the seed to the server unless the player explicitly supplies one',()=>{
 for(const mode of ['random','ai','FS','BTX','MZ','MC']){
  assert.equal(normalizeGameSetup(mode).seed,'');
  assert.ok(!('seed' in generationOptions(mode,{})));
  assert.ok(!('seed' in generationOptions(mode,{seed:''})));
 }
 const custom=normalizeGameSetup('MC',normalizeGameSetup('BTX',{seed:0}));
 assert.equal(generationOptions('MC',custom).seed,0);
 const html=newGameModal(state,'heroes','random');
 assert.match(html,/id="new-seed"[^>]*placeholder="随机"[^>]*value=""/);
 assert.doesNotMatch(html,/id="new-seed"[^>]*required/);
 assert.match(html,/指定种子可复现剧本，建议主人公留空/);
});

test('explicit settings survive ruleset changes while unspecified length fields follow the preset',()=>{
 const btx=normalizeGameSetup('BTX',{lengthPreset:'quick',days:7,loops:4,includeAI:true,seed:99});
 const mc=normalizeGameSetup('MC',btx),request=generationOptions('MC',mc);
 assert.equal(request.days,7);assert.equal(request.loops,4);assert.equal(request.includeAI,true);
 assert.equal(request.incidentCount,undefined);assert.equal(request.lengthPreset,'quick');
 const automatic=generationOptions('MC',{days:'',loops:'',incidentCount:'',lengthPreset:'long',seed:99});
 assert.equal(automatic.days,undefined);assert.equal(automatic.incidentCount,undefined);
 assert.equal(generateScript(automatic).settings.incidentVisibility,'public');
});

test('AI opening carries constraints but no generated truth, and shows its separate spending limit',()=>{
 const request=generationOptions('ai',{ruleset:'MC',seed:12,theme:'雨夜',difficulty:'hard',days:4});
 assert.equal(request.generation,'ai');assert.equal(request.ruleset,'MC');assert.equal(request.theme,'雨夜');assert.equal(request.difficulty,'hard');
 for(const key of ['roles','incidents','privateDesign','script'])assert.ok(!(key in request));
 const html=newGameModal(state,'heroes','ai',{ruleset:'MC'});
 assert.match(html,/value="ai" checked/);assert.match(html,/每次上限 \$0\.12/);assert.match(html,/轮回中的真相保持不变/);
 assert.doesNotMatch(html,/privateDesign|value="strychnine" selected/);
});

test('curated selection reveals only the catalog summary and can be opened without AI',()=>{
 const html=newGameModal({...state,info:{configured:false}},'heroes','library');
 assert.match(html,/不透露答案的标题/);assert.match(html,/id="new-library"/);assert.match(html,/value="ai" disabled/);
 assert.doesNotMatch(html,/data-do="create"[^>]*disabled/);assert.doesNotMatch(html,/犯人是|角色是/);
});

test('fresh seeds change the request and workshop clearly separates authoring from polishing',()=>{
 assert.notEqual(freshSeed(42),42);
 const html=editorHtml({...state,editor:{...state.editor,text:JSON.stringify(starter)}});
 assert.match(html,/随机生成 · 换一份/);assert.match(html,/data-do="ai-generate"/);assert.match(html,/data-do="ai-polish"/);
 assert.match(html,/固定种子，复现这份随机剧本/);assert.match(html,/润色只改标题与简介/);
 const locked=editorHtml({...state,editor:{...state.editor,generator:{...state.editor.generator,lockSeed:true}}});
 assert.match(locked,/按种子生成/);
});

test('uncertain creation reuses its request ID only while the full payload stays unchanged',()=>{
 const a={mode:'heroes',setup:{ruleset:'MC',seed:2,generation:'ai'}},first=creationAttempt(a,null,()=> 'request-one');
 assert.equal(creationAttempt(structuredClone(a),first,()=>{throw Error('must not create another billed request');}),first);
 const changed=creationAttempt({...a,setup:{...a.setup,seed:3}},first,()=> 'request-two');
 assert.equal(changed.requestId,'request-two');assert.notEqual(changed.signature,first.signature);
});

test('public exports drop design secrets and end-game review escapes model-provided prose',()=>{
 const script={...structuredClone(starter),intro:'公开简介',privateDesign:{premise:'SECRET DESIGN'}};
 const exported=publicDraft(script);assert.equal(exported.intro,'公开简介');assert.ok(!JSON.stringify(exported).includes('SECRET DESIGN'));
 const html=reviewModal({title:'<script>alert(1)</script>',summary:'<img src=x onerror=alert(1)>',design:{premise:'<b>设计</b>',threatPlan:'威胁',cluePlan:'线索',loopPlan:'观察变化'},
  clues:[{loop:1,day:2,text:'<a href="javascript:x">线索</a>'}],alternatives:['可行反制']},{script,winner:'heroes'},'interesting');
 assert.doesNotMatch(html,/<script>|<img src=x|<a href="javascript:/);assert.match(html,/&lt;script&gt;/);
 assert.match(html,/编剧的设计意图/);assert.match(html,/轮回中的学习/);assert.match(html,/data-rating="interesting" aria-pressed="true"/);
 assert.equal((html.match(/data-do="feedback"/g)||[]).length,5);
});

test('AI review puts authoritative rule effects before explicitly labeled model design',()=>{
 const html=reviewModal({source:'ai',ruleEffects:[{id:'contract',name:'与我缔结契约',effect:'关键人物必须是少女。轮回结束时，如果她的暗跃达到 2，主人公失败。'}],
  design:{threatPlan:'错误设想：神社暗跃',ruleEffects:[{name:'伪造规则',effect:'伪造效果'}]},clues:[],alternatives:[]},{script:starter,winner:'heroes'});
 assert.ok(html.indexOf('本场实际规则')<html.indexOf('AI 创作设想'));
 assert.ok(html.indexOf('她的暗跃达到 2')<html.indexOf('错误设想：神社暗跃'));
 assert.match(html,/模型说明可能误述规则.*实际规则与速查/);
 assert.doesNotMatch(html,/伪造规则|伪造效果/);
 const escaped=reviewModal({ruleEffects:[{name:'<img src=x>',effect:'<script>rule</script>'}]},{script:starter,winner:'heroes'});
 assert.match(escaped,/&lt;img src=x&gt;/);assert.doesNotMatch(escaped,/<img src=x>|<script>/);
});

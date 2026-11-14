import test from 'node:test';
import assert from 'node:assert/strict';
import {authorPrompt,generateWithAi,polishWithAi,authoredScriptHash,AUTHOR_VERSION} from '../src/author.mjs';
import {configureKey,reserveFor} from '../src/model-provider.mjs';
import {starter,catalog,validateScript,publicScript,generatedTitle} from '../src/content.mjs';
import {listCuratedScripts,getCuratedScript} from '../src/script-library.mjs';

configureKey('author_mock_key_not_a_real_secret');
const design=()=>({premise:'校园里两条危险路线交错，需要逐轮辨别真正的保护目标。',threatPlan:'剧作家可以推动女学生自杀，也可用独处的连环杀手制造第二条危险路线。',counterplay:'主人公可以积累学生的友好降低不安，并通过移动拆开危险的独处组合。',cluePlan:'公开死亡时点与不安牌分配提供线索，友好能力有助于进一步核对配役。',loopPlan:'首轮观察危险来源，后续轮回保留不安减少和移动资源阻止关键一天。',intendedDifficulty:'standard',intentionalExceptions:[]});
function draft(){
 const {title,ruleset,days,loops,communication,characters,mainPlot,subPlots,roles,incidents}=structuredClone(starter);
 return {script:{title:'雨后的第七封信',intro:'雨停以后，教室里多出了一封没有署名的信。',ruleset,days,loops,communication,characters,mainPlot,subPlots,roles,incidents,settings:{incidentVisibility:'public'},specialRules:[]},design:design()};
}
const response=(answer,usage={prompt_tokens:1000,prompt_cache_hit_tokens:800,prompt_cache_miss_tokens:200,completion_tokens:100})=>new Response(JSON.stringify({model:'author-test',id:'author-mock',choices:[{finish_reason:'stop',message:{content:typeof answer==='string'?answer:JSON.stringify(answer)}}],usage}),{status:200});
// Most tests control author drafts; echo a valid design for the independent
// review unless the test explicitly exercises that separate provider call.
async function withFetch(fn,body,{autoReview=true}={}){const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{
 const request=JSON.parse(init.body);
 if(autoReview&&request.user_id.endsWith('_review'))return response({design:JSON.parse(request.messages.at(-1).content).submittedDesign});
 return fn(url,init);
};try{return await body();}finally{globalThis.fetch=original;}}
const base={ruleset:'FS',seed:143211,days:3,loops:3,incidentCount:1,difficulty:'standard'};

test('author prompt asks for full mechanics and only the selected set dictionary',()=>{
 const {messages,configuration}=authorPrompt({...base,mainPlot:'murder_plan',subPlots:[''],theme:'窗边的空座位'});
 const body=JSON.parse(messages[1].content);
 assert.deepEqual(body.dictionary.plots.map(p=>p.id),catalog.plots.filter(p=>p.sets.includes('FS')).map(p=>p.id));
 assert.ok(body.dictionary.roles.every(x=>x.sets.includes('FS')));
 assert.ok(body.dictionary.incidents.every(x=>x.sets.includes('FS')));
 assert.equal(body.constraints.mainPlot,'murder_plan');
 assert.equal(body.schema.script.roles['人物ID'],'角色ID');
 assert.equal(body.schema.script.incidents[0].culprit,'出演人物ID');
 assert.equal(body.draft,undefined);
 assert.equal(configuration.constraints.incidentVisibility,'public');
 assert.equal(body.theme,'窗边的空座位');
 assert.match(messages[0].content,/maxCount:null 表示无额外人数上限/);
 assert.match(messages[0].content,/配额为 0/);
 assert.match(messages[0].content,/AI 人物不能是 person，且必须占用现有非 person 配额/);
 assert.match(messages[0].content,/普通事件发生不会自动公开犯人或角色/);
 assert.match(messages[0].content,/告白 confession 的效果公开犯人及其角色/);
 assert.match(messages[0].content,/封闭之环 closed_circle 只公开犯人所在地点/);
 assert.match(messages[0].content,/不能按职业或人物名称脑补能力/);
 assert.match(messages[0].content,/医生没有查角色的能力/);
});

test('author constrains default cast size while respecting an explicit character list',async()=>{
 for(const [ruleset,min,max] of [['FS',5,7],['BTX',6,9],['MZ',7,10],['MC',7,10]])assert.deepEqual(JSON.parse(authorPrompt({ruleset}).messages[1].content).constraints.characterCount,{min,max});
 const source=getCuratedScript(listCuratedScripts().find(s=>s.ruleset==='BTX').id);
 const script=Object.fromEntries(['title','intro','ruleset','days','loops','communication','characters','mainPlot','subPlots','roles','incidents','settings','specialRules'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
 const compact={script,design:source.privateDesign},crowded=structuredClone(compact);
 for(const id of ['rich_girl','patient','class_rep','alien','journalist','nurse','teacher']){crowded.script.characters.push(id);crowded.script.roles[id]='person';}
 assert.equal(crowded.script.characters.length,15);
 assert.equal(validateScript(crowded.script).errors.length,0);
 const requests=[];
 const result=await withFetch(async(_url,init)=>{requests.push(JSON.parse(init.body));return response(requests.length===1?crowded:compact);},()=>generateWithAi({ruleset:'BTX',seed:42}));
 assert.equal(result.characters.length,8);
 assert.match(requests[1].messages.at(-1).content,/出演人数须为 6–9 人/);
 const config={ruleset:'BTX',characters:crowded.script.characters,seed:42};
 assert.equal(JSON.parse(authorPrompt(config).messages[1].content).constraints.characterCount,undefined);
 const explicit=await withFetch(async()=>response(crowded),()=>generateWithAi(config));
 assert.deepEqual(explicit.characters,crowded.script.characters);
});

test('author repairs the observed event-auto-reveal hallucination',async()=>{
 for(const text of ['首日不安扩大公开犯人记者，次日杀人公开犯人女学生，二者日程与地点可交叉验证。','事件发生后犯人身份会自动公开，主人公据此就能推导出真正的关键人物。']){
  const bad=draft();bad.design.cluePlan=text;const requests=[];
  await withFetch(async(_url,init)=>{requests.push(JSON.parse(init.body));return response(requests.length===1?bad:draft());},()=>generateWithAi(base));
  assert.equal(requests.length,2);
  assert.match(requests[1].messages.at(-1).content,/design\.cluePlan: 普通事件不会自动公开犯人/);
 }
});

test('culprit clue guard permits police investigation and explicit negations',async()=>{
 for(const cluePlan of ['事件不会自动公开犯人，需由警察在友好达到四点后查询本轮已发生事件的犯人。','警察友好四点能力可以公开本轮已发生事件的犯人，必须先积累友好并等待事件发生。','不应误以为首日不安扩大公开犯人；主人公只能依据可见结果提出并验证假说。']){
  const answer=draft();answer.design.cluePlan=cluePlan;let calls=0;
  await withFetch(async()=>{calls++;return response(answer);},()=>generateWithAi(base));
  assert.equal(calls,1);
 }
});

test('culprit clue guard respects confession identity and closed-circle location effects',async()=>{
 for(const [ruleset,cluePlan] of [['MZ','告白发生时公开犯人及其角色，忍者仍可按能力谎报角色，因此需与其他线索交叉验证。'],['MC','封闭之环公开犯人所在地点，主人公结合当日移动记录缩小候选，不能直接确定犯人身份。'],['MC','封闭之环发生后犯人所在地点被公开，可利用这个地点线索安排后续调查。']]){
  const source=getCuratedScript(listCuratedScripts().find(s=>s.ruleset===ruleset).id);
  const script=Object.fromEntries(['title','intro','ruleset','days','loops','communication','characters','mainPlot','subPlots','roles','incidents','settings','specialRules'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
  const answer={script,design:{...source.privateDesign,cluePlan}};let calls=0;
  await withFetch(async()=>{calls++;return response(answer);},()=>generateWithAi({ruleset,characters:script.characters,seed:42}));
  assert.equal(calls,1);
 }
 const source=getCuratedScript(listCuratedScripts().find(s=>s.ruleset==='MC').id);
 const script=Object.fromEntries(['title','intro','ruleset','days','loops','communication','characters','mainPlot','subPlots','roles','incidents','settings','specialRules'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
 const answer={script,design:{...source.privateDesign,cluePlan:'封闭之环发生后公开犯人及其角色，主人公因此可以准确得知全部危险人物身份。'}};
 await withFetch(async()=>response(answer),()=>assert.rejects(generateWithAi({ruleset:'MC',characters:script.characters,seed:42}),error=>error.code==='AUTHOR_QUALITY'&&/普通事件不会自动公开犯人/.test(error.message)));
});

test('author preserves the model-designed mechanics, freezes provenance, and hides the design',async()=>{
 const chosen=draft(),initial=structuredClone(chosen);let sent;
 const result=await withFetch(async(_url,init)=>{sent=JSON.parse(init.body);return response(chosen);},()=>generateWithAi(base));
 assert.deepEqual(result.roles,chosen.script.roles);
 assert.deepEqual(result.incidents,chosen.script.incidents);
 assert.equal(result.title,generatedTitle(base.seed));
 assert.match(result.intro,new RegExp(`${chosen.script.characters.length} 位人物`));
 assert.deepEqual(result.privateDesign,chosen.design);
 assert.deepEqual(chosen,initial);
 assert.equal(result.generation.source,'ai');
 assert.equal(result.source,'ai');
 assert.equal(result.difficulty,'standard');
 assert.equal(result.generation.version,AUTHOR_VERSION);
 assert.equal(result.generation.scriptHash,authoredScriptHash(result));
 assert.equal(result.generation.attempts,1);
 assert.deepEqual(result.generation.quality,{review:'static'});
 assert.equal(validateScript(result).errors.length,0);
 const visible=publicScript(result);
 assert.equal(visible.privateDesign,undefined);
 assert.equal(visible.roles,undefined);
 assert.equal(visible.mainPlot,undefined);
 assert.equal(visible.incidents[0].culprit,undefined);
 assert.equal(visible.source,'ai');
 assert.equal(visible.seed,undefined);
 assert.ok(!visible.id.includes(String(base.seed)));
 assert.equal(sent.thinking.type,'disabled');
 assert.equal(sent.reasoning_effort,undefined);
 assert.match(sent.messages[0].content,/50–150/);
 assert.ok(sent.max_tokens>=4000);
});

test('public author captions are independent of secret mechanics, model prose, and theme',async()=>{
 const first=draft();first.script.title='雨停旧街的契约';first.script.intro='和我缔结契约吧。六人中的女学生是关键人物，真正犯人就是她。';
 const second=draft();second.script.mainPlot='protect_place';second.script.roles.office_worker='person';second.script.roles.doctor='cultist';
 second.script.title='关键人物的身份';second.script.intro='SECRET_MODEL_CAPTION'.repeat(100);
 assert.equal(validateScript(second.script).errors.length,0);
 const results=[];
 for(const [answer,theme] of [[first,'contract 杀人计划 关键人物'],[second,'保护神社的暗跃秘密']]){
  let calls=0;
  results.push(await withFetch(async()=>{calls++;return response(answer);},()=>generateWithAi({...base,theme})));
  assert.equal(calls,1,'Ignored private draft prose must not cause an author repair');
 }
 assert.notEqual(results[0].mainPlot,results[1].mainPlot);
 assert.deepEqual(publicScript(results[0]).incidents,publicScript(results[1]).incidents);
 assert.equal(results[0].title,results[1].title);
 assert.equal(results[0].intro,results[1].intro);
 assert.equal(results[0].title,generatedTitle(base.seed));
 const caption=results[0].title+' '+results[0].intro;
 assert.doesNotMatch(caption,/契约|缔结|contract|SECRET_MODEL_CAPTION|女学生|暗跃秘密/);
 for(const rule of [...catalog.roles,...catalog.plots])for(const label of [rule.id,rule.name_zh_working,rule.name_ja].filter(Boolean))assert.equal(caption.includes(label),false,`Caption exposed ${label}`);
 assert.match(results[0].intro,/6 位人物，3 天的日程，3 次轮回/);
 assert.deepEqual(results[0].privateDesign,first.design);
 assert.deepEqual(results[1].privateDesign,second.design);
});

test('explicit user title is retained even when the model ignores it',async()=>{
 const answer=draft();answer.script.title='模型私密标题';answer.script.intro={secret:'bad prose is never used'};
 let calls=0;
 const result=await withFetch(async()=>{calls++;return response(answer);},()=>generateWithAi({...base,title:'  用户指定的题名  ',theme:'不得写进公开文案的主题'}));
 assert.equal(result.title,'用户指定的题名');
 assert.doesNotMatch(result.intro,/模型|secret|主题/);
 assert.equal(calls,1);
 assert.equal(result.generation.scriptHash,authoredScriptHash(result));
});

test('a wrong explicit constraint gets one repair with the actual validator errors',async()=>{
 const wrong=draft();wrong.script.days=4;const good=draft();let requests=[];
 const result=await withFetch(async(_url,init)=>{requests.push(JSON.parse(init.body));return response(requests.length===1?wrong:good);},()=>generateWithAi(base));
 assert.equal(result.days,3);
 assert.equal(result.generation.attempts,2);
 assert.equal(requests.length,2);
 assert.match(requests[1].messages.at(-1).content,/days.*指定值/);
});

test('count repair freezes valid context and permits at most two structural revisions plus review',async()=>{
 const bad=draft();bad.script.roles.idol='person';
 const changed=draft();changed.script.days=4;
 const requests=[];let drafts=0;
 const result=await withFetch(async(_url,init)=>{
  const request=JSON.parse(init.body);requests.push(request);
  if(request.user_id.endsWith('_review'))return response({design:design()});
  return response([bad,changed,draft()][drafts++]);
 },()=>generateWithAi(base),{autoReview:false});
 assert.equal(requests.length,4);
 assert.equal(result.generation.attempts,3);
 assert.equal(result.days,3);
 const repair=JSON.parse(requests[1].messages.at(-1).content);
 assert.deepEqual(repair.repairContext.fixed,{ruleset:bad.script.ruleset,mainPlot:bad.script.mainPlot,subPlots:bad.script.subPlots,characters:bad.script.characters,days:3,loops:3,communication:bad.script.communication});
 assert.deepEqual(repair.repairContext.allowedDays,[1,2,3]);
 assert.equal(repair.repairContext.incidentCount,1);
 assert.equal(repair.repairContext.requiredRoleSlots.filter(role=>role==='misleader').length,1);
 assert.deepEqual(repair.roleQuotas.roles.misleader,{min:1,max:1,actual:0});
 assert.ok(JSON.parse(requests[2].messages.at(-1).content).issues.some(issue=>issue.includes('结构修订必须保留已合法的固定配置')));
 assert.equal(requests[3].max_tokens,4096);
});

test('duplicate-date repair supplies exact allowed days without changing valid rules',async()=>{
 const source=getCuratedScript(listCuratedScripts().find(s=>s.ruleset==='BTX').id);
 const script=Object.fromEntries(['title','intro','ruleset','days','loops','communication','characters','mainPlot','subPlots','roles','incidents','settings','specialRules'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
 const good={script,design:source.privateDesign},bad=structuredClone(good);bad.script.incidents[1].day=bad.script.incidents[0].day;
 const requests=[];
 await withFetch(async(_url,init)=>{requests.push(JSON.parse(init.body));return response(requests.length===1?bad:good);},()=>generateWithAi({ruleset:'BTX',seed:42}));
 const {repairContext}=JSON.parse(requests[1].messages.at(-1).content);
 assert.deepEqual(repairContext.allowedDays,Array.from({length:script.days},(_,i)=>i+1));
 assert.equal(repairContext.fixed.mainPlot,script.mainPlot);
 assert.deepEqual(repairContext.fixed.subPlots,script.subPlots);
 assert.equal(repairContext.incidentCount,script.incidents.length);
});

test('unrepaired role-count failures stop after three drafts and expose only bounded counts',async()=>{
 const bad=draft();bad.script.roles.idol='person';let calls=0;
 await withFetch(async()=>{calls++;return response(bad);},()=>assert.rejects(generateWithAi(base),error=>{
  assert.equal(error.code,'AUTHOR_QUALITY');
  assert.match(error.message,/roles\.misleader: min=1 max=1 actual=0/);
  assert.doesNotMatch(error.message,/雨后的第七封信|校园里两条危险/);
  return true;
 }));
 assert.equal(calls,3);
});

test('independent review receives only selected dictionaries and cannot change script hash',async()=>{
 const chosen=draft(),original=structuredClone(chosen.script),reviewed={...design(),counterplay:'主人公可使用医生友好二点能力调整同地点另一人的不安，不能用医生查询角色。'};
 const requests=[];
 const result=await withFetch(async(_url,init)=>{const request=JSON.parse(init.body);requests.push(request);return response(request.user_id.endsWith('_review')?{design:reviewed}:chosen);},()=>generateWithAi(base),{autoReview:false});
 assert.equal(requests.length,2);
 const reviewRequest=requests[1],input=JSON.parse(reviewRequest.messages[1].content);
 assert.equal(reviewRequest.thinking.type,'disabled');assert.equal(reviewRequest.max_tokens,4096);
 assert.deepEqual(input.script,{...original,title:result.title,intro:result.intro});
 assert.deepEqual(input.dictionary.characters.map(x=>x.id).sort(),original.characters.toSorted());
 assert.deepEqual(input.dictionary.roles.map(x=>x.id).sort(),[...new Set(Object.values(original.roles))].sort());
 assert.deepEqual(input.dictionary.plots.map(x=>x.id).sort(),[original.mainPlot,...original.subPlots].sort());
 assert.deepEqual(input.dictionary.incidents.map(x=>x.id).sort(),[...new Set(original.incidents.map(e=>e.type))].sort());
 assert.ok(input.dictionary.plots.length<catalog.plots.filter(p=>p.sets.includes('FS')).length);
 assert.equal(result.generation.scriptHash,authoredScriptHash(input.script));
 assert.equal(authoredScriptHash(result),authoredScriptHash(input.script));
 assert.deepEqual(result.privateDesign,reviewed);
 assert.equal(result.generation.designReview,'catalog-grounded-1');
 assert.deepEqual(chosen.script,original);
});

test('grounded-review format, semantic guard, and network failures never return a game script',async()=>{
 for(const mode of ['rewrite','invalid-design','network']){
  let calls=0;
  await withFetch(async(_url,init)=>{
   calls++;const request=JSON.parse(init.body);if(!request.user_id.endsWith('_review'))return response(draft());
   if(mode==='network')throw Error('review disconnected');
   if(mode==='rewrite')return response({design:design(),script:{...draft().script,days:4}});
   return response({design:{...design(),cluePlan:'不安扩大公开犯人记者，主人公通过这个公开身份就能排除全部其他嫌疑。'}});
  },()=>assert.rejects(generateWithAi(base),error=>error.code===(mode==='network'?'NETWORK':'AUTHOR_REVIEW')),{autoReview:false});
  assert.equal(calls,2);
 }
});

test('grounded design review shares the same total author budget',async()=>{
 let calls=0;const usage=[];
 await withFetch(async()=>{calls++;return response(draft(),{prompt_tokens:0,prompt_cache_miss_tokens:0,completion_tokens:95000});},()=>assert.rejects(generateWithAi(base,{onUsage:entry=>usage.push(entry)}),error=>error.code==='AUTHOR_BUDGET'),{autoReview:false});
 assert.equal(calls,1);
 assert.equal(usage.length,1);
 assert.ok(usage[0].estimatedCost<.12);
});

test('full authored responses support all four sets including expansion characters and aliases',async()=>{
 for(const entry of listCuratedScripts()){
  const source=getCuratedScript(entry.id),script=Object.fromEntries(['title','intro','ruleset','days','loops','communication','characters','mainPlot','subPlots','roles','incidents','settings','specialRules'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
  const answer={script,design:source.privateDesign};
  const config={ruleset:source.ruleset,characterPool:'all',characters:source.characters,includeAI:source.characters.includes('ai_character'),days:source.days,loops:source.loops,incidentCount:source.incidents.length,difficulty:source.difficulty,seed:42};
  const result=await withFetch(async()=>response(answer),()=>generateWithAi(config));
  assert.equal(result.ruleset,source.ruleset);
  assert.deepEqual(result.roles,source.roles);
  assert.deepEqual(result.incidents,source.incidents);
  assert.equal(validateScript(result).errors.length,0);
  const publicView=publicScript(result);
  assert.ok(publicView.incidents.every(e=>!Object.hasOwn(e,'culprit')));
  assert.equal(publicView.privateDesign,undefined);
  if(source.ruleset==='MZ')assert.equal(publicView.incidents[0].type,source.incidents[0].publicType);
 }
});

test('MZ repair supplies exact quotas when AI invents an unselected immortal role',async()=>{
 const source=getCuratedScript(listCuratedScripts().find(s=>s.ruleset==='MZ').id);
 const script=Object.fromEntries(['title','intro','ruleset','days','loops','communication','characters','mainPlot','subPlots','roles','incidents','settings','specialRules'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
 assert.ok(!script.subPlots.includes('showtime_death'));
 const good={script,design:source.privateDesign},bad=structuredClone(good);bad.script.roles.ai_character='immortal';
 assert.ok(validateScript(bad.script).errors.some(e=>e.path==='roles.immortal'));
 const requests=[];
 const result=await withFetch(async(_url,init)=>{requests.push(JSON.parse(init.body));return response(requests.length===1?bad:good);},()=>generateWithAi({ruleset:'MZ',characterPool:'all',includeAI:true,seed:42}));
 assert.equal(result.roles.ai_character,'brain');
 assert.equal(validateScript(result).errors.length,0);
 const feedback=JSON.parse(requests[1].messages.at(-1).content);
 assert.deepEqual(feedback.roleQuotas.selectedPlots,[script.mainPlot,...script.subPlots]);
 assert.deepEqual(feedback.roleQuotas.roles.immortal,{min:0,max:0,actual:1});
 assert.deepEqual(feedback.roleQuotas.roles.brain,{min:1,max:1,actual:0});
 assert.match(feedback.instruction,/配额为 0 的角色不可给普通出演人物或 AI/);
 assert.ok(feedback.issues.some(x=>x.startsWith('roles.immortal:')));
 assert.equal(requests.length,2);
});

test('role quota repair excludes the irregular extra role from normal casting counts',async()=>{
 const source=getCuratedScript(listCuratedScripts().find(s=>s.ruleset==='MZ').id);
 const script=Object.fromEntries(['title','intro','ruleset','days','loops','communication','characters','mainPlot','subPlots','roles','incidents','settings','specialRules'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
 script.characters.push('irregular');script.roles.irregular='immortal';
 assert.equal(validateScript(script).errors.length,0);
 const good={script,design:source.privateDesign},bad=structuredClone(good);bad.script.days=6;
 const requests=[];
 await withFetch(async(_url,init)=>{requests.push(JSON.parse(init.body));return response(requests.length===1?bad:good);},()=>generateWithAi({ruleset:'MZ',days:5,characterPool:'all',includeAI:true,seed:42}));
 const feedback=JSON.parse(requests[1].messages.at(-1).content);
 assert.deepEqual(feedback.roleQuotas.roles.immortal,{min:0,max:0,actual:0});
 assert.deepEqual(feedback.roleQuotas.roles.brain,{min:1,max:1,actual:1});
 assert.match(feedback.roleQuotas.irregularRule,/不占以上配额/);
});

test('missing model mechanics cannot silently become a random script',async()=>{
 let calls=0;
 await withFetch(async()=>{calls++;return response({title:'只有标题',intro:'只有故事'});},async()=>{
  await assert.rejects(generateWithAi(base),e=>e.code==='AUTHOR_QUALITY');
 });
 assert.equal(calls,2);
});

test('malformed partial plot data remains repairable rather than throwing a TypeError',async()=>{
 let calls=0;const bad=draft();bad.script.subPlots=7;
 await withFetch(async()=>{calls++;return response(calls===1?bad:draft());},async()=>{
  const result=await generateWithAi({...base,subPlots:['ripper_shadow']});
  assert.deepEqual(result.subPlots,['ripper_shadow']);
 });
 assert.equal(calls,2);
});

test('author rejects invented fields and unsupported special rules',async()=>{
 for(const change of [s=>{s.script.roles.girl_student='invented_role';},s=>{s.script.settings.privateDesign='SECRET';},s=>{s.script.specialRules=['任何人可以穿墙'];}]){
  const bad=draft();change(bad);let calls=0;
  await withFetch(async()=>{calls++;return response(bad);},async()=>{await assert.rejects(generateWithAi(base),e=>e.code==='AUTHOR_QUALITY');});
  assert.equal(calls,2);
 }
});

test('author cannot bypass explicit cast, plot, AI, incident count, or settings constraints',async()=>{
 const configurations=[{characters:['boy_student','girl_student','shrine_maiden','office_worker','idol','patient']},{mainPlot:'protect_place'},{includeAI:true},{incidentCount:2},{settings:{bossTerritory:'city'}}];
 for(const overrides of configurations){let calls=0;await withFetch(async()=>{calls++;return response(draft());},async()=>{await assert.rejects(generateWithAi({...base,...overrides}),e=>e.code==='AUTHOR_QUALITY');});assert.equal(calls,2);}
});

test('structurally valid but poor designs are rejected by the independent quality screen',async()=>{
 const poor=draft();Object.assign(poor.script,{days:1,loops:1,characters:['black_cat','girl_student','rich_girl','doctor','patient','idol'],roles:{black_cat:'person',girl_student:'key_person',rich_girl:'serial_killer',doctor:'brain',patient:'killer',idol:'misleader'},incidents:[{day:1,type:'suicide',culprit:'black_cat'}]});
 assert.equal(validateScript(poor.script).errors.length,0);
 let requests=[];
 await withFetch(async(_url,init)=>{requests.push(JSON.parse(init.body));return response(poor);},async()=>{
  await assert.rejects(generateWithAi({ruleset:'FS',characterPool:'all',seed:1}),e=>e.code==='AUTHOR_QUALITY');
 });
 assert.equal(requests.length,2);
 assert.match(requests[1].messages.at(-1).content,/BLACK_CAT_NO_EFFECT|SHORT_DISCOVERY_WINDOW/);
});

test('failed authoring reports only the last three bounded validator findings',async()=>{
 const first=draft(),last=draft();first.script.days=4;
 last.design={premise:design().premise+'PRIVATE_DESIGN_SENTINEL',intendedDifficulty:'hard'};
 let calls=0;
 await withFetch(async()=>response(++calls===1?first:last),async()=>{
  await assert.rejects(generateWithAi(base),error=>{
   assert.equal(error.code,'AUTHOR_QUALITY');
   assert.match(error.message,/design\.cluePlan/);
   assert.match(error.message,/design\.loopPlan/);
   assert.match(error.message,/design\.intendedDifficulty/);
   assert.doesNotMatch(error.message,/design\.threatPlan|days|PRIVATE_DESIGN_SENTINEL|雨后的第七封信/);
   assert.ok(error.message.length<=240);
   assert.equal(Object.hasOwn(error,'script'),false);
   assert.equal(Object.hasOwn(error,'design'),false);
   return true;
  });
 });
 assert.equal(calls,2);
});

test('invalid author setup is rejected before a paid request',async()=>{
 let calls=0;
 await withFetch(async()=>{calls++;return response(draft());},async()=>{
  for(const bad of [null,[],{ruleset:'UNKNOWN'},{days:'5'},{days:3,incidentCount:4},{subPlots:['ripper_shadow','ripper_shadow']},{characters:['boy_student']},{incidentVisibility:'hidden'},{settings:{bossTerritory:['city']}},{includeAI:'yes'},{lengthPreset:'short'}])await assert.rejects(generateWithAi(bad),e=>e.code==='INVALID_SETUP');
 });
 assert.equal(calls,0);
});

test('author budget reserves before sending and network uncertainty never triggers a second request',async()=>{
 let calls=0;
 await withFetch(async()=>{calls++;return response(draft());},async()=>{await assert.rejects(generateWithAi({...base,authorBudget:.01}),e=>e.code==='AUTHOR_BUDGET');});
 assert.equal(calls,0);
 let accounted=[];
 await withFetch(async()=>{calls++;throw Error('network failure');},async()=>{await assert.rejects(generateWithAi(base,{onUsage:x=>accounted.push(x)}),e=>e.code==='NETWORK');});
 assert.equal(calls,1);
 assert.equal(accounted.length,1);
 assert.equal(accounted[0].status,'unknown');
 assert.equal(accounted[0].estimatedCost,accounted[0].reserved);
});

test('author accounts first attempt cost against the same repair budget',async()=>{
 const reservation=reserveFor(authorPrompt(base).messages,8192),budget=Math.max(.02,reservation*1.5);let calls=0,accounted=0;
 const wrong=draft();wrong.script.days=4;
 await withFetch(async()=>{calls++;return response(wrong,{prompt_tokens:0,prompt_cache_miss_tokens:0,completion_tokens:Math.ceil(budget*.8/1.2*1e6)});},async()=>{
  await assert.rejects(generateWithAi(base,{authorBudget:budget,onUsage:x=>{accounted+=x.estimatedCost;}}),e=>e.code==='AUTHOR_BUDGET');
 });
 assert.equal(calls,1);assert.ok(accounted>0);
});

test('author deadline prevents another paid review after the total wait budget expires',async t=>{
 let clock=0,calls=0;t.mock.method(Date,'now',()=>clock);
 await withFetch(async()=>{calls++;clock=180001;return response(draft());},async()=>{
  await assert.rejects(generateWithAi(base),error=>error.code==='AUTHOR_TIMEOUT');
 },{autoReview:false});
 assert.equal(calls,1);
});

test('AI polish only changes public prose and never sends the original truth',async()=>{
 const original={...draft().script,privateDesign:{premise:'AUTHOR_PRIVATE_SENTINEL'},generation:{source:'ai',version:AUTHOR_VERSION},title:'ORIGINAL_TITLE_SENTINEL'};
 const before=structuredClone(original);let sent;
 const result=await withFetch(async(_url,init)=>{sent=JSON.parse(init.body);return response({title:'雨后的站台',intro:'末班车驶过之后，站台上还留着一把伞。'});},()=>polishWithAi({script:original,theme:'雨夜'}));
 assert.equal(result.title,'雨后的站台');assert.deepEqual(original,before);
 for(const key of ['roles','mainPlot','subPlots','incidents','days','loops','characters','settings','privateDesign'])assert.deepEqual(result[key],before[key]);
 const input=JSON.stringify(sent.messages);
 assert.ok(!input.includes('AUTHOR_PRIVATE_SENTINEL'));
 assert.ok(!input.includes('ORIGINAL_TITLE_SENTINEL'));
 assert.ok(!input.includes('murder_plan'));
 assert.ok(!input.includes('culprit'));
 assert.equal(result.generation.scriptHash,authoredScriptHash(result));
});

test('polish rejects a response that tries to change mechanics',async()=>{
 await withFetch(async()=>response({title:'新标题',intro:'新故事',roles:{girl_student:'person'}}),async()=>{
  await assert.rejects(polishWithAi({script:draft().script}),e=>e.code==='AUTHOR_COPY');
 });
});

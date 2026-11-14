import test from 'node:test';
import assert from 'node:assert/strict';
import {authorPrompt,validateAuthorPlan,buildAuthorCandidates,generateWithAi,polishWithAi,authoredScriptHash,AUTHOR_VERSION} from '../src/author.mjs';
import {configureKey,reserveFor} from '../src/model-provider.mjs';
import {catalog,validateScript,publicScript,generatedTitle} from '../src/content.mjs';
import {listCuratedScripts,getCuratedScript} from '../src/script-library.mjs';

configureKey('author_mock_key_not_a_real_secret');
const base={ruleset:'FS',seed:143211,difficulty:'standard'};
const sourceFor=ruleset=>getCuratedScript(listCuratedScripts().find(script=>script.ruleset===ruleset).id);
const planFor=ruleset=>{const s=sourceFor(ruleset);return {mainPlot:s.mainPlot,subPlots:s.subPlots,characters:s.characters,days:s.days,loops:s.loops,incidentCount:s.incidents.length,settings:s.settings};};
const initialInput=request=>JSON.parse(request.messages.find(message=>message.role==='user').content);
function selectedAnswer(request,index=0){
 const candidate=initialInput(request).candidates[index],o=candidate.designOptions;
 return {candidateId:candidate.id,design:{focus:o.focuses[0].id,...Object.fromEntries(['threats','counterplay','clues','loopFacts'].map(section=>[section,o.facts.filter(fact=>fact.sections.includes(section)).slice(0,section==='loopFacts'?2:3).map(fact=>fact.id)]))}};
}
const response=(answer,usage={prompt_tokens:1000,prompt_cache_hit_tokens:800,prompt_cache_miss_tokens:200,completion_tokens:100})=>new Response(JSON.stringify({model:'author-test',id:'author-mock',choices:[{finish_reason:'stop',message:{content:typeof answer==='string'?answer:JSON.stringify(answer)}}],usage}),{status:200});
async function withProvider(fn,body){
 const original=globalThis.fetch,requests=[];
 globalThis.fetch=async(url,init)=>{const request=JSON.parse(init.body);requests.push(request);const result=await fn(request,requests,url,init);return result instanceof Response?result:response(result??(request.user_id.endsWith('_caption')?{title:initialInput(request).theme+'的余音',intro:'关于'+initialInput(request).theme+'的记忆，在四条街道之间反复回响。'}:request.user_id.endsWith('_plan')?{plan:planFor(initialInput(request).dictionary.set.id)}:selectedAnswer(request)));};
 try{return await body(requests);}finally{globalThis.fetch=original;}
}

test('planning input contains the selected ruleset, exact constraints and one labelled original example',()=>{
 const {messages,configuration:c}=authorPrompt({ruleset:'BTX',mainPlot:'contract',subPlots:['','threads_fate'],theme:'窗边的空座位',seed:1});
 const input=JSON.parse(messages[1].content);
 assert.ok(input.dictionary.plots.every(plot=>plot.sets.includes('BTX')));
 assert.ok(input.dictionary.roles.every(role=>role.sets.includes('BTX')));
 assert.deepEqual(input.constraints.subPlots,['','threads_fate']);
 assert.equal(input.schema.plan.roles,undefined);assert.equal(input.schema.plan.incidents,undefined);
 assert.equal(input.theme,'窗边的空座位');assert.equal(c.constraints.incidentVisibility,'public');
 assert.match(input.example.origin,/原创/);assert.notEqual(input.example.plan.mainPlot,'contract');
 assert.match(messages[0].content,/subPlots 的每个非空索引都已固定/);
 assert.match(messages[0].content,/FS 没有最后的战斗/);
 assert.match(messages[0].content,/事件名称和日期从开局公开/);
});

test('plan validation preserves explicit X indexes and rejects unsupported mechanics fields',()=>{
 const p=planFor('BTX'),c=authorPrompt({ruleset:'BTX',subPlots:['',p.subPlots[1]],seed:1}).configuration;
 assert.deepEqual(validateAuthorPlan({plan:p},c).subPlots,p.subPlots);
 const swapped={...p,subPlots:[p.subPlots[1],p.subPlots[0]]};
 assert.throws(()=>validateAuthorPlan({plan:swapped},c),e=>e.issues.some(issue=>issue.includes('索引')));
 for(const extra of [{roles:{doctor:'brain'}},{incidents:[]},{specialRules:['new rule']},{title:'SECRET'}])assert.throws(()=>validateAuthorPlan({plan:{...p,...extra}},c),e=>e.issues.some(issue=>issue.includes('未支持')));
 assert.throws(()=>validateAuthorPlan({plan:p,design:'free prose'},c),e=>e.issues.length>0);
});

test('all explicit plan constraints, allowed cast and default cast bounds are enforced',()=>{
 for(const [ruleset,min,max]of [['FS',5,7],['BTX',6,9],['MZ',7,10],['MC',7,10]])assert.deepEqual(authorPrompt({ruleset}).configuration.constraints.characterCount,{min,max});
 const p=planFor('MZ'),c=authorPrompt({ruleset:'MZ',...p,includeAI:true,seed:1}).configuration;
 assert.deepEqual(validateAuthorPlan({plan:p},c),p);
 for(const mutate of [p=>p.days++,p=>p.loops++,p=>p.incidentCount--,p=>p.characters.pop(),p=>p.mainPlot='male_confrontation',p=>p.subPlots.reverse(),p=>p.settings.incidentVisibility='hidden']){
  const bad=structuredClone(p);mutate(bad);assert.throws(()=>validateAuthorPlan({plan:bad},c));
 }
 const restricted=authorPrompt({ruleset:'FS',seed:1}).configuration,bad=planFor('FS');bad.characters.push('black_cat');
 assert.throws(()=>validateAuthorPlan({plan:bad},restricted),e=>e.issues.some(issue=>issue.includes('人物池')));
 const crowded=planFor('BTX');crowded.characters=['boy_student','girl_student','rich_girl','shrine_maiden','police','office_worker','informer','doctor','patient','class_rep','alien','idol'];
 assert.throws(()=>validateAuthorPlan({plan:crowded},authorPrompt({ruleset:'BTX'}).configuration),e=>e.issues.some(issue=>issue.includes('6–9')));
 assert.deepEqual(validateAuthorPlan({plan:crowded},authorPrompt({ruleset:'BTX',characters:crowded.characters}).configuration).characters,crowded.characters);
});

test('compiled candidates vary mechanics while preserving the complete plan and public caption',()=>{
 const c=authorPrompt({...base,mainPlot:'avenger'}).configuration,p=validateAuthorPlan({plan:planFor('FS')},c),before=structuredClone(p),pool=buildAuthorCandidates(p,c);
 assert.equal(pool.attemptedCount,24);assert.ok(pool.candidates.length>=2&&pool.candidates.length<=6);
 assert.equal(new Set(pool.candidates.map(candidate=>candidate.fingerprint)).size,pool.candidates.length);
 for(const candidate of pool.candidates){
  const s=candidate.script;assert.deepEqual(validateScript(s).errors,[]);assert.equal(s.mainPlot,p.mainPlot);assert.deepEqual(s.subPlots,p.subPlots);assert.deepEqual(s.characters,p.characters);
  assert.equal(s.days,p.days);assert.equal(s.loops,p.loops);assert.equal(s.incidents.length,p.incidentCount);
  assert.equal(s.title,generatedTitle(base.seed));assert.equal(s.settings.incidentVisibility,'public');
  assert.ok(['limited','completed'].includes(candidate.probe.status));assert.ok(candidate.probe.commands<=400);assert.equal(candidate.probe.scope,'private');
 }
 assert.deepEqual(p,before);
});

test('normal authoring uses planning then legal candidate selection and stores private provenance and usage',async()=>{
 let chosen,stage;
 const used=[];
 const result=await withProvider(request=>{
  if(request.user_id.endsWith('_select')){const input=initialInput(request);chosen=input.candidates.at(-1);stage=input.stage;return selectedAnswer(request,input.candidates.length-1);}
 },requests=>generateWithAi(base,{onUsage:entry=>used.push(entry)}));
 assert.equal(result.source,'ai');assert.equal(result.generation.version,AUTHOR_VERSION);assert.equal(result.generation.pipeline,'plan-compile-select');
 assert.equal(result.generation.planSource,'model');assert.equal(result.generation.planAttempts,1);assert.equal(result.generation.selectionAttempts,1);
 assert.equal(result.generation.chosenId,chosen.id);assert.deepEqual(result.roles,chosen.roles);assert.deepEqual(result.incidents,chosen.incidents);
 assert.deepEqual(stage.plan,planFor('FS'));assert.equal(stage.ruleset,'FS');assert.equal(stage.communication,result.communication);
 assert.deepEqual(new Set(stage.characters.map(character=>character.id)),new Set(result.characters));
 for(const character of stage.characters){const original=catalog.characters.find(value=>value.id===character.id);for(const key of ['start','paranoiaLimit','forbiddenLocations','tags','traits_zh'])assert.deepEqual(character[key],original[key]);}
 assert.equal(result.generation.scriptHash,authoredScriptHash(result));assert.equal(result.generation.designGrounding.version,'catalog-design-1');
 assert.equal(result.generation.usage.requests,2);assert.equal(result.generation.usage.estimatedCost,used.reduce((sum,entry)=>sum+entry.estimatedCost,0));assert.equal(result.generation.usage.promptTokens,2000);
 assert.deepEqual(validateScript(result).errors,[]);assert.match(result.privateDesign.premise,/实际配役与规则目录/);
 const visible=publicScript(result);for(const key of ['roles','mainPlot','privateDesign','generation','seed'])assert.equal(visible[key],undefined);
 assert.ok(visible.incidents.every(event=>!Object.hasOwn(event,'culprit')));assert.ok(!visible.id.includes(String(base.seed)));
});

test('a fully specified user plan skips model planning without bypassing compilation or selection',async()=>{
 const plan=planFor('MC'),config={ruleset:'MC',...plan,includeAI:true,seed:42};let calls=0;
 const result=await withProvider(request=>{calls++;assert.ok(request.user_id.endsWith('_select'));},()=>generateWithAi(config));
 assert.equal(calls,1);assert.equal(result.generation.planSource,'user');assert.equal(result.generation.planAttempts,0);assert.deepEqual(result.generation.plan,plan);
 assert.equal(result.generation.usage.requests,1);assert.notEqual(result.roles.ai_character,'person');
});

test('all four rulesets compile selected model plans including A.I. and expansion requirements',async()=>{
 for(const ruleset of ['FS','BTX','MZ','MC']){
  const result=await withProvider(()=>{},()=>generateWithAi({ruleset,includeAI:['MZ','MC'].includes(ruleset),seed:42}));
  assert.equal(result.ruleset,ruleset);assert.deepEqual(validateScript(result).errors,[]);assert.equal(result.incidents.length,planFor(ruleset).incidentCount);
  if(['MZ','MC'].includes(ruleset))assert.notEqual(result.roles.ai_character,'person');
  assert.equal(result.generation.usage.requests,2);
 }
});

test('the first request of each stage can think while a repair is bounded and non-thinking',async()=>{
 let planCalls=0,selectCalls=0;
 const result=await withProvider(request=>{
  if(request.user_id.endsWith('_plan')){planCalls++;const plan=planFor('FS');if(planCalls===1)plan.days++;return {plan};}
  selectCalls++;if(selectCalls===1)return {candidateId:'not-a-candidate',design:{}};
 },async requests=>{const result=await generateWithAi({...base,days:4});assert.equal(requests.length,4);assert.deepEqual(requests.map(r=>r.thinking.type),['enabled','disabled','enabled','disabled']);assert.deepEqual(requests.map(r=>r.max_tokens),[8192,4096,8192,4096]);assert.equal(requests[0].reasoning_effort,'low');assert.equal(requests[1].reasoning_effort,undefined);return result;});
 assert.equal(result.generation.usage.requests,4);assert.equal(result.generation.planAttempts,2);assert.equal(result.generation.selectionAttempts,2);
});

test('malformed JSON and truncation get at most one fast repair per stage',async()=>{
 for(const stage of ['_plan','_select'])for(const type of ['json','truncated']){
  let failures=0;
  await withProvider(request=>{
   if(request.user_id.endsWith(stage)&&failures++===0)return type==='json'?response('{unfinished'):new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{}'}}],usage:{completion_tokens:50}}));
  },async requests=>{await generateWithAi(base);assert.equal(requests.length,3);assert.equal(requests.filter(r=>r.thinking.type==='disabled').length,1);});
 }
});

test('invalid plans cannot silently become unrelated random scripts',async()=>{
 for(const answer of [{title:'story only'},{plan:{...planFor('FS'),subPlots:7}},{plan:{...planFor('FS'),characters:['doctor']}},{plan:{...planFor('FS'),mainPlot:'invented'}}]){
  let calls=0;await withProvider(()=>{calls++;return answer;},()=>assert.rejects(generateWithAi(base),error=>error.code==='AUTHOR_QUALITY'));assert.equal(calls,2);
 }
});

test('incompatible compiled plans receive concrete repair findings without changing fixed rules',async()=>{
 const good=planFor('BTX');good.mainPlot='contract';good.characters=['boy_student','girl_student','police','office_worker','doctor','informer','soldier'];
 const bad={...good,characters:good.characters.filter(id=>id!=='girl_student')};let plans=0;
 const result=await withProvider(request=>{if(request.user_id.endsWith('_plan'))return {plan:++plans===1?bad:good};},async requests=>{
  const result=await generateWithAi({ruleset:'BTX',mainPlot:'contract',seed:27});assert.equal(requests.length,3);assert.match(requests[1].messages.at(-1).content,/少女/);return result;
 });
 assert.equal(result.mainPlot,'contract');assert.deepEqual(result.characters,good.characters);
});

test('an impossible fully specified user plan fails before any paid model call',async()=>{
 const plan=planFor('BTX');plan.mainPlot='contract';plan.characters=['boy_student','police','office_worker','doctor','informer','soldier'];let calls=0;
 await withProvider(()=>{calls++;},()=>assert.rejects(generateWithAi({ruleset:'BTX',...plan,seed:42}),e=>e.code==='INVALID_SETUP'&&/少女/.test(e.message)));
 assert.equal(calls,0);
});

test('selection cannot alter a candidate or inject natural-language design claims',async()=>{
 for(const modify of [answer=>({...answer,script:{roles:{doctor:'brain'}}}),answer=>({...answer,design:{...answer.design,counterplay:['invented:doctor:reveal']}}),answer=>({...answer,design:{...answer.design,explanation:'医生可以揭露角色'}}),answer=>({...answer,design:{...answer.design,clues:answer.design.threats}})]){
  let selections=0;await withProvider(request=>{if(request.user_id.endsWith('_select')){selections++;return modify(selectedAnswer(request));}},()=>assert.rejects(generateWithAi(base),e=>e.code==='AUTHOR_QUALITY'));
  assert.equal(selections,2);
 }
});

test('selection supplies exact grouped IDs and repairs wrong clue references with only that candidate choices',async()=>{
 let selections=0,chosen,repair;
 const result=await withProvider(request=>{
  if(!request.user_id.endsWith('_select'))return;
  selections++;
  const input=initialInput(request);
  for(const candidate of input.candidates){
   assert.deepEqual(candidate.designChoices.focus,candidate.designOptions.focuses.map(focus=>focus.id));
   for(const section of ['threats','counterplay','clues','loopFacts'])assert.deepEqual(candidate.designChoices[section],candidate.designOptions.facts.filter(fact=>fact.sections.includes(section)).map(fact=>fact.id));
   assert.deepEqual(candidate.designLimits.clues,{type:'array',min:1,max:4,unique:true});
   assert.deepEqual(candidate.designLimits.loopFacts,{type:'array',min:0,max:3,unique:true});
  }
  const index=input.candidates.length-1,answer=selectedAnswer(request,index);
  if(selections===1){chosen=input.candidates[index];answer.design.clues=['UNKNOWN_SECRET_MODEL_CLUE'];return answer;}
  const last=JSON.parse(request.messages.at(-1).content);repair=last.issues.find(issue=>issue.selectionRepair).selectionRepair;
  assert.deepEqual(repair.invalidFields,['clues']);assert.equal(repair.candidateId,chosen.id);
  assert.deepEqual(repair.designChoices,chosen.designChoices);assert.deepEqual(repair.designLimits,chosen.designLimits);
  assert.ok(repair.designChoices.clues.includes('public:schedule'));
  assert.doesNotMatch(JSON.stringify(request.messages),/UNKNOWN_SECRET_MODEL_CLUE/);
  assert.match(last.issues[0],/clues.*1–4/);
  answer.design.clues=repair.designChoices.clues.slice(0,3);return answer;
 },async requests=>{const result=await generateWithAi({ruleset:'BTX',seed:847});assert.equal(requests.length,3);assert.equal(requests.at(-1).thinking.type,'disabled');return result;});
 assert.equal(selections,2);assert.equal(result.generation.chosenId,chosen.id);assert.deepEqual(result.generation.designGrounding.selection.clues,repair.designChoices.clues.slice(0,3));
 assert.equal(result.generation.selectionAttempts,2);
});

test('a repeated invalid design fails after one repair without exposing model text or private reference choices',async()=>{
 let selections=0;
 await withProvider(request=>{
  if(!request.user_id.endsWith('_select'))return;
  selections++;
  const answer=selectedAnswer(request);answer.design.clues=['PRIVATE_UNKNOWN_MODEL_ID'];answer.design.explanation='PRIVATE_MODEL_PROSE';return answer;
 },async requests=>{
  await assert.rejects(generateWithAi(base),error=>{
   assert.equal(error.code,'AUTHOR_QUALITY');assert.match(error.message,/clues/);
   assert.doesNotMatch(error.message,/PRIVATE_UNKNOWN_MODEL_ID|PRIVATE_MODEL_PROSE|public:schedule|candidate-|ability:/);
   assert.equal(error.selectionRepair,undefined);assert.ok(error.message.length<270);return true;
  });
  assert.equal(requests.length,3);assert.doesNotMatch(requests.at(-1).messages.at(-1).content,/PRIVATE_UNKNOWN_MODEL_ID|PRIVATE_MODEL_PROSE/);
 });
 assert.equal(selections,2);
});

test('the same theme yields a secret-independent public caption request under different hidden plans',async()=>{
 const a=planFor('FS'),b={...a,mainPlot:'murder_plan'},theme='雨夜的末班电车',results=[],captions=[];
 for(const plan of [a,b])results.push(await withProvider(request=>{if(request.user_id.endsWith('_caption'))captions.push(request.messages);return request.user_id.endsWith('_plan')?{plan}:undefined;},()=>generateWithAi({...base,theme,mainPlot:plan.mainPlot})));
 assert.notEqual(results[0].mainPlot,results[1].mainPlot);assert.deepEqual(captions[0],captions[1]);
 assert.equal(results[0].title,results[1].title);assert.equal(results[0].intro,results[1].intro);assert.match(results[0].intro,/雨夜的末班电车/);
 assert.doesNotMatch(JSON.stringify(captions),/avenger|murder_plan|roles|culprit|privateDesign|candidate|scriptHash/);
 assert.deepEqual(JSON.parse(captions[0][1].content),{theme,locations:catalog.locations.map(location=>location.name_zh)});
 const result=await withProvider(()=>{},()=>generateWithAi({...base,title:'  用户的题名  '}));assert.equal(result.title,'用户的题名');assert.equal(result.generation.scriptHash,authoredScriptHash(result));
});

test('an explicit theme changes visible prose, is accounted once, and reaches planning and selection',async()=>{
 const results=[];
 for(const theme of ['雨夜的末班电车','雪落在空剧场'])results.push(await withProvider(()=>{},async requests=>{
  const script=await generateWithAi({...base,theme});
  assert.deepEqual(requests.map(request=>request.user_id.split('_').at(-1)),['caption','plan','select']);
  assert.equal(requests[0].thinking.type,'disabled');assert.equal(requests[0].max_tokens,700);
  assert.equal(initialInput(requests[1]).theme,theme);assert.equal(initialInput(requests[2]).theme,theme);
  assert.equal(script.generation.theme,theme);assert.equal(script.generation.captionSource,'public-theme-model');
  assert.equal(script.generation.captionAttempts,1);assert.equal(script.generation.usage.requests,3);assert.equal(script.generation.attempts,3);
  assert.equal(script.generation.scriptHash,authoredScriptHash(script));assert.deepEqual(validateScript(script).errors,[]);
  assert.match(publicScript(script).intro,new RegExp(theme));assert.equal(publicScript(script).generation,undefined);
  return script;
 }));
 assert.notEqual(results[0].title,results[1].title);assert.notEqual(results[0].intro,results[1].intro);
});

test('blank themes add no request and explicit titles still override themed titles',async()=>{
 await withProvider(()=>{},async requests=>{
  const script=await generateWithAi({...base,theme:'   '});assert.equal(requests.length,2);
  assert.equal(script.generation.captionAttempts,0);assert.equal(script.generation.captionSource,'neutral-template');
  assert.equal(script.generation.theme,'');assert.equal(script.title,generatedTitle(base.seed));
 });
 const themed=await withProvider(()=>{},()=>generateWithAi({...base,theme:'春日远信',title:'  用户的题名  '}));
 assert.equal(themed.title,'用户的题名');assert.match(themed.intro,/春日远信/);assert.equal(themed.generation.scriptHash,authoredScriptHash(themed));
});

test('complete fixed plans compile before paid theme copy and preserve mechanics after captioning',async()=>{
 const plan=planFor('MC'),config={ruleset:'MC',...plan,includeAI:true,seed:42};
 const plain=await withProvider(()=>{},()=>generateWithAi(config));
 const themed=await withProvider(()=>{},async requests=>{
  const script=await generateWithAi({...config,theme:'窗外的纸风车'});
  assert.deepEqual(requests.map(request=>request.user_id.split('_').at(-1)),['caption','select']);return script;
 });
 assert.deepEqual(themed.generation.plan,plan);assert.equal(themed.generation.planAttempts,0);
 for(const key of ['ruleset','days','loops','characters','mainPlot','subPlots','roles','incidents','settings'])assert.deepEqual(themed[key],plain[key]);
 assert.equal(themed.generation.scriptHash,authoredScriptHash(themed));assert.match(themed.intro,/窗外的纸风车/);
 const invalid=planFor('BTX');invalid.mainPlot='contract';invalid.characters=['boy_student','police','office_worker','doctor','informer','soldier'];
 await withProvider(()=>{throw Error('An impossible fixed plan must fail before the caption request');},()=>assert.rejects(generateWithAi({ruleset:'BTX',...invalid,theme:'窗外的纸风车',seed:42}),error=>error.code==='INVALID_SETUP'));
});

test('theme copy errors fail explicitly without retrying or silently discarding the theme',async()=>{
 for(const answer of ['{unfinished',{title:'',intro:'主题'},{title:'主题',intro:''},{title:'主题',intro:'氛围',roles:{doctor:'killer'}}]){
  await withProvider(()=>answer,async requests=>{await assert.rejects(generateWithAi({...base,theme:'雨后的回声'}),error=>error.code==='AUTHOR_COPY');assert.equal(requests.length,1);});
 }
 const used=[];await withProvider(()=>{throw Error('disconnect');},async requests=>{
  await assert.rejects(generateWithAi({...base,theme:'雨后的回声'},{onUsage:entry=>used.push(entry)}),error=>error.code==='NETWORK');assert.equal(requests.length,1);
 });
 assert.equal(used.length,1);assert.equal(used[0].status,'unknown');
});

test('theme copy shares the total budget and only adds one request to the bounded repair flow',async()=>{
 await withProvider(()=>response({title:'雨后的回声',intro:'窗边有一封未拆开的信。'},{prompt_tokens:0,prompt_cache_miss_tokens:0,completion_tokens:20000}),async requests=>{
  await assert.rejects(generateWithAi({...base,theme:'雨后的回声'},{authorBudget:.03}),error=>error.code==='AUTHOR_BUDGET');assert.equal(requests.length,1);
 });
 let plans=0,selections=0;
 await withProvider(request=>{
  if(request.user_id.endsWith('_plan')){const plan=planFor('FS');if(!plans++)plan.days++;return {plan};}
  if(request.user_id.endsWith('_select')&&!selections++)return {candidateId:'missing',design:{}};
 },async requests=>{
  const script=await generateWithAi({...base,days:4,theme:'雨后的回声'});
  assert.equal(requests.length,5);assert.equal(script.generation.usage.requests,5);
  assert.equal(script.generation.captionAttempts,1);assert.equal(script.generation.planAttempts,2);assert.equal(script.generation.selectionAttempts,2);
 });
});

test('failed authoring emits bounded findings without the rejected model content',async()=>{
 await withProvider(()=>({plan:{mainPlot:'SECRET_MODEL_BODY',subPlots:['missing'],characters:[],days:99,loops:99,incidentCount:99,settings:{privateText:'PRIVATE_SENTINEL'}}}),()=>assert.rejects(generateWithAi(base),error=>{
  assert.equal(error.code,'AUTHOR_QUALITY');assert.ok(error.message.length<270);assert.doesNotMatch(error.message,/SECRET_MODEL_BODY|PRIVATE_SENTINEL/);assert.equal(error.script,undefined);return true;
 }));
});

test('invalid configuration is rejected before a paid request',async()=>{
 let calls=0;await withProvider(()=>{calls++;},async()=>{
  for(const bad of [null,[],{ruleset:'UNKNOWN'},{days:'5'},{days:3,incidentCount:4},{subPlots:['ripper_shadow','ripper_shadow']},{characters:['boy_student']},{incidentVisibility:'hidden'},{settings:{bossTerritory:['city']}},{includeAI:'yes'},{lengthPreset:'short'}])await assert.rejects(generateWithAi(bad),e=>e.code==='INVALID_SETUP');
 });assert.equal(calls,0);
});

test('the shared budget reserves before calls and includes preceding plan usage',async()=>{
 let calls=0;await withProvider(()=>{calls++;},()=>assert.rejects(generateWithAi({...base,authorBudget:.01}),e=>e.code==='AUTHOR_BUDGET'));assert.equal(calls,0);
 const usage=[];
 await withProvider(request=>{calls++;return response({plan:planFor('FS')},{prompt_tokens:0,prompt_cache_miss_tokens:0,completion_tokens:20000});},()=>assert.rejects(generateWithAi(base,{authorBudget:.03,onUsage:entry=>usage.push(entry)}),e=>e.code==='AUTHOR_BUDGET'));
 assert.equal(calls,1);assert.equal(usage.length,1);assert.equal(usage[0].estimatedCost,.024);
 assert.ok(reserveFor(authorPrompt(base).messages,8192)<.03);
});

test('network uncertainty in either stage is accounted and never retried',async()=>{
 for(const suffix of ['_plan','_select']){let calls=0;const usage=[];
  await withProvider(request=>{calls++;if(request.user_id.endsWith(suffix))throw Error('disconnect');},()=>assert.rejects(generateWithAi(base,{onUsage:entry=>usage.push(entry)}),e=>e.code==='NETWORK'));
  assert.equal(calls,suffix==='_plan'?1:2);assert.equal(usage.at(-1).status,'unknown');assert.equal(usage.at(-1).estimatedCost,usage.at(-1).reserved);
 }
});

test('the total author deadline prevents compilation and the next paid request',async t=>{
 let clock=0,calls=0;t.mock.method(Date,'now',()=>clock);
 await withProvider(()=>{calls++;clock=180001;return {plan:planFor('FS')};},()=>assert.rejects(generateWithAi(base),e=>e.code==='AUTHOR_TIMEOUT'));
 assert.equal(calls,1);
});

test('AI polish changes only public prose and receives no original private data',async()=>{
 const original={...sourceFor('FS'),generation:{version:AUTHOR_VERSION,source:'ai'},title:'ORIGINAL_TITLE_SENTINEL',privateDesign:{premise:'PRIVATE_SENTINEL'}},before=structuredClone(original);let sent;
 const result=await withProvider(request=>{sent=request;return {title:'雨后的站台',intro:'末班车驶过以后，站台上还留着一把伞。'};},()=>polishWithAi({script:original,theme:'雨夜'}));
 assert.deepEqual(original,before);for(const key of ['roles','mainPlot','subPlots','incidents','days','loops','characters','settings','privateDesign'])assert.deepEqual(result[key],before[key]);
 assert.doesNotMatch(JSON.stringify(sent.messages),/PRIVATE_SENTINEL|ORIGINAL_TITLE_SENTINEL|avenger|culprit/);assert.equal(result.generation.scriptHash,authoredScriptHash(result));
});

test('AI polish rejects attempts to change mechanics',async()=>{
 await withProvider(()=>({title:'新标题',intro:'新故事',roles:{doctor:'brain'}}),()=>assert.rejects(polishWithAi({script:sourceFor('FS')}),e=>e.code==='AUTHOR_COPY'));
});

test('polishing preserves only trial evidence that still matches the supplied script',async()=>{
 const original=sourceFor('FS');
 original.generation={scriptHash:authoredScriptHash(original),probe:{version:'engine-probe-1',commands:10}};
 const unchanged=await withProvider(()=>({title:'雨后的站台',intro:'街道再次醒来。'}),()=>polishWithAi({script:original}));
 assert.deepEqual(unchanged.generation.probe,original.generation.probe);
 assert.equal(unchanged.generation.scriptHash,authoredScriptHash(unchanged));
 original.days++;
 const edited=await withProvider(()=>({title:'改变的日程',intro:'街道再次醒来。'}),()=>polishWithAi({script:original}));
 assert.equal(edited.generation.probe,undefined);
 assert.equal(original.generation.probe.commands,10);
});

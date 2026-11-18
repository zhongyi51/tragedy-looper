import test from 'node:test';
import assert from 'node:assert/strict';
import {authorPrompt,selectionPrompt,buildAuthorCandidates,generateWithAi,AUTHOR_VERSION} from '../src/author.mjs';
import {gameRulesPrefix,rulesForPrompt} from '../src/game-prompt.mjs';
import {listCuratedScripts,getCuratedScript} from '../src/script-library.mjs';
import {validateScript} from '../src/content.mjs';

const sourceFor=ruleset=>getCuratedScript(listCuratedScripts().find(s=>s.ruleset===ruleset).id);
const planFor=ruleset=>{const s=sourceFor(ruleset);return {mainPlot:s.mainPlot,subPlots:s.subPlots,characters:s.characters,days:s.days,loops:s.loops,incidentCount:s.incidents.length,settings:s.settings};};
const userInput=messages=>JSON.parse(messages.find(message=>message.role==='user').content);
const select=input=>{const c=input.candidates[0];return {candidateId:c.id,design:{focus:c.designChoices.focus[0],...Object.fromEntries(['threats','counterplay','clues','loopFacts'].map(section=>[section,c.designChoices[section].slice(0,section==='loopFacts'?2:3)]))}};};
const providerResponse=answer=>new Response(JSON.stringify({model:'openai/gpt-6.2-sol',id:'author-prompt-mock',usage:{prompt_tokens:1000,completion_tokens:100,cost:.001,prompt_tokens_details:{cached_tokens:600,cache_write_tokens:400},completion_tokens_details:{reasoning_tokens:60}},choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]}));

for(const ruleset of ['FS','BTX','MZ','MC'])test(`${ruleset} author rules prefix is complete and independent of theme, seed and cast restrictions`,()=>{
 const a=authorPrompt({ruleset,theme:'THEME_A_SENTINEL',seed:12}),b=authorPrompt({ruleset,theme:'THEME_B_SENTINEL',seed:99,characters:planFor(ruleset).characters});
 assert.deepEqual(a.messages.slice(0,2),b.messages.slice(0,2));
 assert.ok(a.messages[0].content.startsWith(gameRulesPrefix(ruleset)));
 assert.doesNotMatch(a.messages[0].content,/THEME_A_SENTINEL|THEME_B_SENTINEL/);
 assert.equal(userInput(a.messages).theme,'THEME_A_SENTINEL');
 assert.equal(userInput(b.messages).theme,'THEME_B_SENTINEL');
 assert.equal(userInput(a.messages).dictionary,undefined);
 const rules=rulesForPrompt(ruleset);
 assert.equal(rules.characters.length,24);assert.ok(rules.actionDeckEntries.length>0);
 for(const section of ['characters','roles','plots','incidents','actionDeckEntries'])assert.ok(a.messages[0].content.includes(JSON.stringify(rules[section])));
 assert.match(a.messages[0].content,/日结束（day_end）/);assert.match(a.messages[0].content,/轮回结束（loop_end）/);
});

test('planning and selection reuse the same full rules prefix; common candidate facts are lossless',()=>{
 const plan=planFor('FS'),p=authorPrompt({ruleset:'FS',seed:42}),pool=buildAuthorCandidates(plan,p.configuration),messages=selectionPrompt(pool,p.configuration),input=userInput(messages);
 assert.deepEqual(messages[0],p.messages[0]);assert.notDeepEqual(messages[1],p.messages[1]);
 assert.ok(input.commonDesignOptions.facts.length>0);
 let expandedBytes=0;
 for(const [index,candidate]of input.candidates.entries()){
  const facts=[...input.commonDesignOptions.facts,...candidate.designOptions.facts],expected=pool.candidates[index].options.facts;
  assert.equal(new Set(facts.map(f=>f.id)).size,facts.length);
  assert.deepEqual(new Map(facts.map(f=>[f.id,f])),new Map(expected.map(f=>[f.id,f])));
  assert.deepEqual(candidate.roles,pool.candidates[index].script.roles);
  assert.deepEqual(candidate.incidents,pool.candidates[index].script.incidents);
  for(const section of ['threats','counterplay','clues','loopFacts'])assert.deepEqual(new Set(candidate.designChoices[section]),new Set(facts.filter(f=>f.sections.includes(section)).map(f=>f.id)));
  expandedBytes+=Buffer.byteLength(JSON.stringify({...candidate,designOptions:pool.candidates[index].options}));
 }
 assert.ok(Buffer.byteLength(JSON.stringify({commonDesignOptions:input.commonDesignOptions,candidates:input.candidates}))<expandedBytes*.9,'shared facts should remove at least 10% of this candidate payload without dropping facts');
});

test('Sol authoring preserves the full prefix through repair, shares mechanical cache identity and accounts actual cost',async t=>{
 const requests=[],config={ruleset:'FS',seed:42,theme:'雨后的空车站'},plan=planFor('FS');let planCalls=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(init.headers.Authorization,'Bearer mock_openrouter_author_prompt_key');
  const request=JSON.parse(init.body),input=userInput(request.messages);requests.push(request);
  assert.deepEqual(request.reasoning,{effort:'low',exclude:true});
  if(input.candidates)return providerResponse(select(input));
  if(input.constraints)return providerResponse({plan:++planCalls===1?{...plan,days:0}:plan});
  assert.deepEqual(Object.keys(input).sort(),['locations','theme']);
  assert.doesNotMatch(JSON.stringify(request.messages),/avenger|roles|culprit|candidate|固定规则/);
  return providerResponse({title:'雨后的空车站',intro:'雨声停下后，一班没有到来的车留在每个人的记忆里。'});
 });
 const result=await generateWithAi(config,{provider:'openrouter',apiKey:'mock_openrouter_author_prompt_key',userId:'author-cache-test'});
 assert.equal(requests.length,4);const [caption,first,repair,selection]=requests;
 assert.deepEqual(first.messages[0],repair.messages[0]);assert.deepEqual(first.messages[0],selection.messages[0]);
 assert.deepEqual(first.messages.slice(0,3),repair.messages.slice(0,3));
 assert.equal(first.session_id,repair.session_id);assert.equal(first.session_id,selection.session_id);assert.notEqual(caption.session_id,first.session_id);
 assert.equal(first.prompt_cache_key,selection.prompt_cache_key);
 assert.equal(result.generation.version,AUTHOR_VERSION);assert.equal(result.generation.provider,'openrouter');assert.equal(result.generation.model,'openai/gpt-6.2-sol');assert.match(result.author,/GPT-6\.2 Sol/);
 assert.equal(result.generation.planAttempts,2);assert.deepEqual(validateScript(result).errors,[]);
 const u=result.generation.usage;
 assert.equal(u.requests,4);assert.equal(u.estimatedCost,.004);assert.equal(u.actualReportedCost,.004);assert.equal(u.costKind,'provider_reported');
 assert.equal(u.reportedRequests,4);assert.equal(u.estimatedRequests,0);assert.equal(u.cacheHitTokens,2400);assert.equal(u.cacheWriteTokens,1600);assert.equal(u.reasoningTokens,240);
});

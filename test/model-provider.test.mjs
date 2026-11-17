import test from 'node:test';
import assert from 'node:assert/strict';
import {configureKey,configured,modelFor,ratesFor,providerLabel,providersInfo,normalizeUsage,estimateUsage,reserveFor,requestJson} from '../src/model-provider.mjs';

const messages=[{role:'system',content:'固定规则 JSON'},{role:'user',content:'当前局面'}];
const reply=(usage={prompt_tokens:1000,completion_tokens:100},content='{"choice":0}',finish='stop')=>new Response(JSON.stringify({id:'response-test',model:'openai/gpt-6.1-sol',provider:'OpenAI',usage,choices:[{finish_reason:finish,message:{content,reasoning:'PRIVATE_REASONING_DO_NOT_SAVE'}}]}));

test('provider configuration isolates credentials and exposes only safe model metadata',async t=>{
 configureKey('deepseek_fake_test_credential');configureKey('openrouter_fake_test_credential','openrouter');
 assert.equal(configured(),true);assert.equal(configured('openrouter'),true);
 const info=providersInfo();assert.deepEqual(info.map(x=>x.id),['deepseek','openrouter']);
 assert.equal(info[1].model,'openai/gpt-6.1-sol');assert.equal(info[1].label,'GPT-6.1 Sol');
 assert.ok(!JSON.stringify(info).includes('_fake_test_credential'));
 assert.deepEqual(providersInfo({OPENROUTER_API_KEY:'worker-secret'}).map(x=>x.configured),[false,true]);
 const sent=[];t.mock.method(globalThis,'fetch',async(url,init)=>{sent.push({url,header:init.headers.Authorization,body:JSON.parse(init.body)});return reply();});
 await requestJson(messages);await requestJson(messages,{provider:'openrouter'});
 assert.equal(sent[0].url,'https://api.deepseek.com/chat/completions');assert.equal(sent[0].header,'Bearer deepseek_fake_test_credential');
 assert.equal(sent[1].url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(sent[1].header,'Bearer openrouter_fake_test_credential');
 await requestJson(messages,{provider:'openrouter',apiKey:'per_request_fake_override'});
 await requestJson(messages,{provider:'openrouter'});
 assert.equal(sent[2].header,'Bearer per_request_fake_override');assert.equal(sent[3].header,'Bearer openrouter_fake_test_credential');
});

test('Sol uses bounded low reasoning and fixed standard OpenAI routing without DeepSeek fields',async t=>{
 const sent=[];t.mock.method(globalThis,'fetch',async(url,init)=>{sent.push({url,init,body:JSON.parse(init.body)});return reply();});
 for(const userId of ['game-private-user_M','game-private-user_A'])await requestJson(messages,{provider:'openrouter',apiKey:'test_openrouter_key',userId,cacheKey:'same-game-private-id',thinking:'disabled',reasoningEffort:'high',maxTokens:8192});
 const body=sent[0].body;
 assert.equal(body.model,modelFor('openrouter'));assert.deepEqual(body.reasoning,{effort:'low',exclude:true});
 assert.equal(body.thinking,undefined);assert.equal(body.reasoning_effort,undefined);assert.equal(body.user_id,undefined);
 assert.equal(body.max_tokens,8192);assert.deepEqual(body.response_format,{type:'json_object'});
 assert.deepEqual(body.provider.only,['openai']);assert.deepEqual(body.provider.ignore,['openai/flex','openai/fast','openai/ultrafast']);
 assert.equal(body.provider.allow_fallbacks,false);assert.equal(body.provider.require_parameters,true);assert.deepEqual(body.provider.max_price,{prompt:2,completion:10});
 assert.equal(body.session_id,sent[1].body.session_id);assert.equal(body.prompt_cache_key,body.session_id);assert.match(body.session_id,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(body).includes('private-id'));assert.ok(!JSON.stringify(body).includes('private-user'));
 assert.equal(sent[0].init.redirect,'manual');assert.deepEqual(body.messages,messages);
});

test('official DeepSeek preserves its reasoning toggle and user_id contract',async t=>{
 let body;t.mock.method(globalThis,'fetch',async(_url,init)=>{body=JSON.parse(init.body);return reply();});
 await requestJson(messages,{apiKey:'test_deepseek_key',thinking:'enabled',reasoningEffort:'low',userId:'existing_game_M'});
 assert.equal(body.model,'deepseek-flash');assert.deepEqual(body.thinking,{type:'enabled'});assert.equal(body.reasoning_effort,'low');assert.equal(body.user_id,'existing_game_M');assert.equal(body.reasoning,undefined);assert.equal(body.provider,undefined);
});

test('DeepSeek explicit game cache keys share its cache partition across seats and author stages',async t=>{
 const bodies=[];t.mock.method(globalThis,'fetch',async(_url,init)=>{bodies.push(JSON.parse(init.body));return reply();});
 for(const userId of ['game_M','game_A','game_plan','game_select'])await requestJson(messages,{apiKey:'test_deepseek_key',userId,cacheKey:'shared-game-key'});
 await requestJson(messages,{apiKey:'test_deepseek_key',userId:'game_M',cacheKey:'different-game-key'});
 assert.match(bodies[0].user_id,/^[a-f0-9]{64}$/);
 assert.ok(bodies.slice(0,4).every(x=>x.user_id===bodies[0].user_id));
 assert.notEqual(bodies[4].user_id,bodies[0].user_id);
 assert.ok(bodies.every(x=>x.session_id===undefined&&x.prompt_cache_key===undefined));
 assert.ok(!JSON.stringify(bodies).includes('shared-game-key'));
});

test('OpenRouter actual usage cost settles once, retaining raw usage and normalized cache tokens',async t=>{
 const usage={prompt_tokens:1000,completion_tokens:120,cost:.00234,prompt_tokens_details:{cached_tokens:600,cache_write_tokens:300},completion_tokens_details:{reasoning_tokens:100}};
 let billed,reserved;t.mock.method(globalThis,'fetch',async()=>reply(usage));
 const result=await requestJson(messages,{provider:'openrouter',apiKey:'test_openrouter_key',onReserve:x=>reserved=x,onUsage:x=>billed=x});
 assert.deepEqual(result,{choice:0});assert.equal(billed.provider,'openrouter');assert.equal(billed.modelLabel,'GPT-6.1 Sol');assert.equal(billed.costKind,'provider_reported');assert.equal(billed.actualCost,.00234);assert.equal(billed.estimatedCost,.00234);assert.equal(billed.reserved,reserved);
 assert.deepEqual(billed.usage,usage);assert.deepEqual(billed.normalizedUsage,{inputTokens:1000,cachedInputTokens:600,cacheWriteTokens:300,outputTokens:120,reasoningTokens:100});
 assert.ok(!JSON.stringify(billed).includes('PRIVATE_REASONING'));
 assert.equal(estimateUsage(usage,'openrouter'),(100*2+600*.1+300*2.5+120*10)/1e6);
});

test('cache writes are reserved at the conservative Sol rate while cache reads are counted once',()=>{
 const bytes=new TextEncoder().encode(JSON.stringify(messages)).length;
 assert.equal(reserveFor(messages,8192,'openrouter'),(bytes*2.5+8192*10)/1e6);
 assert.equal(reserveFor(messages,8192),(bytes*.3+8192*1.2)/1e6);
 assert.equal(ratesFor('openrouter').cacheWrite,2.5);assert.equal(providerLabel(),'DeepSeek');
 assert.deepEqual(normalizeUsage({prompt_tokens:1000,prompt_cache_hit_tokens:800,completion_tokens:100}),{inputTokens:1000,cachedInputTokens:800,cacheWriteTokens:0,outputTokens:100,reasoningTokens:0});
 assert.equal(estimateUsage({prompt_tokens:1000,prompt_cache_hit_tokens:800,prompt_cache_miss_tokens:200,completion_tokens:10}),(200*.3+800*.006+10*1.2)/1e6);
});

test('missing invoice cost uses token estimates and missing usage retains the reservation',async t=>{
 const reports=[],responses=[reply({prompt_tokens:1000,completion_tokens:100}),reply({}),reply({cost:0,prompt_tokens:0,completion_tokens:0})];
 t.mock.method(globalThis,'fetch',async()=>responses.shift());
 for(let n=0;n<3;n++)await requestJson(messages,{provider:'openrouter',apiKey:'test_openrouter_key',onUsage:x=>reports.push(x)});
 assert.equal(reports[0].costKind,'conservative_estimate');assert.equal(reports[0].estimatedCost,.0035);assert.equal(reports[0].actualCost,undefined);
 assert.equal(reports[1].costKind,'reservation_estimate');assert.equal(reports[1].estimatedCost,reports[1].reserved);
 assert.equal(reports[2].costKind,'provider_reported');assert.equal(reports[2].actualCost,0);
});

test('invalid provider, model, key and budget options cannot reserve or send a request',async t=>{
 let calls=0,reservations=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return reply();});
 for(const options of [{provider:'other'},{provider:'openrouter',model:'openai/other'},{provider:'openrouter',apiKey:''},{provider:'openrouter',maxTokens:0},{provider:'openrouter',timeoutMs:90001},{provider:'openrouter',cacheKey:{id:1}}])await assert.rejects(requestJson(messages,{apiKey:'fake_test_key',...options,onReserve:()=>reservations++}),e=>['MODEL_PROVIDER','MODEL_OPTIONS','NO_KEY'].includes(e.code));
 assert.throws(()=>configureKey('invalid','other'),e=>e.code==='MODEL_PROVIDER');assert.throws(()=>configureKey('short','openrouter'),e=>e.code==='NO_KEY');assert.throws(()=>ratesFor('other'),e=>e.code==='MODEL_PROVIDER');
 assert.equal(calls,0);assert.equal(reservations,0);
});

test('a rejected reservation prevents even an otherwise valid Sol call',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return reply();});
 await assert.rejects(requestJson(messages,{provider:'openrouter',apiKey:'fake_test_key',onReserve:()=>{throw Error('budget exhausted');}}),/budget exhausted/);assert.equal(calls,0);
});

test('custom DeepSeek endpoints and unsupported models fail before credential transmission',async t=>{
 let calls=0,reservations=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return reply();});
 const oldBase=process.env.DEEPSEEK_BASE_URL,oldModel=process.env.DEEPSEEK_MODEL;
 try{
  process.env.DEEPSEEK_BASE_URL='https://api.deepseek.com.attacker.invalid';
  const badBase=await import('../src/model-provider.mjs?invalid-endpoint-test');
  await assert.rejects(badBase.requestJson(messages,{apiKey:'fake_test_key',onReserve:()=>reservations++}),e=>e.code==='BASE_URL');
  process.env.DEEPSEEK_BASE_URL='https://api.deepseek.com';process.env.DEEPSEEK_MODEL='arbitrary-unpriced-model';
  const badModel=await import('../src/model-provider.mjs?invalid-model-test');
  await assert.rejects(badModel.requestJson(messages,{apiKey:'fake_test_key',onReserve:()=>reservations++}),e=>e.code==='MODEL_OPTIONS');
 }finally{if(oldBase===undefined)delete process.env.DEEPSEEK_BASE_URL;else process.env.DEEPSEEK_BASE_URL=oldBase;if(oldModel===undefined)delete process.env.DEEPSEEK_MODEL;else process.env.DEEPSEEK_MODEL=oldModel;}
 assert.equal(calls,0);assert.equal(reservations,0);
});

test('Sol network uncertainty is billed conservatively once and never retried',async t=>{
 let calls=0;const reports=[];t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('network');});
 await assert.rejects(requestJson(messages,{provider:'openrouter',apiKey:'fake_test_key',onUsage:x=>reports.push(x)}),e=>e.code==='NETWORK');
 assert.equal(calls,1);assert.equal(reports.length,1);assert.equal(reports[0].status,'unknown');assert.equal(reports[0].estimatedCost,reports[0].reserved);assert.equal(reports[0].provider,'openrouter');
});

test('HTTP rejection remains separate from unknown billed responses',async t=>{
 const responses=[new Response('rate limited',{status:429}),new Response('{"error":{"message":"upstream failed"}}')],reports=[];
 t.mock.method(globalThis,'fetch',async()=>responses.shift());
 await assert.rejects(requestJson(messages,{provider:'openrouter',apiKey:'fake_test_key',onUsage:x=>reports.push(x)}),e=>e.code==='PROVIDER_429');
 await assert.rejects(requestJson(messages,{provider:'openrouter',apiKey:'fake_test_key',onUsage:x=>reports.push(x)}),e=>e.code==='PROVIDER_RESPONSE');
 assert.equal(reports[0].estimatedCost,0);assert.equal(reports[0].status,'rejected');assert.equal(reports[1].status,'unknown');assert.equal(reports[1].estimatedCost,reports[1].reserved);
});

test('Worker-compatible manual redirects reject 3xx without following or retrying credentials',async t=>{
 const calls=[],reports=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  // Cloudflare Workers supports only follow/manual, not the browser error mode.
  if(!['follow','manual'].includes(init.redirect))throw new TypeError('Unsupported redirect mode');
  calls.push({url,redirect:init.redirect});
  return new Response('',{status:307,headers:{Location:'https://redirect-target.invalid'}});
 });
 for(const provider of ['deepseek','openrouter'])await assert.rejects(requestJson(messages,{provider,apiKey:'fake_test_key',onUsage:x=>reports.push(x)}),e=>e.code==='PROVIDER_307');
 assert.equal(calls.length,2);assert.ok(calls.every(x=>x.redirect==='manual'));
 assert.deepEqual(calls.map(x=>x.url),['https://api.deepseek.com/chat/completions','https://openrouter.ai/api/v1/chat/completions']);
 assert.equal(reports.length,2);assert.ok(reports.every(x=>x.status==='rejected'&&x.estimatedCost===0));
});

test('malformed and truncated outputs retain actual Sol billing before rejection',async t=>{
 const reports=[],responses=[reply({cost:.002,prompt_tokens:1000,completion_tokens:100},'not JSON'),reply({cost:.003,prompt_tokens:1000,completion_tokens:100},'{"choice":0}','length')];
 t.mock.method(globalThis,'fetch',async()=>responses.shift());
 for(const code of ['BAD_JSON','TRUNCATED'])await assert.rejects(requestJson(messages,{provider:'openrouter',apiKey:'fake_test_key',onUsage:x=>reports.push(x)}),e=>e.code===code);
 assert.deepEqual(reports.map(x=>x.estimatedCost),[.002,.003]);assert.ok(reports.every(x=>x.status==='completed'));
});

test('Hydrogen QA pins the standard Google endpoint and strips unsupported OpenAI cache controls',async t=>{
 const sent=[];t.mock.method(globalThis,'fetch',async(url,init)=>{sent.push({url,body:JSON.parse(init.body)});return reply();});
 const gameMessages=[{role:'system',content:'JSON full rules'},{role:'user',content:'{"seat":"A"}'},{role:'user',content:JSON.stringify({visibleHistory:[{n:1,text:'public history'}],observation:{script:{title:'sample'},actions:[{choice:0,command:{type:'pass'}}]},privateMemory:{goals:[]}})}];
 for(const reasoningEffort of ['low','high'])await requestJson(gameMessages,{provider:'openrouter',apiKey:'fake-openrouter-key',benchmarkModel:'google/gemini-4-hydrogen',reasoningEffort,cacheLayout:'history',maxTokens:8192});
 for(const [i,{url,body}]of sent.entries()){
  assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(body.model,'google/gemini-4-hydrogen');
  assert.deepEqual(body.provider,{only:['google-vertex/global'],allow_fallbacks:false,require_parameters:true,max_price:{prompt:1.5,completion:7.5}});
  assert.equal(body.reasoning.effort,i?'high':'low');assert.equal(body.prompt_cache_options,undefined);assert.ok(!JSON.stringify(body).includes('prompt_cache_breakpoint'));
  assert.ok(JSON.stringify(body).includes('public history'));assert.ok(JSON.stringify(body).includes('sample'));assert.equal(body.max_tokens,8192);
 }
 await assert.rejects(requestJson(gameMessages,{provider:'deepseek',benchmarkModel:'google/gemini-4-hydrogen'}),e=>e.code==='MODEL_OPTIONS');
 assert.deepEqual(providersInfo().map(x=>x.id),['deepseek','openrouter']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,starter,generateScript} from '../src/content.mjs';
import {createGame,applyCommand,turn,legalActions} from '../src/engine.mjs';
import {decisionContext,decisionProfile,decide,AI_DECISION_VERSION,decisionSummary} from '../src/ai.mjs';
import {commonGameInstructions,gameRulesPrefix,rulesForPrompt} from '../src/game-prompt.mjs';

const output=answer=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}],usage:{prompt_tokens:100,completion_tokens:50}}));
test('compact placement candidates preserve every legal command and its original index',()=>{
 for(const ruleset of ['FS','BTX','MZ','MC']){
  let s=createGame(generateScript({ruleset,seed:14877}));
  for(let n=0;n<6;n++){
   const seat=turn(s),actions=legalActions(s,seat),ctx=decisionContext(s,seat);
   const wire=JSON.parse(ctx.messages[2].content).observation.actions;
   assert.deepEqual(wire.map(a=>Array.isArray(a)?{type:'place',card:a[1],target:a[2]}:a.command),actions.map(a=>a.command));
   assert.deepEqual(wire.map(a=>Array.isArray(a)?a[0]:a.choice),actions.map((_,i)=>i));
   if(actions.every(a=>a.command.type==='place'))assert.ok(JSON.stringify(wire).length<JSON.stringify(ctx.payload.observation.actions).length*.55);
   s=applyCommand(s,seat,actions[0].command);
  }
 }
});
for(const ruleset of ['FS','BTX','MZ','MC'])test(`${ruleset} rules prefix is independent of phase, cast, seat and secret truth`,()=>{
 const s=createGame(generateScript({ruleset,seed:14877})),original=decisionContext(s,'M').messages[0].content;
 assert.ok(original.startsWith(gameRulesPrefix(ruleset)));
 for(const seat of ['A','B','C','M']){
  const other=structuredClone(s);other.phase='hero_cards';other.day=Math.min(2,s.script.days);other.revision+=20;
  other.script.characters=[...other.script.characters].reverse();other.script.roles=Object.fromEntries(other.script.characters.map(id=>[id,'person']));
  other.script.mainPlot='SECRET_OTHER_Y';other.script.subPlots=['SECRET_OTHER_X'];
  assert.equal(decisionContext(other,seat).messages[0].content,original);
 }
 assert.deepEqual(rulesForPrompt(ruleset).characters.map(x=>x.id),catalog.characters.map(x=>x.id));
 assert.deepEqual(rulesForPrompt(ruleset).plots.map(x=>x.id),catalog.plots.filter(x=>x.sets.includes(ruleset)).map(x=>x.id));
 assert.ok(Object.isFrozen(rulesForPrompt(ruleset)));assert.ok(Object.isFrozen(rulesForPrompt(ruleset).roles));
});

test('whole-game instructions include lifecycle, information, resource and final-battle rules',()=>{
 const text=commonGameInstructions();
 for(const required of ['轮回开始','日开始','剧作家暗置三张牌','主人公领导者','当日日程事件','领导者轮换','day_end','loop_end','一次性行动牌','每轮回能力恢复','原始配役、事件犯人和日程不随重置随机改变','公开日志','提前进入最后的战斗','一名人物猜错即失败','none=不能拒绝','optional=剧作家可选择拒绝','mandatory=必须拒绝','三种方向同时出现互相抵消','事件名称公开不代表犯人公开'])assert.ok(text.includes(required),required);
 assert.equal(AI_DECISION_VERSION,'decision-7');
});

test('normal phase transitions keep a substantial identical complete-rules prefix',()=>{
 let s=createGame(starter);const first=decisionContext(s,'M').messages[0];
 for(let n=0;n<3;n++)s=applyCommand(s,'M',legalActions(s,'M')[0].command);
 assert.equal(s.phase,'hero_cards');
 const after=decisionContext(s,turn(s));assert.deepEqual(after.messages[0],first);
 assert.ok(Buffer.byteLength(first.content)>10000);
 const wire=JSON.parse(after.messages[2].content);
 assert.equal(Object.keys(wire)[0],'visibleHistory');
 assert.deepEqual(wire.visibleHistory,after.payload.visibleHistory);
 assert.deepEqual(Object.keys(wire.observation).slice(0,2),['script','version']);
 assert.equal(wire.observation.actions.length,legalActions(s,turn(s)).length);
});

test('compiled-plan repair retains complete facts and exact original cache prefix',async t=>{
 const s=createGame(starter),requests=[];s.notes.M='private strategy still needs current fact checking';s.notes.A='DO_NOT_SHARE_HERO_PRIVATE';
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  const request=JSON.parse(init.body);requests.push(request);
  if(requests.length===1)return output({choices:[0,1],reason:'two choices share a card'});
  return output({plan:0,reason:'选择完整协同三牌'});
 });
 const answer=await decide(s,'M',{apiKey:'not_a_real_test_key'});
 assert.equal(answer.repairMode,'compiled-plan');assert.equal(answer.commands.length,3);
 assert.equal(requests.length,2);assert.equal(requests[1].messages.length,requests[0].messages.length+1);
 assert.deepEqual(requests[1].messages.slice(0,-1),requests[0].messages);
 const data=JSON.parse(requests[1].messages[2].content);
 assert.deepEqual(data.visibleHistory,s.log);assert.equal(data.privateNote,s.notes.M);
 assert.ok(!JSON.stringify(requests[1]).includes('DO_NOT_SHARE_HERO_PRIVATE'));
 assert.match(requests[1].messages.at(-1).content,/只返回 JSON \{"plan":0/);
});

test('decision summary names the selected model without exposing mastermind reasoning',()=>{
 assert.deepEqual(decisionSummary('ai-step','M',{modelLabel:'GPT-6.1 Sol',reason:'SECRET_PLAN'}),{controller:'GPT-6.1 Sol',automatic:false,seat:'M'});
 assert.equal(decisionSummary('ai-step','A',{modelLabel:'GPT-6.1 Sol',reason:'公开行动依据'}).reason,'公开行动依据');
 assert.equal(decisionSummary('ai-step','M',{automatic:true,modelLabel:'GPT-6.1 Sol'}).controller,'规则引擎');
});


test('Sol uses a 2048-token low-reasoning decision cap while DeepSeek retains its profiles',async t=>{
 const s=createGame(starter),actions=legalActions(s,'M'),requests=[];
 assert.deepEqual(decisionProfile(s,actions,3,'openrouter'),{thinking:'enabled',reasoningEffort:'low',maxTokens:2048});
 assert.deepEqual(decisionProfile(s,actions,3,'deepseek'),{thinking:'enabled',reasoningEffort:'low',maxTokens:8192});
 assert.deepEqual(decisionProfile({...s,phase:'refusal'},actions.slice(0,2),0,'deepseek'),{thinking:'disabled',maxTokens:1800});
 t.mock.method(globalThis,'fetch',async(_url,init)=>{requests.push(JSON.parse(init.body));return output({choice:0});});
 const answer=await decide(s,'M',{provider:'openrouter',apiKey:'not_a_real_test_key'});
 assert.equal(requests[0].max_tokens,2048);assert.equal(requests[0].reasoning.effort,'low');
 assert.equal(answer.provider,'openrouter');assert.equal(answer.modelLabel,'GPT-6.1 Sol');
 assert.deepEqual(requests[0].prompt_cache_options,{mode:'explicit',ttl:'30m'});
 const original=decisionContext(s,'M').messages;
 assert.ok(requests[0].messages[0].content[0].text.startsWith(original[0].content));
 assert.equal(requests[0].messages.at(-2).content,original[1].content);
 assert.deepEqual(JSON.parse(requests[0].messages.at(-1).content).observation.actions,JSON.parse(original[2].content).observation.actions);
});

test('Sol ordinary repairs retain the 2048-token cap and explicit first-call overrides still win',async t=>{
 let s=createGame(starter);for(let n=0;n<3;n++)s=applyCommand(s,'M',legalActions(s,'M')[0].command);
 for(const limit of [undefined,4096]){
  const requests=[];
  t.mock.method(globalThis,'fetch',async(_url,init)=>{requests.push(JSON.parse(init.body));return output({choice:requests.length===1?-1:0});});
  const answer=await decide(s,turn(s),{provider:'openrouter',apiKey:'not_a_real_test_key',...(limit===undefined?{}:{maxTokens:limit})});
  assert.equal(answer.repairAttempts,1);assert.deepEqual(requests.map(r=>r.max_tokens),[limit??2048,2048]);
  assert.ok(requests.every(r=>r.reasoning.effort==='low'));
 }
});

test('Sol compiled repair keeps 1200 tokens after a first-call QA truncation override',async t=>{
 const s=createGame(starter),requests=[];
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  const request=JSON.parse(init.body);requests.push(request);
  if(requests.length===1)return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:''}}],usage:{prompt_tokens:100,completion_tokens:1}}));
  return output({plan:0});
 });
 const answer=await decide(s,'M',{provider:'openrouter',apiKey:'not_a_real_test_key',maxTokens:1});
 assert.equal(answer.repairMode,'compiled-plan');assert.equal(answer.commands.length,3);
 assert.deepEqual(requests.map(r=>r.max_tokens),[1,1200]);
 assert.ok(requests.every(r=>r.reasoning.effort==='low'));
});


test('Sol protagonist truncation retains its low-reasoning repair without DeepSeek fast fallback',async t=>{
 let s=createGame(starter);for(let n=0;n<3;n++)s=applyCommand(s,'M',legalActions(s,'M')[0].command);
 const requests=[];
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  requests.push(JSON.parse(init.body));
  if(requests.length===1)return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:''}}],usage:{prompt_tokens:100,completion_tokens:2048}}));
  return output({choice:0});
 });
 const answer=await decide(s,turn(s),{provider:'openrouter',apiKey:'not_a_real_test_key'});
 assert.deepEqual(requests.map(r=>r.max_tokens),[2048,2048]);
 assert.ok(requests.every(r=>r.reasoning.effort==='low'));
 assert.equal(answer.repairAttempts,1);assert.equal(answer.repairMode,undefined);
});

test('DeepSeek fast repair remains bounded to two calls and cannot execute a partial or illegal choice',async t=>{
 let s=createGame(starter);for(let n=0;n<3;n++)s=applyCommand(s,'M',legalActions(s,'M')[0].command);
 for(const second of ['truncated','illegal']){
  const requests=[],before=structuredClone(s);
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
   requests.push(JSON.parse(init.body));
   if(requests.length===1||second==='truncated')return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{"choice":0}'}}],usage:{prompt_tokens:100,completion_tokens:1200}}));
   return output({choice:-1});
  });
  await assert.rejects(decide(s,turn(s),{apiKey:'not_a_real_test_key'}),e=>e.code===(second==='truncated'?'TRUNCATED':'ILLEGAL_MODEL_ACTION'));
  assert.equal(requests.length,2);assert.deepEqual(requests.map(r=>r.max_tokens),[8192,1200]);
  assert.deepEqual(requests[1].messages.slice(0,3),requests[0].messages);
  assert.deepEqual(s,before);
 }
});

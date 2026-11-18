import test from 'node:test';import assert from 'node:assert/strict';
import {createGame,applyCommand,botCommand,turn,view} from '../src/engine.mjs';
import {getCuratedScript} from '../src/script-library.mjs';import {decisionContext} from '../src/ai.mjs';import {cacheDecisionMessages} from '../src/prompt-cache.mjs';
const content=m=>typeof m.content==='string'?m.content:m.content.map(b=>b.text).join('');
test('cache layout preserves complete seat-scoped information across all loops',()=>{
 let s=createGame(getCuratedScript('curated-last-ward'));let checked=0;
 for(let n=0;n<600&&!s.winner;n++){
  if(n%5===0){for(const seat of ['M','A','B','C']){
   const original=decisionContext(s,seat).messages,layout=cacheDecisionMessages(original),wire=layout.messages;
   const history=wire.filter(m=>Array.isArray(m.content)).flatMap(m=>m.content).flatMap(b=>{try{return JSON.parse(b.text).visibleHistorySegment||[];}catch{return [];}});
   const old=JSON.parse(original[2].content),now=JSON.parse(content(wire.at(-1)));now.visibleHistory=history;now.observation.script=JSON.parse(content(wire[1])).observation.script;
   assert.deepEqual(now,old);assert.equal(content(wire.at(-2)),original[1].content);
   assert.ok(wire.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(b=>b.prompt_cache_breakpoint).length<=4);
   if(seat!=='M')assert.equal(JSON.parse(content(wire.at(-2))).secret,undefined);
   checked++;
  }}
  s=applyCommand(s,turn(s),botCommand(s));
 }
 assert.ok(s.winner);assert.ok(checked>50);
});
test('old completed history blocks and shared hero prefix survive appends and seat changes',()=>{
 let s=createGame(getCuratedScript('curated-last-ward'));
 while(view(s,'A').log.length<55)s=applyCommand(s,turn(s),botCommand(s));
 const before=cacheDecisionMessages(decisionContext(s,'A').messages).messages;
 for(let i=0;i<4;i++)s=applyCommand(s,turn(s),botCommand(s));
 const after=cacheDecisionMessages(decisionContext(s,'B').messages).messages;
 assert.equal(content(before[0]),content(after[0]));assert.equal(content(before[1]),content(after[1]));
 assert.equal(before[2].content[0].text,after[2].content[0].text);
 assert.ok(before[2].content.some(b=>b.prompt_cache_breakpoint&&after[2].content.some(a=>a.text===b.text&&a.prompt_cache_breakpoint)));
});

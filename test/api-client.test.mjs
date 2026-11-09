import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const response=(status,text,type='application/json',extra={})=>({status,ok:status>=200&&status<300,headers:new Headers({'content-type':type}),text:async()=>text,...extra});
function client(fetch){const c={fetch,AbortController,setTimeout,clearTimeout};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function apiError('),source.indexOf('function toast(')),c);return c;}
test('API parser accepts whitespace JSON and sends same-origin credentials',async()=>{
 let options;const c=client(async(_url,o)=>{options=o;return response(200,' \n {"revision":7}');});
 assert.equal((await c.api('/games/game')).revision,7);assert.equal(options.credentials,'same-origin');assert.equal(options.headers.Accept,'application/json');
});
test('HTML gateway response never surfaces JSON SyntaxError or exposes its page',async()=>{
 const c=client(async()=>response(502,'<!DOCTYPE html><html>private gateway trace</html>','text/html'));
 await assert.rejects(c.api('/games/game/ai-step',{revision:6}),e=>e.code==='NON_JSON'&&e.uncertain&&!e.requiresLogin&&/网关/.test(e.message)&&!e.message.includes('private gateway trace')&&!e.message.includes('Unexpected token'));
});
test('HTML authentication redirect differs from a JSON business permission error',async()=>{
 let c=client(async()=>response(200,'<!doctype html><html>Sign in</html>','text/html',{redirected:true,url:'https://game.example/signin-with-chatgpt'}));
 await assert.rejects(c.api('/games/game'),e=>e.code==='AUTH'&&e.requiresLogin);
 c=client(async()=>response(403,'{"error":"终局前无法访问私密答案"}'));
 await assert.rejects(c.api('/games/game/replay?full=1'),e=>e.code==='HTTP_403'&&!e.requiresLogin&&e.message==='终局前无法访问私密答案');
});
test('network abort marks mutation result unknown without retrying',async()=>{
 let calls=0;const c=client(async()=>{calls++;throw Object.assign(Error('abort'),{name:'AbortError'});});
 await assert.rejects(c.api('/games/game/ai-step',{revision:6}),e=>e.code==='TIMEOUT'&&e.uncertain&&/同步局面/.test(e.message));assert.equal(calls,1);
});
function stepContext(readResult){
 const calls=[],prev={id:'game',revision:6,phaseId:'cultist',log:[],busy:false};
 const c={calls,working:false,g:prev,syncRequired:false,auto:true,requestKind:'',actionError:'',actionErrorCode:'',transitionView:null,advancedRevision:'',selected:null,document:{querySelector:()=>null,querySelectorAll:()=>[]},boardPositions:()=>({}),localStorage:{setItem(){}},crypto:{randomUUID:()=> 'once-only'},render(){},play(){},animateTransition:async()=>{},api:async(url,data)=>{calls.push({url,data});if(data!==undefined)throw Object.assign(Error('收到网页而非游戏数据'),{code:'NON_JSON',uncertain:true});if(readResult instanceof Error)throw readResult;return readResult;}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('async function step('),source.indexOf('async function runAuto(')),c);return c;
}
test('unknown paid action is followed only by GET and blocks further mutation while busy',async()=>{
 const c=stepContext({id:'game',revision:6,log:[],busy:true});await assert.rejects(c.step(undefined,'ai-step'));
 assert.equal(c.calls.length,2);assert.equal(c.calls[0].url,'/games/game/ai-step');assert.equal(c.calls[1].url,'/games/game');assert.equal(c.calls[1].data,undefined);assert.equal(c.syncRequired,true);assert.equal(c.working,false);assert.equal(c.auto,false);assert.match(c.actionError,/未自动重发/);
});
test('failed status recovery never claims success or unlocks uncertain mutations',async()=>{
 const c=stepContext(Error('offline'));await assert.rejects(c.step(undefined,'ai-step'));
 assert.equal(c.syncRequired,true);assert.match(c.actionError,/无法核对/);assert.doesNotMatch(c.actionError,/已同步|已保留|已保存/);assert.equal(c.calls.length,2);
});
test('a newer read snapshot is described without claiming this specific submission succeeded',async()=>{
 const c=stepContext({id:'game',revision:7,log:[],busy:false});await assert.rejects(c.step(undefined,'ai-step'));
 assert.equal(c.syncRequired,false);assert.equal(c.g.revision,7);assert.match(c.actionError,/已获取更新后的局面/);assert.doesNotMatch(c.actionError,/这一步已保存|提交成功/);assert.equal(c.auto,false);
});

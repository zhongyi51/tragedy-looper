import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../public/js/api.mjs';
import {createSession} from '../public/js/session.mjs';

const response=(status,text,type='application/json',extra={})=>({status,ok:status>=200&&status<300,headers:new Headers({'content-type':type}),text:async()=>text,...extra});
test('API parser accepts whitespace JSON and sends same-origin credentials',async()=>{
 let url,options;const api=createApi(async(u,o)=>{url=u;options=o;return response(200,' \n {"revision":7}');});
 assert.equal((await api('/games/game')).revision,7);assert.equal(url,'/api/games/game');assert.equal(options.credentials,'same-origin');assert.equal(options.headers.Accept,'application/json');assert.equal(options.method,undefined);
 await api('/games/game/command',{revision:7});assert.equal(options.method,'POST');assert.equal(options.body,'{"revision":7}');
});
test('HTML gateway response never surfaces JSON SyntaxError or exposes its page',async()=>{
 const api=createApi(async()=>response(502,'<!DOCTYPE html><html>private gateway trace</html>','text/html'));
 await assert.rejects(api('/games/game/ai-step',{revision:6}),e=>e.code==='NON_JSON'&&e.uncertain&&!e.requiresLogin&&/服务器暂时没有回应/.test(e.message)&&!e.message.includes('private gateway trace')&&!e.message.includes('Unexpected token'));
});
test('HTML authentication redirect differs from a JSON business permission error',async()=>{
 let api=createApi(async()=>response(200,'<!doctype html><html>Sign in</html>','text/html',{redirected:true,url:'https://game.example/signin-with-chatgpt'}));
 await assert.rejects(api('/games/game'),e=>e.code==='AUTH'&&e.requiresLogin);
 api=createApi(async()=>response(403,'{"error":"终局前无法访问私密答案"}'));
 await assert.rejects(api('/games/game/replay?full=1'),e=>e.code==='HTTP_403'&&!e.requiresLogin&&e.message==='终局前无法访问私密答案');
});
test('network abort marks mutation result unknown without retrying',async()=>{
 let calls=0;const api=createApi(async()=>{calls++;throw Object.assign(Error('abort'),{name:'AbortError'});});
 await assert.rejects(api('/games/game/ai-step',{revision:6}),e=>e.code==='TIMEOUT'&&e.uncertain&&/没有回应/.test(e.message));assert.equal(calls,1);
 await assert.rejects(api('/games/game'),e=>e.code==='TIMEOUT'&&!e.uncertain);
});

function stepContext(readResult){
 const calls=[],state={page:'game',working:false,g:{id:'game',mode:'heroes',turn:'M',revision:6,phaseId:'cultist',log:[],busy:false},syncRequired:false,auto:true,requestKind:'',actionError:'',actionErrorCode:'',transitionView:null,advancedRevision:'',selected:null,peekSeat:null,aiFeed:[],banner:null,pendingOutcome:null,info:{configured:true}};
 const session=createSession({state,render(){},storage:{getItem:()=>null,setItem(){}},uuid:()=>'once-only',
  api:async(url,data)=>{calls.push({url,data});if(data!==undefined)throw Object.assign(Error('收到网页而非游戏数据'),{code:'NON_JSON',uncertain:true});if(readResult instanceof Error)throw readResult;return readResult;}});
 return {state,calls,step:session.step,syncState:session.syncState};
}
test('unknown paid action is followed only by GET and blocks further mutation while busy',async()=>{
 const c=stepContext({id:'game',revision:6,log:[],busy:true});await assert.rejects(c.step(undefined,'ai-step'));
 assert.equal(c.calls.length,2);assert.equal(c.calls[0].url,'/games/game/ai-step');assert.equal(c.calls[1].url,'/games/game');assert.equal(c.calls[1].data,undefined);assert.equal(c.state.syncRequired,true);assert.equal(c.state.working,false);assert.equal(c.state.auto,false);assert.equal(c.state.actionError,'收到网页而非游戏数据。这一步还在处理，请稍后同步。为免重复计费，没有自动重试。');
 await c.step(undefined,'ai-step');assert.equal(c.calls.length,2);
});
test('failed status recovery never claims success or unlocks uncertain mutations',async()=>{
 const c=stepContext(Error('offline'));await assert.rejects(c.step(undefined,'ai-step'));
 assert.equal(c.state.syncRequired,true);assert.match(c.state.actionError,/没能取回最新局面/);assert.doesNotMatch(c.state.actionError,/已同步|已保留|已保存/);assert.equal(c.calls.length,2);
});
test('a newer read snapshot is described without claiming this specific submission succeeded',async()=>{
 const c=stepContext({id:'game',revision:7,log:[],busy:false});await assert.rejects(c.step(undefined,'ai-step'));
 assert.equal(c.state.syncRequired,false);assert.equal(c.state.g.revision,7);assert.match(c.state.actionError,/局面已经更新/);assert.doesNotMatch(c.state.actionError,/这一步已保存|提交成功/);assert.equal(c.state.auto,false);
});
test('manual sync only reads and clears the lock once the server is idle',async()=>{
 const c=stepContext({id:'game',revision:6,log:[],busy:true});await assert.rejects(c.step(undefined,'command'));
 await c.syncState();assert.equal(c.state.syncRequired,true);assert.match(c.state.actionError,/还在处理/);
 c.calls.length=0;const idle=stepContext({id:'game',revision:9,log:[],busy:false});idle.state.syncRequired=true;idle.state.actionError='x';
 await idle.syncState();assert.deepEqual(idle.calls,[{url:'/games/game',data:undefined}]);assert.equal(idle.state.syncRequired,false);assert.equal(idle.state.actionError,'');assert.equal(idle.state.g.revision,9);
});

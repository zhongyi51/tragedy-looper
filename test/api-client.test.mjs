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

test('offline event ends an in-flight request promptly, with no mutation retry',async()=>{
 const network=new EventTarget();let calls=0;
 const api=createApi((_url,{signal})=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('abort'),{name:'AbortError'})),{once:true}));},network);
 const pending=api('/games/game/ai-step',{revision:6});
 network.dispatchEvent(new Event('offline'));
 await assert.rejects(pending,e=>e.code==='NETWORK'&&e.uncertain);
 assert.equal(calls,1);
});

function recoveryContext(api,store=new Map()){
 const tasks=new Map(),calls=[];let next=0;
 const state={page:'game',working:false,auto:false,autoPlay:true,syncRequired:true,actionError:'offline',actionErrorCode:'NETWORK',
  g:{id:'game',mode:'heroes',turn:'M',phaseId:'mm_cards',revision:6,log:[],busy:false},info:{configured:true},aiFeed:[]};
 const options={state,render(){},storage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
  schedule:(fn,ms)=>{tasks.set(++next,{fn,ms});return next;},cancel:id=>tasks.delete(id),wait:async()=>{},
  api:async(url,data)=>{calls.push({url,data});return api(url,data,state);}};
 const session=createSession(options);
 const tick=async()=>{assert.equal(tasks.size,1);const [id,task]=tasks.entries().next().value;tasks.delete(id);await task.fn();};
 return {state,session,calls,tasks,tick,store,options};
}
test('reconnection polls busy state to completion and never resumes paid autoplay on its own',async()=>{
 let reads=0;
 const c=recoveryContext((_url,data,state)=>{assert.equal(data,undefined);return {...state.g,busy:++reads===1,revision:reads===1?6:7};});
 c.session.connectionRestored();assert.equal(c.tasks.values().next().value.ms,0);
 await c.tick();assert.equal(c.state.syncRequired,true);assert.equal(c.state.g.busy,true);
 await c.tick();assert.equal(c.state.syncRequired,false);assert.equal(c.state.g.revision,7);assert.equal(c.state.working,false);assert.equal(c.tasks.size,0);
 c.session.kick();await Promise.resolve();assert.equal(c.calls.length,2);assert.ok(c.calls.every(c=>c.data===undefined));
 assert.equal(c.state.recoveryPaused,true);assert.equal(c.store.get('tl-recovery-game'),'1');
 // Reloading an idle game still waits for an explicit Continue, not a paid retry.
 const reloaded=recoveryContext(()=>{throw Error('must not submit');},c.store);reloaded.state.syncRequired=false;reloaded.state.actionError='';
 reloaded.session.kick();await reloaded.session.resumeRules();assert.equal(reloaded.calls.length,0);assert.equal(reloaded.state.recoveryPaused,true);
});
test('status failures back off, online resets the delay, and unchanged idle games unlock',async()=>{
 let offline=true;
 const c=recoveryContext((_url,_data,state)=>{if(offline)throw Object.assign(Error('offline'),{code:'NETWORK'});return {...state.g,busy:false};});
 c.session.watchRecovery();await c.tick();assert.equal(c.tasks.values().next().value.ms,6000);
 await c.tick();assert.equal(c.tasks.values().next().value.ms,12000);
 offline=false;c.session.connectionRestored();assert.equal(c.tasks.size,1);assert.equal(c.tasks.values().next().value.ms,0);
 await c.tick();assert.equal(c.state.syncRequired,false);assert.equal(c.state.g.revision,6);assert.equal(c.state.actionError,'');assert.equal(c.tasks.size,0);
});
test('busy saves start recovery after reload; manual Continue is the only new mutation',async()=>{
 const c=recoveryContext((_url,data,state)=>({...state.g,busy:false,...(data?{revision:7,turn:'A',phaseId:'hero_cards'}:{})}));
 c.state.syncRequired=false;c.state.g.busy=true;c.state.actionError='';
 await c.session.resumeRules();assert.equal(c.tasks.size,1);assert.equal(c.calls.length,0);
 await c.tick();c.session.kick();assert.equal(c.calls.length,1);
 await c.session.runAuto();assert.equal(c.calls.filter(c=>c.data!==undefined).length,1);assert.equal(c.state.g.revision,7);assert.equal(c.store.get('tl-recovery-game'),'');
});
test('recovery cannot overwrite another loaded game, and authentication failure stops polling',async()=>{
 let resolve;const c=recoveryContext(()=>new Promise(r=>resolve=r));
 c.session.watchRecovery();const pending=c.tick();await Promise.resolve();await Promise.resolve();
 c.state.g={...c.state.g,id:'other',revision:20};c.state.syncRequired=false;
 resolve({id:'game',revision:7,busy:false});await pending;assert.equal(c.state.g.id,'other');assert.equal(c.state.g.revision,20);
 const auth=recoveryContext(()=>{throw Object.assign(Error('login'),{code:'AUTH'});});
 auth.session.watchRecovery();await auth.tick();assert.equal(auth.state.actionErrorCode,'AUTH');assert.equal(auth.tasks.size,0);
});

test('reload during a submitted request preserves uncertainty even after the server lease expires',async()=>{
 let finish;
 const c=recoveryContext((_url,_data,state)=>new Promise(r=>finish=()=>r({...state.g,revision:7,turn:'A',phaseId:'hero_cards'})));
 c.state.syncRequired=false;c.state.actionError='';
 const sending=c.session.step(undefined,'ai-step');await Promise.resolve();await Promise.resolve();
 assert.ok(c.store.get('tl-inflight-game'));
 const restored=recoveryContext(()=>{throw Error('no duplicate request');},c.store);
 restored.state.syncRequired=false;restored.state.actionError='';restored.session.kick();
 assert.equal(restored.state.recoveryPaused,true);assert.equal(restored.calls.length,0);
 finish();await sending;assert.equal(c.store.get('tl-inflight-game'),'');
});

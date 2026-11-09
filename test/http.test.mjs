import test from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://127.0.0.1:4317';
function client(){let cookie='';return async(p,b,headers={})=>{const r=await fetch(base+p,{method:b===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(b===undefined?{}:{body:JSON.stringify(b)})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,body:await r.json()};};}
test('HTTP privacy, seats, idempotency, revision conflict and public export',async()=>{
 const request=client(),other=client();let {body:g,status}=await request('/api/games',{mode:'heroes',budget:.1});assert.equal(status,201);assert.equal(g.secret,undefined);assert.equal(g.spent,null);
 assert.equal((await other('/api/games/'+g.id)).status,400);
 assert.equal((await request('/api/games/'+g.id+'/script?full=1')).status,403);
 assert.equal((await request('/api/games/'+g.id+'/replay?full=1')).status,403);
 assert.equal((await request('/api/games/'+g.id+'/usage')).status,403);
 assert.equal((await request('/api/games/'+g.id+'/command',{revision:0,command:{type:'place',card:'move_h#0',target:'girl_student'}})).status,403);
 const commandId='test-once',next=await request('/api/games/'+g.id+'/bot-step',{revision:0,commandId});assert.equal(next.status,200);assert.equal(next.body.revision,1);
 const duplicate=await request('/api/games/'+g.id+'/bot-step',{revision:0,commandId});assert.equal(duplicate.body.revision,1);
 assert.equal((await request('/api/games/'+g.id+'/bot-step',{revision:0,commandId:'old'})).status,409);
 const replay=(await request('/api/games/'+g.id+'/replay')).body;assert.equal(replay.perspective,'public');assert.equal(replay.script.roles,undefined);assert.equal(replay.frames[1].view.placements[0].card,undefined);assert.equal(replay.frames[1].view.secret,undefined);assert.equal(replay.frames[1].stateHash,undefined);
 const mm=(await request('/api/games',{mode:'mastermind'})).body;assert.ok(mm.secret);const mr=(await request('/api/games/'+mm.id+'/replay')).body;assert.equal(mr.frames[0].view.secret,undefined);
});
test('HTTP blocks cross-origin requests and private research/runtime paths',async()=>{
 const c=client();assert.equal((await c('/api/games',{}, {Origin:'https://untrusted.example'})).status,403);
 for(const p of ['/runtime/games.sqlite','/src/server.mjs','/sources/quickset.zip','/data/catalog.json','/assets/../runtime/games.sqlite'])assert.equal((await fetch(base+p)).status,404);
 const image=await fetch(base+'/assets/commons/tragedy_commons_5th/chara_stand/chara_stand_02.png');assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/png/);
 const sound=await fetch(base+'/assets/audio/Audio/click_001.ogg');assert.equal(sound.status,200);assert.equal(Buffer.from(await sound.arrayBuffer()).subarray(0,4).toString(),'OggS');
});
test('HTTP all-bot complete game, replay export and branch',async()=>{
 const c=client();let g=(await c('/api/games',{mode:'observe'})).body;for(let i=0;i<250&&!g.winner;i++){const r=await c('/api/games/'+g.id+'/bot-step',{revision:g.revision,commandId:'bot'+i});assert.equal(r.status,200);g=r.body;}assert.ok(g.winner);
 const full=(await c('/api/games/'+g.id+'/replay?full=1')).body;assert.equal(full.frames.at(-1).view.winner,g.winner);assert.ok(full.frames[0].stateHash);
 const branch=await c('/api/games/'+g.id+'/branch',{revision:1});assert.equal(branch.status,201);assert.equal(branch.body.revision,0);assert.notEqual(branch.body.id,g.id);
 assert.deepEqual((await c('/api/games/'+g.id+'/usage')).body,[]);
});
test('HTTP simultaneous submissions advance exactly once and invalid script shapes do not crash service',async()=>{
 const c=client();let g=(await c('/api/games',{})).body;
 const r=await Promise.all(Array.from({length:12},(_,i)=>c('/api/games/'+g.id+'/bot-step',{revision:0,commandId:'parallel-'+i})));
 assert.equal(r.filter(x=>x.status===200).length,1);assert.equal((await c('/api/games/'+g.id)).body.revision,1);
 const starter=(await c('/api/scripts/starter')).body;
 for(const field of ['characters','subPlots','roles','incidents','settings']){const bad={...starter,[field]:null};const v=await c('/api/scripts/validate',bad);assert.equal(v.status,200);assert.ok(v.body.errors.length);assert.equal((await c('/api/games',{script:bad})).status,400);}
 assert.equal((await c('/api/info')).status,200);
});

test('HTTP public schedule hides event identities across roles and exports',async()=>{
 const c=client();
 for(const mode of ['heroes','observe','mastermind']){
  const g=(await c('/api/games',{mode})).body;
  if(mode==='mastermind')assert.equal(g.secret.incidents[0].type,'suicide');
  else assert.deepEqual(g.script.incidents,[{day:3}]);
  assert.deepEqual((await c('/api/games/'+g.id+'/script')).body.incidents,[{day:3}]);
  const replay=(await c('/api/games/'+g.id+'/replay')).body;
  assert.deepEqual(replay.script.incidents,[{day:3}]);
  for(const frame of replay.frames){assert.deepEqual(frame.view.script.incidents,[{day:3}]);assert.equal(frame.view.secret,undefined);}
 }
});

test('HTTP location movement bluff remains legal and an invalid command leaves the game usable',async()=>{
 const c=client();let g=(await c('/api/games',{mode:'mastermind'})).body;
 const bad=await c('/api/games/'+g.id+'/command',{revision:0,command:{type:'place',card:'move_h#0',target:'no-such-location'}});
 assert.equal(bad.status,400);assert.equal(bad.body.code,'ILLEGAL_ACTION');
 assert.equal((await c('/api/games/'+g.id)).body.busy,false);
 for(const target of ['hospital','shrine','city']){
  const choice=g.actions.find(a=>a.command.type==='place'&&a.command.target===target&&a.command.card.startsWith('move_'));assert.ok(choice);
  const next=await c('/api/games/'+g.id+'/command',{revision:g.revision,command:choice.command});assert.equal(next.status,200);g=next.body;
 }
 assert.equal(g.phaseId,'hero_cards');
 for(let n=0;n<40&&g.day===1&&!g.winner;n++){
  const next=await c('/api/games/'+g.id+'/bot-step',{revision:g.revision});assert.equal(next.status,200);g=next.body;assert.equal(g.busy,false);
 }
 assert.ok(g.day>1||g.winner);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import net from 'node:net';
import {DatabaseSync} from 'node:sqlite';

test('local adapter selects Sol per game, keeps it on branch, and rejects missing provider without falling back',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),runtime=await mkdtemp(join(tmpdir(),'tragedy-provider-http-'));
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const preload=join(runtime,'transport.mjs');
 await writeFile(preload,`const native=globalThis.fetch;globalThis.fetch=async(url,init)=>{if(String(url)==='https://openrouter.ai/api/v1/chat/completions'){const body=JSON.parse(init.body);if(body.model!=='openai/gpt-6.1-sol'||init.headers.Authorization!=='Bearer unit-local-sol-key')throw Error('wrong provider');return new Response(JSON.stringify({model:body.model,usage:{prompt_tokens:100,completion_tokens:10,cost:0.0042},choices:[{finish_reason:'stop',message:{content:'{"choice":0,"reason":"合法行动"}'}}]}));}if(String(url).startsWith('https://api.deepseek.com'))throw Error('unexpected fallback');return native(url,init);};`);
 const child=spawn(process.execPath,['--import',pathToFileURL(preload).href,'src/server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),TL_RUNTIME:runtime,DEEPSEEK_API_KEY:'',OPENROUTER_API_KEY:'unit-local-sol-key'},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);let cookie='';
 const req=async(path,body)=>{const r=await fetch('http://127.0.0.1:'+port+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json()};};
 try{
  await new Promise((resolve,reject)=>{const started=Date.now(),poll=setInterval(async()=>{if(child.exitCode!==null||Date.now()-started>10000){clearInterval(poll);reject(Error(output));return;}try{const r=await req('/api/info');if(r.status===200){clearInterval(poll);resolve();}}catch{}},50);});
  const info=(await req('/api/info')).data;assert.equal(info.defaultProvider,'openrouter');assert.equal(info.providers.find(p=>p.id==='deepseek').configured,false);
  assert.doesNotMatch(JSON.stringify(info),/unit-local-sol-key/);
  assert.equal((await req('/api/games',{aiProvider:'deepseek',opponent:'ai'})).data.code,'NO_KEY');
  assert.equal((await req('/api/games',{aiProvider:'unexpected'})).data.code,'MODEL_PROVIDER');
  let g=(await req('/api/games',{mode:'mastermind',aiProvider:'openrouter',opponent:'ai',budget:1})).data;
  for(let n=0;n<3;n++)g=(await req('/api/games/'+g.id+'/bot-step',{revision:g.revision})).data;
  const command={revision:g.revision,commandId:'local-sol-once'};
  const step=await req('/api/games/'+g.id+'/ai-step',command);assert.equal(step.status,200);assert.equal(step.data.decision.controller,'GPT-6.1 Sol');
  assert.equal((await req('/api/games/'+g.id+'/ai-step',command)).status,200);
  const reload=(await req('/api/games/'+g.id)).data;assert.equal(reload.aiProvider,'openrouter');assert.equal(reload.opponent,'ai');
  const branch=await req('/api/games/'+g.id+'/branch',{revision:0});assert.equal(branch.status,201);assert.equal(branch.data.aiProvider,'openrouter');assert.equal(branch.data.opponent,'ai');
  const db=new DatabaseSync(join(runtime,'games.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM calls WHERE game=?').get(g.id).n,1);assert.ok(Math.abs(db.prepare('SELECT spent FROM games WHERE id=?').get(g.id).spent-.0042)<1e-10);}finally{db.close();}
 }finally{child.kill('SIGINT');if(child.exitCode===null)await new Promise(r=>child.once('exit',r));await rm(runtime,{recursive:true,force:true});}
});

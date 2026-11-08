import {spawn} from 'node:child_process';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const runtime=await mkdtemp(path.join(tmpdir(),'tragedy-tests-'));
const server=spawn(process.execPath,['src/server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,DEEPSEEK_API_KEY:'',PORT:String(port),TL_RUNTIME:runtime},stdio:['ignore','pipe','pipe']});
let serverOutput='';server.stdout.on('data',b=>serverOutput+=b);server.stderr.on('data',b=>serverOutput+=b);
try{
 await new Promise((resolve,reject)=>{const start=Date.now(),timer=setInterval(async()=>{if(server.exitCode!==null||Date.now()-start>10000){clearInterval(timer);reject(Error('Test server did not start: '+serverOutput));return;}try{const r=await fetch('http://127.0.0.1:'+port+'/api/info');if(r.ok){clearInterval(timer);resolve();}}catch{}},100);});
 const files=(await readdir(path.join(root,'test'))).filter(f=>f.endsWith('.test.mjs')).sort().map(f=>'test/'+f);
 const child=spawn(process.execPath,['--test',...files],{cwd:root,windowsHide:true,env:{...process.env,DEEPSEEK_API_KEY:'',TEST_URL:'http://127.0.0.1:'+port},stdio:'inherit'});
 process.exitCode=await new Promise(r=>child.once('exit',code=>r(code??1)));
}finally{
 server.kill();if(server.exitCode===null)await new Promise(r=>server.once('exit',r));
 const resolved=path.resolve(runtime),parent=path.resolve(tmpdir());if(path.dirname(resolved)===parent&&path.basename(resolved).startsWith('tragedy-tests-'))await rm(resolved,{recursive:true,force:true});
}

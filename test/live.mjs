import {writeFileSync} from 'node:fs';
const base=process.env.TEST_URL||'http://127.0.0.1:4317';let cookie='';
async function call(p,b){const r=await fetch(base+'/api'+p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(b?{body:JSON.stringify(b)}:{})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const j=await r.json();if(!r.ok)throw Error(JSON.stringify(j));return j;}
const set=process.env.TEST_SET||'FS';const script=set==='BTX'?await call('/scripts/generate',{ruleset:'BTX',seed:20261108,mainPlot:'sealed_item',subPlots:['unsettling_rumor','hidden_killer'],title:'测试：封印之夜'}):undefined;
const game=await call('/games',{mode:'observe',budget:.5,script});let g=game,steps=0,failures=[];
console.log('Live test started; game '+game.id);
while(!g.winner&&steps<400){try{g=await call('/games/'+g.id+'/ai-step',{revision:g.revision,commandId:'live-'+steps});steps++;console.log(JSON.stringify({step:steps,loop:g.loop,day:g.day,phase:g.phaseId,spent:g.spent,winner:g.winner}));}catch(e){failures.push({step:steps,error:e.message});console.log('Live request stopped: '+e.message);break;}}
const usage=g.winner?await call('/games/'+g.id+'/usage'):[];const result={date:new Date().toISOString(),set,gameId:g.id,steps,winner:g.winner,finalPhase:g.phaseId,spentEstimate:g.spent,failures,calls:usage.length,usage,model:g.model};writeFileSync(new URL('../reports/live-'+set+'.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({done:true,...result,usage:undefined}));

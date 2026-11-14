import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {catalog,chars,starter,generateScript,validateScript,publicScript,scriptForGame} from '../src/content.mjs';
import {createGame,view} from '../src/engine.mjs';
import {createWorker} from '../worker/index.mjs';

const combinations=()=>catalog.sets.filter(s=>['FS','BTX'].includes(s.id)).flatMap(set=>{
 const ys=catalog.plots.filter(p=>p.kind==='Y'&&p.sets.includes(set.id)),xs=catalog.plots.filter(p=>p.kind==='X'&&p.sets.includes(set.id));
 return ys.flatMap(y=>xs.flatMap((x,i)=>set.subPlots===1?[{ruleset:set.id,mainPlot:y.id,subPlots:[x.id]}]:xs.slice(i+1).map(z=>({ruleset:set.id,mainPlot:y.id,subPlots:[x.id,z.id]}))));
});

test('advanced generation covers every FS/BTX plot combination, full character pool and guaranteed A.I.',()=>{
 let seed=1;
 for(const config of combinations())for(let n=0;n<8;n++){
  const s=generateScript({...config,seed:seed++,characterPool:'all',includeAI:true,days:n+1,loops:n+1,incidentCount:n%2,incidentVisibility:'public'});
  assert.deepEqual(validateScript(s).errors,[]);assert.ok(s.characters.includes('ai_character'));assert.notEqual(s.roles.ai_character,'person');
  assert.equal(s.days,n+1);assert.equal(s.loops,n+1);assert.equal(s.incidents.length,n%2);assert.equal(s.settings.incidentVisibility,'public');
  if(s.characters.includes('irregular'))assert.notEqual(s.roles.irregular,'person');
  if(s.characters.includes('godly_being'))assert.equal(s.settings.godlyLoop,1);
  if(s.characters.includes('transfer_student'))assert.equal(s.settings.transferDay,Math.min(2,s.days));
  if(s.characters.includes('boss'))assert.equal(s.settings.bossTerritory,'city');
  if(s.mainPlot==='contract')for(const [c,r] of Object.entries(s.roles))if(r==='key_person')assert.ok(chars[c].tags.includes('girl'));
  assert.doesNotThrow(()=>createGame(s));
 }
});

test('fixed cast generation assigns all 24 characters without invalid A.I. or Irregular roles',()=>{
 for(const config of combinations()){
  const s=generateScript({...config,seed:739,characters:catalog.characters.map(c=>c.id),days:10,loops:8,incidentCount:10,settings:{godlyLoop:3,transferDay:5,bossTerritory:'hospital'}});
  assert.deepEqual(validateScript(s).errors,[]);assert.equal(s.characters.length,24);assert.equal(Object.keys(s.roles).length,24);
  assert.equal(new Set(s.incidents.map(e=>e.day)).size,10);assert.equal(new Set(s.incidents.map(e=>e.culprit)).size,10);assert.notEqual(s.roles.ai_character,'person');
 }
});

test('advanced generation is reproducible, fills individual random X slots and never mutates options',()=>{
 const config={ruleset:'BTX',seed:743,mainPlot:'',subPlots:['factor_x',''],includeAI:true,characterPool:'all',settings:{incidentVisibility:'public'}},before=structuredClone(config);
 const a=generateScript(config),b=generateScript(config);assert.deepEqual(a,b);assert.deepEqual(config,before);
 assert.equal(a.subPlots[0],'factor_x');assert.equal(a.subPlots.length,2);assert.notEqual(a.subPlots[1],'factor_x');assert.equal(a.settings.incidentVisibility,'public');
});

test('one-day schedules support zero or one incident without duplicate days',()=>{
 for(const incidentCount of [undefined,0,1]){
  const s=generateScript({seed:12,days:1,loops:1,incidentCount});assert.deepEqual(validateScript(s).errors,[]);assert.equal(s.incidents.length,incidentCount??1);assert.ok(s.incidents.every(e=>e.day===1));
 }
});

test('generation rejects malformed and incompatible settings with useful structured errors',()=>{
 const cases=[null,[],{ruleset:'MISSING'},{ruleset:'toString'},{days:0},{days:11},{days:2.2},{days:'3'},{loops:0},{loops:9},{seed:'foo'},{seed:NaN},{seed:Infinity},{seed:Number.MAX_SAFE_INTEGER+1},{title:''},{title:'x'.repeat(121)},{mainPlot:'missing'},{mainPlot:'ripper_shadow'},{ruleset:'BTX',mainPlot:'avenger'},{ruleset:'FS',subPlots:[]},{ruleset:'BTX',subPlots:['factor_x','factor_x']},{subPlots:[null]},{subPlots:{}},{settings:null},{settings:[]},{incidentVisibility:'sometimes'},{settings:{incidentVisibility:'yes'}},{settings:{transferDay:4},days:2},{settings:{godlyLoop:2},loops:1},{settings:{bossTerritory:'moon'}},{characterPool:'expansion'},{includeAI:'yes'},{characters:['boy_student','boy_student','doctor','idol']},{characters:['missing','girl_student','doctor','idol']},{characters:['boy_student','girl_student','doctor','idol'],includeAI:true},{communication:'always'},{incidentCount:-1},{incidentCount:2,days:1},{incidentCount:1.5},{incidentCount:10,days:10,characters:starter.characters},
  {ruleset:'BTX',mainPlot:'contract',subPlots:['factor_x','threads_fate'],characters:['boy_student','police','doctor','ai_character']},
  {mainPlot:'murder_plan',subPlots:['ripper_shadow'],characters:['boy_student','girl_student','doctor','idol']}
 ];
 for(const input of cases)assert.throws(()=>generateScript(input),e=>e.code==='INVALID_SETUP'&&e.message.length>0,JSON.stringify(input));
 const invalid=structuredClone(starter);invalid.settings.incidentVisibility='sometimes';assert.ok(validateScript(invalid).errors.some(e=>e.path==='settings.incidentVisibility'));
});

test('selected public schedules reveal types but never culprits or hidden casting',()=>{
 const hidden=structuredClone(starter),published=structuredClone(starter);hidden.settings.incidentVisibility='hidden';published.settings.incidentVisibility='public';
 for(const s of [hidden,published]){
  const p=publicScript(s);assert.equal(p.roles,undefined);assert.equal(p.mainPlot,undefined);assert.equal(p.subPlots,undefined);
  assert.equal(p.incidents[0].culprit,undefined);assert.equal(p.incidents[0].type,s===published?'suicide':undefined);
  p.settings.incidentVisibility='changed';assert.notEqual(s.settings.incidentVisibility,'changed');
 }
 assert.equal(publicScript(hidden,{includeIncidentTypes:true}).incidents[0].type,'suicide');
});

test('server-side setup is independent of client-visible casting and does not mutate starter',()=>{
 const before=structuredClone(starter),s=scriptForGame({incidentVisibility:'public'});assert.equal(s.settings.incidentVisibility,'public');assert.deepEqual(starter,before);
 assert.throws(()=>scriptForGame({script:starter,setup:{}}),e=>e.code==='INVALID_SETUP');
 assert.throws(()=>scriptForGame({setup:null}),e=>e.code==='INVALID_SETUP');
 assert.throws(()=>scriptForGame({incidentVisibility:'sometimes'}),e=>e.code==='INVALID_SETUP');
 assert.ok(scriptForGame({setup:{seed:84,includeAI:true}}).characters.includes('ai_character'));
});

function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_initial.sql',import.meta.url),'utf8'));
 const wrap=(query,args=[])=>({bind(...values){return wrap(query,values);},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}});
 const DB={prepare:q=>wrap(q),async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const worker=createWorker({});
 const request=async(path,body)=>{const response=await worker.fetch(new Request('https://game.test'+path,{method:body===undefined?'GET':'POST',headers:{'oai-authenticated-user-id':'setup-owner','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB});return {status:response.status,data:await response.json()};};
 return {sql,request};
}

test('Worker creates configured games without exposing setup secrets and stores replay policy',async()=>{
 const {sql,request}=fixture();
 for(const visibility of ['hidden','public']){
  const created=await request('/api/games',{mode:'heroes',setup:{ruleset:'BTX',seed:14,days:1,loops:2,includeAI:true,incidentVisibility:visibility}});assert.equal(created.status,201);
  const g=created.data;assert.equal(g.secret,undefined);assert.equal(g.script.roles,undefined);assert.equal(g.script.mainPlot,undefined);assert.equal(g.script.days,1);assert.equal(g.script.loops,2);assert.ok(g.script.characters.includes('ai_character'));
  const stored=JSON.parse(sql.prepare('SELECT state FROM games WHERE id=?').get(g.id).state);assert.equal(stored.script.settings.incidentVisibility,visibility);assert.notEqual(stored.script.roles.ai_character,'person');
  const exported=await request('/api/games/'+g.id+'/script');assert.equal(exported.data.incidents[0].culprit,undefined);assert.equal('type' in exported.data.incidents[0],visibility==='public');
  const replay=await request('/api/games/'+g.id+'/replay');assert.equal('type' in replay.data.script.incidents[0],visibility==='public');assert.equal(replay.data.frames[0].view.secret,undefined);
 }
 const before=sql.prepare('SELECT count(*) n FROM games').get().n;
 for(const body of [{setup:{days:0}},{setup:{},script:starter},{incidentVisibility:'sometimes'}]){const result=await request('/api/games',body);assert.equal(result.status,400);assert.equal(result.data.code,'INVALID_SETUP');assert.doesNotMatch(result.data.error,/请求没有完成/);}
 assert.equal(sql.prepare('SELECT count(*) n FROM games').get().n,before);sql.close();
});

const base=process.env.TEST_URL;
test('HTTP local server accepts the same setup contract and uses the standard public schedule',{skip:!base},async()=>{
 let cookie='';const request=async(path,body)=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});cookie=response.headers.get('set-cookie')?.split(';')[0]||cookie;return {status:response.status,data:await response.json()};};
 const r=await request('/api/games',{mode:'heroes',setup:{ruleset:'BTX',seed:80,characterPool:'all',includeAI:true,days:2,loops:1,incidentCount:0,incidentVisibility:'public'}});assert.equal(r.status,201);assert.equal(r.data.script.days,2);assert.equal(r.data.secret,undefined);assert.deepEqual(r.data.script.incidents,[]);
 const traditional=await request('/api/games',{});assert.equal(traditional.status,201);assert.deepEqual(traditional.data.script.incidents,[{day:3,type:'suicide'}]);assert.equal(traditional.data.script.incidents[0].culprit,undefined);assert.equal(traditional.data.script.roles,undefined);
 const invalid=await request('/api/games',{setup:{days:0}});assert.equal(invalid.status,400);assert.equal(invalid.data.code,'INVALID_SETUP');
});

test('all 105 Midnight Zone plot combinations generate valid casts and mandatory incidents',()=>{
 const ys=catalog.plots.filter(p=>p.kind==='Y'&&p.sets.includes('MZ')),xs=catalog.plots.filter(p=>p.kind==='X'&&p.sets.includes('MZ'));let count=0;
 for(const y of ys)for(let i=0;i<xs.length;i++)for(let j=i+1;j<xs.length;j++){
  count++;
  for(let seed=0;seed<10;seed++){
   const s=generateScript({ruleset:'MZ',mainPlot:y.id,subPlots:[xs[i].id,xs[j].id],seed:count*7919+seed,characterPool:'all',includeAI:true,incidentCount:2});
   assert.deepEqual(validateScript(s).errors,[],JSON.stringify({y:y.id,x:s.subPlots,seed}));assert.notEqual(s.roles.ai_character,'person');
   for(const c of s.characters)if(s.roles[c]==='obstinate')assert.ok(s.incidents.some(e=>e.culprit===c));
   if(s.subPlots.includes('worship_apocalypse'))assert.ok(s.incidents.some(e=>e.type==='suicide'));
   if(s.mainPlot==='male_confrontation')for(const c of s.characters)if(s.roles[c]==='ninja')assert.ok(chars[c].tags.includes('male'));
  }
 }
 assert.equal(count,105);
});

test('random Midnight Zone rules respect zero/one-incident constraints instead of occasionally failing',()=>{
 for(const incidentCount of [0,1])for(let seed=0;seed<200;seed++){
  const s=generateScript({ruleset:'MZ',seed,days:1,incidentCount,characterPool:'all',includeAI:true});
  assert.deepEqual(validateScript(s).errors,[]);assert.equal(s.incidents.length,incidentCount);
 }
 for(const config of [
  {subPlots:['love_hate_spiral','dice_of_gods'],incidentCount:1},
  {subPlots:['worship_apocalypse','unsafe_trigger'],incidentCount:0},
  {mainPlot:'male_confrontation',characters:['boy_student','girl_student','ai_character','idol'],incidentCount:1}
 ])assert.throws(()=>generateScript({ruleset:'MZ',seed:19,...config}),e=>e.code==='INVALID_SETUP');
});

test('Midnight Zone validation distinguishes required real incidents, repeat murder culprits and fake display names',()=>{
 const s=generateScript({ruleset:'MZ',seed:88,mainPlot:'male_confrontation',subPlots:['love_hate_spiral','worship_apocalypse'],days:5,incidentCount:2});
 const bad=structuredClone(s),ninja=s.characters.find(c=>s.roles[c]==='ninja'),woman=s.characters.find(c=>!chars[c].tags.includes('male')&&c!=='irregular');
 [bad.roles[ninja],bad.roles[woman]]=[bad.roles[woman],bad.roles[ninja]];assert.ok(validateScript(bad).errors.some(e=>e.message.includes('忍者必须是男性')));
 const missing=structuredClone(s);missing.incidents=[];assert.ok(validateScript(missing).errors.some(e=>e.message.includes('绝对者')));assert.ok(validateScript(missing).errors.some(e=>e.message.includes('自杀事件')));
 const duplicate=generateScript({ruleset:'MZ',seed:18,mainPlot:'sealed_item',subPlots:['unsafe_trigger','unanswered_heart']});
 const culprit=duplicate.characters.find(c=>c!=='irregular');duplicate.incidents=[{day:1,type:'serial_murder',culprit},{day:2,type:'serial_murder',culprit}];assert.deepEqual(validateScript(duplicate).errors,[]);
 duplicate.incidents[1].type='missing';assert.ok(validateScript(duplicate).errors.some(e=>e.path==='incidents.1.culprit'));
 duplicate.incidents=[{day:1,type:'fake_incident',publicType:'suicide',culprit}];duplicate.settings.incidentVisibility='public';assert.deepEqual(validateScript(duplicate).errors,[]);
 assert.deepEqual(publicScript(duplicate).incidents,[{day:1,type:'suicide'}]);assert.deepEqual(publicScript(duplicate,{includeIncidentTypes:false}).incidents,[{day:1}]);
 duplicate.incidents[0].publicType='unknown';assert.ok(validateScript(duplicate).errors.some(e=>e.path==='incidents.0.publicType'));
 duplicate.incidents[0]={day:1,type:'missing',publicType:'suicide',culprit};assert.ok(validateScript(duplicate).errors.some(e=>e.path==='incidents.0.publicType'));
});


test('random cast expands when a long schedule needs more distinct culprits',()=>{
 for(const ruleset of ['FS','BTX','MZ']){
  const s=generateScript({ruleset,seed:940,days:10,incidentCount:10,includeAI:true});
  assert.equal(s.incidents.length,10);assert.ok(s.characters.length>=10);assert.deepEqual(validateScript(s).errors,[]);
 }
});


test('Fake Incident aliases are optional by rule but malformed declared aliases cannot reveal the real type',()=>{
 const script=generateScript({ruleset:'MZ',seed:18,mainPlot:'sealed_item',subPlots:['unsafe_trigger','unanswered_heart'],incidentVisibility:'public'});
 const culprit=script.characters.find(c=>c!=='irregular');
 script.incidents=[{day:1,type:'fake_incident',culprit}];
 assert.deepEqual(validateScript(script).errors,[]);
 assert.deepEqual(publicScript(script).incidents,[{day:1,type:'fake_incident'}]);
 for(const publicType of ['unknown','fake_incident','__proto__',null,0,[],['suicide'],{}]){
  script.incidents[0].publicType=publicType;
  assert.ok(validateScript(script).errors.some(e=>e.path==='incidents.0.publicType'),JSON.stringify(publicType));
  assert.deepEqual(publicScript(script).incidents,[{day:1}],JSON.stringify(publicType));
 }
 script.incidents[0].publicType='murder';
 assert.deepEqual(validateScript(script).errors,[]);
 assert.deepEqual(publicScript(script).incidents,[{day:1,type:'murder'}]);
 script.incidents[0]={day:1,type:['suicide'],culprit};
 assert.ok(validateScript(script).errors.some(e=>e.path==='incidents.0.type'));
 assert.deepEqual(publicScript(script).incidents,[{day:1}]);
});

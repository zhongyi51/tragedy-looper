import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {catalog,starter} from '../src/content.mjs';
import {createGame,view} from '../src/engine.mjs';
import {setCatalog} from '../public/js/lookup.mjs';
import {offlineReplayHtml} from '../public/js/exporters.mjs';

setCatalog(catalog);
const scriptOf=html=>html.match(/<script>([\s\S]*)<\/script>/)[1];
test('offline replay HTML contains valid standalone script and escapes script terminators',()=>{
 const result=offlineReplayHtml({frames:[{view:{script:{title:'</script><img src=x>'},board:{},log:[]}}]});
 assert.doesNotThrow(()=>new vm.Script(scriptOf(result)));assert.equal((result.match(/<\/script>/g)||[]).length,1);assert.ok(!result.includes('<img src=x>'));
});
test('offline replay runs independently and preserves standard event names without secret answers',()=>{
 for(const visibility of ['public','hidden']){
  const script={...structuredClone(starter),settings:{incidentVisibility:visibility}};
  const v=view(createGame(script),'public');v.script.incidents=structuredClone(script.incidents);
  const html=offlineReplayHtml({perspective:'public',script,frames:[{view:v}]});
  for(const e of script.incidents)assert.equal(html.includes('"type":"'+e.type+'"'),visibility==='public');
  for(const privateField of ['"culprit":','"roles":','"mainPlot":','"subPlots":','"secret":'])assert.ok(!html.includes(privateField),privateField);
  assert.match(html,/<p id="conditions"><\/p>/,'the standalone artifact contains the new conditions node');
  const el=()=>({textContent:'',className:'',replaceChildren(){},append(){},insertRow(){return el();},insertCell(){return el();}}),nodes=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,el()]));
  vm.runInNewContext(scriptOf(html),{document:{getElementById:id=>nodes[id],createElement:el}});
  assert.match(nodes.phase.textContent,new RegExp(starter.title));assert.equal(nodes.range.max,0);assert.equal(nodes.conditions.textContent,'');
 }
});

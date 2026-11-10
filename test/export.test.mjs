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
test('offline replay runs on its own and never carries the answers of a public export',()=>{
 const v=view(createGame(starter),'public');v.script.incidents=structuredClone(starter.incidents);
 const html=offlineReplayHtml({perspective:'public',script:structuredClone(starter),frames:[{view:v}]});
 for(const e of starter.incidents)assert.ok(!html.includes(e.type));
 const el=()=>({textContent:'',className:'',replaceChildren(){},append(){},insertRow(){return el();},insertCell(){return el();}}),nodes={range:{},phase:el(),board:el(),log:el()};
 vm.runInNewContext(scriptOf(html),{document:{getElementById:id=>nodes[id],createElement:el}});
 assert.match(nodes.phase.textContent,new RegExp(starter.title));assert.equal(nodes.range.max,0);
});

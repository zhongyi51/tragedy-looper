import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {sanitizePublicReplay} from '../public/replay-validation.mjs';
test('offline replay HTML contains valid standalone script and escapes script terminators',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');const fn=source.slice(source.indexOf('function offlineReplay()'),source.indexOf("document.addEventListener('input'"));let result;
 const replay={frames:[{view:{script:{title:'</script><img src=x>'},board:{},log:[]}}]};
 vm.runInNewContext(fn+';offlineReplay();',{replay,sanitizePublicReplay,download:html=>result=html});
 const code=result.match(/<script>([\s\S]*)<\/script>/)[1];assert.doesNotThrow(()=>new vm.Script(code));assert.equal((result.match(/<\/script>/g)||[]).length,1);assert.ok(!result.includes('<img src=x>'));
});

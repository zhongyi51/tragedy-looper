import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from '../src/content.mjs';
const inSet=items=>items.filter(item=>item.sets.includes('MZ'));

test('Midnight Zone catalog includes the complete official plot, role and incident lists',()=>{
 assert.equal(catalog.sets.find(s=>s.id==='MZ').subPlots,2);
 assert.equal(catalog.sets.find(s=>s.id==='MZ').finalGuess,true);
 assert.equal(inSet(catalog.plots).filter(p=>p.kind==='Y').length,5);
 assert.equal(inSet(catalog.plots).filter(p=>p.kind==='X').length,7);
 assert.equal(inSet(catalog.roles).length,14); // thirteen secret roles and Person
 assert.equal(inSet(catalog.incidents).length,11);
 for(const p of inSet(catalog.plots))for(const id of Object.keys(p.addedRoles))assert.ok(inSet(catalog.roles).some(r=>r.id===id),`${p.id} requires unavailable ${id}`);
});

test('MZ preserves the official special counts and distinct incident effects',()=>{
 const plots=Object.fromEntries(catalog.plots.map(p=>[p.id,p]));
 const roles=Object.fromEntries(catalog.roles.map(r=>[r.id,r]));
 const events=Object.fromEntries(catalog.incidents.map(e=>[e.id,e]));
 assert.deepEqual(plots.witches_tea_time.addedRoles,{friend:1,misleader:1,witch:2});
 assert.equal(roles.misleader.maxCount,1);
 assert.equal(roles.friend.maxCount,2);
 assert.equal(roles.ninja.goodwillRefusal,'optional');
 assert.equal(roles.obstinate.goodwillRefusal,'mandatory');
 assert.equal(events.breakthrough.defaultChooser,'leader');
 assert.equal(events.serial_murder.repeatCulprit,true);
 assert.equal(events.conspiracies.triggerCounter,'intrigue');
 assert.equal(events.fake_incident.allowsPublicType,true);
 assert.ok(!events.murder.sets.includes('MZ'));
});

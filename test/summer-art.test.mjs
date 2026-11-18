import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {catalog} from '../src/content.mjs';
import {char,setCatalog} from '../public/js/lookup.mjs';

test('each summer skin has a board avatar and full portrait, and switching back restores the originals',()=>{
 setCatalog(catalog,'summer');
 const paths=new Set();
 for(const original of catalog.characters){
  const skin=char(original.id);
  assert.equal(skin.card,skin.portrait);
  for(const asset of [skin.avatar,skin.portrait]){
   assert.ok(!paths.has(asset),asset);paths.add(asset);
   const file=readFileSync(new URL('../public/'+asset,import.meta.url));
   assert.equal(file.toString('ascii',0,4),'RIFF');
   assert.equal(file.toString('ascii',8,12),'WEBP');
  }
 }
 setCatalog(catalog);
 for(const original of catalog.characters){
  assert.equal(char(original.id).avatar,original.portrait);
  assert.equal(char(original.id).card,original.card);
 }
});

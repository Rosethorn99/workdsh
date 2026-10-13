import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {sharedProfileFeatures} from '../../scripts/shared-profile-features.mjs';

test('Web preview resolves every shared feature from its own workspace',async()=>{
 const plan=await sharedProfileFeatures();
 const webRoot=new URL('../../',import.meta.url);
 assert.ok(plan.features.some(feature=>feature.name==='workdsh-plugin-experts'));
 for(const feature of plan.features){
  const manifest=JSON.parse(await readFile(new URL(feature.directory+'/package.json',webRoot),'utf8'));
  assert.equal(manifest.name,feature.name);
 }
});

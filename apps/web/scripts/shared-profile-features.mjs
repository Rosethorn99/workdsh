import {readFile} from 'node:fs/promises';
const repositoryRoot=new URL('../../../',import.meta.url);
export async function sharedProfileFeatures(){
 const plan=JSON.parse(await readFile(new URL('profiles/shared/workdsh-features.json',repositoryRoot),'utf8'));
 const names=new Set();
 for(const feature of plan.features){
  if(names.has(feature.name))throw Error('Duplicate shared feature '+feature.name);
  names.add(feature.name);
  const manifest=JSON.parse(await readFile(new URL(feature.directory+'/package.json',repositoryRoot),'utf8'));
  if(manifest.name!==feature.name)throw Error('Shared feature package mismatch '+feature.name);
 }
 // The shared manifest is repository-relative; Web installers resolve from apps/web.
 return {...plan,features:plan.features.map(feature=>({...feature,directory:'../../'+feature.directory}))};
}

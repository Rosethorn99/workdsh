import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkflowEditor} from '../../../../packages/plugins/experts/dist/workflows/editor-service.js';
import {patchYaml} from '../../../../packages/plugins/experts/dist/workflows/authoring.js';
const actor={principalId:'owner',organizationId:'personal',requestId:'automatic-test',resolvedBy:'fixture'};
async function fixture(nodes){
  const home=await mkdtemp(join(tmpdir(),'workflow-automatic-')),sessions=new Map(),prompts=[],accepted=new Set();let failAck=false,identity=actor;
  const ctx={workdshIdentity:{resolve:async()=>identity},workdshAccess:{authorize:async({actor,owner})=>({effect:actor.principalId===owner.ownerPrincipalId&&actor.organizationId===owner.organizationId?'allow':'deny'})},workdshAudit:{append:async()=>{}},agentPresets:{register:async()=>()=>{}},
    workdshSessionAccess:{create:async r=>{sessions.set(r.sessionId,{meta:{...r,cwd:home},events:[]});return{sessionId:r.sessionId};},inspect:async id=>sessions.get(id)},
    sessionController:{cancel:r=>sessions.get(r.sessionId).events.push({type:'turn/end',data:{reason:{kind:'interrupted'}}}),prompt:async r=>{if(!accepted.has(r.requestId)){accepted.add(r.requestId);prompts.push(r);sessions.get(r.sessionId).events.push({type:'user/message',data:{source:{kind:'user',rpcId:r.requestId}}},{type:'turn/start',data:{}});}if(failAck){failAck=false;throw new Error('fixture acknowledgement lost');}return{accepted:true};}}
  };
  let editor=await WorkflowEditor.open(ctx,home);
  const call=(action,v={})=>editor.dispatch(identity,{action,operationId:randomUUID(),...v},new AbortController().signal);
  let detail=await call('copy',{workflowId:'workdsh-ai-webapp'}),text=detail.draft.files['workflow.yaml'].content;
  for(const[k,v]of Object.entries({mode:'staged',start:nodes[0].id,stages:nodes}))text=patchYaml(text,[k],v);
  detail=await call('save',{workflowId:detail.draft.id,expectedRevision:detail.draft.revision,patches:{'workflow.yaml':{encoding:'utf8',content:text}}});detail=await call('trial',{workflowId:detail.draft.id,expectedRevision:detail.draft.revision});
  const created=await call('create',{workflowId:detail.draft.id,revisionId:detail.revisions.at(-1).id,workspaceId:'fixture',sessionId:randomUUID(),automatic:true,input:'Build my application'});
  const run=async()=> (await call('runs',{workflowId:detail.draft.id}))[0];
  return{home,sessions,prompts,call,run,created,async pump(n=1){for(let i=0;i<n;i++)await editor.pumpAutomatic();},async finish(file){const r=await run();await writeFile(join(home,file),'Output '+randomUUID());sessions.get(r.sessionId).events.push({type:'turn/end',data:{reason:{kind:'completed'}}});},loseAck(){failAck=true;},other(){identity={...actor,principalId:'other'};},async restart(){await editor.dispose();editor=await WorkflowEditor.open(ctx,home);},async close(){await editor.dispose();await rm(home,{recursive:true,force:true});}};
}
const task=(id,next,inputs)=>({id,name:id,kind:'task',prompt:'Write the requested deliverable',outputs:[id+'.md'],next,inputs});
const end={id:'done',name:'done',kind:'end'};
const act=async(f,action,extra={})=>{const r=await f.run();return f.call(action,{workflowId:r.workflowId,runId:r.id,expectedRunRevision:r.revision,...extra});};
test('one click advances native task sessions and real files, stops at approval, continues after approval',async()=>{
  const f=await fixture([task('first','second'),task('second','review',['first.md']),{id:'review',name:'Review',kind:'approval',next:'third'},task('third','done',['second.md']),end]);
  try{await f.pump(2);assert.equal(f.prompts.length,1);assert.match(f.prompts[0].content[0].text,/Build my application/);await f.finish('first.md');await f.pump(3);assert.equal(f.prompts.length,2);assert.equal((await f.run()).current,'second');await f.finish('second.md');await f.pump(3);assert.equal((await f.run()).status,'awaiting-approval');assert.equal(f.prompts.length,2);await act(f,'run-approve',{approve:true});await f.pump(2);assert.equal(f.prompts.length,3);await f.finish('third.md');await f.pump();const r=await f.run();assert.equal(r.status,'completed');assert.equal(r.receipts.filter(r=>r.files).length,3);}finally{await f.close();}
});
test('pending submission survives restart with the same native correlation ID and one accepted prompt',async()=>{
  const f=await fixture([task('first','done'),end]);
  try{await f.pump();const requestId=(await f.run()).automation.submission.requestId;await f.restart();await f.pump(2);assert.equal(f.prompts.length,1);assert.equal(f.prompts[0].requestId,requestId);await f.restart();await f.pump(3);assert.equal(f.prompts.length,1);}finally{await f.close();}
});
test('lost acknowledgement and failed file checks stop execution; explicit retry does not duplicate native submission',async()=>{
  const f=await fixture([task('first','done'),end]);
  try{f.loseAck();await f.pump(2);assert.equal((await f.run()).status,'failed');await f.pump(2);assert.equal(f.prompts.length,1);await act(f,'run-continue');await f.pump();assert.equal(f.prompts.length,1);f.sessions.get((await f.run()).sessionId).events.push({type:'turn/end',data:{reason:{kind:'completed'}}});await f.pump();assert.equal((await f.run()).status,'failed');assert.match((await f.run()).error,/ENOENT/);}finally{await f.close();}
});
test('pause prevents pending delivery and a different Host identity cannot auto-submit another owner run',async()=>{
  const f=await fixture([task('first','done'),end]);
  try{await f.pump();await act(f,'run-pause');await f.pump(3);assert.equal(f.prompts.length,0);await act(f,'run-resume');f.other();await f.pump(3);assert.equal(f.prompts.length,0);}finally{await f.close();}
});

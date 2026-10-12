import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { compareCondition, validateCondition } from '../../../../packages/plugins/experts/dist/workflows/conditions.js';
import { evaluateCondition } from '../../../../packages/plugins/experts/dist/workflows/condition-runtime.js';
import { readManifest, patchYaml, presetDocument } from '../../../../packages/plugins/experts/dist/workflows/authoring.js';
import { editCanvas } from '../../../../packages/plugins/experts/dist/workflows/canvas-operations.js';
import { WorkflowEditor } from '../../../../packages/plugins/experts/dist/workflows/editor-service.js';

const condition=(values={})=>({source:'literal',input:'Approved',operator:'equals',match:'approved',caseSensitive:false,...values});
const signal=()=>new AbortController().signal;
test('If-else string and numeric branches have explicit comparison semantics',()=>{
  assert.equal(compareCondition(condition(),'Approved'),true);
  assert.equal(compareCondition(condition({caseSensitive:true}),'Approved'),false);
  for (const [operator,input,match,expected] of [
    ['notEquals','yes','no',true],['contains','a RESULT z','result',true],
    ['startsWith','Approved now','approved',true],['endsWith','now Approved','approved',true],
    ['greaterThan','11','10',true],['lessThan','11','10',false]
  ]) assert.equal(compareCondition(condition({operator,match}),input),expected);
  assert.throws(()=>compareCondition(condition({operator:'greaterThan',match:'3'}),'text'),/有效数字/);
  assert.throws(()=>validateCondition(condition({operator:'eval',match:'process.exit()'})),/参数无效/);
  assert.throws(()=>validateCondition(condition({source:'file',input:'../outside.md'})),/路径/);
});
test('file conditions read the authorized UTF-8 content and store a reproducible SHA-256 receipt',async()=>{
  const home=await mkdtemp(join(tmpdir(),'lf-condition-'));
  try {
    await mkdir(join(home,'docs'));const bytes=Buffer.from('Approved\n确认');
    await writeFile(join(home,'docs','result.md'),bytes);
    const value=await evaluateCondition(condition({source:'file',input:'docs/result.md',operator:'contains',match:'确认'}),home,signal());
    assert.equal(value.decision,true);assert.equal(value.files['docs/result.md'],createHash('sha256').update(bytes).digest('hex'));
    await writeFile(join(home,'docs','invalid.md'),Buffer.from([255]));
    await assert.rejects(evaluateCondition(condition({source:'file',input:'docs/invalid.md'}),home,signal()));
    await writeFile(join(home,'docs','large.md'),Buffer.alloc(1024*1024+1,65));
    await assert.rejects(evaluateCondition(condition({source:'file',input:'docs/large.md'}),home,signal()),/1 MiB/);
    const aborted=new AbortController();aborted.abort();await assert.rejects(evaluateCondition(condition(),home,aborted.signal));
  } finally { await rm(home,{recursive:true,force:true}); }
});
test('file conditions refuse links out of the authorized workspace',async()=>{
  const home=await mkdtemp(join(tmpdir(),'lf-link-')),outside=await mkdtemp(join(tmpdir(),'lf-outside-'));
  try {
    await writeFile(join(outside,'secret.md'),'other workspace');
    await symlink(outside,join(home,'external'),'junction');
    await assert.rejects(evaluateCondition(condition({source:'file',input:'external/secret.md'}),home,signal()),/链接|工作区/);
  } finally { await rm(home,{recursive:true,force:true});await rm(outside,{recursive:true,force:true}); }
});
const stages=()=>[
  {id:'first',name:'First',kind:'task',component:'write-file',prompt:'Write result',outputs:['result.md'],next:'choice'},
  {id:'choice',name:'Choice',kind:'branch',condition:condition({source:'file',input:'result.md',operator:'contains',match:'approved'}),whenTrue:'yes',whenFalse:'no'},
  {id:'yes',name:'Yes',kind:'end'},{id:'no',name:'No',kind:'end'}
];
const manifest=()=>({format:'workdsh-workflow',version:5,name:'Langflow adapter',description:'',mode:'staged',sourceId:'fufan-ai-webapp',entry:'preset/agent.cordis.yml',start:'first',stages:stages()});
const yaml=m=>{let text='{}';for(const[k,v]of Object.entries(m))text=patchYaml(text,[k],v);return text;};
test('v5 preserves the existing graph contract while old schemas refuse unsupported conditions',()=>{
  assert.deepEqual(readManifest({'workflow.yaml':{encoding:'utf8',content:yaml(manifest())}}).stages,stages());
  const old=manifest();old.version=4;
  assert.throws(()=>readManifest({'workflow.yaml':{encoding:'utf8',content:yaml(old)}}),/version: 5/);
  const cycle=manifest();cycle.stages[1].whenTrue='first';
  assert.throws(()=>readManifest({'workflow.yaml':{encoding:'utf8',content:yaml(cycle)}}),/循环/);
});
test('copying a file producer with its If-else remaps the input and leaves original data and YAML comments intact',()=>{
  const text='# user annotation\n'+yaml(manifest());
  const value=presetDocument(editCanvas(text,{type:'duplicate',ids:['first','choice'],copies:{first:'copy-first',choice:'copy-choice'}}).text).toJS();
  assert.equal(value.stages[4].component,'write-file');
  assert.equal(value.stages[4].next,'copy-choice');
  assert.equal(value.stages[5].condition.input,value.stages[4].outputs[0]);
  assert.equal(value.stages[1].condition.input,'result.md');
  assert.equal(value.stages[5].whenTrue,undefined);
  assert.match(editCanvas(text,{type:'duplicate',ids:['first'],copies:{first:'copy-first'}}).text,/# user annotation/);
});
const actor={principalId:'lf-owner',organizationId:'personal',requestId:'lf-test',resolvedBy:'fixture'};
async function runtimeFixture() {
  const home=await mkdtemp(join(tmpdir(),'lf-runtime-')),sessions=new Map(),prompts=[];
  const ctx={workdshIdentity:{resolve:async()=>actor},workdshAccess:{authorize:async()=>({effect:'allow'})},workdshAudit:{append:async()=>{}},agentPresets:{register:async()=>()=>{}},
    workdshSessionAccess:{create:async request=>{sessions.set(request.sessionId,{meta:{...request,cwd:home},events:[]});return {sessionId:request.sessionId};},inspect:async id=>sessions.get(id)},
    sessionController:{prompt:async request=>{prompts.push(request);sessions.get(request.sessionId).events.push({type:'user/message',data:{source:{kind:'user',rpcId:request.requestId}}},{type:'turn/start',data:{}});return {accepted:true};}}
  };
  const editor=await WorkflowEditor.open(ctx,home);
  const call=(action,extra={})=>editor.dispatch(actor,{action,operationId:randomUUID(),...extra},signal());
  let detail=await call('copy',{workflowId:'workdsh-ai-webapp'}),text=detail.draft.files['workflow.yaml'].content;
  for (const[k,v]of Object.entries({version:5,mode:'staged',start:'first',stages:stages()}))text=patchYaml(text,[k],v);
  detail=await call('save',{workflowId:detail.draft.id,expectedRevision:detail.draft.revision,patches:{'workflow.yaml':{encoding:'utf8',content:text}}});
  detail=await call('trial',{workflowId:detail.draft.id,expectedRevision:detail.draft.revision});
  await call('create',{workflowId:detail.draft.id,revisionId:detail.revisions.at(-1).id,workspaceId:'fixture',sessionId:randomUUID(),automatic:true,input:'Write approved result'});
  const run=async()=>(await call('runs',{workflowId:detail.draft.id}))[0];
  return {home,editor,run,sessions,prompts,detail,async close(){await editor.dispose();await rm(home,{recursive:true,force:true});}};
}
for(const decision of [true,false])test('native task receipt advances the '+(decision?'true':'false')+' branch of the frozen workflow',async()=>{
  const f=await runtimeFixture();
  try {
    await f.editor.pumpAutomatic();await f.editor.pumpAutomatic();assert.equal(f.prompts.length,1);
    const r=await f.run(),bytes=decision?'approved result':'rejected result';
    await writeFile(join(f.home,'result.md'),bytes);f.sessions.get(r.sessionId).events.push({type:'turn/end',data:{reason:{kind:'completed'}}});
    await f.editor.pumpAutomatic();
    const done=await f.run();assert.equal(done.status,'completed');assert.equal(done.current,decision?'yes':'no');
    const receipt=done.receipts.find(r=>r.stageId==='choice');assert.equal(receipt.decision,decision);assert.equal(receipt.files['result.md'],createHash('sha256').update(bytes).digest('hex'));assert.equal(f.prompts.length,1);
  } finally { await f.close(); }
});
test('Langflow upstream sources are pinned, intact, and accompanied by the MIT license',async()=>{
  const root=new URL('../../../../packages/plugins/experts/resources/langflow/',import.meta.url);
  const source=JSON.parse(await readFile(new URL('source-manifest.json',root),'utf8'));
  assert.match(source.commit,/^[a-f0-9]{40}$/);assert.equal(source.tag,'v1.12.5');
  for (const file of source.files)assert.equal(createHash('sha256').update(await readFile(new URL('upstream/'+file.path,root))).digest('hex'),file.sha256,file.path);
  assert.match(await readFile(new URL('LICENSE',root),'utf8'),/MIT License/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { WorkflowEditor } from '../../../../packages/plugins/experts/dist/workflows/editor-service.js';
import { patchYaml, readManifest, pluginRows } from '../../../../packages/plugins/experts/dist/workflows/authoring.js';
import { remapWorkflowConnector, remapStageConnector } from '../../../../packages/plugins/experts/dist/workflows/connector-mapping.js';
const actor={principalId:'author',organizationId:'personal',requestId:'test',resolvedBy:'fixture'},signal=new AbortController().signal;
async function fixture(){
  const home=await mkdtemp(join(tmpdir(),'workdsh-capabilities-')),presets=new Map(),sessions=new Map(),selections=new Map(),calls=[],retained=[],models=[];
  const skill={skillId:'extra',name:'extra',revisionId:'skill-1',contentDigest:'a'.repeat(64)},skillDir=join(home,'extra');await mkdir(skillDir);await writeFile(join(skillDir,'SKILL.md'),'---\nname: extra\ndescription: Extra skill\n---\nComplete extra skill body');
  let skillState='intact',connectorState='ready',expertAvailable=true;
  const experts=new Map(['architect','team','member'].map(id=>[id,{revision:{expertId:id,revisionId:id+'-1',compositionDigest:id+'-digest',dependencyLock:[],definition:{name:id,description:'complete '+id,team:id==='team'?{members:[]}:undefined},teamMembers:id==='team'?{reviewer:{expertId:'member',revisionId:'member-1'}}:undefined},preset:{id:'wd-exp-'+id,plugins:[{id:'persona',name:'@deepseek-ai/dsh-persona',config:{prefix:'Complete published '+id+' persona'}},{id:'skills',name:'@deepseek-ai/dsh-skill-filesystem',config:{includeDefaultRoots:false,customSkillDirs:[]}}]}}]));
  const connectors={list:async()=>[{id:'local-connector',serverName:'example',title:'Example',state:connectorState,enabled:true,toolNames:['mcp__example__read']}],setSelection:async(id,ids)=>{selections.set(id,ids);return ids;},selection:async id=>selections.get(id)??[]};
  const ctx={
    reflect:{get:name=>name==='workdshConnectors'?connectors:undefined},
    workdshIdentity:{resolve:async()=>actor},workdshAccess:{authorize:async({actor:who,owner})=>({effect:who.principalId===owner.ownerPrincipalId&&who.organizationId===owner.organizationId?'allow':'deny'})},workdshAudit:{append:async()=>{}},credentials:{describe:async()=>({configured:true})},
    workdshExperts:{resolveWorkflowRevision:async(who,ref)=>{assert.equal(who.principalId,'author');if(!expertAvailable)throw Error('expert disabled');const e=experts.get(ref.expertId);if(!e||e.revision.revisionId!==ref.revisionId)throw Error('revision not found');return structuredClone(e);}},
    workdshSkills:{resolveRevision:async id=>({...skill,skillId:id,name:id}),checkRevision:async ref=>({ref,status:skillState,snapshotDir:skillDir}),retainRevision:async(ref,consumer)=>{retained.push({ref,consumer});return{ref,snapshotDir:skillDir};}},
    agentPresets:{register:async preset=>{presets.set(preset.id,preset);return()=>presets.delete(preset.id);}},sessionController:{selectModel:async request=>models.push(request),cancel:()=>{}},
    workdshSessionAccess:{create:async request=>{calls.push(request);sessions.set(request.sessionId,{meta:{...request,cwd:home},events:[]});return{sessionId:request.sessionId};},inspect:async id=>sessions.get(id)},
  };
  const editor=await WorkflowEditor.open(ctx,home),call=(action,payload={})=>editor.dispatch(actor,{action,operationId:randomUUID(),...payload},signal);
  async function draft(execution,defaults){let d=await call('copy',{workflowId:'workdsh-ai-webapp'});let text=d.draft.files['workflow.yaml'].content;for(const [path,value] of [[['version'],execution?.team?3:2],[['mode'],'staged'],[['start'],'first'],[['stages'],[{id:'first',name:'first',kind:'task',prompt:'Deliver the scoped result.',outputs:['first.md'],next:'second',execution},{id:'second',name:'second',kind:'task',prompt:'Deliver the next result.',outputs:['second.md'],next:'done',execution:{executor:{kind:'workflow'},connectors:{mode:'explicit',requirements:[]}}},{id:'done',name:'done',kind:'end'}]]])text=patchYaml(text,path,value);if(defaults)text=patchYaml(text,['execution'],defaults);return call('save',{workflowId:d.draft.id,expectedRevision:d.draft.revision,patches:{'workflow.yaml':{encoding:'utf8',content:text}}});}
  return{home,ctx,editor,call,draft,presets,sessions,selections,calls,skill,retained,models,experts,async dispose(){await editor.dispose();await rm(home,{recursive:true,force:true});},disableExpert(){expertAvailable=false;},offline(){connectorState='offline';},online(){connectorState='ready';},disableSkill(){skillState='source-disabled';}};
}
test('stage expert, frozen Skill and connector are applied to real native Session creation and isolated across stages',async()=>{
  const f=await fixture();try{
    let d=await f.draft({executor:{kind:'expert',expertId:'architect',revisionId:'architect-1'},skills:[f.skill],connectors:{mode:'explicit',requirements:[{serverName:'example',required:true}]},model:{provider:'configured',model:'chosen'}});
    d=await f.call('publish',{workflowId:d.draft.id,expectedRevision:d.draft.revision});const created=await f.call('create',{workflowId:d.draft.id,sessionId:randomUUID(),workspaceId:'workspace'});
    let run=(await f.call('runs',{workflowId:d.draft.id}))[0];const preset=f.presets.get(created.presetId),persona=preset.plugins.find(p=>p.name==='@deepseek-ai/dsh-persona').config.prefix;
    assert.ok(persona.includes('Complete published architect persona'));assert.ok(persona.includes('Deliver the scoped result.'));assert.ok(persona.includes(pluginRows(d.draft.files['preset/agent.cordis.yml'].content).find(r=>r.row.name==='@deepseek-ai/dsh-persona').row.config.text),'complete upstream persona retained');
    assert.ok(preset.plugins.find(p=>p.name==='@deepseek-ai/dsh-skill-filesystem').config.customSkillDirs.some(p=>p===join(f.home,'extra')));assert.ok(f.retained.length);assert.deepEqual(f.selections.get(created.sessionId),['local-connector']);assert.equal(f.models[0].model,'chosen');
    const lock=JSON.parse(await readFile(join(f.editor.root,d.draft.id,created.revisionId,'dependency-lock.json'),'utf8'));assert.equal(lock.stageCapabilities.first.executor.revisionId,'architect-1');
    const agent={id:run.sessionId,session:{header:{agentPreset:created.presetId}}};await f.editor.admit(agent,signal,false);
    f.selections.set(run.sessionId,[]);await assert.rejects(f.editor.admit(agent,signal,false),/连接器选择已变化/);f.selections.set(run.sessionId,['local-connector']);
    await writeFile(join(f.home,'first.md'),'fresh first output');f.sessions.get(run.sessionId).events.push({type:'turn/end',data:{reason:{kind:'completed'}}});
    run=await f.call('run-continue',{workflowId:d.draft.id,runId:run.id,expectedRunRevision:run.revision});assert.equal(run.current,'second');assert.deepEqual(f.selections.get(run.sessionId),[]);assert.equal(run.capabilities.executor,undefined);
  }finally{await f.dispose();}
});
test('expert Team role stays bound to frozen members and inherits stage context and Skill roots',async()=>{
  const f=await fixture();try{
    let d=await f.draft({executor:{kind:'team',expertId:'team',revisionId:'team-1'},skills:[f.skill]});d=await f.call('publish',{workflowId:d.draft.id,expectedRevision:d.draft.revision});const created=await f.call('create',{workflowId:d.draft.id,sessionId:randomUUID(),workspaceId:'workspace'});
    const root=await f.editor.resolveNativeRole(actor,created.sessionId,undefined,signal),member=await f.editor.resolveNativeRole(actor,created.sessionId,'reviewer',signal);assert.equal(root.revision.expertId,'team');assert.equal(member.revision.expertId,'member');assert.ok(member.persona.prefix.includes('Complete published member persona'));assert.ok(member.persona.prefix.includes('Deliver the scoped result.'));assert.ok(!member.persona.prefix.includes('Complete published team persona'));assert.ok(member.skills.customSkillDirs.includes(join(f.home,'extra')));
    await assert.rejects(f.editor.resolveNativeRole(actor,created.sessionId,'unknown',signal),/成员不在/);f.disableExpert();await assert.rejects(f.editor.resolveNativeRole(actor,created.sessionId,'reviewer',signal),/disabled/);
  }finally{await f.dispose();}
});
test('missing capabilities block execution; inherited defaults and explicit empty connector set stay distinct',async()=>{
  const f=await fixture();try{
    let d=await f.draft({}, {executor:{kind:'expert',expertId:'architect',revisionId:'architect-1'},connectors:{mode:'explicit',requirements:[{serverName:'example',required:true}]}});d=await f.call('publish',{workflowId:d.draft.id,expectedRevision:d.draft.revision});f.offline();const created=await f.call('create',{workflowId:d.draft.id,sessionId:randomUUID(),workspaceId:'workspace'});let run=(await f.call('runs',{workflowId:d.draft.id}))[0];assert.equal(run.status,'active');assert.equal(run.phase,'needs-capability');assert.match(run.error,/尚未就绪/);await assert.rejects(f.editor.admit({id:created.sessionId,session:{header:{agentPreset:created.presetId}}},signal,false),/尚未就绪/);f.online();run=await f.call('run-continue',{workflowId:d.draft.id,runId:run.id,expectedRunRevision:run.revision});assert.equal(run.phase,'ready');assert.equal(run.sessionId,created.sessionId);assert.deepEqual(f.selections.get(run.sessionId),['local-connector']);
    d=await f.draft({skills:[f.skill]});f.disableSkill();const validation=await f.call('validate',{workflowId:d.draft.id,expectedRevision:d.draft.revision});assert.equal(validation.ok,false);assert.ok(validation.issues.some(i=>i.stageId==='first'&&i.field==='execution'));await assert.rejects(f.call('publish',{workflowId:d.draft.id,expectedRevision:d.draft.revision}),{code:'workflows/invalid-draft'});
  }finally{await f.dispose();}
});
test('version one cannot silently carry stage capabilities and invalid Skill references are rejected',()=>{
  const files={'workflow.yaml':{encoding:'utf8',content:`format: workdsh-workflow\nversion: 1\nname: x\ndescription: ''\nsourceId: x\nentry: preset/agent.cordis.yml\nmode: compatible\nexecution: {executor: {kind: workflow}}\n`}};assert.throws(()=>readManifest(files),/version: 2/);
});

test('selecting a file Skill freezes its first snapshot before admitting the revision',async()=>{
 const f=await fixture();try{const d=await f.draft({});const ref=await f.call('skill-revision',{workflowId:d.draft.id,skillId:'extra'});assert.equal(ref.skillId,'extra');assert.ok(f.retained.some(r=>r.consumer.id===d.draft.id+'/draft'));}finally{await f.dispose();}
});

test('publication reports every missing connector and preserves real validation statistics without creating a revision',async()=>{
 const f=await fixture();try{
  const d=await f.draft({executor:{kind:'expert',expertId:'architect',revisionId:'architect-1'},skills:[f.skill],connectors:{mode:'explicit',requirements:[{serverName:'unmapped-yiform',required:true},{serverName:'unmapped-dbx',required:true}]}});
  let expensiveChecks=0;f.ctx.workdshExperts.resolveWorkflowRevision=async()=>{expensiveChecks++;throw new Error('Should not verify files before missing mappings');};
  const validation=await f.call('validate',{workflowId:d.draft.id,expectedRevision:d.draft.revision});
  assert.equal(validation.ok,false);
  assert.deepEqual(validation.issues.filter(i=>i.stageId==='first').map(i=>i.connectorName),['unmapped-yiform','unmapped-dbx']);
  assert.ok(validation.plugins>0); assert.ok(validation.skills.length>0);
  const before=await readFile(join(f.editor.root,'state.json'),'utf8');
  await assert.rejects(f.call('publish',{workflowId:d.draft.id,expectedRevision:d.draft.revision}),error=>{
   assert.equal(error.code,'workflows/invalid-draft'); assert.deepEqual(error.details.validation,validation); return true;
  });
  assert.equal(await readFile(join(f.editor.root,'state.json'),'utf8'),before);
  assert.equal(f.presets.size,0); assert.equal(f.calls.length,0);
  assert.equal(expensiveChecks,0,'missing mappings are reported before repeated expert/Skill file verification');
 }finally{await f.dispose();}
});

test('connector mapping preserves graph, gates and comments while updating default, stage and Team scopes',()=>{
 const text=`# Keep the workflow header
format: workdsh-workflow
version: 4
name: Mapping
description: unmapped-yiform in documentation must remain
sourceId: custom
entry: preset/agent.cordis.yml
mode: staged
start: first
execution:
  connectors:
    mode: explicit
    requirements:
      - serverName: actual # Keep this binding comment
        required: false
      - serverName: unmapped-yiform
        required: true
stages:
  - id: first
    name: First
    kind: task
    prompt: 'Call unmapped-yiform only after mapping.'
    outputs: [first.md]
    next: done
    gate: {kind: app-gen, step: 0, context: context.json}
    execution:
      executor: {kind: team, expertId: team, revisionId: team-1}
      team:
        lead: {expert: {expertId: lead, revisionId: lead-1}, goal: Deliver}
        strategy: parallel
        members:
          - key: reviewer
            expert: {expertId: reviewer, revisionId: reviewer-1}
            role: Review
            task: Verify
            connectors: [unmapped-yiform, actual]
  - id: done
    name: Done
    kind: end
`;
 const before=readManifest({'workflow.yaml':{encoding:'utf8',content:text}});
 const mapped=remapWorkflowConnector(text,'unmapped-yiform','actual');
 const after=readManifest({'workflow.yaml':{encoding:'utf8',content:mapped}});
 assert.deepEqual(after.execution.connectors.requirements,[{serverName:'actual',required:true}]);
 assert.deepEqual(after.stages[0].execution.team.members[0].connectors,['actual']);
 assert.equal(after.description,before.description);assert.equal(after.stages[0].prompt,before.stages[0].prompt);
 assert.deepEqual(after.stages[0].gate,before.stages[0].gate);assert.equal(after.stages[0].next,before.stages[0].next);
 assert.match(mapped,/# Keep the workflow header/);assert.match(mapped,/# Keep this binding comment/);
 assert.equal(remapWorkflowConnector(text,'actual','actual'),text);assert.throws(()=>remapWorkflowConnector(text,'x','bad/name'),/名称无效/);
 const inherited={team:before.stages[0].execution.team};
 const overridden=remapStageConnector({connectors:{mode:'explicit',requirements:[{serverName:'unmapped-yiform',required:true},{serverName:'actual',required:false}]}},inherited,'unmapped-yiform','actual');
 assert.deepEqual(overridden.connectors.requirements,[{serverName:'actual',required:true}]);
 assert.deepEqual(overridden.team.members[0].connectors,['actual']);assert.deepEqual(inherited.team.members[0].connectors,['unmapped-yiform','actual']);
});

test('an explicitly mapped Team draft publishes and applies only the actual connector to the native session',async()=>{
 const f=await fixture();try{
  const team=configuredTeam();team.members[0].connectors=['unmapped-yiform'];
  let d=await f.draft({executor:{kind:'team',expertId:'team',revisionId:'team-1'},team,connectors:{mode:'explicit',requirements:[{serverName:'unmapped-yiform',required:true}]}});
  const catalog=await f.call('connector-catalog',{workflowId:d.draft.id});assert.deepEqual(catalog.map(c=>c.serverName),['example']);
  const mapped=remapWorkflowConnector(d.draft.files['workflow.yaml'].content,'unmapped-yiform','example');
  d=await f.call('save',{workflowId:d.draft.id,expectedRevision:d.draft.revision,patches:{'workflow.yaml':{encoding:'utf8',content:mapped}}});
  assert.equal((await f.call('validate',{workflowId:d.draft.id,expectedRevision:d.draft.revision})).ok,true);
  d=await f.call('publish',{workflowId:d.draft.id,expectedRevision:d.draft.revision});assert.equal(d.revisions.length,1);
  const created=await f.call('create',{workflowId:d.draft.id,workspaceId:'workspace',sessionId:randomUUID()});
  assert.deepEqual(f.selections.get(created.sessionId),['local-connector']);
  const run=(await f.call('runs',{workflowId:d.draft.id}))[0];assert.deepEqual(run.capabilities.team.members[0].connectors,['example']);
 }finally{await f.dispose();}
});

function configuredTeam(){return {lead:{expert:{expertId:'architect',revisionId:'architect-1'},goal:'Coordinate delivery'},strategy:'sequential',members:[{key:'reviewer',expert:{expertId:'member',revisionId:'member-1'},role:'Quality reviewer',task:'Review and deliver first.md',skills:[],connectors:['example']}]};}
test('publication resolves a ten-stage Team once per stage and retains shared frozen Skills once per revision',async()=>{
 const f=await fixture();try{
  for(const expert of f.experts.values())expert.revision.dependencyLock=[f.skill];
  const execution={executor:{kind:'team',expertId:'team',revisionId:'team-1'},team:configuredTeam(),skills:[f.skill],connectors:{mode:'explicit',requirements:[{serverName:'example',required:true}]}};
  let d=await f.draft(execution);
  const stages=Array.from({length:10},(_,i)=>({id:'task-'+i,name:'Stage '+i,kind:'task',prompt:'Deliver stage '+i,outputs:['stage-'+i+'.md'],next:i===9?'done':'task-'+(i+1),execution:structuredClone(execution)}));
  stages.push({id:'done',name:'Done',kind:'end'});
  let text=patchYaml(d.draft.files['workflow.yaml'].content,['stages'],stages);text=patchYaml(text,['start'],'task-0');
  d=await f.call('save',{workflowId:d.draft.id,expectedRevision:d.draft.revision,patches:{'workflow.yaml':{encoding:'utf8',content:text}}});
  let resolves=0,checks=0;const resolve=f.ctx.workdshExperts.resolveWorkflowRevision,check=f.ctx.workdshSkills.checkRevision;
  f.ctx.workdshExperts.resolveWorkflowRevision=async(...args)=>{resolves++;return resolve(...args);};
  f.ctx.workdshSkills.checkRevision=async(...args)=>{checks++;return check(...args);};
  d=await f.call('publish',{workflowId:d.draft.id,expectedRevision:d.draft.revision});
  assert.equal(resolves,30,'one executor/Lead/member resolution per task, with no repeat during freezing/compilation');
  assert.equal(checks,30,'each stage still checks both Team roles and its Skill');
  assert.equal(f.retained.length,1,'the same Skill is retained once for this workflow revision');
  const revision=d.revisions[0],lock=JSON.parse(await readFile(join(f.editor.root,d.draft.id,revision.id,'dependency-lock.json'),'utf8'));
  assert.equal(Object.keys(lock.stageCapabilities).length,11);
  for(const stage of stages.filter(s=>s.kind==='task')){
   assert.deepEqual(lock.stageCapabilities[stage.id].skills,[f.skill]);
   assert.deepEqual(lock.stageCapabilities[stage.id].team.members,execution.team.members);
   const preset=JSON.parse(await readFile(join(f.editor.root,d.draft.id,revision.id,'native-stage-'+stage.id+'.json'),'utf8'));
   assert.match(preset.plugins.find(p=>p.name==='@deepseek-ai/dsh-persona').config.prefix,new RegExp(stage.prompt));
   assert.ok(preset.plugins.find(p=>p.name==='@deepseek-ai/dsh-skill-filesystem').config.customSkillDirs.includes(join(f.home,'extra')));
  }
  const before=await readFile(join(f.editor.root,'state.json'),'utf8');f.disableSkill();
  await assert.rejects(f.call('publish',{workflowId:d.draft.id,expectedRevision:d.draft.revision}),{code:'workflows/invalid-draft'});
  assert.equal(await readFile(join(f.editor.root,'state.json'),'utf8'),before,'the next publication rechecks source state rather than reusing a previous request');
  assert.equal(f.calls.length,0,'publication never creates a business session');
 }finally{await f.dispose();}
});
test('failed Skill retention does not publish or register presets, and a retry checks capabilities afresh',async()=>{
 const f=await fixture();try{
  const d=await f.draft({executor:{kind:'team',expertId:'team',revisionId:'team-1'},team:{...configuredTeam(),members:configuredTeam().members.map(m=>({...m,skills:[structuredClone(f.skill)]}))},skills:[f.skill],connectors:{mode:'explicit',requirements:[{serverName:'example',required:true}]}});
  const before=await readFile(join(f.editor.root,'state.json'),'utf8'),retain=f.ctx.workdshSkills.retainRevision;
  f.ctx.workdshSkills.retainRevision=async()=>{throw new Error('retained files changed');};
  await assert.rejects(f.call('publish',{workflowId:d.draft.id,expectedRevision:d.draft.revision}),/retained files changed/);
  assert.equal(await readFile(join(f.editor.root,'state.json'),'utf8'),before);assert.equal(f.presets.size,0);assert.equal(f.calls.length,0);
  f.ctx.workdshSkills.retainRevision=retain;f.disableExpert();
  await assert.rejects(f.call('publish',{workflowId:d.draft.id,expectedRevision:d.draft.revision}),{code:'workflows/invalid-draft'});
  assert.equal(await readFile(join(f.editor.root,'state.json'),'utf8'),before);
 }finally{await f.dispose();}
});
test('stage-specific Team overrides are frozen, applied to native roles and never rewrite an existing run',async()=>{
 const f=await fixture();try{let d=await f.draft({executor:{kind:'team',expertId:'team',revisionId:'team-1'},team:configuredTeam(),connectors:{mode:'explicit',requirements:[{serverName:'example',required:true}]}});d=await f.call('publish',{workflowId:d.draft.id,expectedRevision:d.draft.revision});const created=await f.call('create',{workflowId:d.draft.id,sessionId:randomUUID(),workspaceId:'workspace'});
 const lead=await f.editor.resolveNativeRole(actor,created.sessionId,undefined,signal),member=await f.editor.resolveNativeRole(actor,created.sessionId,'reviewer',signal);assert.equal(lead.revision.expertId,'architect');assert.match(lead.persona.prefix,/按上述顺序/);assert.match(member.persona.prefix,/Quality reviewer/);
 const yaml=patchYaml(d.draft.files['workflow.yaml'].content,['stages',0,'execution','team','members',0,'role'],'Changed role');await f.call('save',{workflowId:d.draft.id,expectedRevision:d.draft.revision,patches:{'workflow.yaml':{encoding:'utf8',content:yaml}}});const frozen=await f.editor.resolveNativeRole(actor,created.sessionId,'reviewer',signal);assert.match(frozen.persona.prefix,/Quality reviewer/);assert.ok(!frozen.persona.prefix.includes('Changed role'));
 }finally{await f.dispose();}
});
test('Lead turn completion cannot advance before actual member turns and official assigned tasks complete',async()=>{
 const f=await fixture();try{let d=await f.draft({executor:{kind:'team',expertId:'team',revisionId:'team-1'},team:{...configuredTeam(),members:configuredTeam().members.map(m=>({...m,connectors:[]}))}});d=await f.call('publish',{workflowId:d.draft.id,expectedRevision:d.draft.revision});const created=await f.call('create',{workflowId:d.draft.id,sessionId:randomUUID(),workspaceId:'workspace'});let run=(await f.call('runs',{workflowId:d.draft.id}))[0];await writeFile(join(f.home,'first.md'),'valid fresh output');f.sessions.get(created.sessionId).events.push({type:'turn/end',data:{reason:{kind:'completed'}}});
 const root={id:created.sessionId};let status='running',taskStatus='in_progress';f.ctx.agents={get:()=>root};f.ctx.agentTeams={tryMembership:()=>({root}),listMembers:()=>[{id:'child',name:'reviewer',role:'teammate',status}],listTasks:()=>[{id:'task',subject:'Review result',ownerName:'reviewer',status:taskStatus,blockedBy:[]}]};
 run=await f.call('run-continue',{workflowId:d.draft.id,runId:run.id,expectedRunRevision:run.revision});assert.equal(run.current,'first');assert.equal(run.status,'active');assert.match(run.error,/等待成员/);
 status='inactive';f.sessions.set('child',{meta:{},events:[{type:'turn/end',data:{reason:{kind:'completed'}}}]});run=await f.call('run-continue',{workflowId:d.draft.id,runId:run.id,expectedRunRevision:run.revision});assert.equal(run.current,'first');assert.match(run.error,/等待团队任务/);
 taskStatus='completed';run=await f.call('run-continue',{workflowId:d.draft.id,runId:run.id,expectedRunRevision:run.revision});assert.equal(run.current,'second');assert.equal(run.capabilities.team,undefined);
 }finally{await f.dispose();}
});
test('invalid Team revisions, duplicate member keys and out-of-stage connector grants fail closed',async()=>{
 const f=await fixture();try{let team=configuredTeam();let d=await f.draft({executor:{kind:'team',expertId:'team',revisionId:'team-1'},team});let validation=await f.call('validate',{workflowId:d.draft.id,expectedRevision:d.draft.revision});assert.equal(validation.ok,false);assert.ok(validation.issues.some(i=>/阶段范围/.test(i.message)));team={...team,members:[...team.members,...structuredClone(team.members)]};assert.throws(()=>readManifest({'workflow.yaml':{encoding:'utf8',content:patchYaml(d.draft.files['workflow.yaml'].content,['stages',0,'execution','team'],team)}}),/成员标识/);
 const old=patchYaml(d.draft.files['workflow.yaml'].content,['version'],2);assert.throws(()=>readManifest({'workflow.yaml':{encoding:'utf8',content:old}}),/version: 3/);
 }finally{await f.dispose();}
});

test('sequential configuration requires actual official task dependencies before accepting the stage',async()=>{
 const f=await fixture();try{const team={...configuredTeam(),members:[{...configuredTeam().members[0],connectors:[]},{key:'builder',expert:{expertId:'architect',revisionId:'architect-1'},role:'Builder',task:'Deliver first.md',connectors:[]}]};let d=await f.draft({executor:{kind:'team',expertId:'team',revisionId:'team-1'},team});d=await f.call('publish',{workflowId:d.draft.id,expectedRevision:d.draft.revision});const created=await f.call('create',{workflowId:d.draft.id,sessionId:randomUUID(),workspaceId:'workspace'});let run=(await f.call('runs',{workflowId:d.draft.id}))[0];await writeFile(join(f.home,'first.md'),'fresh team result');f.sessions.get(created.sessionId).events.push({type:'turn/end',data:{reason:{kind:'completed'}}});for(const name of ['reviewer','builder'])f.sessions.set(name,{meta:{},events:[{type:'turn/end',data:{reason:{kind:'completed'}}}]});const board=[{id:'a',subject:'review',ownerName:'reviewer',status:'completed',blockedBy:[]},{id:'b',subject:'build',ownerName:'builder',status:'completed',blockedBy:[]}];const root={id:created.sessionId};f.ctx.agents={get:()=>root};f.ctx.agentTeams={tryMembership:()=>({root}),listMembers:()=>['reviewer','builder'].map(name=>({id:name,name,role:'teammate',status:'inactive'})),listTasks:()=>board};
 run=await f.call('run-continue',{workflowId:d.draft.id,runId:run.id,expectedRunRevision:run.revision});assert.equal(run.current,'first');assert.match(run.error,/缺少官方任务前置依赖/);board[1].blockedBy=['a'];run=await f.call('run-continue',{workflowId:d.draft.id,runId:run.id,expectedRunRevision:run.revision});assert.equal(run.current,'second');
 }finally{await f.dispose();}
});

test('app-gen Host cannot advance a completed native turn with real files but 0/9 pipeline state',async()=>{
 const f=await fixture();try{const sha=x=>createHash('sha256').update(x).digest('hex'),proof='Actual test target confirmation',spec=JSON.stringify({app:{appKey:'demo',appId:'123',databaseName:'demo',dataSource:'ds',executionMode:'dry-run'},targetConfirmation:{appId:'123',databaseName:'demo',confirmed:true}});await writeFile(join(f.home,'proof.md'),proof);await writeFile(join(f.home,'context.json'),JSON.stringify({version:1,appKey:'demo',dataSource:'ds',executionMode:'dry-run',spec:'spec.json',state:'state.json',targetConfirmation:{appId:'123',databaseName:'demo',confirmed:true,source:'user',evidenceRefs:[{path:'proof.md',sha256:sha(proof)}]}}));await writeFile(join(f.home,'spec.json'),spec);await writeFile(join(f.home,'state.json'),JSON.stringify({specPath:join(f.home,'spec.json'),specSha256:sha(spec),steps:Array.from({length:9},(_,i)=>({number:i+1,status:'pending'}))}));
 let d=await f.draft({skills:[{...f.skill,skillId:'app-gen',name:'app-gen'}]});let text=patchYaml(d.draft.files['workflow.yaml'].content,['version'],4);text=patchYaml(text,['stages',0,'gate'],{kind:'app-gen',step:1,context:'context.json'});d=await f.call('save',{workflowId:d.draft.id,expectedRevision:d.draft.revision,patches:{'workflow.yaml':{encoding:'utf8',content:text}}});d=await f.call('publish',{workflowId:d.draft.id,expectedRevision:d.draft.revision});const c=await f.call('create',{workflowId:d.draft.id,sessionId:randomUUID(),workspaceId:'workspace'});let r=(await f.call('runs',{workflowId:d.draft.id}))[0];assert.equal(r.phase,'ready');await writeFile(join(f.home,'first.md'),'fresh deliverable');f.sessions.get(c.sessionId).events.push({type:'turn/end',data:{reason:{kind:'completed'}}});r=await f.call('run-continue',{workflowId:d.draft.id,runId:r.id,expectedRunRevision:r.revision});assert.equal(r.status,'failed');assert.equal(r.current,'first');assert.match(r.error,/尚未全部 passed/);assert.equal(f.calls.length,1);assert.equal(r.receipts.length,0);
 }finally{await f.dispose();}
});

// Production role adapter + real official Team/Loader/AgentLoop/persistence.
// Only model I/O and the trusted local identity/Session ingress are fixtures.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, createMessage } from '@deepseek-ai/dsh-llm';
import { ExpertsManager } from '../../../packages/plugins/experts/dist/index.js';
import { registerExpertExecutionGuard } from '../../../packages/plugins/experts/dist/runtime/execution-guard.js';
import { WorkflowEditor } from '../../../packages/plugins/experts/dist/workflows/editor-service.js';
import { patchYaml, presetDocument } from '../../../packages/plugins/experts/dist/workflows/authoring.js';
import { registerExpertManagementTools } from '../../../packages/plugins/experts/dist/tools/management-tools.js';
import { AccessManager } from '../../../packages/plugins/access/dist/index.js';
import { AuditJournal } from '../../../packages/plugins/audit/dist/index.js';
import { SkillManager } from '../../../packages/plugins/skills/dist/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowStage = true;
const langflowBranch=process.argv.includes('--langflow')||process.argv.includes('--langflow-false');
const falseBranch=process.argv.includes('--langflow-false');
const artifacts = resolve(root, langflowBranch?'../../.artifacts/workflow-langflow-native/'+(falseBranch?'false':'true'):'../../.artifacts/workflow-automatic-native');
await mkdir(artifacts, { recursive: true });
await mkdir(join(root, '.test-runtime'), { recursive: true });
const cold = process.argv.includes('--resume');
const home = cold ? process.argv.at(-1) : await mkdtemp(join(root, '.test-runtime/native-expert-team-'));
process.env.DSH_HOME = join(home, 'dsh');
process.env.DSH_AGENTS_HOME = join(home, 'agents');
const requireRoot = createRequire(import.meta.url);
const requireDsh = createRequire(requireRoot.resolve('@deepseek-ai/dsh/package.json'));
const requireExperts = createRequire(join(root, '../../packages/plugins/experts/package.json'));
const baseUrl = pathToFileURL(dirname(requireRoot.resolve('@deepseek-ai/dsh/package.json')) + '/').href;
const ctx = new Context().extend({ baseUrl });
const actor = { principalId: 'probe-owner', organizationId: 'probe-org', resolvedBy: 'probe-identity', requestId: 'probe' };
const report = { home, version: JSON.parse(await readFile(requireRoot.resolve('@deepseek-ai/dsh/package.json'), 'utf8')).version, mode: langflowBranch?'automatic-langflow-branch':'automatic-native', checks: [], requests: [], notRun: ['real paid model', 'professional content acceptance', 'user preview deployment'] };
const pass = (name, detail) => { report.checks.push({ name, detail }); console.log(`PASS ${name}`); };
const blocks = text => [{ type: 'text', text }];
const handles = [];
const observed = new Map();
const concurrent = new Set();
let leadId, workflowEditor;
const roleNames = ['alpha', 'beta', 'reviewer', 'waiter', 'writer'];
ctx.on('agent/created', ({ agent }) => { observed.set(agent.id, agent); });
const signal = AbortSignal.timeout(120_000);
async function waitFor(fn) {
  const timeout = AbortSignal.timeout(15000);
  while (!await fn()) { timeout.throwIfAborted(); await new Promise(r => setTimeout(r, 20)); }
}
async function history(id) { const h = await ctx.sessionPersistence.open(id, 'read'); try { return await h.read(); } finally { await h.close(); } }
async function settled(id, before = 0) {
  await waitFor(async () => (await history(id)).events.filter(e => e.type === 'turn/end').length > before);
  const end = (await history(id)).events.filter(e => e.type === 'turn/end').at(-1);
  assert.equal(end.data.reason.kind, 'completed', JSON.stringify(end));
}
class Model extends LlmAdapter {
  async *stream(options) {
    const agent=ctx.agents.currentInitiator(),all=JSON.stringify(options.messages);
    const file=all.includes('auto-first.md')?'auto-first.md':'auto-second.md';
    const completed=all.includes('AUTO_WRITE_OK');
    const block=completed?{type:'text',text:'Fixture complete.'}:{type:'tool-call',id:'write-'+agent.id,name:'workflow_auto_fixture_write',arguments:JSON.stringify({file})};
    report.requests.push({id:agent.id,file});
    assert.ok(report.requests.length<10);
    yield{type:'block-start',index:0,blockType:block.type};yield{type:'block-end',index:0,block};yield{type:'finish',reason:{kind:completed?'stop':'tool-calls'}};
  }
}
async function load(name, config) {
  let entry;
  for (const req of [requireExperts, requireDsh, requireRoot]) { try { entry = pathToFileURL(req.resolve(name)).href; break; } catch {} }
  assert.ok(entry, name);
  return ctx.loader.create({ name: entry, ...(config ? { config } : {}) });
}
async function rootAgent(id, preset = 'standard') {
  const handle = await ctx.agents.create({ sessionId: id, agentOptions: { provider: 'fixture', model: 'fixture', cwd: home },
    meta: { cwd: home, agentPreset: preset }, setup: scope => ctx.agentPresets.mount(scope, preset).then(() => undefined) });
  handles.push(handle); return handle.agent;
}
const definition = name => ({ name, description: `${name} fixture expert.`, role: `ROLE_${name.toUpperCase()}`, methodology: 'Load your method and inspect real inputs.', boundaries: 'Fixture workspace only.', deliverables: 'A verified fixture answer.', tags: [], examples: [{ id: 'one', prompt: 'Run fixture.' }], skillRequirements: name === 'lead' ? [] : [{ name: `method-${name}` }], futureRequirements: [] });
try {
  const { default: Loader } = await import(pathToFileURL(requireDsh.resolve('@deepseek-ai/cordis-plugin-loader')).href);
  await ctx.plugin(Loader, { baseUrl });
  for (const name of ['dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-llm', 'dsh-agent', 'dsh-agent-loop', 'dsh-subagent', 'dsh-invariants']) await load(`@deepseek-ai/${name}`);
  await load('@deepseek-ai/dsh-session-persistence-jsonl', { root: join(home, 'sessions'), compression: 'none' });
  await load('@deepseek-ai/dsh-session-query-sqlite', { path: join(home, 'session-query.sqlite'), openAt: 'never' });
  await load('@deepseek-ai/dsh-subagent-spawn-in-process', { providerName: 'spawn' });
  await load('@deepseek-ai/dsh-subagent-fork-in-process', { providerName: 'fork' });
  await load('@deepseek-ai/dsh-experimental-agent-team', { maxMembers: 16, disposalTimeoutMs: 4000 });
  await load('@deepseek-ai/dsh-experimental-tool-agent-team');
  ctx.llm.registerAdapter(['fixture'], new Model());
  const presetRoot = join(home, 'presets');
  if (!cold) {
    await mkdir(join(presetRoot, 'standard'), { recursive: true });
    for (const name of roleNames) {
      const dir = join(process.env.DSH_AGENTS_HOME, 'skills', `method-${name}`);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), `---\nname: method-${name}\ndescription: Fixture ${name} method\n---\nMETHOD_${name.toUpperCase()}\n`);
    }
  }
  for (const [name, config] of [['dsh-storage'], ['dsh-storage-json', { root: join(home, 'storage') }], ['dsh-storage-domain', { backend: 'json' }], ['dsh-skill'], ['dsh-skill-filesystem', { watch: false }], ['dsh-agent-preset-registry', { default: 'standard' }]]) await load(`@deepseek-ai/${name}`, config);
  await ctx.loader.create({ name: '@deepseek-ai/dsh-agent-preset', config: { id: 'standard', plugins: [
    { name: '@deepseek-ai/dsh-persona', config: { prefix: 'BASE' } },
    { name: '@deepseek-ai/dsh-skill-filesystem', config: { includeDefaultRoots: false, watch: false } },
    { name: '@deepseek-ai/dsh-tool-skill' },
  ] } });
  ctx.provide('workdshIdentity', { id: actor.resolvedBy, async resolve() { return actor; }, membership(org, principal) { return org === actor.organizationId && principal === actor.principalId ? { organizationId: org, principalId: principal, principalKind: 'human', role: 'owner', state: 'active', revision: 'fixture-v1' } : undefined; } });
  for (const plugin of [AuditJournal, AccessManager]) await ctx.plugin(plugin);
  await ctx.plugin({ name: 'fixture-skills-host', inject: ['skills'], apply(scope) { new SkillManager(scope); } });
  const {SessionController}=await import(pathToFileURL(requireExperts.resolve('@deepseek-ai/dsh-api-session-controller')).href);
  ctx.provide('attachments',{admitPromptContent:async content=>content});
  ctx.provide('fileUploads',{registerAgentResolver(){return ()=>{};},resolve(){throw Error('Fixture has no uploads');},bindPrompt(){return{commit(){},[Symbol.dispose](){}};}});
  await load('@deepseek-ai/dsh-typert-registry');
  await load('@deepseek-ai/dsh-fs');await load('@deepseek-ai/dsh-fs-local');
  await load('@deepseek-ai/dsh-workspace');
  await load('@deepseek-ai/dsh-agent-default-model',{provider:'fixture',model:'fixture'});
  await ctx.plugin(SessionController,{nativeOpen:false});
  const {defineTool}=await import(pathToFileURL(requireDsh.resolve('@deepseek-ai/dsh-tools')).href);
  ctx.tools.register(defineTool({name:'workflow_auto_fixture_write',description:'Write an isolated acceptance file',parameters:{file:{type:'string',required:true}},output:{schema:{type:'object',additionalProperties:false,properties:{ok:{type:'string',required:true}}},render:(_args,result)=>blocks(result.ok)},async execute({file}){assert.ok(['auto-first.md','auto-second.md'].includes(file));await writeFile(join(home,file),'AUTO_WRITE_OK '+Date.now());return{ok:'AUTO_WRITE_OK'};}}));
  ctx.provide('workdshSessionAccess', { async create(request) { await rootAgent(request.sessionId, request.agentPreset); return { sessionId: request.sessionId }; }, async inspect(id) { const agent=ctx.agents.get(id);try{const session=await history(id);return {meta:agent?.session.header,events:session.events};}catch(error){if(error.name==='SessionPersistenceNotFoundError'&&agent)return {meta:agent.session.header,events:[]};throw error;} } });
  await ctx.extend({ baseUrl }).plugin(ExpertsManager);
  const composition = ctx.plugin({ name: 'production-expert-adapter', inject: ['workdshExperts', 'workdshIdentity', 'tools', 'agentTeams', 'agentPresets', 'agents', 'skills', 'systemPrompt', 'workdshSkills'], apply(scope) { registerExpertExecutionGuard(scope, {}, (actor, id, name, signal) => workflowEditor?.resolveNativeRole(actor, id, name, signal)); registerExpertManagementTools(scope); } });
  await composition;
  if (workflowStage) {
    workflowEditor = await WorkflowEditor.open(ctx.extend({ baseUrl }));
    ctx.on('agent/created', ({ agent, signal }) => workflowEditor.admit(agent, signal, true));
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => { await workflowEditor.admit(agent, signal, false); return next(); });
  }

  const call=(action,extra={})=>workflowEditor.dispatch(actor,{action,operationId:crypto.randomUUID(),...extra},signal);
  let detail=await call('copy',{workflowId:'workdsh-ai-webapp'}),text=detail.draft.files['workflow.yaml'].content;
  const nodes=[{id:'first',name:'First task',kind:'task',prompt:'Write auto-first.md using workflow_auto_fixture_write',outputs:['auto-first.md'],next:'review'},{id:'review',name:'Human review',kind:'approval',next:'second'},{id:'second',name:'Second task',kind:'task',prompt:'Write auto-second.md using workflow_auto_fixture_write',outputs:['auto-second.md'],next:'done'},{id:'done',name:'Done',kind:'end'}];
  if(langflowBranch){nodes[0].next='choice';nodes.splice(1,0,{id:'choice',name:'If-else',kind:'branch',condition:{source:'file',input:'auto-first.md',operator:'contains',match:falseBranch?'NO_MATCH':'AUTO_WRITE_OK',caseSensitive:true},whenTrue:'review',whenFalse:'done'});}
  for(const[k,v]of Object.entries({version:langflowBranch?5:1,mode:'staged',start:'first',stages:nodes}))text=patchYaml(text,[k],v);
  const document=presetDocument(detail.draft.files['preset/agent.cordis.yml'].content);document.contents.items=document.contents.items.filter(row=>['persona','skill-filesystem','tool-skill'].includes(row.get('id')));
  detail=await call('save',{workflowId:detail.draft.id,expectedRevision:detail.draft.revision,patches:{'workflow.yaml':{encoding:'utf8',content:text},'preset/agent.cordis.yml':{encoding:'utf8',content:document.toString()}}});
  detail=await call('trial',{workflowId:detail.draft.id,expectedRevision:detail.draft.revision});
  const created=await call('create',{workflowId:detail.draft.id,revisionId:detail.revisions.at(-1).id,sessionId:crypto.randomUUID(),workspaceId:'fixture',automatic:true,input:'Automatic workflow fixture'});
  const getRun=async()=> (await call('runs',{workflowId:detail.draft.id}))[0];
  let run;
  if(falseBranch){
    await waitFor(async()=>{await workflowEditor.pumpAutomatic();return (await getRun()).status==='completed';});
    run=await getRun();assert.equal(run.receipts.filter(r=>r.sessionId).length,1);assert.equal(new Set(report.requests.map(r=>r.id)).size,1);pass('false-file-condition-finishes-after-one-official-session');
  }else{
  await waitFor(async()=>{await workflowEditor.pumpAutomatic();return (await getRun()).status==='awaiting-approval';});
  run=await getRun();assert.equal(run.receipts[0].stageId,'first');assert.equal(run.current,'review');assert.ok(await readFile(join(home,'auto-first.md'),'utf8'));
  const before=report.requests.length;await workflowEditor.pumpAutomatic();assert.equal(report.requests.length,before);pass('official-session-prompt-agent-loop-files-and-human-gate');
  await call('run-approve',{workflowId:run.workflowId,runId:run.id,expectedRunRevision:run.revision,approve:true});
  await waitFor(async()=>{await workflowEditor.pumpAutomatic();return (await getRun()).status==='completed';});
  run=await getRun();assert.equal(run.receipts.filter(r=>r.sessionId).length,2);assert.ok(await readFile(join(home,'auto-second.md'),'utf8'));
  assert.equal(new Set(report.requests.map(r=>r.id)).size,2);pass('approval-resumes-second-native-session-and-completes-real-delivery');
  }
  if(langflowBranch){const receipt=run.receipts.find(r=>r.stageId==='choice'),bytes=await readFile(join(home,'auto-first.md'));assert.equal(receipt.decision,!falseBranch);assert.equal(receipt.files['auto-first.md'],crypto.createHash('sha256').update(bytes).digest('hex'));pass('file-condition-records-real-content-decision-and-digest');}
  report.run=run;report.status='passed';
} catch(error){report.error=error.stack;console.error(error);process.exitCode=1;} finally {
  await workflowEditor?.dispose();for(const handle of handles.reverse())await handle.dispose();await ctx.fiber.dispose();
  await writeFile(join(artifacts,'report.json'),JSON.stringify(report,null,2));
}

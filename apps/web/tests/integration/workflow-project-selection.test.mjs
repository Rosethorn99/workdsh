import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkflowEditor } from '../../../../packages/plugins/experts/dist/workflows/editor-service.js';

const actor = { principalId: 'owner', organizationId: 'personal', requestId: 'project-selection', resolvedBy: 'fixture' };
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'workflow-project-selection-'));
  const sessions = [], projectsRead = [];
  const inspection = new Map();
  let instruction = '', configRevision = 'current';
  const projects = {
    async get(who, id) {
      if (who.principalId !== actor.principalId || id !== 'project') throw new Error('projects/not-found');
      projectsRead.push(configRevision);
      return { project: { id, status: 'active' }, config: { id: configRevision, instruction, capabilities: [] } };
    },
    validateInputRefs: async (_who, _id, refs) => refs,
    linkTask: async () => {},
  };
  const ctx = {
    reflect: { get: name => name === 'workdshProjects' ? projects : undefined },
    workdshAccess: { authorize: async ({ actor: who, owner }) => ({ effect: who.principalId === owner.ownerPrincipalId && who.organizationId === owner.organizationId ? 'allow' : 'deny' }) },
    workdshAudit: { append: async () => {} },
    agentPresets: { register: async () => () => {} },
    workdshSessionAccess: {
      create: async request => { sessions.push(request); inspection.set(request.sessionId, { meta: { ...request, cwd: home }, events: [] }); return { sessionId: request.sessionId }; },
      inspect: async id => inspection.get(id),
    },
  };
  const editor = await WorkflowEditor.open(ctx, home);
  t.after(async () => { await editor.dispose(); await rm(home, { recursive: true, force: true }); });
  const call = (action, payload = {}, who = actor) => editor.dispatch(who, { action, operationId: randomUUID(), ...payload }, new AbortController().signal);
  const draft = await call('create-draft', { name: 'App-Gen · YiForm 企业应用交付', starter: 'review' });
  let other = await call('create-draft', { name: 'Other workflow', starter: 'review' });
  other = await call('publish', { workflowId: other.draft.id, expectedRevision: other.draft.revision });
  return { call, draft, other, sessions, projectsRead, bind(id = draft.draft.id, name = 'App-Gen · YiForm 企业应用交付') { instruction = `本项目仅使用现有工作流“${name}”（workflowId=${id}），不得新建、复制或替换工作流。`; configRevision += '-next'; }, instruction(value) { instruction = value; }, state: () => readFile(join(home, '.workdsh-state/workflows/state.json'), 'utf8') };
}

test('bound App-Gen draft is visible with a publication reason; other published workflows are excluded', async t => {
  const f = await fixture(t); f.bind();
  const result = await f.call('project-options', { projectId: 'project' });
  assert.equal(result.binding.workflowId, f.draft.draft.id);
  assert.deepEqual(result.workflows.map(w => w.id), [f.draft.draft.id]);
  assert.equal(result.workflows[0].publishedRevision, undefined);
  assert.match(result.blocked, /尚未发布/);
  assert.equal(f.sessions.length, 0);
});

test('unrestricted projects show published workflows and labelled drafts without interpreting ordinary references as bindings', async t => {
  const f = await fixture(t);
  f.instruction(`参考工作流（workflowId=${f.draft.draft.id}），可以自行选择。`);
  const result = await f.call('project-options', { projectId: 'project' });
  assert.equal(result.binding, undefined); assert.equal(result.workflows.length, 2);
  assert.ok(result.workflows.find(w => w.id === f.other.draft.id).publishedRevision);
});

test('create enforces the current project binding before creating a session or saving a run', async t => {
  const f = await fixture(t); f.bind(); const before = await f.state();
  await assert.rejects(f.call('create', { projectId: 'project', workflowId: f.other.draft.id, workspaceId: 'workspace', sessionId: randomUUID() }), { code: 'workflows/project-workflow-mismatch' });
  assert.equal(f.sessions.length, 0); assert.equal(await f.state(), before);
  f.bind(f.other.draft.id, 'Other workflow');
  assert.deepEqual((await f.call('project-options', { projectId: 'project' })).workflows.map(w => w.id), [f.other.draft.id]);
  assert.ok(f.projectsRead.every(r => r.startsWith('current-next')));
});

test('missing or archived binding stays blocked without falling back to another published workflow', async t => {
  const f = await fixture(t); f.bind('wf-' + randomUUID());
  let result = await f.call('project-options', { projectId: 'project' });
  assert.deepEqual(result.workflows, []); assert.match(result.blocked, /不存在|无权访问/);
  f.bind(); await f.call('archive', { workflowId: f.draft.draft.id, expectedRevision: f.draft.draft.revision });
  result = await f.call('project-options', { projectId: 'project' });
  assert.deepEqual(result.workflows, []); assert.match(result.blocked, /归档/);
  await assert.rejects(f.call('project-options', { projectId: 'project' }, { ...actor, principalId: 'stranger' }), /projects\/not-found/);
});

test('invalid explicit workflow restriction cannot silently enable unrestricted choices', async t => {
  const f = await fixture(t); f.instruction('本项目仅使用现有工作流“App-Gen”（workflowId=typo）。');
  await assert.rejects(f.call('project-options', { projectId: 'project' }), { code: 'workflows/project-binding-invalid' });
  await assert.rejects(f.call('create', { projectId: 'project', workflowId: f.other.draft.id, workspaceId: 'workspace', sessionId: randomUUID() }), { code: 'workflows/project-binding-invalid' });
  assert.equal(f.sessions.length, 0);
  f.instruction(`本项目仅使用现有工作流“App-Gen”（workflowId=${f.draft.draft.id}）。\n本项目仅使用现有工作流“Other workflow”（workflowId=${f.other.draft.id}）。`);
  await assert.rejects(f.call('project-options', { projectId: 'project' }), { code: 'workflows/project-binding-invalid' });
});

test('a permitted published workflow starts once; replay rechecks a subsequently changed project restriction', async t => {
  const f = await fixture(t); f.bind(f.other.draft.id, 'Other workflow');
  const request = { projectId: 'project', workflowId: f.other.draft.id, workspaceId: 'workspace', sessionId: randomUUID(), operationId: 'start-once' };
  const result = await f.call('create', request);
  assert.equal(f.sessions.length, 1); assert.equal(result.workflowId, f.other.draft.id);
  assert.deepEqual(await f.call('create', request), result); assert.equal(f.sessions.length, 1);
  f.bind();
  await assert.rejects(f.call('create', request), { code: 'workflows/project-workflow-mismatch' });
  assert.equal(f.sessions.length, 1);
});

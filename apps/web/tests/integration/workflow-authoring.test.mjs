import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkflowEditor } from '../../../../packages/plugins/experts/dist/workflows/editor-service.js';
import { patchYaml, pluginRows, packagePath, readManifest, presetDocument } from '../../../../packages/plugins/experts/dist/workflows/authoring.js';
import { editCanvas, paletteNode, entryNodeId } from '../../../../packages/plugins/experts/dist/workflows/canvas-operations.js';
import { readWorkflowCatalog } from '../../../../packages/plugins/experts/dist/workflows/host.js';

const actor = { principalId: 'author', organizationId: 'personal', requestId: 'test', resolvedBy: 'fixture' };
const signal = new AbortController().signal;
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'workdsh-workflow-authoring-'));
  const presets = new Map(), calls = [], audits = [], sessions = new Map(), cancelled = []; let failNext = false;
  const ctx = {
    workdshIdentity: { resolve: async () => actor },
    workdshAccess: { authorize: async ({ actor, owner }) => ({ effect: actor.organizationId === owner.organizationId && actor.principalId === owner.ownerPrincipalId ? 'allow' : 'deny' }) },
    workdshAudit: { append: async value => audits.push(value) },
    credentials: { describe: async () => ({ configured: true }) },
    agentPresets: { register: async value => { assert.ok(!presets.has(value.id), 'no duplicate registration'); presets.set(value.id, value); return () => presets.delete(value.id); } },
    sessionController: { cancel: request => cancelled.push(request.sessionId) },
    workdshSessionAccess: {
      create: async request => {
        if (failNext) { failNext = false; throw new Error('fixture transient session creation failure'); }
        calls.push(request);
        if (!sessions.has(request.sessionId)) sessions.set(request.sessionId, { meta: { ...request, cwd: home }, events: [] });
        return { sessionId: request.sessionId };
      },
      inspect: async id => { assert.ok(sessions.has(id), 'session exists'); return sessions.get(id); },
    },
  };
  let editor = await WorkflowEditor.open(ctx, home);
  return { home, presets, calls, audits, sessions, cancelled, failCreate() { failNext = true; }, get editor() { return editor; },
    call: (action, value = {}, who = actor) => editor.dispatch(who, { action, operationId: randomUUID(), ...value }, signal),
    async restart() { await editor.dispose(); editor = await WorkflowEditor.open(ctx, home); },
    async dispose() { await editor.dispose(); assert.equal(presets.size, 0); await rm(home, { recursive: true, force: true }); } };
}

test('all seven complete source packages validate, copy without loss and leave upstream unchanged', async () => {
  const f = await fixture();
  try {
    const catalog = await readWorkflowCatalog();
    for (const workflow of catalog.workflows) {
      const original = await f.call('get', { workflowId: workflow.id });
      assert.equal(original.readonly, true);
      const validation = await f.call('validate', { workflowId: workflow.id });
      assert.deepEqual(validation.issues, [], workflow.name + ': ' + JSON.stringify(validation.issues));
      assert.equal(validation.skills.length, workflow.skills.length);
      const copied = await f.call('copy', { workflowId: workflow.id });
      assert.notEqual(copied.draft.id, workflow.id); assert.equal(copied.readonly, false);
      assert.deepEqual(copied.draft.files, original.draft.files);
    }
    assert.equal((await f.call('list')).length, 7);
  } finally { await f.dispose(); }
});

test('new workflow creates an owned neutral draft once, survives restart and publishes through native presets', async () => {
  const f = await fixture();
  try {
    const request = { name: '  我的 AI 流程  ', description: '  完成任务后人工验收  ', starter: 'review', operationId: 'new-workflow-once' };
    const results = await Promise.all([f.call('create-draft', request), f.call('create-draft', request)]);
    assert.deepEqual(results[0], results[1]);
    let detail = results[0]; const id = detail.draft.id;
    assert.equal(detail.readonly, false); assert.equal(detail.draft.publishedRevision, undefined);
    assert.equal(detail.draft.upstream.repository, '');
    assert.equal(f.presets.size, 0); assert.equal(f.calls.length, 0);
    assert.equal(f.audits.filter(a => a.action === 'workflows.create-draft').length, 1);
    assert.deepEqual(Object.keys(detail.draft.files).sort(), ['layout.json', 'preset/agent.cordis.yml', 'workflow.yaml']);
    const manifest = readManifest(detail.draft.files);
    assert.equal(manifest.name, '我的 AI 流程'); assert.equal(manifest.description, '完成任务后人工验收');
    assert.equal(manifest.start, 'task1');
    assert.deepEqual(manifest.stages.map(n => n.kind), ['task', 'approval', 'end']);
    assert.deepEqual(manifest.execution.connectors.requirements, []);
    assert.ok(!detail.draft.files['preset/agent.cordis.yml'].content.includes('grill-me'));
    assert.equal((await f.call('validate', { workflowId: id, expectedRevision: detail.draft.revision })).ok, true);
    assert.equal((await f.call('list')).length, 1);
    const stranger = { ...actor, principalId: 'other' };
    assert.deepEqual(await f.call('list', {}, stranger), []);
    await assert.rejects(f.call('get', { workflowId: id }, stranger), { code: 'workflows/forbidden' });
    await assert.rejects(f.call('save', { workflowId: id, expectedRevision: detail.draft.revision, patches: {} }, stranger), { code: 'workflows/forbidden' });
    await f.restart(); assert.deepEqual(await f.call('create-draft', request), JSON.parse(JSON.stringify(detail)));
    detail = await f.call('publish', { workflowId: id, expectedRevision: detail.draft.revision });
    assert.ok(detail.draft.publishedRevision); assert.equal(f.calls.length, 0);
    assert.equal(f.presets.size, 2, 'one base preset and one native task preset');
    const published = [...f.presets.values()].find(p => p.id.endsWith('-stage-task1'));
    assert.ok(published.plugins.find(p => p.name === '@deepseek-ai/dsh-persona').config.prefix.includes('AI 任务'));
    const bundle = await f.call('export', { workflowId: id });
    assert.equal((await f.call('preview-import', { bundle })).validation.ok, true);
    const imported = await f.call('import', { bundle });
    assert.notEqual(imported.draft.id, id); assert.equal(imported.draft.publishedRevision, undefined);
    assert.deepEqual(imported.draft.files, detail.draft.files);
    assert.deepEqual((await f.call('copy', { workflowId: id })).draft.files, detail.draft.files);
  } finally { await f.dispose(); }
});

test('blank draft is freely editable and portable, but cannot run or publish an incomplete graph', async () => {
  const f = await fixture();
  try {
    let detail = await f.call('create-draft', { name: '空白流程', starter: 'blank' }); const id = detail.draft.id;
    assert.deepEqual(presetDocument(detail.draft.files['workflow.yaml'].content).toJS().stages, []);
    assert.equal((await f.call('validate', { workflowId: id, expectedRevision: detail.draft.revision })).ok, false);
    await assert.rejects(f.call('publish', { workflowId: id, expectedRevision: detail.draft.revision }), { code: 'workflows/invalid-draft' });
    await assert.rejects(f.call('trial', { workflowId: id, expectedRevision: detail.draft.revision }), { code: 'workflows/invalid-draft' });
    assert.equal(f.presets.size, 0); assert.equal(f.calls.length, 0);
    const bundle = await f.call('export', { workflowId: id });
    assert.equal((await f.call('preview-import', { bundle })).validation.ok, false);
    assert.deepEqual((await f.call('import', { bundle })).draft.files, detail.draft.files);
    let text = detail.draft.files['workflow.yaml'].content;
    for (const node of [paletteNode('task1', 'task'), paletteNode('done', 'end')]) text = editCanvas(text, { type: 'add', node }).text;
    for (const edge of [{ from: entryNodeId, port: 'next', target: 'task1' }, { from: 'task1', port: 'next', target: 'done' }]) text = editCanvas(text, { type: 'connect', edge }).text;
    text = patchYaml(text, ['stages', 0, 'prompt'], '按用户需求完成工作并将结果写入声明的文件。');
    detail = await f.call('save', { workflowId: id, expectedRevision: detail.draft.revision, patches: { 'workflow.yaml': { encoding: 'utf8', content: text } } });
    assert.equal((await f.call('validate', { workflowId: id, expectedRevision: detail.draft.revision })).ok, true);
    await f.restart(); assert.equal(readManifest((await f.call('get', { workflowId: id })).draft.files).stages.length, 2);
  } finally { await f.dispose(); }
});

test('new workflow rejects invalid names and templates without records, and scopes retries to identity', async () => {
  const f = await fixture();
  try {
    for (const request of [{ name: '   ' }, { name: 'x'.repeat(121) }, { name: 'x\n' }, { name: 123 }, { name: 'x', description: {} }, { name: 'x', description: 'a'.repeat(4097) }, { name: 'x', starter: 'missing' }]) await assert.rejects(f.call('create-draft', request));
    assert.deepEqual(await f.call('list'), []); assert.equal(f.audits.length, 0);
    const request = { name: '同名流程', operationId: 'same-key' };
    const own = await f.call('create-draft', request), other = await f.call('create-draft', request, { ...actor, principalId: 'other' });
    assert.notEqual(own.draft.id, other.draft.id);
    await assert.rejects(f.call('create-draft', { ...request, name: 'changed' }), { code: 'workflows/conflict' });
    assert.equal((await f.call('list')).length, 1); assert.equal(f.calls.length, 0);
  } finally { await f.dispose(); }
});

test('visual edits retain comments, unknown properties, original groups and tagged platform/path expressions', async () => {
  const f = await fixture();
  try {
    const source = await f.call('get', { workflowId: 'workdsh-ai-webapp' });
    const before = source.draft.files['preset/agent.cordis.yml'].content + '\n# author note\n';
    const edited = patchYaml(before, [0, 'config', 'text'], 'Complete original-role text with updated acceptance contract.');
    assert.ok(edited.includes('# author note'));
    assert.equal((edited.match(/!!js/g) ?? []).length, (before.match(/!!js/g) ?? []).length);
    const a = pluginRows(before), b = pluginRows(edited);
    assert.deepEqual(a.map(row => row.path), b.map(row => row.path));
    assert.deepEqual(a.slice(1).map(row => row.row), b.slice(1).map(row => row.row));
    assert.throws(() => patchYaml('- invalid: [', [0, 'id'], 'x'));
  } finally { await f.dispose(); }
});

test('CAS rejects stale saves, retries are idempotent, invalid drafts remain editable but cannot publish', async () => {
  const f = await fixture();
  try {
    const initial = await f.call('copy', { workflowId: 'workdsh-ppt-office' });
    const input = { workflowId: initial.draft.id, expectedRevision: initial.draft.revision };
    const saves = await Promise.allSettled([
      f.call('save', { ...input, patches: { 'one.md': { encoding: 'utf8', content: 'one' } } }),
      f.call('save', { ...input, patches: { 'two.md': { encoding: 'utf8', content: 'two' } } }),
    ]);
    assert.equal(saves.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(saves.find(row => row.status === 'rejected').reason.code, 'workflows/conflict');
    let detail = await f.call('get', { workflowId: initial.draft.id });
    const retry = { workflowId: detail.draft.id, expectedRevision: detail.draft.revision, operationId: 'stable-save', patches: { 'preset/agent.cordis.yml': { encoding: 'utf8', content: '- id: [' } } };
    detail = await f.call('save', retry);
    assert.deepEqual(await f.call('save', retry), detail);
    const validation = await f.call('validate', { workflowId: detail.draft.id, expectedRevision: detail.draft.revision });
    assert.equal(validation.ok, false);
    await assert.rejects(f.call('publish', { workflowId: detail.draft.id, expectedRevision: detail.draft.revision }), { code: 'workflows/invalid-draft' });
    assert.equal(f.presets.size, 0);
  } finally { await f.dispose(); }
});

test('publishing freezes files and native bindings, supports trial, rollback and cold restart', async () => {
  const f = await fixture();
  try {
    let detail = await f.call('copy', { workflowId: 'workdsh-ppt-office' });
    const id = detail.draft.id;
    detail = await f.call('publish', { workflowId: id, expectedRevision: detail.draft.revision });
    const first = detail.draft.publishedRevision, session1 = randomUUID();
    const created = await f.call('create', { workflowId: id, sessionId: session1, workspaceId: 'synthetic-workspace' });
    assert.equal(created.revisionId, first);
    const native = f.presets.get(created.presetId);
    assert.ok(native.plugins.find(row => row.id === 'motion-deck-tools').name.includes('/wf-'));
    assert.ok(native.plugins.find(row => row.id === 'skill-filesystem').config.customSkillDirs[0].includes(id));
    const snapshot = await f.call('get', { workflowId: id, revisionId: first });
    assert.equal(snapshot.readonly, true);
    detail = await f.call('save', { workflowId: id, expectedRevision: detail.draft.revision, patches: { 'notes.md': { encoding: 'utf8', content: 'new evidence' } } });
    assert.deepEqual((await f.call('diff', { workflowId: id, expectedRevision: detail.draft.revision, revisionId: first })).changes, [{ path: 'notes.md', kind: 'added' }]);
    detail = await f.call('trial', { workflowId: id, expectedRevision: detail.draft.revision });
    assert.equal(detail.draft.publishedRevision, first, 'trial never promotes default');
    detail = await f.call('publish', { workflowId: id, expectedRevision: detail.draft.revision });
    const second = detail.draft.publishedRevision; assert.notEqual(first, second);
    assert.equal((await f.call('get', { workflowId: id, revisionId: first })).draft.files['notes.md'], undefined);
    await assert.rejects(f.call('create', { workflowId: id, sessionId: session1, workspaceId: 'synthetic-workspace' }), /已绑定其他/);
    const session2 = randomUUID(); await f.call('create', { workflowId: id, sessionId: session2, workspaceId: 'synthetic-workspace' });
    assert.notEqual(f.calls[0].agentPreset, f.calls[1].agentPreset);
    detail = await f.call('activate', { workflowId: id, revisionId: first, expectedRevision: detail.draft.revision });
    await f.restart();
    assert.equal((await f.call('get', { workflowId: id })).draft.publishedRevision, first);
    assert.equal(f.presets.size, 3, 'published revisions and isolated trial restored');
    const dirs = await readdir(join(f.editor.root, id)); assert.ok(dirs.includes(first));
    const template = join(f.editor.root, id, first, detail.draft.source.sourceId, 'preset/runtime/motion-deck/source/deck-template.html');
    await writeFile(template, (await readFile(template, 'utf8')) + 'tampered');
    await assert.rejects(f.call('create', { workflowId: id, sessionId: randomUUID(), workspaceId: 'synthetic-workspace' }), /发布文件已被修改/);
  } finally { await f.dispose(); }
});

test('native execution guard blocks unbound preset selections, version changes and verifies inherited child bindings', async () => {
  const f = await fixture();
  try {
    let detail = await f.call('copy', { workflowId: 'workdsh-ai-webapp' });
    detail = await f.call('publish', { workflowId: detail.draft.id, expectedRevision: detail.draft.revision });
    const sessionId = randomUUID();
    const created = await f.call('create', { workflowId: detail.draft.id, sessionId, workspaceId: 'synthetic-workspace' });
    const agent = { id: sessionId, session: { header: { agentPreset: created.presetId } } };
    await f.editor.admit(agent, signal, false);
    await assert.rejects(f.editor.admit({ id: randomUUID(), session: { header: { agentPreset: created.presetId } } }, signal, false), { code: 'workflows/unbound' });
    await f.editor.admit({ id: randomUUID(), session: { header: { agentPreset: created.presetId, parentSession: sessionId } } }, signal, false);
    await assert.rejects(f.editor.admit({ id: sessionId, session: { header: { agentPreset: 'standard' } } }, signal, false), { code: 'workflows/conflict' });
  } finally { await f.dispose(); }
});

test('online PPT template and effective runtime edits appear in the published renderer, not in upstream files', async () => {
  const f = await fixture();
  const { mkdir } = await import('node:fs/promises');
  try {
    let detail = await f.call('copy', { workflowId: 'workdsh-ppt-office' });
    const templatePath = 'preset/runtime/motion-deck/source/deck-template.html', runtimePath = 'preset/workdsh-runtime/motion-deck/generate-deck.mjs';
    const template = detail.draft.files[templatePath].content.replace('</style>', '/* online-template-proof */\n</style>');
    const generator = detail.draft.files[runtimePath].content.replace('MOTION STORY', 'ONLINE RUNTIME PROOF');
    detail = await f.call('save', { workflowId: detail.draft.id, expectedRevision: detail.draft.revision, patches: {
      [templatePath]: { encoding: 'utf8', content: template }, [runtimePath]: { encoding: 'utf8', content: generator },
    } });
    detail = await f.call('publish', { workflowId: detail.draft.id, expectedRevision: detail.draft.revision });
    const native = f.presets.get(detail.revisions.at(-1).presetId), module = native.plugins.find(row => row.id === 'motion-deck-tools').name;
    assert.ok(module.includes('/workdsh-runtime/motion-deck/index.js'));
    const tools = new Map(), disposers = [];
    (await import(module)).apply({ tools: { register(value) { tools.set(value.name, value); return () => tools.delete(value.name); } }, effect(fn) { disposers.push(fn()); } });
    const project = 'generated/online-proof'; await mkdir(join(f.home, project, 'input'), { recursive: true });
    await writeFile(join(f.home, project, 'input/outline.json'), JSON.stringify({ deck: { title: 'Online workflow test', brand: 'ONLINE RUNTIME PROOF' }, slides: Array.from({ length: 8 }, (_, i) => ({ section: 'Section ' + i, title: 'Page ' + i, summary: 'Synthetic validation', points: ['One', 'Two', 'Three'] })) }));
    const result = await tools.get('render_motion_deck').execute({ project_dir: project, theme: 'ocean', focus: 'result' }, { signal, agent: { session: { header: { cwd: f.home } } } });
    assert.equal(result.pages, 8);
    const html = await readFile(join(f.home, project, 'output/index.html'), 'utf8');
    assert.ok(html.includes('online-template-proof')); assert.ok(html.includes('ONLINE RUNTIME PROOF'));
    for (const dispose of disposers) await dispose();
  } finally { await f.dispose(); }
});

test('file package rejects traversal/case conflicts and checks authoritative ownership on every operation', async () => {
  const f = await fixture();
  try {
    for (const path of ['../outside', '/absolute', 'C:/outside', 'a\\b', 'x/../../y', 'x/CON.txt', 'x./y', 'node_modules/x']) assert.throws(() => packagePath(path), path);
    const detail = await f.call('copy', { workflowId: 'workdsh-ai-webapp' });
    const other = { ...actor, principalId: 'other' };
    assert.deepEqual(await f.call('list', {}, other), []);
    for (const action of ['get', 'save', 'publish', 'create', 'export']) await assert.rejects(f.call(action, { workflowId: detail.draft.id, expectedRevision: detail.draft.revision, patches: {} }, other), { code: 'workflows/forbidden' });
    await assert.rejects(f.call('save', { workflowId: detail.draft.id, expectedRevision: detail.draft.revision, patches: { 'UP.md': { encoding: 'utf8', content: 'a' }, 'up.md': { encoding: 'utf8', content: 'b' } } }), /大小写冲突/);
    assert.equal((await f.call('get', { workflowId: detail.draft.id })).draft.files['UP.md'], undefined);
    const exported = await f.call('export', { workflowId: detail.draft.id });
    assert.ok(!JSON.stringify(exported).includes('ownerPrincipalId'));
    assert.equal((await f.call('preview-import', { bundle: exported })).validation.ok, true);
    const imported = await f.call('import', { bundle: exported });
    assert.deepEqual(imported.draft.files, detail.draft.files); assert.notEqual(imported.draft.id, detail.draft.id);
    assert.ok(f.audits.every(event => !JSON.stringify(event).includes('content')));
  } finally { await f.dispose(); }
});

async function staged(f, nodes) {
  let detail = await f.call('copy', { workflowId: 'workdsh-ai-webapp' });
  let text = detail.draft.files['workflow.yaml'].content;
  for (const [key, value] of Object.entries({ mode: 'staged', start: nodes[0].id, stages: nodes })) text = patchYaml(text, [key], value);
  detail = await f.call('save', { workflowId: detail.draft.id, expectedRevision: detail.draft.revision, patches: { 'workflow.yaml': { encoding: 'utf8', content: text } } });
  return f.call('publish', { workflowId: detail.draft.id, expectedRevision: detail.draft.revision });
}
const task = (id, outputs, next, inputs) => ({ id, name: id, kind: 'task', prompt: 'Only execute this stage and deliver actual files.', outputs, next, ...(inputs ? { inputs } : {}) });
const end = { id: 'done', name: 'Done', kind: 'end' };
const complete = (f, sessionId, kind = 'completed') => f.sessions.get(sessionId).events.push({ type: 'turn/end', data: { turn: 1, reason: { kind } } });
const runAction = (f, run, action, extra = {}) => f.call(action, { workflowId: run.workflowId, runId: run.id, expectedRunRevision: run.revision, ...extra });
const startRun = async (f, detail) => {
  const created = await f.call('create', { workflowId: detail.draft.id, sessionId: randomUUID(), workspaceId: 'synthetic-workspace' });
  return (await f.call('runs', { workflowId: detail.draft.id })).find(row => row.id === created.runId);
};

test('staged native sessions require settled turns and fresh files, persist checkpoints, gate approval and pause', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.home, 'result.md'), 'old output');
    const detail = await staged(f, [
      task('draft', ['result.md'], 'check'),
      { id: 'check', name: 'Check output', kind: 'check', outputs: ['result.md'], next: 'review' },
      { id: 'review', name: 'Human review', kind: 'approval', next: 'branch' },
      { id: 'branch', name: 'Conditional delivery', kind: 'branch', file: 'optional.md', whenTrue: 'final', whenFalse: 'done' },
      task('final', ['final.md'], 'done', ['result.md']), end,
    ]);
    let run = await startRun(f, detail);
    assert.equal(f.calls.length, 1); assert.ok(f.calls[0].agentPreset.endsWith('-stage-draft'));
    assert.ok(f.presets.get(f.calls[0].agentPreset).plugins.find(row => row.name === '@deepseek-ai/dsh-persona').config.prefix.includes('Only execute this stage and deliver actual files.'));
    run = await runAction(f, run, 'run-continue'); assert.match(run.error, /任务尚未开始/); assert.equal(run.status, 'active'); assert.equal(run.phase, 'ready'); assert.equal(run.current, 'draft');
    complete(f, run.sessionId, 'cancelled');
    run = await runAction(f, run, 'run-continue'); assert.equal(run.status, 'failed');
    complete(f, run.sessionId);
    run = await runAction(f, run, 'run-continue'); assert.match(run.error, /旧文件/);
    const agent = { id: run.sessionId, session: { header: { agentPreset: f.calls[0].agentPreset } } };
    const before = run;
    run = await runAction(f, run, 'run-pause'); assert.equal(run.status, 'paused'); assert.deepEqual(f.cancelled, [run.sessionId]);
    await assert.rejects(f.editor.admit(agent, signal, false), { code: 'workflows/stage-inactive' });
    await assert.rejects(runAction(f, before, 'run-resume'), { code: 'workflows/conflict' });
    run = await runAction(f, run, 'run-resume'); await f.editor.admit(agent, signal, false);
    await writeFile(join(f.home, 'result.md'), 'new output after stage began');
    run = await runAction(f, run, 'run-continue'); assert.equal(run.status, 'awaiting-approval'); assert.equal(run.current, 'review');
    assert.equal(run.receipts[0].files['result.md'].length, 64); assert.equal(f.calls.length, 1, 'no agent/model loop');
    await assert.rejects(f.editor.admit(agent, signal, false), { code: 'workflows/stage-inactive' });
    await f.restart();
    run = (await f.call('runs', { workflowId: detail.draft.id }))[0]; assert.equal(run.status, 'awaiting-approval');
    run = await runAction(f, run, 'run-approve', { approve: false }); assert.equal(run.status, 'paused');
    run = await runAction(f, run, 'run-resume');
    run = await runAction(f, run, 'run-approve', { approve: true }); assert.equal(run.status, 'completed');
    assert.equal(run.receipts.find(row => row.stageId === 'branch').decision, false); assert.equal(f.calls.length, 1);
    await assert.rejects(f.call('create', { workflowId: detail.draft.id, sessionId: before.sessionId, workspaceId: 'synthetic-workspace' }), { code: 'workflows/conflict' });
    assert.deepEqual(await f.call('runs', { workflowId: detail.draft.id }, { ...actor, principalId: 'other' }).catch(error => error.code), 'workflows/forbidden');
  } finally { await f.dispose(); }
});

test('accepted inputs cannot change silently; repair preserves history and retries session creation without advancing', async () => {
  const f = await fixture();
  try {
    const detail = await staged(f, [
      task('draft', ['result.md'], 'review'),
      { id: 'review', name: 'Human review', kind: 'approval', next: 'branch' },
      { id: 'branch', name: 'Optional output', kind: 'branch', file: 'optional.md', whenTrue: 'final', whenFalse: 'done' },
      task('final', ['final.md'], 'done', ['result.md']), end,
    ]);
    let run = await startRun(f, detail), first = run.sessionId;
    await writeFile(join(f.home, 'result.md'), 'accepted draft'); await writeFile(join(f.home, 'optional.md'), 'enable final'); complete(f, first);
    run = await runAction(f, run, 'run-continue'); assert.equal(run.status, 'awaiting-approval');
    await writeFile(join(f.home, 'result.md'), 'unreviewed change');
    run = await runAction(f, run, 'run-approve', { approve: true }); assert.equal(run.status, 'failed'); assert.match(run.error, /输入文件发生变化/);
    run = await runAction(f, run, 'run-repair'); assert.equal(run.sessionId, first); assert.equal(run.current, 'draft'); assert.ok(run.receipts.some(row => row.reset));
    await writeFile(join(f.home, 'result.md'), 'repaired and reviewed draft');
    run = await runAction(f, run, 'run-continue');
    f.failCreate();
    run = await runAction(f, run, 'run-approve', { approve: true }); assert.equal(run.status, 'failed'); assert.match(run.error, /transient/);
    const reserved = run.sessionId;
    run = await runAction(f, run, 'run-continue'); assert.equal(run.status, 'active'); assert.equal(run.sessionId, reserved); assert.equal(run.current, 'final');
    assert.equal(f.calls.at(-1).sessionId, reserved);
    run = await runAction(f, run, 'run-continue'); assert.match(run.error, /任务尚未开始/); assert.equal(run.status, 'active'); assert.equal(run.phase, 'ready');
    await writeFile(join(f.home, 'final.md'), 'final deliverable'); complete(f, reserved);
    run = await runAction(f, run, 'run-continue'); assert.equal(run.status, 'completed');
    assert.ok(run.receipts.filter(row => row.stageId === 'draft' && row.files).length === 2);
  } finally { await f.dispose(); }
});

test('invalid stage graphs remain editable but reject disconnected nodes, cycles, unsupported start and unsafe output paths', async () => {
  const f = await fixture();
  try {
    for (const nodes of [
      [task('draft', ['result.md'], 'done'), end, { id: 'unused', name: 'Unused', kind: 'end' }],
      [task('draft', ['result.md'], 'again'), task('again', ['again.md'], 'draft')],
      [{ id: 'review', name: 'Review', kind: 'approval', next: 'done' }, end],
      [task('draft', ['../escape.md'], 'done'), end],
    ]) await assert.rejects(staged(f, nodes), { code: 'workflows/invalid-draft' });
    let detail = await staged(f, [task('draft', ['result.md'], 'done'), end]);
    detail = await f.call('save', { workflowId: detail.draft.id, expectedRevision: detail.draft.revision, patches: { 'preset/agent.cordis.yml': { encoding: 'utf8', content: patchYaml(detail.draft.files['preset/agent.cordis.yml'].content, [0, 'disabled'], true) } } });
    await assert.rejects(f.call('publish', { workflowId: detail.draft.id, expectedRevision: detail.draft.revision }), { code: 'workflows/invalid-draft' });
  } finally { await f.dispose(); }
});

test('archive withdraws a paused workflow from new runs while retaining recoverable project history', async () => {
  const f = await fixture();
  try {
    const detail = await staged(f, [task('draft', ['result.md'], 'done'), end]), id = detail.draft.id;
    let run = await startRun(f, detail);
    await assert.rejects(f.call('archive', { workflowId: id, expectedRevision: detail.draft.revision }), { code: 'workflows/conflict' });
    const request = { workflowId: id, expectedRevision: detail.draft.revision, operationId: 'archive-once' };
    await assert.rejects(f.call('archive', request, { ...actor, principalId: 'other' }), { code: 'workflows/forbidden' });
    run = await runAction(f, run, 'run-pause');
    const archived = await f.call('archive', request);
    assert.deepEqual(await f.call('archive', request), archived);
    assert.deepEqual(await f.call('list'), []);
    assert.equal((await f.call('list', { includeArchived: true }))[0].archivedAt, archived.archivedAt);
    assert.deepEqual(await f.call('list', { includeArchived: true }, { ...actor, principalId: 'other' }), []);
    assert.deepEqual((await f.call('get', { workflowId: id, revisionId: detail.draft.publishedRevision })).draft.files, detail.draft.files);
    assert.equal((await f.call('runs', { workflowId: id }))[0].id, run.id);
    await assert.rejects(f.call('create', { workflowId: id, sessionId: randomUUID(), workspaceId: 'synthetic-workspace' }), { code: 'workflows/archived' });
    await assert.rejects(runAction(f, run, 'run-resume'), { code: 'workflows/archived' });
    await f.restart();
    assert.deepEqual(await f.call('list'), []);
    assert.equal((await f.call('export', { workflowId: id })).files['workflow.yaml'].content, detail.draft.files['workflow.yaml'].content);
    await assert.rejects(f.call('restore', { workflowId: id, expectedRevision: detail.draft.revision }), { code: 'workflows/conflict' });
    await f.call('restore', { workflowId: id, expectedRevision: archived.revision });
    assert.equal((await f.call('list')).length, 1);
    run = await runAction(f, run, 'run-resume');
    assert.equal(run.current, 'draft'); assert.equal(run.status, 'active');
    assert.equal(f.calls.length, 1, 'archive/restore never recreates the historical Session');
  } finally { await f.dispose(); }
});

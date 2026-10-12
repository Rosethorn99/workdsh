import { test } from 'node:test';
import { createRequire } from 'node:module';
const { parseDocument } = createRequire(new URL('../../../../packages/plugins/experts/package.json', import.meta.url))('yaml');
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkflowCatalog, workflowPreset, registerWorkflowPresets, listWorkflows, configureFeishu, createWorkflowSession } from '../../../../packages/plugins/experts/dist/workflows/host.js';
import { apply as applyFeishu } from '../../../../packages/plugins/experts/dist/workflows/feishu.js';
import { apply as applyDeck } from '../../../../packages/plugins/experts/resources/workflows/adapters/motion-deck/index.js';
import { apply as applyImages } from '../../../../packages/plugins/experts/resources/workflows/adapters/content-imagegen/index.js';

const standard = [
  { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'standard' } },
  { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
  { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
  { id: 'planning', name: 'cordis:group', group: true, isolate: { planMode: true }, config: [{ id: 'plan', name: '@deepseek-ai/dsh-plan-mode' }] },
];
function toolsContext() {
  const tools = new Map(), effects = [];
  const ctx = { tools: { register(tool) { assert.ok(!tools.has(tool.name)); tools.set(tool.name, tool); return () => tools.delete(tool.name); } }, effect(register) { const dispose = register(); effects.push(dispose); } };
  return { ctx, tools, async dispose() { for (const effect of effects.reverse()) if (typeof effect === 'function') await effect(); } };
}

test('seven packaged workflows retain nine skills, references, adapters and licenses', async () => {
  const catalog = await readWorkflowCatalog();
  assert.equal(catalog.workflows.length, 7);
  assert.equal(new Set(catalog.workflows.map(row => row.id)).size, 7);
  assert.equal(catalog.workflows.reduce((n, row) => n + row.skills.length, 0), 9);
  const root = new URL('../../../../packages/plugins/experts/resources/workflows/', import.meta.url);
  assert.match(await readFile(new URL('LICENSE', root), 'utf8'), /MIT License/);
  const manifest = JSON.parse(await readFile(new URL('source-manifest.json', root), 'utf8'));
  assert.equal(Object.keys(manifest.files).length, 98);
  const { createHash } = await import('node:crypto');
  for (const [path, expected] of Object.entries(manifest.files)) {
    const bytes = await readFile(new URL(path, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, 'unaltered source: ' + path);
  }
  for (const workflow of catalog.workflows) {
    for (const skill of workflow.skills) {
      const path = new URL(workflow.sourceId + '/preset/skills/' + skill + '/SKILL.md', root);
      assert.match(await readFile(path, 'utf8'), /^---/);
    }
    const preset = await workflowPreset(workflow, standard);
    assert.equal(preset.id, workflow.id);
    assert.ok(preset.plugins.find(row => row.id === 'persona').config.prefix.length > 40);
    const source = parseDocument(await readFile(new URL(workflow.sourceId + '/preset/agent.cordis.yml', root), 'utf8'), { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] }).toJS();
    assert.deepEqual(preset.plugins.map(row => row.id), source.map(row => row.id), 'all original rows, in original order');
    const flatten = rows => rows.flatMap(row => [row, ...(row.group ? flatten(row.config) : [])]);
    for (const original of flatten(source)) {
      const adapted = flatten(preset.plugins).find(row => row.id === original.id);
      if (['persona','skill-filesystem','mcp-feishu','mcp-datetime','workflow-worker-thread'].includes(original.id) || original.name.startsWith('./')) continue;
      if (['tool-fs-search', 'tool-pwsh'].includes(original.id)) {
        assert.match(adapted.name, /\/adapters\/(fs-search|pwsh)\/index\.js$/);
      } else assert.equal(adapted.name, original.name);
      if (original.group) assert.deepEqual(adapted.config.map(row => row.id), original.config.map(row => row.id));
      else assert.deepEqual(adapted.config, original.config, 'original parameters: ' + original.id);
      if (typeof original.disabled === 'boolean') assert.equal(adapted.disabled, original.disabled);
      assert.deepEqual(adapted.isolate, original.isolate);
    }
    if (workflow.id === 'workdsh-video-generation') assert.equal(preset.plugins.find(row => row.id === 'tool-web').config.searchMaxResults, 8);
    if (workflow.id === 'workdsh-llm-wiki-producer') assert.equal(flatten(preset.plugins).find(row => row.id === 'workflow-worker-thread').name, '@deepseek-ai/dsh-workflow-ptc');
    const provider = preset.plugins.find(row => row.id === 'skill-filesystem');
    assert.equal(provider.config.includeDefaultRoots ?? true, workflow.id === 'workdsh-llm-wiki-producer');
    assert.ok((await readdir(provider.config.customSkillDirs[0])).length);
    assert.ok(!JSON.stringify(preset).includes('credentialEnv'));
    for (const row of preset.plugins.filter(row => row.id.endsWith('-tools'))) { assert.ok(row.name.startsWith('file:'), 'Loader adapters use portable file URLs'); await readFile(new URL(row.name)); const original = source.find(item => item.id === row.id); assert.equal(fileURLToPath(new URL(row.name)), fileURLToPath(new URL(manifest.runtimeAdapters[workflow.sourceId + '/preset/' + original.name.slice(2)], root)), 'only the documented runtime adapter is mounted'); }
  }
  assert.equal(standard[0].config.prefix, 'standard');
});

test('workflow registration is lifecycle-owned and does not list presets during Host activation', async () => {
  const definitions = [], effects = [];
  const ctx = {
    loader: { entries: () => [{ disabled: false, options: { name: '@deepseek-ai/dsh-agent-preset', config: { id: 'standard', plugins: standard } } }] },
    agentPresets: { async register(definition) { definitions.push(definition); return async () => definitions.splice(definitions.indexOf(definition), 1); }, list() { throw Error('activation must not await its own Host tree'); } },
    effect(register) { effects.push(register()); },
  };
  await registerWorkflowPresets(ctx);
  assert.equal(definitions.length, 7);
  for (const dispose of effects.reverse()) await dispose();
  assert.equal(definitions.length, 0);
});

test('credential settings are write-only; missing/broken workflows cannot create sessions', async () => {
  const writes = [];
  const rows = (await readWorkflowCatalog()).workflows;
  const ctx = {
    credentials: { describe: async () => ({ configured: false }), set: async (ref, value) => writes.push([ref, value]) },
    agentPresets: { list: async () => rows.map(row => ({ id: row.id })) },
    workdshSessionAccess: { create() { throw Error('unexpected session creation'); } },
  };
  const catalog = await listWorkflows(ctx);
  assert.equal(catalog.workflows.find(row => row.id === 'workdsh-feishu-digital-employee').configured, false);
  assert.ok(!JSON.stringify(catalog).includes('synthetic-secret'));
  await assert.rejects(createWorkflowSession(ctx, { workflowId: 'workdsh-feishu-digital-employee' }, new AbortController().signal), /先配置飞书/);
  await assert.rejects(createWorkflowSession(ctx, { workflowId: '../unknown' }, new AbortController().signal), /暂不可用/);
  await assert.rejects(configureFeishu(ctx, { FEISHU_APP_ID: 'synthetic' }, new AbortController().signal));
  assert.equal(writes.length, 0);
  assert.deepEqual(await configureFeishu(ctx, { FEISHU_APP_ID: 'synthetic', FEISHU_APP_SECRET: 'synthetic-secret', FEISHU_DEFAULT_OPEN_ID: 'ou_synthetic' }, new AbortController().signal), { saved: true });
  assert.equal(writes.length, 3);
});

test('workflow session uses authorized native ingress and caller-stable identity', async () => {
  const rows = (await readWorkflowCatalog()).workflows, calls = [];
  const ctx = { credentials: { describe: async () => ({ configured: false }) }, agentPresets: { list: async () => rows.map(row => ({ id: row.id })) }, workdshSessionAccess: { async create(request) { calls.push(request); return { sessionId: request.sessionId }; } } };
  const input = { workflowId: 'workdsh-ai-webapp', sessionId: '00000000-0000-4000-8000-000000000001', cwd: '/synthetic/workspace', workspaceId: 'synthetic-workspace' };
  assert.equal((await createWorkflowSession(ctx, input, new AbortController().signal)).sessionId, input.sessionId);
  assert.deepEqual(calls[0], { sessionId: input.sessionId, workspaceId: input.workspaceId, agentPreset: input.workflowId });
});

test('PPT adapter generates and inspects a real eight-page offline deck on this platform', async () => {
  const home = await mkdtemp(join(tmpdir(), 'workdsh-workflow-'));
  const fixture = toolsContext(); applyDeck(fixture.ctx);
  try {
    await mkdir(join(home, 'generated/test-deck/input'), { recursive: true });
    const outline = { deck: { title: 'Workflow regression', brand: 'WorkDSH' }, slides: Array.from({ length: 8 }, (_, i) => ({ section: 'Phase ' + (i + 1), title: 'Title ' + (i + 1), summary: 'Synthetic content for validation.', points: ['Read', 'Build', 'Verify'] })) };
    await writeFile(join(home, 'generated/test-deck/input/outline.json'), JSON.stringify(outline));
    const execution = { signal: new AbortController().signal, agent: { session: { header: { cwd: home } } } };
    const rendered = await fixture.tools.get('render_motion_deck').execute({ project_dir: 'generated/test-deck', theme: 'ocean', focus: 'result' }, execution);
    assert.equal(rendered.pages, 8);
    const inspected = await fixture.tools.get('inspect_motion_deck').execute({ project_dir: 'generated/test-deck' }, execution);
    assert.equal(inspected.ok, true);
    assert.equal(inspected.motions.length, 8);
    const html = await readFile(join(home, 'generated/test-deck/output/index.html'), 'utf8');
    assert.ok(html.includes('Workflow regression'));
    // Exercise the delivered animation helper at its real cancellation boundary.
    const { runInNewContext } = await import('node:vm');
    const helper = html.match(/const animateItem = ([\s\S]*?);\s*const stagger =/)[1];
    let frames, complete, canceled = false;
    const item = { animate(value) { frames = value; return { finished: new Promise(resolve => { complete = resolve; }), cancel() { canceled = true; } }; } };
    const animate = runInNewContext('(' + helper + ')', { getComputedStyle: () => ({ transform: 'matrix(1, 0, 0, 1, 0, 18)' }) });
    animate({ _motionAnimations: [] }, item, [{ opacity: 0, transform: 'translateY(34px) scale(.95)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }]);
    assert.equal(frames.at(-1).transform, 'matrix(1, 0, 0, 1, 0, 18)', 'finished animation must retain the underlying layout transform');
    assert.equal(frames[0].opacity, 0, 'fade-in remains transparent at entry');
    complete(); await Promise.resolve(); assert.equal(canceled, true, 'release completed effects for theme changes');
    animate({ _motionAnimations: [] }, item, [{ opacity: 0, transform: 'translate(-50%, -50%) scale(.4)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }]);
    assert.equal(frames.at(-1).transform, 'matrix(1, 0, 0, 1, 0, 18)', 'absolute centering must not be applied twice');
    assert.ok(!frames[0].transform.includes('-50%'), 'entry transform uses the computed layout anchor');
    assert.equal([...html.matchAll(/class="nav-dot"/g)].length, 8, 'one navigation button per slide');
    for (const selector of ['task-core', 'compare-layout', 'compare-col', 'action-stack', 'assembly-stage', 'assembly-note', 'pipeline-grid', 'console-log', 'constellation-layout', 'constellation-stage', 'constellation-lines', 'decision-stage', 'decision-rail', 'converge-stage', 'results-halo']) assert.ok(html.includes(selector), 'retained original scene contract: ' + selector);
    for (const id of ['previewStage', 'previewKicker', 'previewTitle', 'previewText']) assert.equal([...html.matchAll(new RegExp('id="' + id + '"', 'g'))].length, 1, 'interactive preview binds ' + id);
    assert.equal([...html.matchAll(/data-preview-control=/g)].length, 2, 'both theme and focus preview controls retained');
    await writeFile(join(home, 'generated/test-deck/output/index.html'), html.replace('class="task-core"', 'class="cover-visual"'));
    await assert.rejects(fixture.tools.get('inspect_motion_deck').execute({ project_dir: 'generated/test-deck' }, execution), /场景结构/);
    await writeFile(join(home, 'generated/test-deck/output/index.html'), html.replace('class="nav-dot"', 'class="wrong-nav"'));
    await assert.rejects(fixture.tools.get('inspect_motion_deck').execute({ project_dir: 'generated/test-deck' }, execution), /导航/);
    await writeFile(join(home, 'generated/test-deck/output/index.html'), html.replace('id="previewStage"', 'id="brokenPreview"'));
    await assert.rejects(fixture.tools.get('inspect_motion_deck').execute({ project_dir: 'generated/test-deck' }, execution), /交互/);
    await assert.rejects(fixture.tools.get('render_motion_deck').execute({ project_dir: '../outside', theme: 'ocean', focus: 'result' }, execution));
  } finally { await fixture.dispose(); assert.equal(fixture.tools.size, 0); await rm(home, { recursive: true, force: true }); }
});

test('official MCP bridge runs the packaged datetime server and disposes its children/tools', async () => {
  const fixture = toolsContext();
  fixture.ctx.credentials = { resolve: async () => undefined };
  applyFeishu(fixture.ctx, { serverName: 'feishu', toolCallTimeoutMs: 60000 });
  applyFeishu(fixture.ctx, { serverName: 'datetime', toolCallTimeoutMs: 10000 });
  try {
    assert.equal(fixture.tools.size, 2);
    const result = await fixture.tools.get('mcp__datetime__resolve_deadline').execute({ text: '2026-10-10 18:00' }, { signal: new AbortController().signal });
    assert.ok(JSON.stringify(result).includes('2026-10-10'));
    await assert.rejects(fixture.tools.get('mcp__feishu__task_v2_task_create').execute({ data: { summary: 'Do not send' } }, { signal: new AbortController().signal }), /请先配置/);
  } finally { await fixture.dispose(); assert.equal(fixture.tools.size, 0); }
});

test('image adapter exposes its two tools and revokes them without paid execution', async () => {
  const fixture = toolsContext(); applyImages(fixture.ctx);
  assert.deepEqual([...fixture.tools.keys()].sort(), ['generate_content_image', 'inspect_content_series']);
  await fixture.dispose(); assert.equal(fixture.tools.size, 0);
});

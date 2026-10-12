import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readWorkflowCatalog, workflowPreset } from '../../../../packages/plugins/experts/dist/workflows/host.js';

const require = createRequire(new URL('../../../../packages/plugins/experts/package.json', import.meta.url));
const webRequire = createRequire(new URL('../../package.json', import.meta.url));
const runtimeRequire = createRequire(webRequire.resolve('@deepseek-ai/dsh/package.json'));
const baseRequire = createRequire(runtimeRequire.resolve('@deepseek-ai/dsh-base'));
const load = name => import(name.startsWith('file:') ? name : pathToFileURL(require.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { default: Subprocess } = await import(pathToFileURL(baseRequire.resolve('@deepseek-ai/dsh-subprocess-local')).href);
const { default: Pwsh } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-pwsh-local')).href);
const search = await load('@deepseek-ai/dsh-tool-fs-search');
const workflow = (await readWorkflowCatalog()).workflows.find(row => row.id === 'workdsh-ai-webapp');
const preset = await workflowPreset(workflow);

function toolContext(runtime) {
  const tools = new Map(), hooks = [];
  return {
    tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); }, get(name) { return tools.get(name); } },
    subprocess: runtime.subprocess,
    shell: runtime.shell,
    shellEnv: { collect() { return {}; } },
    systemPrompt: { section() {}, getSectionOrder() { return 0; } },
    logger: { warn() {} },
    get() {},
    on(name, callback) { hooks.push({ name, callback }); },
    effect(register) { return register(); },
    inject() {},
    hooks,
  };
}

test('workflow glob prunes dependency caches while retaining source, hidden context and explicit cache access', async () => {
  await mkdir(new URL('../../../../.artifacts/studio-runtime-tests/', import.meta.url), { recursive: true });
  const directory = await mkdtemp(new URL('../../../../.artifacts/studio-runtime-tests/search-', import.meta.url));
  const runtime = new Context();
  await runtime.plugin(Subprocess);
  try {
    for (const file of ['AGENTS.md', '.scratch/mes/spec.md', 'src/main.ts', 'node_modules/vendor/README.md', '.artifacts/profile/README.md', '.pnpm-store/vendor/README.md', 'apps/desktop/build/official-release-cache/README.md', '.yarn/cache/dependency.md', '.yarn/patches/source.patch']) {
      await mkdir(join(directory, file, '..'), { recursive: true });
      await writeFile(join(directory, file), 'fixture');
    }
    const ctx = toolContext(runtime);
    const module = await load(preset.plugins.find(row => row.id === 'tool-fs-search').name);
    await module.apply(ctx, {
      globMaxResults: search.GLOB_MAX_RESULTS, grepMaxMatches: search.GREP_MAX_MATCHES,
      grepMaxLineBytes: search.GREP_MAX_LINE_BYTES, searchMetaMaxBytes: search.SEARCH_META_MAX_BYTES,
      rawOutputMaxBytes: search.RAW_OUTPUT_MAX_BYTES, graceMs: search.SEARCH_GRACE_MS,
      stderrMaxBytes: search.SEARCH_STDERR_MAX_BYTES, timeoutMs: search.SEARCH_TIMEOUT_MS,
      sampleOverCapGlobResults: false,
    });
    const exec = { name: 'glob', signal: new AbortController().signal, agent: { session: { header: { cwd: directory } } } };
    const glob = ctx.tools.get('glob');
    const result = await glob.execute({ pattern: '*', path: '.' }, exec);
    const paths = result.paths.map(path => path.replaceAll('\\', '/'));
    assert.ok(paths.some(path => path.endsWith('/AGENTS.md')));
    assert.ok(paths.some(path => path.endsWith('/.scratch/mes/spec.md')));
    assert.ok(paths.some(path => path.endsWith('/.yarn/patches/source.patch')));
    assert.equal(paths.some(path => /node_modules|\.artifacts|\.pnpm-store|official-release-cache|\.yarn\/cache/.test(path)), false, 'broad discovery must not traverse generated runtime caches');
    const explicit = await glob.execute({ pattern: '*.md', path: 'node_modules' }, exec);
    assert.ok(explicit.paths.some(path => path.replaceAll('\\', '/').endsWith('/vendor/README.md')));
    const explicitPattern = await glob.execute({ pattern: '**/.artifacts/**/*.md', path: '.' }, exec);
    assert.ok(explicitPattern.paths.some(path => path.replaceAll('\\', '/').endsWith('/.artifacts/profile/README.md')));
    assert.match(glob.description, /cache|缓存/);
    assert.ok(ctx.hooks.some(hook => hook.name === 'tools/post-execute'), 'official result spilling remains registered');
  } finally {
    await runtime.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Windows workflow pwsh executes directory discovery with a compatible engine', { skip: process.platform !== 'win32' }, async () => {
  const runtime = new Context();
  await runtime.plugin(Subprocess);
  await runtime.plugin(Pwsh, { timeoutMs: 5000, maxTimeoutMs: 5000 });
  try {
    const ctx = toolContext(runtime);
    const module = await load(preset.plugins.find(row => row.id === 'tool-pwsh').name);
    await module.apply(ctx, { enableRunInBackground: false });
    const result = await ctx.tools.get('pwsh').execute({ command: 'Get-ChildItem -Depth 1 | Select-Object -First 30 Name, Length', description: 'Check root directory contents' }, {
      name: 'pwsh', signal: new AbortController().signal, agent: { session: { header: { cwd: process.cwd() } } },
    });
    assert.equal(result.exitCode, 0, result.stderr.text);
    assert.equal(result.timedOut, false);
    assert.match(result.stdout.text, /Name/);
    assert.doesNotMatch(result.stderr.text, /CET/);
  } finally {
    await runtime.fiber.dispose();
  }
});

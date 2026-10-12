import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry';
import type { SessionCreateRequest } from '@deepseek-ai/dsh-api-session-controller';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { parseDocument } from 'yaml';
import type { WorkflowCatalog, WorkflowDefinition } from './catalog.js';

const resources = new URL('../../resources/workflows/', import.meta.url);
const runtimeAdapters: Record<string, string> = {
  'fufan-ppt-office/preset/runtime/motion-deck/index.js': 'adapters/motion-deck/index.js',
  'fufan-content-factory/preset/runtime/content-imagegen/index.js': 'adapters/content-imagegen/index.js',
};
export const feishuReferences = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_DEFAULT_OPEN_ID'] as const;

export async function readWorkflowCatalog(): Promise<WorkflowCatalog> {
  return JSON.parse(await readFile(new URL('catalog.json', resources), 'utf8')) as WorkflowCatalog;
}

/** Studio expressions are data: resolve only the pinned path/platform expressions, never eval. */
export async function workflowPreset(workflow: WorkflowDefinition, _standard?: PresetDefinition['plugins'], options: { directory?: URL; adapterRoot?: URL; text?: string; runtimeOverrides?: Record<string, string> } = {}): Promise<PresetDefinition> {
  const directory = options.directory ?? new URL(workflow.sourceId + '/preset/', resources);
  const document = parseDocument(options.text ?? await readFile(new URL('agent.cordis.yml', directory), 'utf8'), {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (expression: string) => ({ studioExpression: expression }) }],
  });
  if (document.errors.length) throw new Error('工作流来源配置无法解析。');
  const resolveValue = (value: unknown): any => {
    if (Array.isArray(value)) return value.map(resolveValue);
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (typeof record.studioExpression === 'string') {
      const expression = record.studioExpression;
      if (expression === "process.platform === 'win32'") return process.platform === 'win32';
      if (expression === "process.platform !== 'win32'") return process.platform !== 'win32';
      if (expression === 'process.execPath') return process.execPath;
      for (const path of ['skills/', 'runtime/feishu-mcp.mjs', 'runtime/datetime-mcp.mjs']) {
        if (expression === "process.getBuiltinModule('node:url').fileURLToPath(new URL('" + path + "', baseUrl))") return fileURLToPath(new URL(path, directory));
      }
      throw new Error('工作流含未适配的来源表达式：' + expression);
    }
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, resolveValue(child)]));
  };
  const plugins = resolveValue(document.toJS({ maxAliasCount: 0 })) as PresetDefinition['plugins'][number][];
  if (!Array.isArray(plugins)) throw new Error('工作流 Preset 必须是插件数组。');
  const adapt = (rows: PresetDefinition['plugins'][number][]) => {
    for (const row of rows) {
      if (row.group) { adapt(row.config as PresetDefinition['plugins'][number][]); continue; }
      if (row.name === '@deepseek-ai/dsh-persona') {
        const { text, ...config } = row.config as Record<string, unknown>;
        if (typeof text !== 'string' || !text) throw new Error('工作流缺少角色说明。');
        row.config = { ...config, prefix: text, suffix: '', complete: false, includeRuntimeContext: true };
      } else if (row.name === '@deepseek-ai/dsh-workflow-worker-thread') {
        // The published runtime renamed this provider; its config and scope are unchanged.
        row.name = '@deepseek-ai/dsh-workflow-ptc';
      } else if (row.name === '@deepseek-ai/dsh-tool-fs-search') {
        row.name = new URL('adapters/fs-search/index.js', resources).href;
      } else if (row.name === '@deepseek-ai/dsh-tool-pwsh') {
        row.name = new URL('adapters/pwsh/index.js', resources).href;
      } else if (row.name === '@deepseek-ai/dsh-mcp-client') {
        const config = row.config as { serverName: string; toolCallTimeoutMs: number };
        if (!['feishu', 'datetime'].includes(config.serverName)) throw new Error('未知工作流 MCP 服务。');
        row.name = new URL('feishu.js', import.meta.url).href;
        row.config = { serverName: config.serverName, toolCallTimeoutMs: config.toolCallTimeoutMs,
          ...(options.directory ? { scriptPath: fileURLToPath(new URL('runtime/' + (config.serverName === 'feishu' ? 'feishu-mcp.mjs' : 'datetime-mcp.mjs'), directory)) } : {}) };
      } else if (row.name?.startsWith('./runtime/')) {
        const adapter = runtimeAdapters[workflow.sourceId + '/preset/' + row.name.slice(2)];
        if (row.name.includes('..') || row.name.includes('\\')) throw new Error('运行模块必须位于工作流 runtime 目录。');
        const override = options.runtimeOverrides?.[row.name];
        row.name = override ? new URL('../' + override, directory).href : adapter ? new URL(adapter, options.adapterRoot ?? resources).href : new URL(row.name, directory).href;
      }
    }
  };
  adapt(plugins);
  return { id: workflow.id, name: workflow.name, description: workflow.description, order: workflow.order, plugins };
}

/** Register each complete source composition; do not await the Host tree during activation. */
export async function registerWorkflowPresets(ctx: Context): Promise<void> {
  for (const workflow of (await readWorkflowCatalog()).workflows) {
    const dispose = await ctx.agentPresets.register(await workflowPreset(workflow));
    ctx.effect(() => dispose);
  }
}

export async function listWorkflows(ctx: Context): Promise<WorkflowCatalog> {
  const catalog = await readWorkflowCatalog();
  const presets = new Map((await ctx.agentPresets.list()).map(row => [row.id, row]));
  const configured = (await Promise.all(feishuReferences.map(ref => ctx.credentials.describe(credentialRef(ref))))).every(info => info.configured);
  return { ...catalog, workflows: catalog.workflows.map(row => ({ ...row,
    ...(!presets.has(row.id) ? { broken: '工作流尚未注册。' } : presets.get(row.id)?.broken ? { broken: presets.get(row.id)!.broken } : {}),
    ...(row.id === 'workdsh-feishu-digital-employee' ? { configured } : {}),
  })) };
}

export async function createWorkflowSession(ctx: Context, input: Record<string, unknown>, signal: AbortSignal) {
  const workflow = (await listWorkflows(ctx)).workflows.find(row => row.id === input.workflowId);
  if (!workflow || workflow.broken) throw new Error('工作流暂不可用，请刷新后查看状态。');
  if (workflow.configured === false) throw new Error('请先配置飞书应用和默认负责人。');
  if (typeof input.workspaceId !== 'string' || !input.workspaceId || typeof input.sessionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.sessionId)) throw new Error('请先选择工作区。');
  // Access owns native Session admission and workspace authorization; no alternate executor.
  const request: SessionCreateRequest = {
    sessionId: input.sessionId as NonNullable<SessionCreateRequest['sessionId']>,
    workspaceId: input.workspaceId as NonNullable<SessionCreateRequest['workspaceId']>,
    agentPreset: workflow.id,
  };
  return ctx.workdshSessionAccess.create(request, signal);
}

/** Write-only UI operation. Neither catalog nor responses contain credential values. */
export async function configureFeishu(ctx: Context, input: Record<string, unknown>, signal: AbortSignal): Promise<{ saved: true }> {
  const values = feishuReferences.map(ref => input[ref]);
  if (values.some(value => typeof value !== 'string' || !value.trim() || value.length > 4096)) throw new Error('请填写飞书 App ID、App Secret 和默认负责人 open_id。');
  for (const [index, ref] of feishuReferences.entries()) {
    signal.throwIfAborted();
    await ctx.credentials.set(credentialRef(ref), (values[index] as string).trim());
  }
  return { saved: true };
}

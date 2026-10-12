import type { Context } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';

export const name = 'workdsh-feishu-workflow-tools';
export const inject = ['tools', 'credentials'];
const runtime = new URL('../../resources/workflows/fufan-feishu-digital-employee/preset/runtime/', import.meta.url);
const definitions = [
  { server: 'feishu', rawName: 'task_v2_task_create', script: 'feishu-mcp.mjs', description: '使用已配置的飞书自建应用创建真实任务；成功以飞书回执为准。', inputSchema: {
    type: 'object', additionalProperties: false, properties: {
      data: { type: 'object', description: '飞书任务字段，包括 summary、description、due、members。' },
      params: { type: 'object', additionalProperties: false, properties: { user_id_type: { type: 'string', enum: ['open_id'] } } },
    }, required: ['data'],
  } },
  { server: 'datetime', rawName: 'resolve_deadline', script: 'datetime-mcp.mjs', description: '按 Asia/Shanghai 将中文日期转换为飞书截止时间。', inputSchema: {
    type: 'object', additionalProperties: false, properties: { text: { type: 'string', minLength: 1 } }, required: ['text'],
  } },
] as const;

/** The official MCP SDK and DSH output bridge own protocol/validation. Secrets only reach the child env. */
export function apply(ctx: Context, config: { serverName?: string; toolCallTimeoutMs?: number; scriptPath?: string } = {}): void {
  const lifetime = new AbortController();
  const pending = new Set<Promise<unknown>>();
  ctx.effect(() => async () => { lifetime.abort(); await Promise.allSettled([...pending]); });
  for (const definition of definitions.filter(row => !config.serverName || row.server === config.serverName)) {
    const timeoutMs = config.toolCallTimeoutMs ?? (definition.server === 'datetime' ? 10000 : 60000);
    const tool = createMcpToolDefinition(ctx, {
      name: 'mcp__' + definition.server + '__' + definition.rawName,
      rawName: definition.rawName, description: definition.description,
      inputSchema: definition.inputSchema,
      call(args, execution) {
        const operation = (async () => {
          const signal = AbortSignal.any([execution.signal, lifetime.signal, AbortSignal.timeout(timeoutMs)]);
          signal.throwIfAborted();
          const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1' };
          // Re-resolve each operation. Values never enter declarative config, prompts, responses or disk.
          if (definition.server === 'feishu') for (const ref of ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_DEFAULT_OPEN_ID']) {
            const credential = await ctx.credentials.resolve(credentialRef(ref));
            if (!credential) throw new Error('请先配置飞书应用和默认负责人。');
            env[ref] = credential.value;
          }
          signal.throwIfAborted();
          const client = new Client({ name: 'workdsh-feishu-workflow', version: '1.0.0' });
          const transport = new StdioClientTransport({ command: process.execPath, args: [config.scriptPath ?? fileURLToPath(new URL(definition.script, runtime))], env, stderr: 'pipe' });
          const cancel = () => { void client.close().catch(() => undefined); };
          signal.addEventListener('abort', cancel, { once: true });
          try {
            await client.connect(transport, { signal, timeout: 10000 });
            return await client.callTool({ name: definition.rawName, arguments: args }, { signal, timeout: timeoutMs });
          } finally {
            signal.removeEventListener('abort', cancel);
            await client.close();
            await transport.close();
          }
        })();
        pending.add(operation);
        void operation.then(() => pending.delete(operation), () => pending.delete(operation));
        return operation;
      },
    });
    ctx.effect(() => ctx.tools.register(tool));
  }
}

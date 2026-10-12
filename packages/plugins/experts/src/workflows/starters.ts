import { stringify } from 'yaml';
import type { WorkflowDefinition } from './catalog.js';
import type { WorkflowDraft, WorkflowManifest } from './authoring.js';

export const workflowStarters = [
  { id: 'review', name: 'AI 任务 + 人工确认', description: '已连好开始、AI 任务、人工确认和结束，适合第一次创建。', preview: ['开始', 'AI 任务', '人工确认', '结束'] },
  { id: 'blank', name: '空白画布', description: '只保留开始节点，自由添加任务、专家团、分支和连接器。', preview: ['开始', '自由添加节点'] },
] as const;
export type WorkflowStarter = typeof workflowStarters[number]['id'];
export const userWorkflowSource: WorkflowDefinition = {
  id: 'user-workflow', sourceId: 'workdsh-user-workflow', name: '用户创建的工作流',
  role: '按节点配置执行任务', description: '', category: '自定义', deliverable: '节点声明的文件产出',
  requirements: '配置任务与产出，连接完整流程并校验后发布。', skills: [], order: 100,
};

/** A neutral native composition, independent of the seven pinned Studio presets. */
const preset = `- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: 按当前工作流节点的任务说明执行，只使用授权的工具和绑定能力，将结果保存为声明的产出文件。遇到不确定的业务要求先向用户澄清。
- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536
- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'
- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
  config:
    sampleOverCapGlobResults: false
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'
- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'
- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'
- id: tool-ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'
`;

export function newWorkflowSeed(name: unknown, description: unknown = '', starter: unknown = 'review'): Pick<WorkflowDraft, 'source' | 'upstream' | 'files'> {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('请填写工作流名称（1–120 个字符）。');
  if (typeof description !== 'string' || description.length > 4096 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(description)) throw new Error('工作流说明最多 4096 个字符。');
  if (!workflowStarters.some(row => row.id === starter)) throw new Error('请选择有效的起步方式。');
  const manifest: WorkflowManifest = { format: 'workdsh-workflow', version: 3, name: name.trim(), description: description.trim(),
    sourceId: userWorkflowSource.sourceId, entry: 'preset/agent.cordis.yml', mode: 'staged',
    execution: { executor: { kind: 'workflow' }, connectors: { mode: 'explicit', requirements: [] } },
    ...(starter === 'review' ? { start: 'task1', stages: [
      { id: 'task1', name: 'AI 任务', kind: 'task', prompt: '根据本次运行的用户需求完成任务，将完整结果保存到声明的产出文件。', outputs: ['generated/workflow-output/result.md'], next: 'review' },
      { id: 'review', name: '人工确认', kind: 'approval', next: 'done' },
      { id: 'done', name: '结束', kind: 'end' },
    ] } : { stages: [] }),
  };
  return { source: { ...userWorkflowSource, name: manifest.name, description: manifest.description }, upstream: { repository: '', commit: '', license: '用户自有内容' }, files: {
    'workflow.yaml': { encoding: 'utf8', content: stringify(manifest) },
    'preset/agent.cordis.yml': { encoding: 'utf8', content: preset },
    'layout.json': { encoding: 'utf8', content: '{"version":1,"mode":"auto","stages":{}}\n' },
  } };
}

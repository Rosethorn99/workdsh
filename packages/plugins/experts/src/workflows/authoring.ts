import { parseDocument, stringify } from 'yaml';
import type { WorkflowDefinition } from './catalog.js';
import type { ExpertRevisionRef, SkillRevisionRef, ModelSelectionRequest } from 'workdsh-contracts';
import { validateCondition } from './conditions.js';

export interface StageTeamRole {
  key: string; expert: ExpertRevisionRef; role: string; task: string;
  skills?: SkillRevisionRef[]; connectors?: string[];
}
export interface StageTeamConfig {
  lead: { expert: ExpertRevisionRef; goal: string };
  members: StageTeamRole[]; strategy: 'parallel' | 'sequential';
}
export interface StageTeamLock extends StageTeamConfig {
  roles: Record<string, { expert: ExpertRevisionRef; name: string; compositionDigest: string; skills: SkillRevisionRef[] }>;
}
export interface StageExecution {
  executor?: { kind: 'workflow' } | ({ kind: 'expert' | 'team' } & ExpertRevisionRef);
  team?: StageTeamConfig;
  skills?: SkillRevisionRef[];
  connectors?: { mode: 'inherit' | 'explicit'; requirements?: { serverName: string; required: boolean }[] };
  model?: ModelSelectionRequest;
}
export interface StageCapabilityLock {
  executor?: { kind: 'expert' | 'team'; expertId: string; revisionId: string; name: string; compositionDigest: string; teamMembers?: Record<string, ExpertRevisionRef> };
  team?: StageTeamLock;
  skills: SkillRevisionRef[];
  connectors: { serverName: string; required: boolean }[];
  model?: ModelSelectionRequest;
}
export interface CapabilityCatalog {
  experts: { id: string; name: string; kind: 'expert' | 'team'; revisionId: string; description: string; members: string[]; team?: StageTeamConfig }[];
  skills: { name: string; description: string; state: string; selectable: boolean; reason?: string }[];
  connectors: { id: string; title: string; serverName: string; state: string; toolNames: readonly string[] }[];
  diagnostics: string[];
}

export interface WorkflowFile { encoding: 'utf8' | 'base64'; content: string }
export interface WorkflowManifest {
  format: 'workdsh-workflow'; version: 1 | 2 | 3 | 4 | 5;
  name: string; description: string; mode: 'compatible' | 'staged';
  sourceId: string; entry: 'preset/agent.cordis.yml';
  runtimeOverrides?: Record<string, string>;
  start?: string; stages?: WorkflowStage[];
  execution?: StageExecution;
}
export interface AppGenGate { kind: 'app-gen'; step: number; context: string }
export interface WorkflowCondition {
  source: 'literal' | 'file'; input: string;
  operator: 'equals' | 'notEquals' | 'contains' | 'startsWith' | 'endsWith' | 'greaterThan' | 'lessThan';
  match: string; caseSensitive: boolean;
}
export interface WorkflowStage {
  id: string; name: string; kind: 'task' | 'approval' | 'check' | 'branch' | 'end';
  prompt?: string; inputs?: string[]; outputs?: string[]; next?: string; file?: string; whenTrue?: string; whenFalse?: string;
  execution?: StageExecution;
  gate?: AppGenGate;
  condition?: WorkflowCondition;
  component?: 'agent' | 'read-file' | 'write-file';
}
export interface WorkflowRun {
  id: string; workflowId: string; revisionId: string; revision: string; workspaceId: string; projectId?: string;
  current: string; status: 'active' | 'paused' | 'awaiting-approval' | 'failed' | 'completed';
  sessionId?: string; cwd: string; createdAt: string; updatedAt: string; error?: string;
  receipts: { stageId: string; sessionId?: string; files?: Record<string, string>; decision?: boolean; approvedBy?: string; reset?: boolean; gate?: import('./app-gen-gate.js').AppGenGateReceipt; at: string }[];
  capabilities?: StageCapabilityLock & { connectorIds: string[] }; phase?: 'ready' | 'running' | 'check' | 'needs-capability';
  automation?: { input: string; submission?: { sessionId: string; stageId: string; requestId: string; state: 'pending' | 'sent' } };

}
export interface WorkflowDraft {
  id: string; source: WorkflowDefinition; upstream: { repository: string; commit: string; license: string };
  revision: string; files: Record<string, WorkflowFile>; updatedAt: string;
  publishedRevision?: string;
}
export interface WorkflowRevision {
  id: string; name: string; createdAt: string; draftRevision: string;
  digest: string; presetId: string; kind: 'published' | 'trial';
}
export interface WorkflowDetail {
  draft: WorkflowDraft; revisions: WorkflowRevision[]; readonly: boolean;
}
export interface WorkflowIssue { path: string; message: string; line?: number; stageId?: string; field?: string; connectorName?: string }
export interface WorkflowValidation { ok: boolean; issues: WorkflowIssue[]; skills: string[]; plugins: number }
export interface WorkflowSummary { id: string; name: string; description: string; updatedAt: string; publishedRevision?: string; archivedAt?: string }

export const sourceTags = [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }];
export function presetDocument(text: string) {
  return parseDocument(text, { customTags: sourceTags });
}
export function manifestText(source: WorkflowDefinition, runtimeOverrides?: Record<string, string>) {
  return stringify({ format: 'workdsh-workflow', version: 1, name: source.name + '（自定义）', description: source.description,
    mode: 'compatible', sourceId: source.sourceId, entry: 'preset/agent.cordis.yml', ...(runtimeOverrides ? { runtimeOverrides } : {}) });
}
export function readManifest(files: Record<string, WorkflowFile>): WorkflowManifest {
  const text = files['workflow.yaml'];
  if (!text || text.encoding !== 'utf8') throw new Error('缺少 workflow.yaml。');
  const doc = parseDocument(text.content);
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  const value = doc.toJS({ maxAliasCount: 0 });
  if (!value || value.format !== 'workdsh-workflow' || ![1, 2, 3, 4, 5].includes(value.version) || value.entry !== 'preset/agent.cordis.yml'
    || !['compatible', 'staged'].includes(value.mode) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120
    || typeof value.description !== 'string' || value.description.length > 4096 || typeof value.sourceId !== 'string') {
    throw new Error('工作流格式无效。');
  }
  if (value.runtimeOverrides !== undefined) {
    if (!value.runtimeOverrides || typeof value.runtimeOverrides !== 'object' || Array.isArray(value.runtimeOverrides)) throw new Error('运行模块映射无效。');
    for (const [module, path] of Object.entries(value.runtimeOverrides)) {
      if (!module.startsWith('./runtime/')) throw new Error('只能映射工作流自带运行模块。');
      packagePath(module.slice(2)); const target = packagePath(path);
      if (!/^preset\/(runtime|workdsh-runtime)\/.+\.[cm]?js$/.test(target) || !files[target]) throw new Error('运行模块映射必须引用包内实际脚本。');
    }
  }
  if (value.version === 1 && (value.execution || value.stages?.some((n: WorkflowStage) => n.execution))) throw new Error('阶段能力绑定需要工作流格式 version: 2，避免旧版本忽略配置。');
  if (value.version < 3 && (value.execution?.team || value.stages?.some((n: WorkflowStage) => n.execution?.team))) throw new Error('阶段团队配置需要 version: 3。');
  if (value.version < 4 && value.stages?.some((n: WorkflowStage) => n.gate)) throw new Error('app-gen 状态机门禁需要 version: 4。');
  if (value.version < 5 && value.stages?.some((n: WorkflowStage) => n.condition || n.component)) throw new Error('组件与 If-else 文本条件需要 version: 5。');
  validateExecution(value.execution);
  if (value.mode === 'staged') validateStages(value);
  return value as WorkflowManifest;
}

export function validateStages(manifest: WorkflowManifest) {
  const stages = manifest.stages;
  if (!Array.isArray(stages) || stages.length < 2 || stages.length > 32) throw new Error('阶段编排需要 2–32 个节点。');
  const nodes = new Map<string, WorkflowStage>();
  for (const node of stages) {
    if (!node || !/^[a-z][a-z0-9-]{0,39}$/.test(node.id) || nodes.has(node.id) || typeof node.name !== 'string' || !node.name.trim()
      || !['task', 'approval', 'check', 'branch', 'end'].includes(node.kind)) throw new Error('阶段 ID、名称或类型无效，ID 不能重复。');
    nodes.set(node.id, node);
    validateExecution(node.execution);
    if (node.condition) { if (node.kind !== 'branch') throw new Error('文本条件只能用于 If-else 节点。'); validateCondition(node.condition); }
    if (node.component && (node.kind !== 'task' || !['agent', 'read-file', 'write-file'].includes(node.component))) throw new Error('任务组件类型无效。');
    if (node.gate) {
      if (node.kind !== 'task' || node.gate.kind !== 'app-gen' || !Number.isInteger(node.gate.step) || node.gate.step < 0 || node.gate.step > 9) throw new Error('app-gen 门禁仅用于 Agent 节点，步骤为 0–9。');
      packagePath(node.gate.context);
    }
    if (node.inputs !== undefined) { if (!Array.isArray(node.inputs) || node.inputs.length > 32) throw new Error('阶段输入无效。'); node.inputs.forEach(packagePath); }
    if (node.kind === 'task' && (typeof node.prompt !== 'string' || !node.prompt.trim() || node.prompt.length > 32000)) throw new Error('Agent 阶段需要完整任务说明。');
    if (node.kind === 'task' || node.kind === 'check') {
      if (!Array.isArray(node.outputs) || !node.outputs.length || node.outputs.length > 32) throw new Error('任务和校验阶段需要声明实际产出文件。');
      node.outputs.forEach(packagePath);
    }
    if (node.kind === 'branch' && !node.condition) packagePath(node.file);
  }
  if (!manifest.start || nodes.get(manifest.start)?.kind !== 'task') throw new Error('起始节点必须是 Agent 任务，以建立授权工作区。');
  const visit = (id: string, stack: Set<string>, seen: Set<string>) => {
    if (stack.has(id)) throw new Error('首版阶段编排不支持循环连接。');
    const node = nodes.get(id); if (!node) throw new Error('阶段连接指向不存在的节点：' + id);
    if (seen.has(id)) return; seen.add(id); const active = new Set(stack).add(id);
    if (node.kind === 'branch') { visit(node.whenTrue ?? '', active, seen); visit(node.whenFalse ?? '', active, seen); }
    else if (node.kind !== 'end') visit(node.next ?? '', active, seen);
  };
  const seen = new Set<string>(); visit(manifest.start, new Set(), seen);
  if (seen.size !== nodes.size) throw new Error('所有阶段必须能从起点到达。');
}

export function effectiveExecution(manifest: WorkflowManifest, node: WorkflowStage): StageExecution {
  const base = manifest.execution ?? {}, own = node.execution ?? {};
  const skills = [...(base.skills ?? []), ...(own.skills ?? [])];
  const unique = new Map<string, SkillRevisionRef>();
  for (const ref of skills) { const previous = unique.get(ref.skillId); if (previous && previous.contentDigest !== ref.contentDigest) throw new Error('Skill 版本冲突：' + ref.name); unique.set(ref.skillId, ref); }
  return { executor: own.executor ?? base.executor, team: own.executor ? own.team : own.team ?? base.team, skills: [...unique.values()],
    connectors: own.connectors?.mode === 'explicit' ? own.connectors : base.connectors?.mode === 'explicit' ? base.connectors : { mode: 'explicit', requirements: [] }, model: own.model ?? base.model };
}
export function validateExecution(value?: StageExecution) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('阶段能力配置必须是对象。');
  const bounded = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 256;
  if (value.executor && (!['workflow','expert','team'].includes(value.executor.kind) || value.executor.kind !== 'workflow' && (!bounded(value.executor.expertId) || !bounded(value.executor.revisionId)))) throw new Error('请绑定具体已发布的专家或专家团版本。');
  if (value.skills && (!Array.isArray(value.skills) || value.skills.length > 32 || value.skills.some(r => !r || !bounded(r.skillId) || !bounded(r.revisionId) || !bounded(r.name) || !/^[a-f0-9]{64}$/.test(r.contentDigest)))) throw new Error('Skill 绑定必须包含完整的固定版本与内容哈希。');
  if (value.connectors && (!['inherit','explicit'].includes(value.connectors.mode) || value.connectors.requirements && (!Array.isArray(value.connectors.requirements) || value.connectors.requirements.length > 32 || value.connectors.requirements.some(r => !r || !/^[a-zA-Z0-9_-]{1,64}$/.test(r.serverName) || typeof r.required !== 'boolean')))) throw new Error('连接器配置无效。');
  if (value.team) {
    const t = value.team, keys = new Set<string>();
    const ref = (r: ExpertRevisionRef) => r && bounded(r.expertId) && bounded(r.revisionId);
    if (!t.lead || !ref(t.lead.expert) || typeof t.lead.goal !== 'string' || t.lead.goal.length > 16000 || !['parallel','sequential'].includes(t.strategy) || !Array.isArray(t.members) || t.members.length < 1 || t.members.length > 8) throw new Error('团队需要 Lead、1–8 位成员及有效协作策略。');
    for (const m of t.members) {
      if (!m || !/^[a-z][a-z0-9-]{0,39}$/.test(m.key) || m.key === 'lead' || keys.has(m.key) || !ref(m.expert) || typeof m.role !== 'string' || !m.role.trim() || m.role.length > 200 || typeof m.task !== 'string' || !m.task.trim() || m.task.length > 16000) throw new Error('成员标识、专家固定版本和任务分工无效。');
      keys.add(m.key); validateExecution({skills:m.skills});
      if (m.connectors && (!Array.isArray(m.connectors) || m.connectors.length > 32 || new Set(m.connectors).size !== m.connectors.length || m.connectors.some(s => !/^[a-zA-Z0-9_-]{1,64}$/.test(s)))) throw new Error('成员连接器范围无效。');
    }
  }
  if (value.model && (!bounded(value.model.provider) || !bounded(value.model.model) || value.model.reasoningEffort !== undefined && !bounded(value.model.reasoningEffort))) throw new Error('模型配置必须引用可用的 provider/model。');
}

/** A portable package path, also safe on case-insensitive Windows hosts. */
export function packagePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 240 || !value || /[\\:\x00-\x1f<>"|?*]/.test(value)
    || value.split('/').some(part => !part || ['.', '..', '__proto__', 'prototype', 'constructor'].includes(part) || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))
    || /^(node_modules|\.git)(\/|$)/i.test(value)) throw new Error('文件路径必须位于工作流包内，且不能包含特殊路径。');
  return value;
}

/** Mutate only an AST field; preserve unknown fields, comments, groups and !!js tags. */
export function patchYaml(text: string, path: (string | number)[], value: unknown): string {
  const doc = presetDocument(text);
  if (doc.errors.length) throw new Error('请先修复 YAML 语法错误，再使用可视化配置。');
  doc.toJS({ maxAliasCount: 0 });
  if (!path.length) throw new Error('不能通过属性编辑替换整个配置。');
  doc.setIn(path, value);
  return doc.toString();
}

export function pluginRows(text: string): Array<{ path: (string | number)[]; row: Record<string, any>; depth: number }> {
  const doc = presetDocument(text);
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  const rows = doc.toJS({ maxAliasCount: 0 });
  if (!Array.isArray(rows)) throw new Error('Preset 必须是插件数组。');
  const result: Array<{ path: (string | number)[]; row: Record<string, any>; depth: number }> = [];
  const visit = (items: any[], prefix: (string | number)[], depth: number) => {
    if (depth > 8) throw new Error('插件分组超过八层。');
    items.forEach((row, i) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('插件节点必须是对象。');
      const path = [...prefix, i]; result.push({ row, path, depth });
      if (row.group) { if (!Array.isArray(row.config)) throw new Error('插件分组缺少节点数组。'); visit(row.config, [...path, 'config'], depth + 1); }
    });
  };
  visit(rows, [], 0); return result;
}

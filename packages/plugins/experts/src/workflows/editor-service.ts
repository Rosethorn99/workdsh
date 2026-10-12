import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, lstat, rename, writeFile, mkdtemp, rm, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ActorContext, ResourceOwner } from 'workdsh-contracts';
import { parseDocument } from 'yaml';
import { readWorkflowCatalog, workflowPreset, feishuReferences } from './host.js';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { capabilityCatalog, resolveStageCapabilities, composeStagePreset, applyConnectors, connectorsService, ConnectorMappingError, personaPrefix, skillDirectories, stageInstructions, teamInstructions } from './capabilities.js';
import { readStageTeam } from './team-runtime.js';
import { checkAppGenGate } from './app-gen-gate.js';
import { evaluateCondition } from './condition-runtime.js';
import { validateGraph } from './graph-operations.js';
import { newWorkflowSeed, userWorkflowSource } from './starters.js';
import { projectWorkflowBinding, projectWorkflowOptions } from './project-selection.js';
import type { WorkflowNativeRole } from '../runtime/execution-guard.js';
import { manifestText, packagePath, pluginRows, readManifest, effectiveExecution, type WorkflowFile, type WorkflowDraft, type WorkflowDetail,
  type WorkflowRevision, type WorkflowValidation, type WorkflowSummary, type WorkflowManifest, type WorkflowRun, type StageCapabilityLock } from './authoring.js';

const resources = fileURLToPath(new URL('../../resources/workflows/', import.meta.url));
const compiler = 'workdsh-workflow/3-stage-capabilities';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
interface SavedRevision extends WorkflowRevision { files: Record<string, string>; adapterDigest: string; stagePresets?: Record<string, string>; stageCapabilities?: Record<string, StageCapabilityLock> }
interface SavedRun extends WorkflowRun { projectConfigRevisionId?: string; references?: readonly import('workdsh-contracts/projects').ProjectInputRef[]; owner: ResourceOwner; baseline?: Record<string, { digest: string; mtime: number }>; taskReady?: boolean }
interface SavedPackage { owner: ResourceOwner; draft: WorkflowDraft; revisions: SavedRevision[]; archivedAt?: string }
interface Store {
  version: 1; packages: Record<string, SavedPackage>;
  operations: Record<string, { digest: string; result: unknown }>;
  bindings: Record<string, { workflowId: string; revisionId: string; presetId: string; organizationId: string; principalId: string }>;
  runs: Record<string, SavedRun>;
}
export class WorkflowError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) { super(message); }
}
function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || value.length > 256) throw new WorkflowError('workflows/invalid-request', `缺少有效的 ${field}。`);
  return value;
}
function validateFiles(files: unknown): asserts files is Record<string, WorkflowFile> {
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length > 512) throw new Error('工作流最多包含 512 个文件。');
  let bytes = 0; const paths = new Set<string>();
  for (const [path, file] of Object.entries(files)) {
    packagePath(path); if (paths.has(path.toLowerCase())) throw new Error('文件路径存在大小写冲突。'); paths.add(path.toLowerCase());
    if (!file || typeof file !== 'object' || typeof file.content !== 'string' || !['utf8', 'base64'].includes(file.encoding)) throw new Error('文件内容或编码无效。');
    if (file.encoding === 'base64' && Buffer.from(file.content, 'base64').toString('base64') !== file.content) throw new Error('二进制文件编码无效。');
    const size = Buffer.byteLength(file.content, file.encoding === 'base64' ? 'base64' : 'utf8'); bytes += size;
    if (size > 4 * 1024 * 1024 || bytes > 16 * 1024 * 1024) throw new Error('单文件上限 4 MiB，工作流包上限 16 MiB。');
  }
}
function bytesOf(file: WorkflowFile): Buffer { return Buffer.from(file.content, file.encoding); }
async function atomicRename(source: string, target: string, signal?: AbortSignal, existingDirectory = false) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try { await rename(source, target); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (existingDirectory && ['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(code)) {
        const present = await lstat(target).catch(cause => { if (cause.code === 'ENOENT') return undefined; throw cause; });
        if (present?.isDirectory() && !present.isSymbolicLink()) return;
      }
      if (process.platform !== 'win32' || attempt >= 6 || !['EPERM', 'EACCES', 'EBUSY'].includes(code)) throw error;
      await delay(Math.min(25 * 2 ** attempt, 200), undefined, { signal });
    }
  }
}
async function collect(directory: string, prefix = ''): Promise<Record<string, WorkflowFile>> {
  const files: Record<string, WorkflowFile> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name; packagePath(path);
    if (entry.isSymbolicLink()) throw new Error('工作流包不接受符号链接。');
    if (entry.isDirectory()) Object.assign(files, await collect(join(directory, entry.name), path + '/'));
    else if (entry.isFile()) {
      const bytes = await readFile(join(directory, entry.name)), text = bytes.toString('utf8');
      files[path] = !bytes.includes(0) && Buffer.from(text).equals(bytes) ? { encoding: 'utf8', content: text } : { encoding: 'base64', content: bytes.toString('base64') };
    }
  }
  return files;
}
async function putFiles(directory: string, files: Record<string, WorkflowFile>): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const [path, file] of Object.entries(files)) {
    const target = join(directory, packagePath(path)); await mkdir(dirname(target), { recursive: true });
    const bytes = bytesOf(file); await writeFile(target, bytes, { flag: 'wx' }); hashes[path] = hash(bytes);
  }
  return hashes;
}

/** One Host owner for authoring, immutable revisions and native Session admission. */
export class WorkflowEditor {
  private state: Store = { version: 1, packages: {}, operations: {}, bindings: {}, runs: {} };
  private tail: Promise<unknown> = Promise.resolve();
  private registrations = new Map<string, () => void | Promise<void>>();
  private failures = new Map<string, string>();
  private stopped = false;
  private prepared = new WeakSet<Agent>();
  private memberConnections = new WeakSet<Agent>();
  private automaticTimer?: ReturnType<typeof setTimeout>;
  private pumping = false;
  private automaticSignal = new AbortController();
  private constructor(private ctx: Context, readonly root: string) {}
  static async open(ctx: Context, agentsHome?: string) {
    const editor = new WorkflowEditor(ctx, join(agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents'), '.workdsh-state', 'workflows'));
    await mkdir(editor.root, { recursive: true });
    try {
      editor.state = JSON.parse(await readFile(join(editor.root, 'state.json'), 'utf8'));
      if (editor.state.version !== 1) throw new Error('不支持的工作流存储版本。');
      editor.state.runs ??= {};
      for (const [id, item] of Object.entries(editor.state.packages)) {
        if (!/^wf-[a-f0-9-]{36}$/.test(id)) throw new Error('工作流存储标识无效。');
        validateFiles(item.draft.files);
        for (const revision of item.revisions) {
          if (!/^rev-(published|trial)-[a-f0-9]{24}$/.test(revision.id)) throw new Error('工作流版本标识无效。');
          try { await editor.register(id, revision); } catch (error) { editor.failures.set(revision.presetId, error instanceof Error ? error.message : '版本加载失败。'); }
        }
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    editor.scheduleAutomatic();
    return editor;
  }
  private revisionDir(id: string, revisionId: string) { return join(this.root, id, revisionId); }
  private async verify(id: string, revision: SavedRevision) {
    const directory = this.revisionDir(id, revision.id);
    for (const [path, expected] of Object.entries(revision.files)) {
      packagePath(path);
      const target = join(directory, path);
      // Reject junctions/symlinks at every path segment, not only at the leaf.
      let cursor = directory;
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error('版本目录不能是链接。');
      for (const part of path.split('/')) { cursor = join(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new Error('版本文件不能包含链接。'); }
      if (hash(await readFile(target)) !== expected) throw new Error('发布文件已被修改，请重新发布工作流。');
    }
  }
  private async register(id: string, revision: SavedRevision) {
    if ([revision.presetId, ...Object.values(revision.stagePresets ?? {})].every(id => this.registrations.has(id))) return;
    await this.verify(id, revision);
    const definition = JSON.parse(await readFile(join(this.revisionDir(id, revision.id), 'native-preset.json'), 'utf8'));
    if (definition.id !== revision.presetId) throw new Error('发布版本的 Preset 标识不匹配。');
    if (!this.registrations.has(revision.presetId)) this.registrations.set(revision.presetId, await this.ctx.agentPresets.register(definition));
    for (const [stageId, presetId] of Object.entries(revision.stagePresets ?? {})) {
      if (!/^[a-z][a-z0-9-]{0,39}$/.test(stageId) || presetId !== revision.presetId + '-stage-' + stageId) throw new Error('阶段发布标识无效。');
      const stage = JSON.parse(await readFile(join(this.revisionDir(id, revision.id), 'native-stage-' + stageId + '.json'), 'utf8'));
      if (stage.id !== presetId) throw new Error('阶段 Preset 标识不匹配。');
      if (!this.registrations.has(presetId)) this.registrations.set(presetId, await this.ctx.agentPresets.register(stage));
    }
  }
  private async ready(presetId: string) {
    if (typeof this.ctx.agentPresets.resolve !== 'function') return;
    const preset = await this.ctx.agentPresets.resolve(presetId);
    if (preset.broken) throw new WorkflowError('workflows/preset-broken', '工作流运行配置不可用：' + preset.broken);
  }
  async dispose() { this.stopped = true; clearTimeout(this.automaticTimer); this.automaticSignal.abort(); await this.tail; for (const dispose of this.registrations.values()) await dispose(); this.registrations.clear(); }
  /** Native preset-picker, cold resume and child execution cannot bypass admission. */
  async admit(agent: Agent, signal: AbortSignal | undefined, creating: boolean) {
    const header = agent.session.header;
    if (!header.agentPreset?.startsWith('wf-') && !this.state.bindings[String(agent.id)]) return;
    const actor = await this.ctx.workdshIdentity.resolve({ sessionId: String(agent.id) }, signal);
    let sessionId = String(agent.id), binding = this.state.bindings[sessionId], parent = header.parentSession;
    for (let depth = 0; !binding && parent && depth < 16; depth++) {
      sessionId = String(parent); binding = this.state.bindings[sessionId];
      if (!binding) parent = (await this.ctx.workdshSessionAccess.inspect(parent, signal)).meta.parentSession;
    }
    if (!binding) {
      // Native create happens before our durable workflow binding is committed.
      if (creating && !header.parentSession) return;
      throw new WorkflowError('workflows/unbound', '此原生会话尚未绑定工作流版本，请从工作流页面创建会话。');
    }
    if (binding.principalId !== actor.principalId || binding.organizationId !== actor.organizationId) throw new WorkflowError('workflows/forbidden', '会话与工作流不属于同一授权主体。');
    if (binding.presetId !== header.agentPreset) throw new WorkflowError('workflows/conflict', '会话 Preset 与绑定的工作流版本不一致。');
    const run = Object.values(this.state.runs).find(run => run.workflowId === binding!.workflowId && (run.sessionId === sessionId || run.receipts.some(receipt => receipt.sessionId === sessionId)));
    if (run && (run.sessionId !== sessionId || !['active', 'failed'].includes(run.status))) throw new WorkflowError('workflows/stage-inactive', '此阶段已暂停或已验收。请从运行页面恢复或退回任务修复后再执行。');
    if (run?.taskReady === false && !creating) throw new WorkflowError('workflows/capability-unavailable', run.error ?? '阶段预检尚未通过，请在运行页面恢复能力并重试。');
    const item = this.item(binding.workflowId);
    await this.authorize(actor, item, 'use', signal ?? new AbortController().signal);
    const revision = item.revisions.find(row => row.id === binding.revisionId);
    if (!revision) throw new WorkflowError('workflows/not-found', '固定工作流版本不存在。');
    if (!this.prepared.has(agent)) { await this.verify(item.draft.id, revision); this.prepared.add(agent); }
    const runNode = run && (await this.manifest(item, revision)).stages!.find(n => n.id === run.current);
    const lock = runNode && revision.stageCapabilities?.[runNode.id];
    if (lock && runNode) {
      const manifest = await this.manifest(item, revision), resolved = await resolveStageCapabilities(this.ctx, actor, manifest, runNode, signal ?? new AbortController().signal);
      if (hash(JSON.stringify(lock)) !== hash(JSON.stringify(resolved.lock))) throw new WorkflowError('workflows/conflict', '阶段能力版本与发布锁定不一致。');
      const connectors = connectorsService(this.ctx);
      const membership=this.ctx.agentTeams?.tryMembership(agent);
      const role=membership?.role==='teammate'?lock.team?.members.find(m=>m.key===membership.name):undefined;
      if(String(agent.id)!==sessionId && lock.team && !membership && creating) return;
      const roleLock=role?{...lock,connectors:lock.connectors.filter(r=>(role.connectors??[]).includes(r.serverName))}:lock;
      if (String(agent.id) !== sessionId && !this.memberConnections.has(agent)) { await applyConnectors(this.ctx, roleLock, String(agent.id), signal ?? new AbortController().signal); this.memberConnections.add(agent); }
      else if (connectors) {
        const catalog = await connectors.list(signal), selected = await connectors.selection(String(agent.id));
        const expected = roleLock.connectors.flatMap(r => { const found = catalog.find(c => c.serverName === r.serverName && c.enabled && c.state === 'ready'); if (!found && r.required) throw new WorkflowError('workflows/capability-unavailable', '必需连接器未就绪：' + r.serverName); return found ? [found.id] : []; });
        if (selected.length !== expected.length || expected.some(id => !selected.includes(id))) throw new WorkflowError('workflows/conflict', '阶段会话连接器选择已变化，请恢复阶段配置后执行。');
      }
    }
  }
  /** Resolve frozen workflow Team roles through the expert owner; no second Team state or driver. */
  async resolveNativeRole(actor: ActorContext, rootSessionId: string, memberName?: string, signal: AbortSignal = new AbortController().signal): Promise<WorkflowNativeRole | undefined> {
    const binding = this.state.bindings[rootSessionId]; if (!binding) return;
    const item = this.item(binding.workflowId); await this.authorize(actor, item, 'use', signal);
    if (binding.principalId !== actor.principalId || binding.organizationId !== actor.organizationId) throw new WorkflowError('workflows/forbidden', '专家团阶段属于其他授权主体。');
    const revision = item.revisions.find(r => r.id === binding.revisionId)!;
    const manifest = await this.manifest(item, revision), run = Object.values(this.state.runs).find(r => r.sessionId === rootSessionId);
    if (!run) return;
    const node = manifest.stages!.find(n => n.id === run.current)!, lock = revision.stageCapabilities?.[node.id];
    if (!lock?.executor) return;
    const ref = lock.team ? lock.team.roles[memberName ?? 'lead']?.expert : memberName ? lock.executor.teamMembers?.[memberName] : lock.executor;
    if (!ref) throw new WorkflowError('workflows/invalid-member', '成员不在阶段锁定的专家团中。');
    const role = await this.ctx.workdshExperts.resolveWorkflowRevision(actor, ref, signal);
    const stage = JSON.parse(await readFile(join(this.revisionDir(item.draft.id, revision.id), 'native-stage-' + node.id + '.json'), 'utf8'));
    const base = memberName ? JSON.parse(await readFile(join(this.revisionDir(item.draft.id, revision.id), 'native-preset.json'), 'utf8')) : stage;
    const supplemental = memberName ? await Promise.all([...(effectiveExecution(manifest, node).skills ?? []), ...(lock.team?.roles[memberName!]?.skills ?? [])].map(async ref => {
      const check = await this.ctx.workdshSkills.checkRevision(ref, actor, signal);
      if (check.status !== 'intact' || !check.snapshotDir) throw new WorkflowError('workflows/capability-unavailable', '成员补充 Skill 不可用：' + ref.name);
      return check.snapshotDir;
    })) : [];
    const prefix = memberName ? personaPrefix(role.preset) + '\n\n工作流完整角色说明：\n' + personaPrefix(base) + stageInstructions(node) + teamInstructions(lock.team, memberName) : personaPrefix(stage) + teamInstructions(lock.team);
    return { binding: { presetRevisionRef: binding.presetId }, revision: role.revision,
      persona: { prefix, suffix: '', complete: false, includeRuntimeContext: true },
      skills: { includeDefaultRoots: false, watch: false, customSkillDirs: [...new Set([...skillDirectories(base), ...supplemental, ...skillDirectories(role.preset)])] },
      digest: hash(revision.digest + role.revision.compositionDigest + node.id + JSON.stringify(lock.team ?? null)) };
  }
  private async authorize(actor: ActorContext, item: SavedPackage, action: 'read' | 'edit' | 'use' | 'manage', signal: AbortSignal) {
    const decision = await this.ctx.workdshAccess.authorize({ actor, action, resource: { domain: 'workdsh.workflows', id: item.draft.id, revision: item.draft.revision }, owner: item.owner }, signal);
    if (decision.effect !== 'allow') throw new WorkflowError('workflows/forbidden', '没有权限操作此工作流。');
  }
  private item(id: unknown): SavedPackage {
    const value = this.state.packages[requireText(id, '工作流 ID')];
    if (!value) throw new WorkflowError('workflows/not-found', '工作流不存在。'); return value;
  }
  private detail(item: SavedPackage): WorkflowDetail { return { draft: clone(item.draft), revisions: item.revisions.map(({ files, adapterDigest, ...value }) => value), readonly: false }; }
  private publicRun(run: SavedRun): WorkflowRun { const { owner, baseline, taskReady, projectConfigRevisionId, references, ...value } = run; return clone(value); }
  private async manifest(item: SavedPackage, revision: SavedRevision): Promise<WorkflowManifest> {
    await this.verify(item.draft.id, revision);
    const prefix = item.draft.source.sourceId + '/';
    const files = Object.fromEntries(Object.keys(revision.files).filter(path => path.startsWith(prefix)).map(path => [path.slice(prefix.length), { encoding: 'utf8' as const, content: '' }]));
    files['workflow.yaml'].content = await readFile(join(this.revisionDir(item.draft.id, revision.id), prefix, 'workflow.yaml'), 'utf8');
    return readManifest(files);
  }
  private async output(cwd: string, path: string, signal: AbortSignal): Promise<{ digest: string; mtime: number }> {
    const root = await realpath(cwd), target = join(root, packagePath(path));
    let cursor = root;
    for (const part of path.split('/')) { cursor = join(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new Error('产出路径不能包含链接：' + path); }
    const actual = await realpath(target), rel = relative(root, actual);
    if (rel === '..' || rel.startsWith('..' + sep)) throw new Error('产出超出授权工作区。');
    const info = await stat(actual);
    if (!info.isFile() || info.size === 0 || info.size > 512 * 1024 * 1024) throw new Error('产出必须是非空文件，且不超过 512 MiB：' + path);
    const digest = createHash('sha256'), stream = createReadStream(actual);
    const abort = () => stream.destroy(new Error('产出校验已取消。')); signal.addEventListener('abort', abort, { once: true });
    try { signal.throwIfAborted(); for await (const chunk of stream) { signal.throwIfAborted(); digest.update(chunk); } }
    finally { signal.removeEventListener('abort', abort); stream.destroy(); }
    return { digest: digest.digest('hex'), mtime: info.mtimeMs };
  }
  private async appGenGate(run: SavedRun, node: import('./authoring.js').WorkflowStage, lock: StageCapabilityLock | undefined, actor: ActorContext, signal: AbortSignal, prerequisite = false) {
    if (!node.gate || prerequisite && node.gate.step === 0) return;
    const ref = lock?.skills.find(s => s.name === 'app-gen');
    const check = ref ? await this.ctx.workdshSkills.checkRevision(ref, actor, signal) : undefined;
    if (ref && check?.status !== 'intact') throw new Error('app-gen 固定 Skill 不可用。');
    return checkAppGenGate(run.cwd, {...node.gate, step: prerequisite ? node.gate.step - 1 : node.gate.step}, check?.snapshotDir, signal);
  }
  private async task(item: SavedPackage, revision: SavedRevision, run: SavedRun, manifest: WorkflowManifest, state: Store, actor: ActorContext, signal: AbortSignal, sessionId: string = randomUUID()) {
    const node = manifest.stages!.find(node => node.id === run.current)!;
    const presetId = revision.stagePresets?.[node.id]; if (!presetId) throw new Error('阶段没有固定运行配置。');
    await this.ready(presetId);
    const lock = revision.stageCapabilities?.[node.id];
    if (lock) {
      const resolved = await resolveStageCapabilities(this.ctx, actor, manifest, node, signal);
      if (hash(JSON.stringify(resolved.lock)) !== hash(JSON.stringify(lock))) throw new Error('阶段能力与发布锁定不一致。');
    }
    run.sessionId = sessionId; run.taskReady = false;
    state.bindings[sessionId] = { workflowId: item.draft.id, revisionId: revision.id, presetId, principalId: actor.principalId, organizationId: actor.organizationId };
    await this.ctx.workdshSessionAccess.create({ sessionId: sessionId as any, workspaceId: run.workspaceId as any, agentPreset: presetId }, signal);
    if (lock) {
      run.phase = 'needs-capability';
      run.capabilities = { ...clone(lock), connectorIds: await applyConnectors(this.ctx, lock, sessionId, signal) };
      if (lock.model) await this.ctx.sessionController.selectModel({ sessionId: sessionId as any, ...lock.model });
    }
    run.phase = 'ready';
    const inspection = await this.ctx.workdshSessionAccess.inspect(sessionId as any, signal);
    if (!inspection.meta.cwd) throw new Error('原生会话未提供工作区路径。');
    if (run.cwd && resolve(run.cwd) !== resolve(inspection.meta.cwd)) throw new Error('阶段工作区发生变化。');
    run.cwd = inspection.meta.cwd; run.baseline = {};
    if (run.projectId) {
      const projects=this.ctx.reflect.get('workdshProjects') as import('workdsh-contracts/projects').ProjectService | undefined;
      if(!projects) throw new Error('项目服务不可用。');
      const project=await projects.get(actor,run.projectId,signal),assets=(run.references??[]).filter(r=>r.kind==='asset').map(r=>project.assets.find(a=>a.id===r.id&&a.revisionId===r.revision));
      if(assets.some(a=>!a)) throw new Error('项目资产引用已失效，请检查原始修订。');
      if(assets.length){const library=this.ctx.reflect.get('workdshLibrary') as import('workdsh-contracts').LibraryService | undefined;if(!library)throw new Error('资料库服务不可用。');await library.setTaskSelection(actor,sessionId,assets.map(a=>a!.nodeId),signal);const applied=await library.taskSelection(actor,sessionId,signal);if(assets.some(a=>!applied.some(r=>r.nodeId===a!.nodeId&&r.revisionId===a!.revisionId)))throw new Error('项目资产未实际应用到阶段会话。');}
      await projects.linkTask(actor,run.projectId,sessionId,manifest.name+' / '+node.name,undefined,run.references??[],signal,[],run.projectConfigRevisionId,{workflowId:run.workflowId,revisionId:run.revisionId,runId:run.id,stageId:node.id});
    }
    for (const path of node.inputs ?? []) {
      const value = await this.output(run.cwd, path, signal), accepted = [...run.receipts].reverse().find(receipt => receipt.files?.[path]);
      if (accepted?.files?.[path] && accepted.files[path] !== value.digest) throw new Error('已验收的输入文件发生变化：' + path + '。请退回任务修复并重新验收。');
    }
    await this.appGenGate(run, node, lock, actor, signal, true);
    for (const path of node.outputs ?? []) { try { run.baseline[path] = await this.output(run.cwd, path, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    run.taskReady = true; run.status = 'active'; run.phase = 'ready'; run.error = undefined;
  }
  private async advance(item: SavedPackage, revision: SavedRevision, run: SavedRun, manifest: WorkflowManifest, state: Store, actor: ActorContext, signal: AbortSignal) {
    for (let count = 0; count < 32; count++) {
      signal.throwIfAborted(); const node = manifest.stages!.find(node => node.id === run.current)!;
      if (node.kind === 'task') { await this.task(item, revision, run, manifest, state, actor, signal); return; }
      if (node.kind === 'approval') { run.status = 'awaiting-approval'; return; }
      if (node.kind === 'end') { run.status = 'completed'; run.receipts.push({ stageId: node.id, at: new Date().toISOString() }); return; }
      if (node.kind === 'branch') {
        if (node.condition) {
          const receipt = await evaluateCondition(node.condition, run.cwd, signal);
          run.receipts.push({ stageId: node.id, ...receipt, at: new Date().toISOString() });
          run.current = (receipt.decision ? node.whenTrue : node.whenFalse)!;
          continue;
        }
        let exists = true;
        try { await this.output(run.cwd, node.file!, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') exists = false; else throw error; }
        run.receipts.push({ stageId: node.id, decision: exists, at: new Date().toISOString() }); run.current = (exists ? node.whenTrue : node.whenFalse)!;
      } else {
        const files: Record<string, string> = {};
        for (const path of node.outputs!) files[path] = (await this.output(run.cwd, path, signal)).digest;
        run.receipts.push({ stageId: node.id, files, at: new Date().toISOString() }); run.current = node.next!;
      }
    }
    throw new Error('阶段推进超过节点上限。');
  }
  /** Business scheduling only: the official Session Controller owns all model execution. */
  private scheduleAutomatic() {
    if (this.stopped || this.automaticTimer || this.pumping) return;
    this.automaticTimer = setTimeout(() => { this.automaticTimer = undefined; void this.pumpAutomatic(); }, 800);
    this.automaticTimer.unref();
  }
  async pumpAutomatic() {
    if (this.stopped || this.pumping) return;
    this.pumping = true;
    const signal = this.automaticSignal.signal;
    try {
      for (const snapshot of Object.values(this.state.runs)) {
        if (this.stopped) break;
        const run = this.state.runs[snapshot.id];
        if (!run.automation || run.status !== 'active' || !run.sessionId || !run.taskReady || run.phase === 'needs-capability') continue;
        try {
          const actor = await this.ctx.workdshIdentity.resolve({sessionId: run.sessionId}, signal);
          if (actor.principalId !== run.owner.ownerPrincipalId || actor.organizationId !== run.owner.organizationId) continue;
          const inspection = await this.ctx.workdshSessionAccess.inspect(run.sessionId as any, signal);
          let action: string;
          const submission = run.automation.submission;
          if (!submission || submission.sessionId !== run.sessionId) action = 'run-submit';
          else if (submission.state === 'pending') action = 'run-deliver';
          else {
            const boundary = [...inspection.events].reverse().find(e => e.type === 'turn/start' || e.type === 'turn/end');
            if (boundary?.type !== 'turn/end') continue;
            const team = await readStageTeam(this.ctx, run.sessionId, run.capabilities, signal);
            if (team.waiting && !team.failure) continue;
            action = 'run-continue';
          }
          await this.dispatch(actor, {action, workflowId: run.workflowId, runId: run.id, expectedRunRevision: run.revision, operationId: 'automatic-'+run.id+'-'+run.revision+'-'+action}, signal);
        } catch { /* A conflicting UI operation wins. Authorization failures never submit a prompt. */ }
      }
    } finally { this.pumping = false; if (Object.values(this.state.runs).some(r => r.automation && r.status === 'active')) this.scheduleAutomatic(); }
  }
  private async revisionDetail(item: SavedPackage, revisionId: unknown): Promise<WorkflowDetail> {
    if (revisionId === undefined) return this.detail(item);
    const revision = item.revisions.find(row => row.id === revisionId);
    if (!revision) throw new Error('版本不存在。');
    await this.verify(item.draft.id, revision);
    const files = await collect(join(this.revisionDir(item.draft.id, revision.id), item.draft.source.sourceId));
    return { ...this.detail(item), readonly: true, draft: { ...clone(item.draft), files, revision: revision.id, updatedAt: revision.createdAt } };
  }
  private async builtin(id: unknown): Promise<WorkflowDetail> {
    const catalog = await readWorkflowCatalog(), source = catalog.workflows.find(row => row.id === id);
    if (!source) throw new WorkflowError('workflows/not-found', '内置工作流不存在。');
    const files = await collect(join(resources, source.sourceId));
    for (const path of ['LICENSE', 'NOTICE.md']) { try { files[path] = { encoding: 'utf8', content: await readFile(join(resources, path), 'utf8') }; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    const overrides: Record<string, string> = {};
    if (source.sourceId === 'fufan-ppt-office') {
      overrides['./runtime/motion-deck/index.js'] = 'preset/workdsh-runtime/motion-deck/index.js';
      for (const name of ['index.js', 'generate-deck.mjs']) {
        let text = await readFile(join(resources, 'adapters/motion-deck', name), 'utf8');
        if (name === 'generate-deck.mjs') text = text.replace('../../fufan-ppt-office/preset/runtime/motion-deck/source/deck-template.html', '../../runtime/motion-deck/source/deck-template.html');
        files['preset/workdsh-runtime/motion-deck/' + name] = { encoding: 'utf8', content: text };
      }
    } else if (source.sourceId === 'fufan-content-factory') {
      overrides['./runtime/content-imagegen/index.js'] = 'preset/workdsh-runtime/content-imagegen/index.js';
      files[overrides['./runtime/content-imagegen/index.js']] = { encoding: 'utf8', content: await readFile(join(resources, 'adapters/content-imagegen/index.js'), 'utf8') };
    }
    files['workflow.yaml'] = { encoding: 'utf8', content: manifestText(source, Object.keys(overrides).length ? overrides : undefined) };
    files['layout.json'] = { encoding: 'utf8', content: '{}' };
    return { readonly: true, revisions: [], draft: { id: source.id, source, files, upstream: { repository: catalog.repository, commit: catalog.commit, license: catalog.license }, revision: catalog.commit, updatedAt: '' } };
  }
  private expected(item: SavedPackage, value: unknown) {
    if (value !== item.draft.revision) throw new WorkflowError('workflows/conflict', '草稿已被其他窗口修改。请比较差异后重新保存。', { currentRevision: item.draft.revision });
  }
  async validate(draft: WorkflowDraft, actor?: ActorContext, signal: AbortSignal = new AbortController().signal): Promise<WorkflowValidation> {
    return (await this.inspectDraft(draft, actor, signal)).validation;
  }
  private async inspectDraft(draft: WorkflowDraft, actor: ActorContext | undefined, signal: AbortSignal) {
    const issues: WorkflowValidation['issues'] = [], skills: string[] = []; let plugins = 0;
    const capabilities = new Map<string, Awaited<ReturnType<typeof resolveStageCapabilities>>>();
    try { validateFiles(draft.files); } catch (error) { issues.push({ path: '', message: String((error as Error).message) }); }
    try { if (readManifest(draft.files).sourceId !== draft.source.sourceId) throw new Error('不能修改原版来源标识。'); }
    catch (error) { issues.push({ path: 'workflow.yaml', message: (error as Error).message }); }
    try {
      const raw = parseDocument(draft.files['workflow.yaml']?.content ?? '').toJS({ maxAliasCount: 0 }) as WorkflowManifest;
      if (raw?.mode === 'staged' && Array.isArray(raw.stages)) for (const node of raw.stages) {
        if (node.kind === 'task' && !node.prompt?.trim()) issues.push({ path: 'workflow.yaml', stageId: node.id, field: 'prompt', message: '请填写阶段任务说明：' + node.name });
        if (node.execution || raw.execution || raw.version >= 2) {
          try { if (!actor) throw new Error('校验能力绑定需要当前授权用户。'); capabilities.set(node.id, await resolveStageCapabilities(this.ctx, actor, raw, node, signal)); }
          catch (error) {
            if (error instanceof ConnectorMappingError) for (const connectorName of error.missingConnectors) issues.push({ path: 'workflow.yaml', stageId: node.id, field: 'connectors', connectorName, message: '连接器需要本机映射：' + connectorName });
            else issues.push({ path: 'workflow.yaml', stageId: node.id, field: 'execution', message: (error as Error).message });
          }
        }
      }
    } catch { /* Syntax diagnostics already reported. */ }
    const preset = draft.files['preset/agent.cordis.yml'];
    try {
      if (!preset || preset.encoding !== 'utf8') throw new Error('缺少 Preset 配置。');
      const rows = pluginRows(preset.content); plugins = rows.length; const ids = new Set<string>();
      const declared = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
      const allowed = new Set([...Object.keys(declared.dependencies ?? {}), '@deepseek-ai/dsh-workflow-worker-thread']);
      for (const { row } of rows) {
        if (typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw new Error('插件 ID 必须非空且唯一。'); ids.add(row.id);
        if (row.group) continue;
        if (typeof row.name !== 'string') throw new Error('插件缺少模块名。');
        if (row.name.startsWith('./runtime/')) {
          const path = 'preset/' + packagePath(row.name.slice(2));
          if (!draft.files[path]) throw new Error('运行模块不存在：' + path);
        } else {
          const packageName = row.name.startsWith('@') ? row.name.split('/').slice(0, 2).join('/') : row.name.split('/')[0];
          if (!allowed.has(packageName) || row.name.split('/').some((part: string) => part === '..' || part === '.') || /[\\:%?#]/.test(row.name)) throw new Error('未安装的插件：' + row.name + '。保存不会自动安装插件。');
        }
        if (row.name === '@deepseek-ai/dsh-skill-filesystem') {
          const dirs = row.config?.customSkillDirs;
          if (!Array.isArray(dirs) || dirs.some(value => value !== "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))")) throw new Error('当前原版兼容模式的 Skill 目录必须引用包内 skills/。');
        }
      }
      const compiled = await workflowPreset(draft.source, undefined, { text: preset.content });
      if (readManifest(draft.files).mode === 'staged' && !compiled.plugins.some(row => row.name === '@deepseek-ai/dsh-persona' && !row.disabled && typeof (row.config as any)?.prefix === 'string')) {
        throw new Error('阶段模式需要启用顶层 Persona，才能装载当前阶段任务。');
      }
      const visit = (rows: typeof compiled.plugins) => {
        for (const row of rows) {
          if (row.group) { visit(row.config as typeof compiled.plugins); continue; }
          if (row.name === '@deepseek-ai/dsh-skill-filesystem') {
            const config = row.config as { customSkillDirs: string[] };
            const expected = join(resources, draft.source.sourceId, 'preset', 'skills');
            if (config.customSkillDirs.some(value => resolve(value) !== expected)) throw new Error('Skill 路径表达式必须保留 !!js 标签，并指向包内 skills/。');
          }
        }
      }; visit(compiled.plugins);
    } catch (error) { issues.push({ path: 'preset/agent.cordis.yml', message: (error as Error).message }); }
    for (const [path, file] of Object.entries(draft.files)) {
      if (file.encoding !== 'utf8') continue;
      if (/\/SKILL\.md$/.test(path)) {
        try {
          const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(file.content);
          if (!header) throw new Error('Skill 缺少 YAML 元数据。');
          const doc = parseDocument(header[1]); if (doc.errors.length) throw doc.errors[0];
          const meta = doc.toJS({ maxAliasCount: 0 });
          if (typeof meta?.name !== 'string' || !meta.name || typeof meta.description !== 'string') throw new Error('Skill 需要 name 和 description。');
          if (skills.includes(meta.name)) throw new Error('Skill 名称重复：' + meta.name); skills.push(meta.name);
        } catch (error) { issues.push({ path, message: (error as Error).message }); }
      } else if (path.endsWith('.json')) {
        try { JSON.parse(file.content); } catch (error) { issues.push({ path, message: (error as Error).message }); }
      }
    }
    if (!skills.length && draft.source.sourceId !== userWorkflowSource.sourceId) issues.push({ path: 'preset/skills', message: '工作流必须保留至少一个完整 Skill。' });
    return { validation: { ok: issues.length === 0, issues, skills, plugins }, capabilities };
  }
  private async snapshot(item: SavedPackage, kind: WorkflowRevision['kind'], actor: ActorContext, signal: AbortSignal): Promise<SavedRevision> {
    // Reuse only this publication's authoritative checks, never a previous UI validation.
    const { validation, capabilities } = await this.inspectDraft(item.draft, actor, signal);
    if (!validation.ok) throw new WorkflowError('workflows/invalid-draft', '草稿未通过校验。请先处理验证页中的问题。', { issues: validation.issues, validation, draftRevision: item.draft.revision });
    const adapters = await collect(join(resources, 'adapters')), manifest = readManifest(item.draft.files);
    const stageCapabilities: Record<string, StageCapabilityLock> = {};
    if (manifest.version >= 2 && manifest.mode === 'staged') for (const node of manifest.stages!) stageCapabilities[node.id] = capabilities.get(node.id)!.lock;
    const adapterDigest = hash(JSON.stringify(adapters)), digest = hash(JSON.stringify({ compiler, files: item.draft.files, upstream: item.draft.upstream, adapterDigest, stageCapabilities }));
    const id = `rev-${kind}-${digest.slice(0, 24)}`, existing = item.revisions.find(row => row.id === id);
    if (existing) { await this.register(item.draft.id, existing); await this.ready(existing.presetId); return existing; }
    const directory = this.revisionDir(item.draft.id, id);
    await mkdir(dirname(directory), { recursive: true }); const stage = await mkdtemp(directory + '.staging-');
    const presetId = item.draft.id + '-' + id;
    try {
      const authored = await putFiles(join(stage, item.draft.source.sourceId), item.draft.files);
      const copiedAdapters = await putFiles(join(stage, 'adapters'), adapters);
      const files: Record<string, string> = {};
      for (const [path, value] of Object.entries(authored)) files[item.draft.source.sourceId + '/' + path] = value;
      for (const [path, value] of Object.entries(copiedAdapters)) files['adapters/' + path] = value;
      const directoryUrl = pathToFileURL(join(directory, item.draft.source.sourceId, 'preset') + '/');
      const definition = await workflowPreset({ ...item.draft.source, id: presetId, name: manifest.name + (kind === 'trial' ? '（草稿试运行）' : '') + ' · ' + id.slice(-8), description: manifest.description }, undefined,
        { directory: directoryUrl, adapterRoot: pathToFileURL(directory + '/'), text: item.draft.files['preset/agent.cordis.yml'].content, runtimeOverrides: manifest.runtimeOverrides });
      const generated: Record<string, string> = { 'package.json': JSON.stringify({ type: 'module' }), 'native-preset.json': JSON.stringify(definition),
        'dependency-lock.json': JSON.stringify({ compiler, digest, adapterDigest, upstream: item.draft.upstream, fileHashes: authored, stageCapabilities }) };
      const stagePresets: Record<string, string> = {};
      const retained = new Map<string, string>();
      const skillKey = (ref: import('workdsh-contracts').SkillRevisionRef) => JSON.stringify([ref.skillId, ref.revisionId, ref.name, ref.contentDigest]);
      if (manifest.mode === 'staged') for (const node of manifest.stages!.filter(node => node.kind === 'task')) {
        const stageId = presetId + '-stage-' + node.id;
        const resolved = capabilities.get(node.id);
        const directories = [...resolved?.directories ?? []];
        if (resolved) {
          const refs = [...resolved.lock.skills, ...Object.values(resolved.lock.team?.roles ?? {}).flatMap(role => role.skills)];
          for (const ref of refs) {
            const key = skillKey(ref);
            if (!retained.has(key)) retained.set(key, (await this.ctx.workdshSkills.retainRevision(ref, { domain: 'workdsh.workflows', id: item.draft.id + '/' + id }, signal)).snapshotDir);
          }
          directories.push(...resolved.lock.skills.map(ref => retained.get(skillKey(ref))!));
        }
        const stage = composeStagePreset(definition, resolved?.expertPreset, [...new Set(directories)], {...node,execution:effectiveExecution(manifest,node)}, stageId);
        generated['native-stage-' + node.id + '.json'] = JSON.stringify(stage); stagePresets[node.id] = stageId;
      }
      Object.assign(files, await putFiles(stage, Object.fromEntries(Object.entries(generated).map(([path, content]) => [path, { encoding: 'utf8', content }]))));
      await atomicRename(stage, directory, signal, true);
      const revision: SavedRevision = { id, presetId, name: manifest.name, kind, digest, adapterDigest, createdAt: new Date().toISOString(), draftRevision: item.draft.revision, files,
        ...(Object.keys(stagePresets).length ? { stagePresets } : {}), ...(Object.keys(stageCapabilities).length ? { stageCapabilities } : {}) };
      await this.register(item.draft.id, revision);
      try { for (const id of [revision.presetId, ...Object.values(stagePresets)]) await this.ready(id); }
      catch (error) { for (const id of [revision.presetId, ...Object.values(stagePresets)]) { await this.registrations.get(id)?.(); this.registrations.delete(id); } throw error; }
      item.revisions.push(revision); return revision;
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  async dispatch(actor: ActorContext, payload: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const action = requireText(payload.action, '操作'); signal.throwIfAborted();
    if (this.stopped) throw new WorkflowError('workflows/unavailable', '工作流编辑服务已停止。');
    if (action === 'project-options') {
      const project = await this.project(actor, payload.projectId, signal);
      const binding = projectWorkflowBinding(project.config.instruction);
      const workflows = await this.dispatch(actor, { action: 'list', includeArchived: true }, signal) as WorkflowSummary[];
      return projectWorkflowOptions(binding, workflows);
    }
    if (action === 'capability-catalog' || action === 'connector-catalog' || action === 'skill-revision') {
      const item = this.item(payload.workflowId); await this.authorize(actor, item, 'read', signal);
      if (action === 'capability-catalog') return capabilityCatalog(this.ctx, actor, signal);
      if (action === 'connector-catalog') return [...await connectorsService(this.ctx)?.list(signal) ?? []];
      const ref = await this.ctx.workdshSkills.resolveRevision(requireText(payload.skillId, 'Skill'), undefined, signal);
      await this.ctx.workdshSkills.retainRevision(ref, { domain: 'workdsh.workflows', id: item.draft.id + '/draft' }, signal);
      if ((await this.ctx.workdshSkills.checkRevision(ref, actor, signal)).status !== 'intact') throw new Error('当前用户不能使用此 Skill。'); return ref;
    }
    if (action === 'run-team') {
      const item=this.item(payload.workflowId); await this.authorize(actor,item,'read',signal);
      const run=this.state.runs[requireText(payload.runId,'运行 ID')];
      if (!run || run.workflowId!==item.draft.id || run.owner.ownerPrincipalId!==actor.principalId || run.owner.organizationId!==actor.organizationId) throw new WorkflowError('workflows/forbidden','无法读取其他主体的阶段团队。');
      const revision=item.revisions.find(r=>r.id===run.revisionId)!; const manifest=await this.manifest(item,revision);
      const stageId=typeof payload.stageId==='string'?payload.stageId:run.current; const node=manifest.stages!.find(n=>n.id===stageId);
      if(!node) throw new Error('阶段不存在。');
      const sessionId=run.current===stageId?run.sessionId:[...run.receipts].reverse().find(r=>r.stageId===stageId&&!r.reset)?.sessionId;
      const lock=revision.stageCapabilities?.[stageId];
      return {stage:node,lock,revisionId:run.revisionId,...(sessionId?await readStageTeam(this.ctx,sessionId,lock,signal):{members:[],tasks:[]})};
    }
    if (action === 'runs') {
      const item = this.item(payload.workflowId); await this.authorize(actor, item, 'read', signal);
      const results = Object.values(this.state.runs).filter(run => (payload.projectId===undefined||run.projectId===payload.projectId) && run.workflowId === item.draft.id && run.owner.ownerPrincipalId === actor.principalId && run.owner.organizationId === actor.organizationId).map(run => this.publicRun(run));
      for (const run of results) if (run.status === 'active' && run.sessionId) {
        const inspection = await this.ctx.workdshSessionAccess.inspect(run.sessionId as any, signal);
        const event = [...inspection.events].reverse().find(e => e.type === 'turn/start' || e.type === 'turn/end');
        if (event?.type === 'turn/start') run.phase = 'running'; else if (event?.type === 'turn/end' && event.data.reason.kind === 'completed') run.phase = 'check';
      }
      return results;
    }
    if (action === 'list') {
      const results: WorkflowSummary[] = [];
      for (const item of Object.values(this.state.packages)) {
        try { await this.authorize(actor, item, 'read', signal); } catch (error) { if (error instanceof WorkflowError && error.code === 'workflows/forbidden') continue; throw error; }
        if (item.archivedAt && payload.includeArchived !== true) continue;
        let name = item.draft.source.name, description = item.draft.source.description;
        try { ({ name, description } = readManifest(item.draft.files)); } catch { try { const raw=parseDocument(item.draft.files['workflow.yaml']?.content??'').toJS({maxAliasCount:0});if(typeof raw?.name==='string')name=raw.name;if(typeof raw?.description==='string')description=raw.description; } catch { /* Invalid drafts remain editable. */ } }
        results.push({ id: item.draft.id, name, description, updatedAt: item.draft.updatedAt, publishedRevision: item.draft.publishedRevision, ...(item.archivedAt ? { archivedAt: item.archivedAt } : {}) });
      }
      return results;
    }
    if (action === 'get' || action === 'validate' || action === 'export' || action === 'diff') {
      if (typeof payload.workflowId === 'string' && payload.workflowId.startsWith('workdsh-')) {
        const detail = await this.builtin(payload.workflowId);
        return action === 'validate' ? this.validate(detail.draft, actor, signal) : detail;
      }
      const item = this.item(payload.workflowId); await this.authorize(actor, item, 'read', signal);
      if (action === 'diff') {
        this.expected(item, payload.expectedRevision);
        const before = (await this.revisionDetail(item, payload.revisionId)).draft.files, after = item.draft.files;
        const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
        const changes = paths.filter(path => !before[path] || !after[path] || hash(bytesOf(before[path])) !== hash(bytesOf(after[path])))
          .map(path => ({ path, kind: !before[path] ? 'added' : !after[path] ? 'removed' : 'changed' }));
        const path = payload.path === undefined ? undefined : packagePath(payload.path);
        return { changes, ...(path ? { path, before: before[path] ?? null, after: after[path] ?? null } : {}) };
      }
      if (action === 'validate') { this.expected(item, payload.expectedRevision); return this.validate(item.draft, actor, signal); }
      const detail = await this.revisionDetail(item, payload.revisionId);
      if (action === 'export') return { format: 'workdsh-workflow-bundle', version: 1, sourceId: item.draft.source.sourceId, upstream: item.draft.upstream, files: detail.draft.files };
      return detail;
    }
    if (action === 'preview-import') {
      const bundle = payload.bundle as any; validateFiles(bundle?.files);
      if (bundle.format !== 'workdsh-workflow-bundle' || bundle.version !== 1) throw new Error('不支持的工作流包格式。');
      const base = bundle.sourceId === userWorkflowSource.sourceId ? userWorkflowSource : (await readWorkflowCatalog()).workflows.find(row => row.sourceId === bundle.sourceId);
      if (!base) throw new Error('工作流包来源不受支持。');
      const validation = await this.validate({ source: base, files: bundle.files } as WorkflowDraft, actor, signal);
      // Incomplete graphs are valid authoring material, especially a new blank canvas.
      // Execution validation remains mandatory at trial/publish time.
      let name = base.name;
      try { const raw = parseDocument(bundle.files['workflow.yaml']?.content ?? '').toJS({ maxAliasCount: 0 }); if (typeof raw?.name === 'string' && raw.name.trim() && raw.name.length <= 120) name = raw.name; } catch { /* Keep the source label for an invalid draft. */ }
      return { validation, files: Object.keys(bundle.files), name };
    }
    const operationId = requireText(payload.operationId, '操作 ID'), key = actor.organizationId + ':' + actor.principalId + ':' + operationId;
    const digest = hash(JSON.stringify(payload));
    const work = async () => {
      signal.throwIfAborted(); if (this.stopped) throw new WorkflowError('workflows/unavailable', '工作流编辑服务已停止。');
      const previous = this.state.operations[key];
      if (previous) {
        if (previous.digest !== digest) throw new WorkflowError('workflows/conflict', '操作 ID 已用于其他请求。');
        const replay = previous.result as any, target = replay?.draft?.id ?? replay?.workflowId;
        if (target && this.state.packages[target]) await this.authorize(actor, this.state.packages[target], action === 'create' ? 'use' : action === 'publish' || action === 'activate' ? 'manage' : 'edit', signal);
        if (action === 'create' && payload.projectId !== undefined) this.checkProjectWorkflow(await this.project(actor, payload.projectId, signal), payload.workflowId);
        return clone(previous.result);
      }
      const next = clone(this.state); const current = this.state;
      let result: unknown; let target: string | undefined;
      try {
        // Readers see only committed state; the queue owns this private candidate.
        if (action === 'create-draft' || action === 'copy' || action === 'import') {
          let detail: WorkflowDetail;
          if (action === 'create-draft') {
            detail = { readonly: false, revisions: [], draft: { ...newWorkflowSeed(payload.name, payload.description, payload.starter), id: '', revision: '', updatedAt: '' } };
          } else if (action === 'copy') {
            if (typeof payload.workflowId === 'string' && payload.workflowId.startsWith('workdsh-')) detail = await this.builtin(payload.workflowId);
            else { const source = this.item(payload.workflowId); await this.authorize(actor, source, 'read', signal); detail = await this.revisionDetail(source, payload.revisionId); }
          } else {
            await this.dispatch(actor, { action: 'preview-import', bundle: payload.bundle }, signal);
            const bundle = payload.bundle as any;
            const seed = bundle.sourceId === userWorkflowSource.sourceId ? { ...newWorkflowSeed('导入的工作流'), id: '', revision: '', updatedAt: '' } : (await this.builtin((await readWorkflowCatalog()).workflows.find(row => row.sourceId === bundle.sourceId)!.id)).draft;
            detail = { readonly: false, revisions: [], draft: { ...seed, files: clone(bundle.files) } };
          }
          const id = 'wf-' + randomUUID(); target = id;
          const item: SavedPackage = { owner: { organizationId: actor.organizationId, ownerPrincipalId: actor.principalId, scope: 'personal' },
            draft: { ...detail.draft, id, revision: randomUUID(), updatedAt: new Date().toISOString(), publishedRevision: undefined }, revisions: [] };
          await this.authorize(actor, item, 'edit', signal); next.packages[id] = item; result = this.detail(item);
        } else {
          const id = requireText(payload.workflowId, '工作流 ID');
          const item = next.packages[id];
          if (!item) throw new WorkflowError('workflows/not-found', '工作流不存在。');
          target = item.draft.id;
          await this.authorize(actor, item, action === 'create' || action.startsWith('run-') ? 'use' : action === 'publish' || action === 'activate' ? 'manage' : 'edit', signal);
          if (action === 'archive' || action === 'restore') {
            this.expected(item, payload.expectedRevision);
            if (action === 'archive') {
              if (Object.values(next.runs).some(run => run.workflowId === id && !['paused', 'completed'].includes(run.status))) throw new WorkflowError('workflows/conflict', '请先暂停此工作流的运行，再归档。');
              item.archivedAt ??= new Date().toISOString();
            } else delete item.archivedAt;
            item.draft.revision = randomUUID(); item.draft.updatedAt = new Date().toISOString();
            result = { workflowId: id, archivedAt: item.archivedAt, revision: item.draft.revision };
          } else if (item.archivedAt && action !== 'run-pause') {
            throw new WorkflowError('workflows/archived', '此工作流已归档；请恢复后再编辑或运行。');
          } else if (action === 'save') {
            this.expected(item, payload.expectedRevision); const patches = payload.patches as Record<string, WorkflowFile | null>;
            if (!patches || typeof patches !== 'object' || Array.isArray(patches)) throw new Error('文件补丁无效。');
            for (const [path, file] of Object.entries(patches)) { packagePath(path); if (file === null) delete item.draft.files[path]; else item.draft.files[path] = file; }
            validateFiles(item.draft.files); item.draft.revision = randomUUID(); item.draft.updatedAt = new Date().toISOString(); result = this.detail(item);
          } else if (action === 'publish' || action === 'trial') {
            this.expected(item, payload.expectedRevision); const revision = await this.snapshot(item, action === 'trial' ? 'trial' : 'published', actor, signal);
            if (action === 'publish') { item.draft.publishedRevision = revision.id; item.draft.revision = randomUUID(); }
            result = this.detail(item);
          } else if (action === 'activate') {
            this.expected(item, payload.expectedRevision); const revision = item.revisions.find(row => row.id === payload.revisionId && row.kind === 'published');
            if (!revision) throw new Error('只能启用已发布版本。'); await this.register(item.draft.id, revision);
            item.draft.publishedRevision = revision.id; item.draft.revision = randomUUID(); result = this.detail(item);
          } else if (action.startsWith('run-')) {
            const run = next.runs[requireText(payload.runId, '运行 ID')];
            if (!run || run.workflowId !== item.draft.id || run.owner.ownerPrincipalId !== actor.principalId || run.owner.organizationId !== actor.organizationId) throw new WorkflowError('workflows/forbidden', '无法操作其他主体的阶段运行。');
            if (payload.expectedRunRevision !== run.revision) throw new WorkflowError('workflows/conflict', '阶段状态已更新，请刷新后操作。');
            const revision = item.revisions.find(row => row.id === run.revisionId);
            if (!revision) throw new Error('运行绑定的工作流版本不存在。');
            const manifest = await this.manifest(item, revision), node = manifest.stages!.find(node => node.id === run.current)!;
            if (run.status === 'completed') throw new Error('此工作流运行已完成。');
            if (action === 'run-submit') {
              if (!run.automation || run.status !== 'active' || node.kind !== 'task' || !run.taskReady || !run.sessionId) throw new Error('当前节点不能自动提交。');
              if (run.automation.submission?.sessionId !== run.sessionId) run.automation.submission = { sessionId: run.sessionId, stageId: node.id, requestId: randomUUID(), state: 'pending' };
            } else if (action === 'run-deliver') {
              const submission = run.automation?.submission;
              if (!submission || submission.state !== 'pending' || submission.sessionId !== run.sessionId || submission.stageId !== node.id || run.status !== 'active' || !run.taskReady) throw new Error('自动提交状态已改变。');
              try {
                await this.ctx.workdshSessionAccess.inspect(run.sessionId as any, signal);
                await this.ctx.sessionController.prompt({ sessionId: run.sessionId as any, requestId: submission.requestId as any, mode: 'queue', content: [{ type: 'text', text: ['工作流需求：', run.automation!.input, '', '当前节点：'+node.name, node.prompt, '', '输入文件：'+(node.inputs?.join('、') || '无'), '必须保存的产出文件：'+node.outputs!.join('、'), '完成当前节点即可。下一节点由工作流调度；需要人工确认时由用户审核。'].join('\n') }] }, signal);
                submission.state = 'sent'; run.phase = 'running'; run.error = undefined;
              } catch (error) { signal.throwIfAborted(); run.status = 'failed'; run.error = (error as Error).message; }
            } else if (action === 'run-repair') {
              if (run.status !== 'failed') throw new Error('只有验收失败的运行可以退回修复。');
              const receipt = [...run.receipts].reverse().find(receipt => receipt.sessionId && !receipt.reset);
              if (!receipt) throw new Error('没有可退回的 Agent 阶段。');
              const repairNode = manifest.stages!.find(node => node.id === receipt.stageId)!;
              await this.ctx.workdshSessionAccess.inspect(receipt.sessionId as any, signal);
              run.current = repairNode.id; run.sessionId = receipt.sessionId; run.taskReady = true; run.baseline = {};
              const repairLock = revision.stageCapabilities?.[repairNode.id];
              run.capabilities = repairLock ? { ...clone(repairLock), connectorIds: [...await connectorsService(this.ctx)?.selection(receipt.sessionId!) ?? []] } : undefined;
              run.phase = 'ready';
              for (const path of repairNode.outputs!) { try { run.baseline[path] = await this.output(run.cwd, path, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
              run.receipts.push({ stageId: repairNode.id, sessionId: receipt.sessionId, reset: true, approvedBy: actor.principalId, at: new Date().toISOString() });
              run.status = 'active'; run.error = undefined; run.automation = undefined;
            } else if (action === 'run-pause') {
              if (run.sessionId) { await this.ctx.workdshSessionAccess.inspect(run.sessionId as any, signal);
                const root=this.ctx.agents?.get(run.sessionId as any); if(root && this.ctx.agentTeams?.tryMembership(root)) for(const member of this.ctx.agentTeams.listMembers(root)) if(member.role==='teammate'&&member.status==='running') this.ctx.agentTeams.interrupt(root,member.name);
                this.ctx.sessionController.cancel({ sessionId: run.sessionId as any }); }
              run.status = 'paused';
            } else if (action === 'run-resume') {
              if (run.status !== 'paused') throw new Error('只有暂停的运行可以恢复。');
              run.status = node.kind === 'approval' ? 'awaiting-approval' : 'active';
            } else if (action === 'run-approve') {
              if (node.kind !== 'approval' || run.status !== 'awaiting-approval' || typeof payload.approve !== 'boolean') throw new Error('当前阶段不等待人工确认。');
              run.receipts.push({ stageId: node.id, approvedBy: actor.principalId, decision: payload.approve, at: new Date().toISOString() });
              if (!payload.approve) { run.status = 'paused'; run.error = '用户未通过此阶段。'; }
              else { run.current = node.next!; run.status = 'active'; run.error = undefined; try { await this.advance(item, revision, run, manifest, next, actor, signal); } catch (error) { run.status = run.phase === 'needs-capability' ? 'active' : 'failed'; run.error = (error as Error).message; } }
            } else if (action === 'run-continue') {
              if (run.status === 'paused' || run.status === 'awaiting-approval') throw new Error('请先恢复或完成当前人工确认。');
              try {
                if (node.kind === 'task' && run.taskReady === false) {
                  await this.task(item, revision, run, manifest, next, actor, signal, run.sessionId);
                } else if (node.kind === 'task') {
                  if (!run.sessionId) throw new Error('阶段原生会话不存在。');
                  const inspection = await this.ctx.workdshSessionAccess.inspect(run.sessionId as any, signal);
                  if (inspection.meta.agentPreset !== revision.stagePresets?.[node.id]) throw new Error('阶段原生会话的 Preset 不一致。');
                  const boundary = [...inspection.events].reverse().find(event => event.type === 'turn/start' || event.type === 'turn/end');
                  if (!boundary || boundary.type === 'turn/start') { run.status = 'active'; run.phase = boundary ? 'running' : 'ready'; run.error = undefined; run.revision = randomUUID(); run.updatedAt = new Date().toISOString(); result = this.publicRun(run); }
                  if (!boundary || boundary.type === 'turn/start') throw new WorkflowError('workflows/task-not-ready', boundary ? '任务正在执行，请结束后检查产出。' : '任务尚未开始，请打开会话输入需求并发送。');
                  if (boundary.data.reason.kind !== 'completed') throw new Error('当前原生回合未成功结束，请修复任务后重新检查。');
                  const team = await readStageTeam(this.ctx, run.sessionId, revision.stageCapabilities?.[node.id], signal);
                  if (team.failure) throw new Error(team.failure);
                  if (team.waiting) {run.phase='running'; throw new WorkflowError('workflows/task-not-ready', team.waiting);}
                  const files: Record<string, string> = {};
                  for (const path of node.outputs!) {
                    const value = await this.output(run.cwd, path, signal), baseline = run.baseline?.[path];
                    if (baseline && value.digest === baseline.digest && value.mtime <= baseline.mtime) throw new Error('产出沿用阶段开始前的旧文件：' + path);
                    files[path] = value.digest;
                  }
                  const gate = await this.appGenGate(run, node, revision.stageCapabilities?.[node.id], actor, signal);
                  run.receipts.push({ stageId: node.id, sessionId: run.sessionId, files, ...(gate ? {gate} : {}), at: new Date().toISOString() });
                  run.current = node.next!; run.sessionId = undefined; run.baseline = undefined; run.taskReady = undefined;
                }
                run.error = undefined; run.status = 'active';
                if (!(node.kind === 'task' && run.current === node.id)) await this.advance(item, revision, run, manifest, next, actor, signal);
              } catch (error) { signal.throwIfAborted(); run.status = run.phase === 'needs-capability' || error instanceof WorkflowError && error.code === 'workflows/task-not-ready' ? 'active' : 'failed'; run.error = (error as Error).message; }
            } else throw new Error('未知的阶段操作。');
            run.revision = randomUUID(); run.updatedAt = new Date().toISOString(); result = this.publicRun(run);
          } else if (action === 'create') {
            let project: import('workdsh-contracts/projects').ProjectSnapshot | undefined, references: readonly import('workdsh-contracts/projects').ProjectInputRef[] = [];
            if (payload.projectId !== undefined) {
              project = await this.project(actor, payload.projectId, signal);
              this.checkProjectWorkflow(project, item.draft.id);
              const projects = this.ctx.reflect.get('workdshProjects') as import('workdsh-contracts/projects').ProjectService;
              references = await projects.validateInputRefs(actor, project.project.id, (payload.references ?? []) as any, signal);
            }
            const revision = item.revisions.find(row => row.id === (payload.revisionId ?? item.draft.publishedRevision));
            if (!revision) throw new Error('请先发布工作流或创建试运行快照。');
            const sessionId = requireText(payload.sessionId, '会话 ID'), workspaceId = requireText(payload.workspaceId, '工作区 ID');
            if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw new Error('会话 ID 无效。');
            const binding = next.bindings[sessionId];
            if (binding && (binding.workflowId !== item.draft.id || binding.revisionId !== revision.id || binding.principalId !== actor.principalId || binding.organizationId !== actor.organizationId)) throw new Error('此会话已绑定其他工作流版本。');
            if (item.draft.source.id === 'workdsh-feishu-digital-employee' && !(await Promise.all(feishuReferences.map(ref => this.ctx.credentials.describe(credentialRef(ref))))).every(info => info.configured)) throw new Error('请先配置飞书凭据。');
            await this.verify(item.draft.id, revision); await this.register(item.draft.id, revision); await this.ready(revision.presetId);
            const manifest = await this.manifest(item, revision);
            if (payload.automatic === true && (manifest.mode !== 'staged' || typeof payload.input !== 'string' || !payload.input.trim() || payload.input.length > 32000)) throw new Error('自动运行需要 AI 编排模式和有效的需求（最多 32000 字符）。');
            if (manifest.mode === 'staged') {
              if (next.runs['run-' + sessionId]) throw new WorkflowError('workflows/conflict', '此会话已有阶段运行，请打开现有运行。');
              const run: SavedRun = { id: 'run-' + sessionId, workflowId: item.draft.id, revisionId: revision.id, revision: randomUUID(), workspaceId,
                owner: { organizationId: actor.organizationId, ownerPrincipalId: actor.principalId, scope: 'personal' }, current: manifest.start!,
                ...(project?{projectId:project.project.id,projectConfigRevisionId:project.config.id,references}:{}), status: 'active', cwd: '', receipts: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
              try { await this.task(item, revision, run, manifest, next, actor, signal, sessionId); }
              catch (error) { signal.throwIfAborted(); if (run.phase !== 'needs-capability') throw error; run.status = 'active'; run.error = (error as Error).message; }
              if (payload.automatic === true) {
                if (typeof payload.input !== 'string' || !payload.input.trim() || payload.input.length > 32000) throw new Error('请填写本次运行的需求（最多 32000 字符）。');
                run.automation = { input: payload.input.trim() };
              }
              next.runs[run.id] = run;
              result = { sessionId: run.sessionId, workflowId: item.draft.id, revisionId: revision.id, presetId: revision.stagePresets![run.current], runId: run.id };
            } else {
              const created = await this.ctx.workdshSessionAccess.create({ sessionId: sessionId as any, workspaceId: workspaceId as any, agentPreset: revision.presetId }, signal);
              if(project) await (this.ctx.reflect.get('workdshProjects') as import('workdsh-contracts/projects').ProjectService).linkTask(actor,project.project.id,sessionId,item.draft.source.name,undefined,references,signal,[],project.config.id);
              next.bindings[sessionId] = { workflowId: item.draft.id, revisionId: revision.id, presetId: revision.presetId, principalId: actor.principalId, organizationId: actor.organizationId };
              result = { ...created, workflowId: item.draft.id, revisionId: revision.id, presetId: revision.presetId };
            }
          } else throw new Error('未知的工作流编辑操作。');
        }
        signal.throwIfAborted();
        await this.ctx.workdshAudit.append({ id: randomUUID(), occurredAt: new Date().toISOString(), requestId: actor.requestId,
          principalId: actor.principalId, organizationId: actor.organizationId, action: 'workflows.' + action,
          ...(target ? { target: { domain: 'workdsh.workflows', id: target } } : {}), outcome: 'succeeded', code: 'workflows/ok' });
        next.operations[key] = { digest, result: clone(result) };
        const temp = join(this.root, 'state-' + randomUUID() + '.tmp');
        try {
          await writeFile(temp, JSON.stringify(next), { flag: 'wx' });
          // Windows scanners can briefly hold the old file. Preserve it and retry
          // only the atomic replace, never delete it or replay the operation.
          await atomicRename(temp, join(this.root, 'state.json'), signal);
        }
        finally { await rm(temp, { force: true }); }
        this.state = next; this.scheduleAutomatic(); return clone(result);
      } catch (error) { this.state = current; throw error; }
    };
    const promise = this.tail.then(work, work); this.tail = promise.then(() => undefined, () => undefined); return promise;
  }
  private async project(actor: ActorContext, projectId: unknown, signal: AbortSignal) {
    const projects = this.ctx.reflect.get('workdshProjects') as import('workdsh-contracts/projects').ProjectService | undefined;
    if (!projects) throw new Error('项目服务不可用。');
    const project = await projects.get(actor, requireText(projectId, '项目 ID'), signal);
    if (project.project.status !== 'active') throw new Error('项目已归档，无法启动工作流。');
    return project;
  }
  private checkProjectWorkflow(project: import('workdsh-contracts/projects').ProjectSnapshot, workflowId: unknown) {
    const binding = projectWorkflowBinding(project.config.instruction);
    if (binding && binding.workflowId !== workflowId) throw new WorkflowError('workflows/project-workflow-mismatch', `本项目固定使用「${binding.name}」，请从项目入口打开该工作流。`);
  }
}

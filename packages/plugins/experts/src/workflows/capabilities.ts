import type { Context } from '@deepseek-ai/cordis';
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry';
import type { ActorContext, SkillRevisionRef } from 'workdsh-contracts';
import { effectiveExecution, type WorkflowManifest, type WorkflowStage, type StageCapabilityLock, type CapabilityCatalog, type StageTeamConfig } from './authoring.js';

// Optional plugin contract; do not import another plugin's implementation or require it for unbound legacy workflows.
export interface WorkflowConnectors {
  list(signal?: AbortSignal): Promise<readonly { id: string; title: string; serverName: string; state: string; enabled: boolean; toolNames: readonly string[] }[]>;
  selection(sessionId: string): Promise<readonly string[]>;
  setSelection(sessionId: string, ids: readonly string[]): Promise<readonly string[]>;
}
export function connectorsService(ctx: Context): WorkflowConnectors | undefined { return ctx.reflect?.get('workdshConnectors') as WorkflowConnectors | undefined; }
export class ConnectorMappingError extends Error {
  constructor(readonly missingConnectors: string[]) { super('连接器需要本机映射：' + missingConnectors.join('、')); }
}
const walk = (rows: PresetDefinition['plugins'], fn: (row: PresetDefinition['plugins'][number]) => void) => { for (const row of rows) row.group ? walk(row.config as PresetDefinition['plugins'], fn) : fn(row); };
export function skillDirectories(preset: PresetDefinition): string[] { const dirs: string[] = []; walk(preset.plugins, r => { if (r.name === '@deepseek-ai/dsh-skill-filesystem') dirs.push(...((r.config as any)?.customSkillDirs ?? [])); }); return dirs; }
export function personaPrefix(preset: PresetDefinition): string { const parts: string[] = []; walk(preset.plugins, r => { if (r.name === '@deepseek-ai/dsh-persona' && !r.disabled) parts.push(String((r.config as any)?.prefix ?? '')); }); return parts.join('\n\n'); }
export function stageInstructions(node: WorkflowStage): string { return '\n\n本会话属于 WorkDSH 阶段编排，仅执行当前阶段：' + node.name + '。其他阶段由 Host 控制，不自行跨阶段。\n' + node.prompt + '\n输入文件：' + (node.inputs ?? []).join('、') + '\n必须交付的新文件：' + (node.outputs ?? []).join('、') + '\n完成当前阶段后等待用户验收；模型文字不代表阶段通过。'; }

export function teamTemplate(revision: import('workdsh-contracts').ExpertRevision): StageTeamConfig | undefined {
  if (!revision.definition.team) return;
  return {lead:{expert:{expertId:revision.expertId,revisionId:revision.revisionId},goal:revision.definition.role || revision.definition.description},strategy:'parallel',members:revision.definition.team.members.map(m=>({key:m.key,expert:revision.teamMembers![m.key],role:m.definition.role || m.definition.name,task:m.definition.description,connectors:[]}))};
}
export function teamInstructions(team?: StageTeamConfig, memberName?: string): string {
  if (!team) return '';
  if (memberName) { const member=team.members.find(m=>m.key===memberName); if(!member) throw new Error('成员不属于此阶段团队。'); return '\n阶段成员分工：'+member.role+'\n只执行本成员任务：'+member.task+'\n通过官方 Team 任务板领取、更新并完成自己的任务，然后向 Lead 汇报。'; }
  return '\n本阶段使用官方 Agent Teams。Lead 目标：'+team.lead.goal+'\n必须使用 spawn_teammate 创建以下成员（name 必须完全一致），通过 team_task_create 建立并分配任务：\n'+JSON.stringify(team.members.map(m=>({name:m.key,role:m.role,task:m.task})))+'\n协作策略：'+(team.strategy==='parallel'?'所有成员可以并行工作。':'成员按上述顺序执行；通过任务 blockedBy 设置前后依赖，上一任务完成后才启动下一任务。')+'\nLead 负责汇总与产出验收。所有配置成员均完成任务且文件交付后才可结束；不自行跨阶段。';
}
export async function capabilityCatalog(ctx: Context, actor: ActorContext, signal: AbortSignal): Promise<CapabilityCatalog> {
  const result: CapabilityCatalog = { experts: [], skills: [], connectors: [], diagnostics: [] };
  if (ctx.workdshExperts) {
    let cursor: string | undefined;
    do { const page = await ctx.workdshExperts.list(actor, { availability: 'enabled', limit: 100, cursor }, signal);
      for (const summary of page.items) {
        for (const rev of await ctx.workdshExperts.listWorkflowRevisions(actor, summary.id, signal)) result.experts.push({ id: rev.expertId, name: rev.definition.name, kind: rev.definition.team ? 'team' : 'expert', revisionId: rev.revisionId, description: rev.definition.description, members: Object.keys(rev.teamMembers ?? {}), team: teamTemplate(rev) });
      } cursor = page.nextCursor;
    } while (cursor);
  } else result.diagnostics.push('专家服务未就绪。');
  if (ctx.workdshSkills) for (const skill of (await ctx.workdshSkills.list(signal)).filter(s => s.modelInvocable)) {
    const detail = await ctx.workdshSkills.detail(skill.name, signal), selectable = Boolean(detail?.directoryPath) && ['enabled', 'readonly'].includes(skill.state);
    result.skills.push({ name: skill.name, description: skill.description, state: skill.state, selectable, ...(!selectable ? { reason: detail?.directoryPath ? '技能未启用' : '此内置能力由插件提供，没有可冻结的文件目录' } : {}) });
  }
  const connectors = connectorsService(ctx);
  if (connectors) result.connectors = [...await connectors.list(signal)]; else result.diagnostics.push('连接器插件未启用；可继续使用无连接器的阶段。');
  return result;
}

export async function resolveStageCapabilities(ctx: Context, actor: ActorContext, manifest: WorkflowManifest, node: WorkflowStage, signal: AbortSignal, consumer?: { domain: string; id: string }) {
  const effective = effectiveExecution(manifest, node);
  const lock: StageCapabilityLock = { skills: [], connectors: effective.connectors?.requirements ?? [], ...(effective.model ? { model: effective.model } : {}) };
  // Missing local mappings are prerequisites: report them before expensive frozen-file verification.
  // Availability is checked again at stage start, and mapped drafts still undergo every check below.
  if (lock.connectors.length) {
    const connectors = connectorsService(ctx); if (!connectors) throw new Error('连接器插件未启用。');
    const catalog = await connectors.list(signal);
    const missing = [...new Set(lock.connectors.filter(r => r.required && !catalog.some(c => c.serverName === r.serverName)).map(r => r.serverName))];
    if (missing.length) throw new ConnectorMappingError(missing);
  }
  let expertPreset: PresetDefinition | undefined;
  const refs: SkillRevisionRef[] = [...effective.skills ?? []], directories: string[] = [];
  if (effective.executor && effective.executor.kind !== 'workflow') {
    if (!ctx.workdshExperts) throw new Error('专家服务不可用。');
    const { revision, preset } = await ctx.workdshExperts.resolveWorkflowRevision(actor, effective.executor, signal);
    if (Boolean(revision.definition.team) !== (effective.executor.kind === 'team')) throw new Error('绑定主体类型与专家版本不一致。');
    lock.executor = { kind: effective.executor.kind, expertId: revision.expertId, revisionId: revision.revisionId, name: revision.definition.name, compositionDigest: revision.compositionDigest, ...(revision.teamMembers ? { teamMembers: { ...revision.teamMembers } } : {}) };
    refs.push(...revision.dependencyLock); expertPreset = preset; directories.push(...skillDirectories(preset));
  }
  if (effective.team) {
    if (lock.executor?.kind !== 'team') throw new Error('阶段团队配置需要绑定已发布专家团。');
    const team = structuredClone(effective.team), roles: NonNullable<StageCapabilityLock['team']>['roles'] = {};
    for (const [key, ref, extras] of [['lead', team.lead.expert, []], ...team.members.map(m => [m.key, m.expert, m.skills ?? []])] as [string, import('workdsh-contracts').ExpertRevisionRef, SkillRevisionRef[]][]) {
      const resolved = await ctx.workdshExperts.resolveWorkflowRevision(actor, ref, signal);
      if (key !== 'lead' && resolved.revision.definition.team) throw new Error('团队成员必须绑定单个专家。');
      roles[key] = {expert: ref, name: resolved.revision.definition.name, compositionDigest: resolved.revision.compositionDigest, skills: [...resolved.revision.dependencyLock, ...extras]};
      for (const skill of roles[key].skills) {
        const check = await ctx.workdshSkills.checkRevision(skill, actor, signal);
        if (check.status !== 'intact' || !check.snapshotDir) throw new Error('团队角色 Skill 不可用：' + skill.name);
        if (consumer) await ctx.workdshSkills.retainRevision(skill, consumer, signal);
      }
      if (key === 'lead') { expertPreset = resolved.preset; refs.push(...resolved.revision.dependencyLock); directories.push(...skillDirectories(resolved.preset)); }
    }
    for (const member of team.members) for (const serverName of member.connectors ?? []) if (!lock.connectors.some(r=>r.serverName===serverName)) throw new Error('成员连接器必须在阶段范围内：'+serverName);
    lock.team = {...team, roles};
    lock.executor.teamMembers = Object.fromEntries(team.members.map(m=>[m.key,m.expert]));
  }
  const unique = new Map<string, SkillRevisionRef>(), names = new Map<string, SkillRevisionRef>();
  for (const ref of refs) {
    const sameName = names.get(ref.name.toLowerCase());
    if (sameName && (sameName.skillId !== ref.skillId || sameName.contentDigest !== ref.contentDigest)) throw new Error('同名 Skill 冲突：' + ref.name);
    const previous = unique.get(ref.skillId); if (previous && previous.contentDigest !== ref.contentDigest) throw new Error('Skill 版本冲突：' + ref.name); if (previous) continue;
    if (!ctx.workdshSkills) throw new Error('Skill 服务不可用。');
    const check = await ctx.workdshSkills.checkRevision(ref, actor, signal);
    if (check.status !== 'intact' || !check.snapshotDir) throw new Error('Skill 不可用：' + ref.name + ' · ' + check.status);
    directories.push(consumer ? (await ctx.workdshSkills.retainRevision(ref, consumer, signal)).snapshotDir : check.snapshotDir); unique.set(ref.skillId, ref); names.set(ref.name.toLowerCase(), ref);
  }
  lock.skills = [...unique.values()];
  if (node.gate && !lock.skills.some(s => s.name === 'app-gen')) throw new Error('app-gen 门禁需要绑定完整 app-gen Skill 固定版本。');
  return { lock, expertPreset, directories: [...new Set(directories)] };
}

/** Preserve the complete workflow composition; append explicit expert persona and frozen skill roots. */
export function composeStagePreset(base: PresetDefinition, expert: PresetDefinition | undefined, directories: string[], node: WorkflowStage, id: string): PresetDefinition {
  const stage = { ...structuredClone(base), id, name: base.name + ' · ' + node.name, plugins: [...structuredClone(base.plugins)] };
  const extraPrefix = expert ? '\n\n当前阶段执行主体（完整已发布定义）：\n' + personaPrefix(expert) : '';
  let persona = false, skill = false;
  walk(stage.plugins, row => {
    if (row.name === '@deepseek-ai/dsh-persona' && !row.disabled) { persona = true; row.config = { ...(row.config as any), prefix: String((row.config as any)?.prefix ?? '') + extraPrefix + stageInstructions(node) + teamInstructions(node.execution?.team) }; }
    if (row.name === '@deepseek-ai/dsh-skill-filesystem') { skill = true; row.config = { ...(row.config as any), watch: false, includeDefaultRoots: false, customSkillDirs: [...new Set([...((row.config as any)?.customSkillDirs ?? []), ...directories])] }; }
  });
  if (!persona) throw new Error('阶段需要启用 Persona。');
  if (!skill && directories.length) stage.plugins.push({ id: 'stage-skills', name: '@deepseek-ai/dsh-skill-filesystem', config: { watch: false, includeDefaultRoots: false, customSkillDirs: directories } });
  if (expert) {
    const present = new Set<string>(); walk(stage.plugins, r=>{if(!r.disabled)present.add(r.name);});
    walk(expert.plugins, r=>{if(r.name.startsWith('@deepseek-ai/dsh-tool-team-') && !present.has(r.name)) {stage.plugins.push(structuredClone(r)); present.add(r.name);}});
  }
  return stage;
}

export async function applyConnectors(ctx: Context, lock: StageCapabilityLock, sessionId: string, signal: AbortSignal): Promise<string[]> {
  const connectors = connectorsService(ctx);
  if (!connectors) { if (lock.connectors.length) throw new Error('连接器插件不可用。'); return []; }
  const catalog = await connectors.list(signal), ids: string[] = [];
  for (const requirement of lock.connectors) {
    const found = catalog.find(c => c.serverName === requirement.serverName);
    if (!found || !found.enabled || found.state !== 'ready') { if (requirement.required) throw new Error('必需连接器尚未就绪：' + requirement.serverName); continue; }
    ids.push(found.id);
  }
  await connectors.setSelection(sessionId, ids);
  const applied = [...await connectors.selection(sessionId)];
  if (applied.length !== ids.length || ids.some(id => !applied.includes(id))) throw new Error('连接器未实际应用到阶段会话。');
  return applied;
}

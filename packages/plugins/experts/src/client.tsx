import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import { WorkflowsPanel, WorkflowNavigationIcon } from './client/WorkflowsPanel.js';
import type { ComposerHandoff, ComposerHandoffSource } from 'workdsh-contracts/composer';
declare module '@deepseek-ai/cordis' { interface Events { 'workdsh/composer-handoff'(handoff: ComposerHandoff): Promise<void>; } }
import type { ActivityPresentation } from 'workdsh-contracts/activity';
declare module '@deepseek-ai/cordis' { interface Context { activityPresentation: ActivityPresentation; } }
import { installExpertPresetMenu } from './client/PresetMenu.js';
import { ConversationWorkflows } from './client/ConversationWorkflows.js';
import { PROJECT_TASK_FOCUS_EVENT, type ProjectTaskFocus, type ProjectTaskContext } from 'workdsh-contracts/projects';
import { ConversationExperts } from './client/ConversationExperts.js';
import { parseDocument } from 'yaml';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import { ProjectWorkflowSurface, ProjectConversationEmbed } from './client/ProjectWorkflowSurface.js';
import { readManifest } from './workflows/authoring.js';
import type { WorkflowDetail } from './workflows/authoring.js';
import type { ProjectInputRef } from 'workdsh-contracts/projects';
import { ExpertsPanel } from './client/ExpertsPanel.js';
import { PendingExpertDraft, pendingExpertDraftKey, pendingExpertDraftEvent, expertManagerGuide, expertTeamManagerGuide } from './client/drafts.js';
import { createExpertManagementClient } from './client/management.js';


declare module '@deepseek-ai/dsh-client-ui-slots' { interface SlotMap {
  'workdsh.project.workflow': {kind:'single';scope:'root';owner:import('workdsh-contracts/projects').ProjectWorkflowOwner};
  'workdsh.project.conversation': {kind:'single';scope:'session';owner:{}};
} }

declare module '@deepseek-ai/dsh-api-session-controller/client' {interface SessionReferenceSourceMap {workdshProjectWorkflow:unknown}}
export const name = 'workdsh-experts-client';
export const inject = ['slots', 'layout', 'sessions', 'workspaces', 'remote', 'remote.session', 'connection', 'uiWorkspace', 'conversation'];

type SessionId = Awaited<ReturnType<ISessions['create']>>;

/**
 * Expert Client assembly (D04 / P1-02).
 *
 * Contributes the expert `main` panel and one native-input draft overlay. Expert
 * management does not add a `sidebar.panellist` entry: the shared
 * capability center ("专家 · 技能 · 连接器") stays a single navigation item owned by the
 * Skill plugin, and the two panels switch through the in-panel capability tabs via
 * `layout.selectPanel`. This keeps AT-20 (no duplicate navigation) and lets the Skill
 * panel keep working when experts is removed. The seven packaged workflows use a
 * separate native sidebar entry and paired main panel.
 *
 * Summon creates the bound native Session on the Host (so the expert's compiled preset
 * is attached at creation), then opens it here and seeds a one-shot draft hand-off; the
 * draft is never auto-sent. "制作专家" opens an ordinary Session seeded with the
 * `/workdsh-expert-manager` guide.
 */
export function apply(ctx: Context): void {
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort(), 'workdsh.experts.client');
  const waitForInput = (milliseconds: number) => new Promise<void>((resolve, reject) => {
    lifetime.signal.throwIfAborted();
    const abort = () => { window.clearTimeout(timer); reject(lifetime.signal.reason); };
    const timer = window.setTimeout(() => { lifetime.signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    lifetime.signal.addEventListener('abort', abort, { once: true });
  });
  // Host and Client faces ship from one package; keep browser calls bound to the client face.
  const sessions = ctx.sessions as unknown as ISessions;
  const management = createExpertManagementClient(ctx, lifetime.signal);
  installExpertPresetMenu(ctx, management);
  ctx.inject(['activityPresentation'], (scope) => scope.effect(() => scope.activityPresentation.registerIdentity(async (sessionId, signal) => {
    // Official Team member conversations are continuable child Sessions. Their
    // immutable expert binding belongs to the Lead Session, exactly like the
    // official Team Client resolves its panel through parentSessionId. alpha.2:
    // read the discovered address off the controller instead of borrowing a binding.
    const rootSessionId = (sessions.subagentAddress(sessionId as SessionId)?.parentSessionId ?? sessionId) as SessionId;
    const binding = await management.verifyBinding(rootSessionId, signal);
    const detail = await management.get(binding.expertRevisionRef.expertId, binding.expertRevisionRef.revisionId, signal);
    const definition = detail.revision?.definition;
    if (!definition) return undefined;
    const local = (value: unknown): string | undefined => typeof value === 'string' ? value : value && typeof value === 'object' ? (value as { zh?: string; en?: string }).zh ?? (value as { en?: string }).en : undefined;
    const identityOf = (value: typeof definition) => {
      let metadata: { displayName?: unknown; profession?: unknown; avatar?: string } = {};
      try { const front = value.agentDocument?.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]; if (front) { const parsed = parseDocument(front); if (!parsed.errors.length) metadata = parsed.toJS(); } } catch { /* optional authored metadata */ }
      const path = (metadata.avatar ?? value.avatarRef ?? '').replace(/^\.\//, '');
      const asset = value.packageAssets?.[path] ?? definition.packageAssets?.[path];
      const avatar = asset && /\.(png|jpe?g|webp)$/i.test(path) ? `data:image/${/\.webp$/i.test(path) ? 'webp' : /\.jpe?g$/i.test(path) ? 'jpeg' : 'png'};base64,${asset.base64}` : value.avatarRef;
      return { name: local(metadata.displayName) || value.name, profession: local(metadata.profession), avatar };
    };
    const leadIdentity = identityOf(definition);
    return { ...leadIdentity, kind: definition.team ? 'team' : 'expert', ...(definition.team ? { teamName: definition.name, members: [{ key: 'lead', ...leadIdentity, kind: 'expert' as const }, ...definition.team.members.map(member => ({ key: member.key, ...identityOf(member.definition), kind: 'expert' as const }))] } : {}) };
  })));


  // alpha.2: the list snapshot has no `current`; the shown Session derives from the
  // view owner's mainView retention (same rule as the official ui-session publishMain).
  const resolveWorkspace = () => {
    const sessionState = sessions.list.getSnapshot();
    const currentId = Object.values(sessionState.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id;
    const workspaces = ctx.workspaces.list.getSnapshot().items;
    return (currentId ? workspaces.find(row => row.sessionIds.includes(currentId)) : undefined)
      ?? workspaces.find(row => row.path === (currentId ? sessionState.byId[currentId]?.cwd : undefined))
      ?? workspaces[0];
  };

  /** Seed an empty native input once through the addressed overlay hand-off. */
  const seedDraft = async (sessionId: SessionId, text: string): Promise<void> => {
    window.sessionStorage.setItem(pendingExpertDraftKey, JSON.stringify({ sessionId, text, expiresAt: Date.now() + 60_000 }));
    // Select after staging so the Session overlay mounts with its addressed seed.
    ctx.uiWorkspace.openSession(sessionId);
    window.dispatchEvent(new Event(pendingExpertDraftEvent));
  };

  /** Pull the Host-created native Session into the client list, then select it. */
  const openSession = async (sessionId: SessionId): Promise<void> => {
    for (let attempt = 0; attempt < 30; attempt++) {
      lifetime.signal.throwIfAborted();
      await sessions.refresh();
      if (sessions.list.getSnapshot().byId[sessionId]) { ctx.uiWorkspace.openSession(sessionId); return; }
      await waitForInput(120);
    }
    throw new Error('未能打开专家任务，请稍后在会话列表中查看。');
  };

  const summon = async (expertId: string, revisionId: string | undefined, draftText: string | undefined, source?: ComposerHandoffSource): Promise<void> => {
    lifetime.signal.throwIfAborted();
    const workspace = resolveWorkspace();
    const plan = await management.prepareExecution(expertId, {
      ...(revisionId === undefined ? {} : { revisionId }),
      ...(workspace ? { workspaceRef: workspace.path, workspaceId: String(workspace.workspaceId) } : {}),
      ...(draftText ? { draftText } : {}),
    });
    if (plan.missing.length > 0) {
      throw new Error(plan.missing.map(issue => issue.message).join('；') || '该专家暂不可召唤。');
    }
    const creation = await management.createExecution(plan.executionPlanId, management.newOperationId('create-execution'));
    const sessionId = creation.sessionId as SessionId;
    const references = source?.references.map(reference => ({ ...reference })) ?? [];
    if (source) await ctx.parallel('workdsh/composer-handoff', { sourceSessionId: source.sessionId, targetSessionId: String(sessionId), references });
    await openSession(sessionId);
    ctx.layout.selectPanel(null);
    if (creation.handoffId) {
      const handoff = await management.consumeHandoff(creation.handoffId, creation.handoffId);
      if (!source && handoff.text) await seedDraft(sessionId, handoff.text);
    }
    if (source) {
      const binding = sessions.binding(sessionId);
      if (!binding) throw new Error('专家任务输入框尚未就绪，请重试。');
      const input = ctx.conversation.input.for(binding.ctx);
      const state = input.state.getSnapshot();
      if (state.draft || state.attachmentIds.length || state.phase !== 'plain') throw new Error('专家任务已有草稿，不能覆盖。');
      input.setDraft(source.draft);
      for (const reference of [...references].sort((a, b) => b.offset - a.offset)) {
        const current = input.state.getSnapshot();
        if (!input.insertReference(reference, { start: reference.offset, end: reference.offset + reference.length, draftRev: current.draftRev })) throw new Error('资料引用未能恢复，请在新任务中重新添加。');
      }
    }
  };

  const createExpertTask = async (kind: 'agent' | 'team' = 'agent'): Promise<void> => {
    lifetime.signal.throwIfAborted();
    const workspace = resolveWorkspace();
    if (!workspace) throw new Error('需要先选择一个工作区再制作专家。');
    const sessionId = await sessions.create({ workspaceId: workspace.workspaceId, cwd: workspace.path });
    lifetime.signal.throwIfAborted();
    ctx.uiWorkspace.openSession(sessionId);
    ctx.layout.selectPanel(null);
    await seedDraft(sessionId, kind === 'team' ? expertTeamManagerGuide : expertManagerGuide);
  };

  const editExpertTask = async (expertId: string): Promise<void> => {
    lifetime.signal.throwIfAborted();
    const detail = await management.get(expertId);
    if (!detail.canEdit) throw new Error('没有编辑该作品的权限。');
    const definition = detail.draft.definition;
    const workspace = resolveWorkspace();
    if (!workspace) throw new Error('需要先选择一个工作区再修改专家。');
    const sessionId = await sessions.create({ workspaceId: workspace.workspaceId, cwd: workspace.path });
    lifetime.signal.throwIfAborted();
    ctx.layout.selectPanel(null);
    // Use authored names only. Never translate a Chinese name or expose storage IDs.
    let englishName = '';
    const authoredName = (value: unknown): string => typeof value === 'string' && value.trim() && /^[\x20-\x7e]+$/.test(value.trim()) && /[a-z]/i.test(value) ? value.trim() : '';
    const manifestText = definition.packageDocuments?.['.workdsh-expert/plugin.json'] ?? definition.packageDocuments?.['.codebuddy-plugin/plugin.json'];
    try {
      if (manifestText) {
        const manifest = JSON.parse(manifestText);
        englishName = authoredName(manifest.displayName?.en) || authoredName(manifest.name);
      } else if (!definition.team) {
        const frontmatter = definition.agentDocument?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
        const document = frontmatter ? parseDocument(frontmatter) : undefined;
        const metadata = document && !document.errors.length ? document.toJS() : undefined;
        englishName = authoredName(metadata?.displayName?.en) || authoredName(metadata?.name);
      }
    } catch { /* Missing or invalid name metadata is omitted from the input. */ }
    const name = `${definition.name}${englishName && englishName !== definition.name ? `（${englishName}）` : ''}`;
    await seedDraft(sessionId, `/workdsh-expert-manager 帮我修改专家：[${name}]，增加/优化[请补充你希望新增/优化的技能或知识领域等]方面的能力`);
  };

  const workflowRequests = new Map<string, string>();
  const startWorkflow = async (workflowId: string): Promise<void> => {
    lifetime.signal.throwIfAborted();
    const workspace = resolveWorkspace();
    if (!workspace) throw new Error('请先选择或创建工作区，再使用工作流。');
    const key = workspace.workspaceId + ':' + workflowId;
    const requestId = workflowRequests.get(key) ?? window.crypto.randomUUID();
    workflowRequests.set(key, requestId);
    const created = await management.createWorkflow(workflowId, requestId, String(workspace.workspaceId));
    await openSession(created.sessionId as SessionId);
    workflowRequests.delete(key);
    ctx.layout.selectPanel(null);
  };
  const loadWorkflows = (signal: AbortSignal) => management.listWorkflows(signal);
  const configureWorkflow = (values: Record<string, string>) => management.configureFeishu(values).then(() => undefined);
  const startAuthoredWorkflow = async (workflowId: string, revisionId?: string, input?: string): Promise<void> => {
    lifetime.signal.throwIfAborted();
    const workspace = resolveWorkspace();
    if (!workspace) throw new Error('请先选择或创建工作区，再使用工作流。');
    const key = workspace.workspaceId + ':' + workflowId + ':' + (revisionId ?? 'published') + ':' + (input ?? 'manual');
    const sessionId = workflowRequests.get(key) ?? window.crypto.randomUUID(); workflowRequests.set(key, sessionId);
    const created = await management.workflowAuthoring<{ sessionId: string }>({ action: 'create', workflowId, revisionId, sessionId,
      workspaceId: String(workspace.workspaceId), operationId: 'workflow-create-' + sessionId, ...(input===undefined?{}:{automatic:true,input}) });
    workflowRequests.delete(key);
    if(input===undefined){await openSession(created.sessionId as SessionId);ctx.layout.selectPanel(null);}
  };
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'workdsh-workflows', label: '工作流', order: 15 }, WorkflowNavigationIcon));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'workdsh-workflows', inject: () => ({ load: loadWorkflows, start: startWorkflow, configure: configureWorkflow, api: management.workflowAuthoring, startAuthored: startAuthoredWorkflow,
    openSession: async (sessionId: string) => { await openSession(sessionId as SessionId); ctx.layout.selectPanel(null); }, toggleNavigation: () => ctx.layout.toggleSidebar() }) }, WorkflowsPanel));


  const retainProjectSession=async(id:string,signal?:AbortSignal)=>{
    const waitSignal=signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal;waitSignal.throwIfAborted();
    await sessions.refresh();waitSignal.throwIfAborted();
    return sessions.retain(sessions.subagentAddress(id as SessionId)??id as SessionId,{source:'workdshProjectWorkflow',signal:waitSignal});
  };
  const startProjectWorkflow=async(projectId:string,workflowId:string,revisionId:string|undefined,input:string|undefined,references:readonly ProjectInputRef[]|undefined):Promise<string>=>{
    lifetime.signal.throwIfAborted();
    const response=await fetch('/api/workdsh-projects',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:'ensure-workspace',payload:{projectId}}),signal:lifetime.signal});
    const envelope=await response.json();if(!response.ok||!envelope.ok)throw new Error(envelope.error?.message??'无法打开项目工作区。');
    const workspace=envelope.value as {workspaceId:string;path:string};
    const detail=await management.workflowAuthoring<WorkflowDetail>({action:'get',workflowId,revisionId});
    const automatic=readManifest(detail.draft.files).mode==='staged'&&Boolean(input?.trim());
    const key=projectId+':'+workflowId+':'+(revisionId??'published')+':'+(input??'manual');
    const sessionId=workflowRequests.get(key)??crypto.randomUUID();workflowRequests.set(key,sessionId);
    const created=await management.workflowAuthoring<{sessionId:string}>({action:'create',workflowId,revisionId,sessionId,workspaceId:String(workspace.workspaceId),projectId,references:references??[],operationId:'project-workflow-create-'+sessionId,...(automatic?{automatic:true,input}: {})});
    void sessions.refresh().catch(()=>{/* The persisted task is authoritative; opening retains it directly. */});
    if(input?.trim()&&!automatic){const held=await retainProjectSession(created.sessionId);try{await held.ready;const conversation=held.binding.ctx.get('conversation');if(!conversation)throw new Error('工作流会话已创建，输入尚未就绪；请打开对话发送需求。');await conversation.send(input);}finally{held.release();}}
    workflowRequests.delete(key);return created.sessionId;
  };
  ctx.slots.inject('workdsh.project.conversation',()=>ctx.slots.register({name:'workdsh.project.conversation'},ProjectConversationEmbed));
  ctx.slots.inject('workdsh.project.workflow',()=>ctx.slots.register({name:'workdsh.project.workflow',children:{'workdsh.project.conversation':{kind:'single',scope:'session'}},inject:()=>({api:management.workflowAuthoring,load:loadWorkflows,start:startProjectWorkflow,retainSession:retainProjectSession})},ProjectWorkflowSurface));

  const openCapability = (key: string): void => { ctx.layout.selectPanel(key as Parameters<typeof ctx.layout.selectPanel>[0]); };
  const hasCapability = (key: string): boolean => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === key);

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'workdsh-experts',
    inject: () => ({ toggleNavigation: () => ctx.layout.toggleSidebar(), management, openCapability, hasCapability, summon, createExpertTask, editExpertTask }),
  }, ExpertsPanel));
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({ name: 'conversation.input.overlay', id: 'workdsh-expert-draft' }, PendingExpertDraft));
  const projectTaskContext=async(sessionId:string,signal:AbortSignal):Promise<ProjectTaskContext|null>=>{
    const response=await fetch('/api/workdsh-projects',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:'task-context',payload:{sessionId}}),signal:AbortSignal.any([signal,lifetime.signal,AbortSignal.timeout(5000)])});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error?.message??'无法读取项目任务。');return result.value??null;
  };
  const focusProjectTask=(projectId:string,sessionId:string)=>{
    const url=new URL(window.location.href);url.searchParams.set('project',projectId);url.searchParams.set('task',sessionId);url.searchParams.set('workdsh-view','project-detail');window.history.replaceState(window.history.state,'',url);
    ctx.layout.selectPanel('workdsh-project-detail' as Parameters<typeof ctx.layout.selectPanel>[0]);
    window.dispatchEvent(new CustomEvent<ProjectTaskFocus>(PROJECT_TASK_FOCUS_EVENT,{detail:{projectId,sessionId}}));
  };
  ctx.slots.inject('conversation.input.left',()=>ctx.slots.register({name:'conversation.input.left',id:'workdsh-project-workflow',order:30,inject:()=>({api:management.workflowAuthoring,readProjectTaskContext:projectTaskContext,startProjectRun:startProjectWorkflow,openProjectTask:focusProjectTask})},ConversationWorkflows));
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'workdsh-summon-expert', order: 25, inject: () => ({ management, summon, openManagement: () => openCapability('workdsh-experts') }) }, ConversationExperts));
}

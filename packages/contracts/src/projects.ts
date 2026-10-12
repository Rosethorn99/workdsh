import type { ActorContext, ResourceOwner } from './governance.js';

export type ProjectStatus = 'active' | 'archived';
export type WorkItemStatus = 'todo' | 'doing' | 'review' | 'done' | 'cancelled';
export type WorkItemPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
export type ProjectCapabilityKind = 'skill' | 'expert' | 'connector';

export interface ProjectCapabilityRef { readonly kind: ProjectCapabilityKind; readonly id: string; readonly revision?: string; readonly label: string; readonly scope?: 'personal' | 'public'; }
export interface ProjectConfig { readonly instruction: string; readonly capabilities: readonly ProjectCapabilityRef[]; }
export interface ProjectConfigRevision extends ProjectConfig { readonly id: string; readonly projectId: string; readonly number: number; readonly createdBy: string; readonly createdAt: string; }
export interface Project { readonly id: string; readonly name: string; readonly description: string; readonly templateId?: string; readonly owner: ResourceOwner; readonly status: ProjectStatus; readonly configRevisionId: string; readonly createdAt: string; readonly updatedAt: string; }
export interface ProjectTemplate { readonly id: string; readonly name: string; readonly description: string; readonly instruction: string; }
export interface ProjectWorkItem { readonly id: string; readonly projectId: string; readonly title: string; readonly status: WorkItemStatus; readonly assignee?: string; readonly priority: WorkItemPriority; readonly tags: readonly string[]; readonly revision: string; readonly createdAt: string; readonly updatedAt: string; }
export interface ProjectAssetRef { readonly id: string; readonly projectId: string; readonly nodeId: string; readonly assetId: string; readonly revisionId: string; readonly name: string; readonly kind: string; readonly createdAt: string; }
export type ProjectInputRefKind = 'work-item' | 'asset' | 'skill';
export interface ProjectInputRef { readonly kind: ProjectInputRefKind; readonly id: string; readonly revision: string; readonly label: string; }
/** UI navigation only; the Project service rechecks the target task before displaying it. */
export const PROJECT_TASK_FOCUS_EVENT = 'workdsh:project-task-focus';
export interface ProjectTaskFocus { readonly projectId: string; readonly sessionId: string; }
export interface ProjectWorkflowRef { readonly workflowId: string; readonly revisionId: string; readonly runId: string; readonly stageId: string; }
export interface ProjectWorkflowOwner {
  snapshot: ProjectSnapshot; sessionId?: string; mode: 'task' | 'plan' | 'launch'; input?: string;
  references?: readonly ProjectInputRef[]; activateConversation?: (conversationId:string)=>void; done: (sessionId:string)=>void; refresh:()=>Promise<void>;
}

export interface ProjectTaskLink { readonly id: string; readonly projectId: string; readonly sessionId: string; readonly title: string; readonly configRevisionId: string; readonly capabilities?: readonly ProjectCapabilityRef[]; readonly workItemId?: string; readonly references: readonly ProjectInputRef[]; readonly workflow?: ProjectWorkflowRef; readonly createdAt: string; }
export interface ProjectTaskContext { readonly availableCapabilities?: readonly ProjectCapabilityRef[]; readonly project: Project; readonly config: ProjectConfigRevision; readonly task: ProjectTaskLink; }
export interface ProjectActivity { readonly id: string; readonly projectId: string; readonly kind: 'project' | 'work-item' | 'asset' | 'task'; readonly text: string; readonly actorId: string; readonly createdAt: string; }
export interface ProjectSnapshot { readonly project: Project; readonly config: ProjectConfigRevision; readonly workItems: readonly ProjectWorkItem[]; readonly assets: readonly ProjectAssetRef[]; readonly tasks: readonly ProjectTaskLink[]; readonly activity: readonly ProjectActivity[]; }
export interface CreateProjectInput { readonly name: string; readonly description?: string; readonly templateId?: string; }

export interface ProjectService {
  templates(): Promise<readonly ProjectTemplate[]>;
  list(actor: ActorContext, query?: string, signal?: AbortSignal): Promise<readonly Project[]>;
  listArchived(actor: ActorContext, query?: string, signal?: AbortSignal): Promise<readonly Project[]>;
  create(actor: ActorContext, input: CreateProjectInput, signal?: AbortSignal): Promise<ProjectSnapshot>;
  get(actor: ActorContext, projectId: string, signal?: AbortSignal): Promise<ProjectSnapshot>;
  archive(actor: ActorContext, projectId: string, signal?: AbortSignal): Promise<Project>;
  restore(actor: ActorContext, projectId: string, signal?: AbortSignal): Promise<Project>;
  updateConfig(actor: ActorContext, projectId: string, config: ProjectConfig, expectedRevisionId: string, signal?: AbortSignal): Promise<ProjectConfigRevision>;
  addWorkItem(actor: ActorContext, projectId: string, title: string, signal?: AbortSignal): Promise<ProjectWorkItem>;
  updateWorkItem(actor: ActorContext, projectId: string, item: Pick<ProjectWorkItem, 'id'|'title'|'status'|'assignee'|'priority'|'tags'>, expectedRevision: string, signal?: AbortSignal): Promise<ProjectWorkItem>;
  addAsset(actor: ActorContext, projectId: string, asset: Omit<ProjectAssetRef, 'id'|'projectId'|'createdAt'>, signal?: AbortSignal): Promise<ProjectAssetRef>;
  removeAsset(actor: ActorContext, projectId: string, refId: string, signal?: AbortSignal): Promise<void>;
  validateInputRefs(actor: ActorContext, projectId: string, references: readonly ProjectInputRef[], signal?: AbortSignal): Promise<readonly ProjectInputRef[]>;
  linkTask(actor: ActorContext, projectId: string, sessionId: string, title: string, workItemId?: string, references?: readonly ProjectInputRef[], signal?: AbortSignal, capabilities?: readonly ProjectCapabilityRef[], configRevisionId?: string, workflow?: ProjectWorkflowRef): Promise<ProjectTaskLink>;
  taskContext(actor: ActorContext, sessionId: string, signal?: AbortSignal): Promise<ProjectTaskContext | undefined>;
  noteDeliveryGap(actor: ActorContext, projectId: string, text: string, signal?: AbortSignal): Promise<void>;
}

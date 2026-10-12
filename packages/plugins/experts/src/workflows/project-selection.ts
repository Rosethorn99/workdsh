import type { WorkflowSummary } from './authoring.js';

export interface ProjectWorkflowBinding { workflowId: string; name: string }
export interface ProjectWorkflowOptions {
  binding?: ProjectWorkflowBinding;
  workflows: WorkflowSummary[];
  blocked?: string;
}

/** Read the explicit workflowId clause already saved by project workflow setup.
 * Ordinary workflow references in prose are not project restrictions.
 */
export function projectWorkflowBinding(instruction: string): ProjectWorkflowBinding | undefined {
  const clauses = instruction.match(/(?:^|[\n。])本项目仅使用(?:现有)?工作流[^\n。]*/g) ?? [];
  if (!clauses.length) return undefined;
  const match = clauses.length === 1 && clauses[0].match(/工作流[“"]([^”"\r\n]+)[”"]\s*[（(]workflowId=(wf-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})[）)]/i);
  if (!match) throw Object.assign(new Error('项目的固定工作流指令缺少唯一有效的 workflowId，请检查项目指令。'), { code: 'workflows/project-binding-invalid' });
  return { workflowId: match[2], name: match[1] };
}

export function projectWorkflowOptions(binding: ProjectWorkflowBinding | undefined, workflows: WorkflowSummary[]): ProjectWorkflowOptions {
  if (!binding) return { workflows: workflows.filter(w => !w.archivedAt) };
  const row = workflows.find(w => w.id === binding.workflowId);
  const blocked = !row ? '项目绑定的工作流不存在或无权访问，请检查项目指令中的工作流。'
    : row.archivedAt ? '项目绑定的工作流已归档，请恢复原工作流后再运行。'
    : !row.publishedRevision ? '项目绑定的工作流尚未发布，请在「计划」中完成能力校验并发布后再运行。' : undefined;
  return { binding, workflows: row && !row.archivedAt ? [row] : [], ...(blocked ? { blocked } : {}) };
}

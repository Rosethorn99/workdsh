import type { CapabilityCatalog, StageExecution, WorkflowStage } from '../../workflows/authoring.js';

export interface PaletteItem {
  id: string; name: string; description: string; kind: WorkflowStage['kind'] | 'note'; color: string;
  binding?: string; disabled?: boolean; category?: string;
}
export interface CanvasNote { id: string; text: string; color: string; x: number; y: number; width?: number; height?: number }
export interface CardData extends Record<string, unknown> {
  stage?: WorkflowStage; effective?: StageExecution; name: string; state: string; readonly: boolean; entry?: boolean;
  executor?: string; catalog?: CapabilityCatalog;
  patch?: (id: string, values: Partial<WorkflowStage>) => void;
  inspect?: (id: string, tab?: 'basic' | 'capabilities' | 'outputs') => void;
  duplicate?: (ids: string[]) => void; remove?: (ids: string[]) => void;
}

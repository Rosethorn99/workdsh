export interface WorkflowDefinition {
  readonly id: string;
  readonly sourceId: string;
  readonly name: string;
  readonly role: string;
  readonly description: string;
  readonly category: string;
  readonly deliverable: string;
  readonly requirements: string;
  readonly skills: readonly string[];
  readonly order: number;
}
export interface WorkflowStatus extends WorkflowDefinition {
  readonly broken?: string;
  readonly configured?: boolean;
}
export interface WorkflowCatalog {
  readonly repository: string;
  readonly commit: string;
  readonly license: string;
  readonly workflows: readonly WorkflowStatus[];
}

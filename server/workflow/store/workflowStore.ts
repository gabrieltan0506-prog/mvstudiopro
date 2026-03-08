import type { WorkflowTask } from "../types/workflow";

const store = new Map<string, WorkflowTask>();

export function saveWorkflow(task: WorkflowTask) {
  store.set(task.workflowId, task);
}

export function getWorkflow(id: string) {
  return store.get(id);
}

export function updateWorkflow(id: string, data: Partial<WorkflowTask>) {
  const current = store.get(id);
  if (!current) return;
  store.set(id, { ...current, ...data });
}

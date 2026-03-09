import type { WorkflowTask } from "../types/workflow";

const store = new Map<string, WorkflowTask>();

export function saveWorkflow(task: WorkflowTask) {
  store.set(task.workflowId, task);
}

export function getWorkflow(workflowId: string) {
  return store.get(workflowId);
}

export function updateWorkflow(workflowId: string, patch: Partial<WorkflowTask>) {
  const current = store.get(workflowId);
  if (!current) return undefined;

  const next: WorkflowTask = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
    outputs: {
      ...current.outputs,
      ...(patch.outputs || {}),
    },
  };

  store.set(workflowId, next);
  return next;
}

export function listWorkflows() {
  return Array.from(store.values());
}

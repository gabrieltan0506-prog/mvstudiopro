import type { WorkflowTask } from "../types/workflow";
import { getWorkflow, updateWorkflow } from "../store/workflowStore";

export function renderStep(task: WorkflowTask) {
  if (!task.outputs.videoUrl) {
    updateWorkflow(task.workflowId, {
      currentStep: "render",
      outputs: {
        renderProvider: "workflow-render",
        renderIsFallback: true,
        renderErrorMessage: "missing outputs.videoUrl",
      },
    });
    throw new Error("missing outputs.videoUrl");
  }

  const updated = updateWorkflow(task.workflowId, {
    currentStep: "render",
    outputs: {
      finalVideoUrl: task.outputs.videoUrl,
      renderProvider: "workflow-render",
      renderIsFallback: false,
      renderErrorMessage: undefined,
    },
  });

  return updated ?? getWorkflow(task.workflowId);
}

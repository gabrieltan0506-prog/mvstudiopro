export type WorkflowType = "storyboardToVideo";

export type WorkflowStatus = "queued" | "running" | "succeeded" | "failed";

export type WorkflowRun = {
  id: string;
  userId: string;
  type: WorkflowType;
  status: WorkflowStatus;
  inputJson: any;
  stateJson: any;
  outputsJson: any;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowType =
  | "storyboardToVideo"
  | "musicVideo"
  | "viralAnalysis";

export type WorkflowStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export type WorkflowRun = {
  id: string;
  type: WorkflowType;
  status: WorkflowStatus;
  input: any;
  state: any;
  outputs: any;
  createdAt: string;
  updatedAt: string;
};

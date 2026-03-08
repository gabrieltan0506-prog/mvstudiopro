export type WorkflowStep =
  | "input"
  | "script"
  | "storyboard"
  | "image"
  | "video"
  | "music"
  | "render"
  | "done"
  | "error";

export type WorkflowStatus =
  | "pending"
  | "running"
  | "done"
  | "failed";

export interface WorkflowOutputs {
  script?: string;
  storyboard?: Array<{
    sceneIndex: number;
    scenePrompt: string;
    duration: number;
    camera: string;
    mood: string;
  }>;
  imageUrls?: string[];
  videoUrl?: string;
  musicUrl?: string;
}

export interface WorkflowTask {
  workflowId: string;
  sourceType: "remix" | "showcase" | "direct";
  inputType: "script" | "image";
  currentStep: WorkflowStep;
  status: WorkflowStatus;
  payload: Record<string, any>;
  outputs: WorkflowOutputs;
  createdAt: number;
  updatedAt: number;
}

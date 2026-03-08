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

export interface WorkflowTask {
  workflowId: string;
  sourceType: "remix" | "showcase" | "direct";
  inputType: "script" | "image";
  currentStep: WorkflowStep;
  status: "pending" | "running" | "done" | "failed";
  payload: Record<string, any>;
  outputs: {
    script?: string;
    storyboard?: any;
    imageUrls?: string[];
    videoUrl?: string;
    musicUrl?: string;
  };
  createdAt: number;
}

export type WorkflowStep =
  | "input"
  | "script"
  | "storyboard"
  | "storyboardImages"
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
  scriptProvider?: string;
  scriptModel?: string;
  scriptIsFallback?: boolean;
  scriptErrorMessage?: string;
  storyboard?: Array<{
    sceneIndex: number;
    scenePrompt: string;
    duration: number;
    camera: string;
    mood: string;
  }>;
  storyboardImages?: Array<{
    sceneIndex: number;
    images: string[];
  }>;
  imageUrls?: string[];
  imageProvider?: string;
  imageModel?: string;
  imageIsFallback?: boolean;
  imageErrorMessage?: string;
  videoUrl?: string;
  videoProvider?: string;
  videoModel?: string;
  videoIsFallback?: boolean;
  videoErrorMessage?: string;
  renderProvider?: string;
  renderIsFallback?: boolean;
  renderErrorMessage?: string;
  musicUrl?: string;
  finalVideoUrl?: string;
}

export interface WorkflowTask {
  workflowId: string;
  sourceType: "remix" | "showcase" | "direct" | "workflow";
  inputType: "script" | "image";
  currentStep: WorkflowStep;
  status: WorkflowStatus;
  payload: Record<string, any>;
  outputs: WorkflowOutputs;
  createdAt: number;
  updatedAt: number;
}

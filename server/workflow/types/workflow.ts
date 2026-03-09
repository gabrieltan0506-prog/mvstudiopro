export type WorkflowStep =
  | "script"
  | "storyboard"
  | "storyboardImages"
  | "characterLock"
  | "confirmStoryboard"
  | "video"
  | "voice"
  | "music"
  | "render"
  | "done"
  | "error";

export interface StoryboardScene {
  sceneIndex: number;
  scenePrompt: string;
  duration: number;
  camera: string;
  mood: string;
}

export interface StoryboardImages {
  sceneIndex: number;
  images: string[];
  characterLocked?: boolean;
  referenceCharacterUrl?: string;
  backgroundStatus?: string;
}

export interface WorkflowOutputs {
  script?: string;
  storyboard?: StoryboardScene[];
  storyboardImages?: StoryboardImages[];
  storyboardConfirmed?: boolean;
  storyboardConfirmedAt?: number;
  characterLocked?: boolean;
  referenceImages?: string[];
  videoUrl?: string;
  videoProvider?: string;
  videoModel?: string;
  finalVideoUrl?: string;
  dialogueText?: string;
  voicePrompt?: string;
  voiceProvider?: string;
  voiceModel?: string;
  voiceUrl?: string;
  musicPrompt?: string;
  musicMood?: string;
  musicBpm?: number;
  musicDuration?: number;
  musicProvider?: string;
  musicUrl?: string;
}

export interface WorkflowTask {
  workflowId: string;
  sourceType: string;
  inputType: "script";
  payload: {
    prompt: string;
    targetWords?: number;
    targetScenes?: number;
    referenceImages?: string[];
  };
  currentStep: WorkflowStep;
  status: "pending" | "running" | "done" | "failed";
  outputs: WorkflowOutputs;
  updatedAt?: number;
}

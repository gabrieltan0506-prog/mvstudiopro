export type WorkflowStep =
  | "script"
  | "storyboard"
  | "storyboardImages"
  | "characterLock"
  | "backgroundRemove"
  | "confirmStoryboard"
  | "video"
  | "voice"
  | "music"
  | "render"
  | "done"
  | "error";

export interface StoryboardScene {
  sceneIndex: number;
  sceneTitle?: string;
  scenePrompt: string;
  environment?: string;
  character?: string;
  duration: number;
  camera: string;
  mood: string;
  lighting?: string;
  action?: string;
}

export interface StoryboardImages {
  sceneIndex: number;
  images: string[];
  characterLocked?: boolean;
  referenceCharacterUrl?: string;
  characterPngUrl?: string;
  backgroundStatus?: string;
}

export interface WorkflowOutputs {
  script?: string;
  scriptProvider?: string;
  scriptModel?: string;
  scriptIsFallback?: boolean;
  scriptErrorMessage?: string;
  storyboard?: StoryboardScene[];
  storyboardStructuredStatus?: string;
  storyboardImages?: StoryboardImages[];
  storyboardConfirmed?: boolean;
  storyboardConfirmedAt?: number;
  detectedCharacters?: { characterId: string; label?: string; referenceImage?: string }[];
  lockedCharacters?: { characterId: string; referenceImage: string }[];
  lockedCharacterPrompt?: string;
  characterLocked?: boolean;
  referenceImages?: string[];
  referenceCharacterUrl?: string;
  characterPngUrl?: string;
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

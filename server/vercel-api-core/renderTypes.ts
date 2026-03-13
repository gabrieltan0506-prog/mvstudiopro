export type RenderTransition = "cut" | "fade";

export interface SceneVideoInput {
  sceneIndex?: number;
  url: string;
  duration?: string | number;
  stillImageUrl?: string;
  stillDuration?: string | number;
  voiceUrl?: string;
}

export interface RenderWorkflowInput {
  sceneVideos: SceneVideoInput[];
  musicUrl?: string;
  voiceUrl?: string;
  transition?: RenderTransition | string;
  resolution?: string;
}

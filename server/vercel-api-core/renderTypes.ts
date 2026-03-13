export type RenderTransition = "cut" | "fade";

export interface SceneVideoInput {
  sceneIndex?: number;
  url: string;
  duration?: string | number;
}

export interface RenderWorkflowInput {
  sceneVideos: SceneVideoInput[];
  musicUrl?: string;
  voiceUrl?: string;
  transition?: RenderTransition | string;
  resolution?: string;
}

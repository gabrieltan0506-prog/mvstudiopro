export type RouteKind = "script" | "image" | "video" | "music";

export interface RouteInput {
  workflowType?: string;
  inputType?: string;
  userPlan?: string;
  preferredModel?: string;
}

export interface RouteResult {
  provider: string;
  model: string;
  config: Record<string, any>;
}

export function routeModel(kind: RouteKind, input: RouteInput = {}): RouteResult {
  if (kind === "script") {
    return {
      provider: "google",
      model: input.preferredModel || "gemini",
      config: {},
    };
  }

  if (kind === "image") {
    return {
      provider: "vertex",
      model: input.preferredModel || "gemini-3.1-flash-image-preview",
      config: {},
    };
  }

  if (kind === "video") {
    return {
      provider: "vertex",
      model: input.preferredModel || "veo-3.1-generate-001",
      config: {},
    };
  }

  return {
    provider: "suno",
    model: input.preferredModel || "suno",
    config: {},
  };
}

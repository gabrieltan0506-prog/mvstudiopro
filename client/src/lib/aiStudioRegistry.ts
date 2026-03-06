export type EngineFamily = "script" | "image" | "video" | "music";

export type ModelPlan =
  | "free"
  | "education"
  | "business"
  | "director";

export interface ModelRegistryItem {
  id: string;
  label: string;
  family: EngineFamily;
  provider: "google" | "kling" | "music";
  plan: ModelPlan;
  uiGroup: "google" | "kling" | "music";
  createOp: string;
  taskOp?: string;
  defaults?: Record<string, any>;
  notes?: string;
}

export const AI_STUDIO_MODELS: ModelRegistryItem[] = [
  {
    id: "gemini-script",
    label: "Gemini Script",
    family: "script",
    provider: "google",
    plan: "business",
    uiGroup: "google",
    createOp: "geminiScript",
    defaults: { aspectRatio: "16:9" },
    notes: "智能脚本生成 / 分镜草案",
  },

  {
    id: "nano-banana-flash",
    label: "Nano Banana Flash（当前俗称 Nano Banana 2）",
    family: "image",
    provider: "google",
    plan: "business",
    uiGroup: "google",
    createOp: "nanoImage",
    defaults: { tier: "flash", imageSize: "1K", aspectRatio: "16:9" },
    notes: "更贴场景要求，速度快",
  },
  {
    id: "nano-banana-pro",
    label: "Nano Banana Pro",
    family: "image",
    provider: "google",
    plan: "director",
    uiGroup: "google",
    createOp: "nanoImage",
    defaults: { tier: "pro", imageSize: "1K", aspectRatio: "16:9" },
    notes: "更高遵循度与更强画质",
  },

  {
    id: "veo-rapid",
    label: "Veo 3.1 Rapid",
    family: "video",
    provider: "google",
    plan: "business",
    uiGroup: "google",
    createOp: "veoCreate",
    taskOp: "veoTask",
    defaults: { provider: "rapid", durationSeconds: 8, aspectRatio: "16:9", resolution: "720p" },
    notes: "更快，适合快速预览",
  },
  {
    id: "veo-pro",
    label: "Veo 3.1 Pro",
    family: "video",
    provider: "google",
    plan: "director",
    uiGroup: "google",
    createOp: "veoCreate",
    taskOp: "veoTask",
    defaults: { provider: "pro", durationSeconds: 8, aspectRatio: "16:9", resolution: "720p" },
    notes: "更高质量",
  },

  {
    id: "kling-image-2.6",
    label: "Kling 2.6 图像（教育）",
    family: "image",
    provider: "kling",
    plan: "education",
    uiGroup: "kling",
    createOp: "klingImage",
    taskOp: "klingImageTask",
    defaults: { model_name: "kling-v2", resolution: "1k", aspectRatio: "16:9" },
    notes: "教育专案默认图像方案",
  },
  {
    id: "kling-image-3.0",
    label: "Kling 3.0 图像",
    family: "image",
    provider: "kling",
    plan: "business",
    uiGroup: "kling",
    createOp: "klingImage",
    taskOp: "klingImageTask",
    defaults: { model_name: "kling-v2-1", resolution: "1k", aspectRatio: "16:9" },
    notes: "角色场景化主力模型",
  },

  {
    id: "kling-video-2.6",
    label: "Kling 2.6 视频（教育）",
    family: "video",
    provider: "kling",
    plan: "education",
    uiGroup: "kling",
    createOp: "klingCreate",
    taskOp: "klingTask",
    defaults: { mode: "rapid", duration: "10", model_name: "kling-v2-6" },
    notes: "教育专案默认视频方案",
  },
  {
    id: "kling-video-3.0",
    label: "Kling 3.0 视频",
    family: "video",
    provider: "kling",
    plan: "business",
    uiGroup: "kling",
    createOp: "klingCreate",
    taskOp: "klingTask",
    defaults: { mode: "pro", duration: "10", model_name: "kling-v2-6" },
    notes: "后续可切换到更高阶 Kling 视频模型",
  },

  {
    id: "suno",
    label: "Suno",
    family: "music",
    provider: "music",
    plan: "business",
    uiGroup: "music",
    createOp: "aimusicSunoCreate",
    taskOp: "aimusicSunoTask",
    defaults: {},
    notes: "高质量音乐生成",
  },
  {
    id: "udio",
    label: "Udio",
    family: "music",
    provider: "music",
    plan: "business",
    uiGroup: "music",
    createOp: "aimusicUdioCreate",
    taskOp: "aimusicUdioTask",
    defaults: {},
    notes: "更便宜的音乐生成",
  },
];

export function getModelsByFamily(family: EngineFamily) {
  return AI_STUDIO_MODELS.filter((m) => m.family === family);
}

export function getModelsByGroup(group: "google" | "kling" | "music") {
  return AI_STUDIO_MODELS.filter((m) => m.uiGroup === group);
}

export function getModelById(id: string) {
  return AI_STUDIO_MODELS.find((m) => m.id === id) || null;
}

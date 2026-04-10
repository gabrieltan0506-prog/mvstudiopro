type WorkflowStep =
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

type WorkflowStatus = "pending" | "running" | "done" | "failed";

interface WorkflowOutputs {
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
  storyboardImages?: Array<{ sceneIndex: number; images: string[] }>;
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

const store = new Map<string, WorkflowTask>();

export function saveWorkflow(task: WorkflowTask) {
  store.set(task.workflowId, task);
}

export function getWorkflow(workflowId: string) {
  return store.get(workflowId);
}

function updateWorkflow(workflowId: string, patch: Partial<WorkflowTask>) {
  const current = store.get(workflowId);
  if (!current) return undefined;
  const next: WorkflowTask = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
    outputs: {
      ...current.outputs,
      ...(patch.outputs || {}),
    },
  };
  store.set(workflowId, next);
  return next;
}

function routeModel(type: "script" | "image" | "video" | "music") {
  switch (type) {
    case "script":
      return { provider: "google", model: "gemini-3.1" };
    case "image":
      return { provider: "vertex", model: "imagen-4.0-generate-001" };
    case "video":
      return { provider: "vertex", model: "veo-3.1-generate-001" };
    default:
      return { provider: "suno", model: "suno" };
  }
}

function renderStep(task: WorkflowTask) {
  if (!task.outputs.videoUrl) {
    updateWorkflow(task.workflowId, {
      status: "failed",
      currentStep: "error",
      outputs: {
        renderProvider: "workflow-render",
        renderIsFallback: true,
        renderErrorMessage: "videoUrl is required before render",
      },
    });
    throw new Error("videoUrl is required before render");
  }

  updateWorkflow(task.workflowId, {
    currentStep: "render",
    outputs: {
      finalVideoUrl: task.outputs.videoUrl,
      renderProvider: "workflow-render",
      renderIsFallback: false,
      renderErrorMessage: undefined,
    },
  });
}

export async function startWorkflow(task: WorkflowTask) {
  saveWorkflow(task);
  try {
    if (task.inputType === "script") return await runScriptWorkflow(task.workflowId);
    if (task.inputType === "image") return await runImageWorkflow(task.workflowId);
    throw new Error("unknown workflow inputType");
  } catch (error) {
    updateWorkflow(task.workflowId, { status: "failed", currentStep: "error" });
    throw error;
  }
}

async function runScriptWorkflow(workflowId: string) {
  const task = getWorkflow(workflowId);
  if (!task) throw new Error("workflow not found");

  updateWorkflow(workflowId, { status: "running", currentStep: "script" });
  const scriptRoute = routeModel("script");
  const prompt = String(task.payload?.prompt || task.payload?.text || "").trim();
  if (!prompt) throw new Error("missing payload.prompt");

  let scriptText = "";
  let scriptIsFallback = false;
  let scriptErrorMessage: string | undefined;
  try {
    const scriptResp = await callWorkflowModelApi({ op: "scriptGenerate", prompt, model: scriptRoute.model });
    if (!scriptResp.ok || !scriptResp.script) throw new Error(scriptResp.error || "scriptGenerate failed");
    scriptText = String(scriptResp.script);
  } catch (error) {
    scriptIsFallback = true;
    scriptErrorMessage = error instanceof Error ? error.message : String(error);
    scriptText = buildFallbackScript(prompt);
  }

  const storyboard = buildStoryboardFromScript(scriptText, prompt);
  updateWorkflow(workflowId, {
    currentStep: "storyboard",
    outputs: {
      script: scriptText,
      scriptProvider: scriptRoute.provider,
      scriptModel: scriptRoute.model,
      scriptIsFallback,
      scriptErrorMessage,
      storyboard,
    },
  });

  const storyboardImages = await generateStoryboardImages(storyboard);
  const afterStoryboard = getWorkflow(workflowId);
  if (!afterStoryboard) throw new Error("workflow not found");
  updateWorkflow(workflowId, {
    currentStep: "storyboardImages",
    outputs: {
      ...afterStoryboard.outputs,
      storyboardImages,
    },
  });

  const videoRoute = routeModel("video");
  let videoUrl = "";
  let videoIsFallback = true;
  let videoErrorMessage: string | undefined;
  try {
    const videoResp = await callWorkflowModelApi({ op: "klingT2V", prompt: scriptText, model: videoRoute.model });
    if (!videoResp.ok || !videoResp.videoUrl) throw new Error(videoResp.error || "klingT2V failed");
    videoUrl = String(videoResp.videoUrl);
    videoIsFallback = false;
  } catch (error) {
    videoErrorMessage = error instanceof Error ? error.message : String(error);
  }

  updateWorkflow(workflowId, {
    currentStep: "video",
    outputs: {
      videoUrl,
      videoProvider: videoRoute.provider,
      videoModel: videoRoute.model,
      videoIsFallback,
      videoErrorMessage,
    },
  });

  const beforeRender = getWorkflow(workflowId);
  if (!beforeRender) throw new Error("workflow not found");
  renderStep(beforeRender);

  updateWorkflow(workflowId, { status: "done", currentStep: "done" });
  return getWorkflow(workflowId);
}

async function runImageWorkflow(workflowId: string) {
  const task = getWorkflow(workflowId);
  if (!task) throw new Error("workflow not found");
  const prompt = typeof task.payload?.prompt === "string" ? task.payload.prompt.trim() : "";
  const originalImageUrl = typeof task.payload?.imageUrl === "string" ? task.payload.imageUrl.trim() : "";
  if (!prompt && !originalImageUrl) throw new Error("missing payload.prompt and payload.imageUrl");

  updateWorkflow(workflowId, { status: "running", currentStep: "image" });
  const imageRoute = routeModel("image");
  let preparedImageUrl = "";
  let imageUrls: string[] = [];
  let imageIsFallback = false;
  let imageErrorMessage: string | undefined;

  // When a reference image already exists, treat this as true image-to-video.
  // Do not run an extra text-to-image step first and then fallback back to the upload.
  if (originalImageUrl) {
    preparedImageUrl = originalImageUrl;
    imageUrls = [originalImageUrl];
  } else if (prompt) {
    try {
      const imageResp = await callWorkflowModelApi({ op: "bananaGenerate", prompt, numImages: 1, aspectRatio: "auto" });
      if (!imageResp.ok || !Array.isArray(imageResp.imageUrls) || !imageResp.imageUrls[0]) {
        throw new Error(imageResp.error || "bananaGenerate failed");
      }
      imageUrls = imageResp.imageUrls.map((url: any) => String(url));
      preparedImageUrl = imageUrls[0];
    } catch (error) {
      imageErrorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  updateWorkflow(workflowId, {
    outputs: {
      imageUrls,
      imageProvider: imageRoute.provider,
      imageModel: imageRoute.model,
      imageIsFallback,
      imageErrorMessage,
    },
  });

  const videoRoute = routeModel("video");
  let videoUrl = "";
  let videoIsFallback = true;
  let videoErrorMessage: string | undefined;
  try {
    const videoResp = await callWorkflowModelApi({
      op: "klingI2V",
      imageUrl: preparedImageUrl,
      prompt,
      model: videoRoute.model,
    });
    if (!videoResp.ok || !videoResp.videoUrl) throw new Error(videoResp.error || "klingI2V failed");
    videoUrl = String(videoResp.videoUrl);
    videoIsFallback = false;
  } catch (error) {
    videoErrorMessage = error instanceof Error ? error.message : String(error);
  }

  updateWorkflow(workflowId, {
    currentStep: "video",
    outputs: {
      videoUrl,
      videoProvider: videoRoute.provider,
      videoModel: videoRoute.model,
      videoIsFallback,
      videoErrorMessage,
    },
  });

  const beforeRender = getWorkflow(workflowId);
  if (!beforeRender) throw new Error("workflow not found");
  renderStep(beforeRender);
  updateWorkflow(workflowId, { status: "done", currentStep: "done" });
  return getWorkflow(workflowId);
}

function buildStoryboardFromScript(script: string, fallbackPrompt: string) {
  const segments = script.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 6);
  const source = segments.length > 0 ? segments : [fallbackPrompt];
  return source.map((line, idx) => ({
    sceneIndex: idx + 1,
    scenePrompt: line,
    duration: 5,
    camera: idx % 2 === 0 ? "medium" : "wide",
    mood: "cinematic",
  }));
}

function buildFallbackScript(prompt: string): string {
  return [
    `开场：${prompt}，建立世界观与主要冲突。`,
    "中段：角色在高压环境中推进目标，镜头切换强调速度与张力。",
    "结尾：冲突爆发后出现反转，留下可延展的情绪尾音。",
  ].join("\n");
}

async function generateStoryboardImages(storyboard: Array<{ sceneIndex: number; scenePrompt: string }>) {
  const results: Array<{ sceneIndex: number; images: string[] }> = [];
  for (const scene of storyboard) {
    const sceneIndex = Number(scene?.sceneIndex || 0);
    const scenePrompt = String(scene?.scenePrompt || "").trim();
    if (!sceneIndex || !scenePrompt) continue;
    try {
      const imageResp = await callWorkflowModelApi({
        op: "bananaGenerate",
        prompt: scenePrompt,
        numImages: 1,
        aspectRatio: "16:9",
      });
      const images = Array.isArray(imageResp?.imageUrls)
        ? imageResp.imageUrls.map((url: any) => String(url)).filter(Boolean).slice(0, 1)
        : [];
      results.push({ sceneIndex, images });
    } catch {
      results.push({ sceneIndex, images: [] });
    }
  }
  return results;
}

async function callWorkflowModelApi(payload: Record<string, any>) {
  const mod = await import("../../api/jobs.js");
  const handler = mod.default;
  const req: any = { method: "POST", body: payload, query: {}, headers: { "content-type": "application/json" } };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
  };
  await handler(req, res);
  return { statusCode: res.statusCode, ...(res.body || {}) };
}

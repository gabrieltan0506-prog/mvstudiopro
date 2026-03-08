import type { WorkflowTask } from "./types/workflow";
import { saveWorkflow, updateWorkflow, getWorkflow } from "./store/workflowStore";
import { routeModel } from "../router/modelRouter";
import { renderStep } from "./steps/renderStep";

export async function startWorkflow(task: WorkflowTask) {
  saveWorkflow(task);

  try {
    if (task.inputType === "script") {
      return await runScriptWorkflow(task.workflowId);
    }

    if (task.inputType === "image") {
      return await runImageWorkflow(task.workflowId);
    }

    throw new Error("unknown workflow inputType");
  } catch (error) {
    updateWorkflow(task.workflowId, {
      status: "failed",
      currentStep: "error",
    });
    throw error;
  }
}

async function runScriptWorkflow(workflowId: string) {
  const task = getWorkflow(workflowId);
  if (!task) throw new Error("workflow not found");

  updateWorkflow(workflowId, {
    status: "running",
    currentStep: "script",
  });

  const scriptRoute = routeModel("script");
  const prompt = String(task.payload?.prompt || task.payload?.text || "").trim();
  if (!prompt) {
    throw new Error("missing payload.prompt");
  }

  let scriptText = "";
  let scriptIsFallback = false;
  let scriptErrorMessage: string | undefined;
  try {
    const scriptResp = await callWorkflowModelApi({
      op: "scriptGenerate",
      prompt,
      model: scriptRoute.model,
    });
    if (!scriptResp.ok || !scriptResp.script) {
      throw new Error(scriptResp.error || "scriptGenerate failed");
    }
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

  const videoRoute = routeModel("video");
  let videoUrl = `mock://${videoRoute.provider}/${videoRoute.model}`;
  let videoIsFallback = true;
  let videoErrorMessage: string | undefined;
  try {
    const videoResp = await callWorkflowModelApi({
      op: "klingT2V",
      prompt: scriptText,
      model: videoRoute.model,
    });
    if (!videoResp.ok || !videoResp.videoUrl) {
      throw new Error(videoResp.error || "klingT2V failed");
    }
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

  updateWorkflow(workflowId, {
    status: "done",
    currentStep: "done",
  });

  return getWorkflow(workflowId);
}

async function runImageWorkflow(workflowId: string) {
  const task = getWorkflow(workflowId);
  if (!task) throw new Error("workflow not found");

  const prompt = typeof task.payload?.prompt === "string" ? task.payload.prompt.trim() : "";
  const originalImageUrl = typeof task.payload?.imageUrl === "string" ? task.payload.imageUrl.trim() : "";
  if (!prompt && !originalImageUrl) {
    updateWorkflow(workflowId, {
      status: "failed",
      currentStep: "error",
    });
    throw new Error("missing payload.prompt and payload.imageUrl");
  }

  updateWorkflow(workflowId, {
    status: "running",
    currentStep: "image",
  });

  const imageRoute = routeModel("image");
  let preparedImageUrl = "";
  let imageUrls: string[] = [];
  let imageIsFallback = false;
  let imageErrorMessage: string | undefined;

  if (prompt) {
    try {
      const imageResp = await callWorkflowModelApi({
        op: "bananaGenerate",
        prompt,
        numImages: 1,
        aspectRatio: "auto",
      });
      if (!imageResp.ok || !Array.isArray(imageResp.imageUrls) || !imageResp.imageUrls[0]) {
        throw new Error(imageResp.error || "bananaGenerate failed");
      }
      imageUrls = imageResp.imageUrls.map((url: any) => String(url));
      preparedImageUrl = imageUrls[0];
    } catch (error) {
      imageErrorMessage = error instanceof Error ? error.message : String(error);
      if (originalImageUrl) {
        preparedImageUrl = originalImageUrl;
        imageUrls = [originalImageUrl];
        imageIsFallback = true;
      } else {
        updateWorkflow(workflowId, {
          status: "failed",
          currentStep: "error",
          outputs: {
            imageProvider: imageRoute.provider,
            imageModel: imageRoute.model,
            imageIsFallback: true,
            imageErrorMessage,
          },
        });
        throw error;
      }
    }
  } else if (originalImageUrl) {
    preparedImageUrl = originalImageUrl;
    imageUrls = [originalImageUrl];
    imageIsFallback = true;
    imageErrorMessage = "payload.prompt is missing, use payload.imageUrl as fallback";
  }

  if (!preparedImageUrl) {
    updateWorkflow(workflowId, {
      status: "failed",
      currentStep: "error",
    });
    throw new Error("no image available for kling i2v");
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

  updateWorkflow(workflowId, {
    status: "running",
    currentStep: "video",
  });

  const videoRoute = routeModel("video");
  let videoUrl = `mock://${videoRoute.provider}/${videoRoute.model}?imageUrl=${encodeURIComponent(preparedImageUrl)}`;
  let videoIsFallback = true;
  let videoErrorMessage: string | undefined;
  try {
    const videoResp = await callWorkflowModelApi({
      op: "klingI2V",
      imageUrl: preparedImageUrl,
      prompt,
      model: videoRoute.model,
    });
    if (!videoResp.ok || !videoResp.videoUrl) {
      throw new Error(videoResp.error || "klingI2V failed");
    }
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

  updateWorkflow(workflowId, {
    status: "done",
    currentStep: "done",
  });

  return getWorkflow(workflowId);
}

function buildStoryboardFromScript(script: string, fallbackPrompt: string) {
  const segments = script
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);

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

async function callWorkflowModelApi(payload: Record<string, any>) {
  const mod = await import("../../api/workflow-model");
  const handler = mod.default;

  const req: any = {
    method: "POST",
    body: payload,
    query: {},
    headers: { "content-type": "application/json" },
  };

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
  return {
    statusCode: res.statusCode,
    ...(res.body || {}),
  };
}

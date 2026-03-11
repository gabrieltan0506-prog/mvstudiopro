const store = /* @__PURE__ */ new Map();
function saveWorkflow(task) {
  store.set(task.workflowId, task);
}
function getWorkflow(workflowId) {
  return store.get(workflowId);
}
function updateWorkflow(workflowId, patch) {
  const current = store.get(workflowId);
  if (!current) return void 0;
  const next = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
    outputs: {
      ...current.outputs,
      ...patch.outputs || {}
    }
  };
  store.set(workflowId, next);
  return next;
}
function routeModel(type) {
  switch (type) {
    case "script":
      return { provider: "google", model: "gemini-3.1" };
    case "image":
      return { provider: "fal", model: "fal-ai/nano-banana-2" };
    case "video":
      return { provider: "kling", model: "kling-video" };
    default:
      return { provider: "suno", model: "suno" };
  }
}
function renderStep(task) {
  if (!task.outputs.videoUrl) {
    updateWorkflow(task.workflowId, {
      status: "failed",
      currentStep: "error",
      outputs: {
        renderProvider: "workflow-render",
        renderIsFallback: true,
        renderErrorMessage: "videoUrl is required before render"
      }
    });
    throw new Error("videoUrl is required before render");
  }
  updateWorkflow(task.workflowId, {
    currentStep: "render",
    outputs: {
      finalVideoUrl: task.outputs.videoUrl,
      renderProvider: "workflow-render",
      renderIsFallback: false,
      renderErrorMessage: void 0
    }
  });
}
async function startWorkflow(task) {
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
async function runScriptWorkflow(workflowId) {
  const task = getWorkflow(workflowId);
  if (!task) throw new Error("workflow not found");
  updateWorkflow(workflowId, { status: "running", currentStep: "script" });
  const scriptRoute = routeModel("script");
  const prompt = String(task.payload?.prompt || task.payload?.text || "").trim();
  if (!prompt) throw new Error("missing payload.prompt");
  let scriptText = "";
  let scriptIsFallback = false;
  let scriptErrorMessage;
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
      storyboard
    }
  });
  const storyboardImages = await generateStoryboardImages(storyboard);
  const afterStoryboard = getWorkflow(workflowId);
  if (!afterStoryboard) throw new Error("workflow not found");
  updateWorkflow(workflowId, {
    currentStep: "storyboardImages",
    outputs: {
      ...afterStoryboard.outputs,
      storyboardImages
    }
  });
  const videoRoute = routeModel("video");
  let videoUrl = `mock://${videoRoute.provider}/${videoRoute.model}`;
  let videoIsFallback = true;
  let videoErrorMessage;
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
      videoErrorMessage
    }
  });
  const beforeRender = getWorkflow(workflowId);
  if (!beforeRender) throw new Error("workflow not found");
  renderStep(beforeRender);
  updateWorkflow(workflowId, { status: "done", currentStep: "done" });
  return getWorkflow(workflowId);
}
async function runImageWorkflow(workflowId) {
  const task = getWorkflow(workflowId);
  if (!task) throw new Error("workflow not found");
  const prompt = typeof task.payload?.prompt === "string" ? task.payload.prompt.trim() : "";
  const originalImageUrl = typeof task.payload?.imageUrl === "string" ? task.payload.imageUrl.trim() : "";
  if (!prompt && !originalImageUrl) throw new Error("missing payload.prompt and payload.imageUrl");
  updateWorkflow(workflowId, { status: "running", currentStep: "image" });
  const imageRoute = routeModel("image");
  let preparedImageUrl = "";
  let imageUrls = [];
  let imageIsFallback = false;
  let imageErrorMessage;
  if (prompt) {
    try {
      const imageResp = await callWorkflowModelApi({ op: "bananaGenerate", prompt, numImages: 1, aspectRatio: "auto" });
      if (!imageResp.ok || !Array.isArray(imageResp.imageUrls) || !imageResp.imageUrls[0]) {
        throw new Error(imageResp.error || "bananaGenerate failed");
      }
      imageUrls = imageResp.imageUrls.map((url) => String(url));
      preparedImageUrl = imageUrls[0];
    } catch (error) {
      imageErrorMessage = error instanceof Error ? error.message : String(error);
      if (originalImageUrl) {
        preparedImageUrl = originalImageUrl;
        imageUrls = [originalImageUrl];
        imageIsFallback = true;
      } else {
        throw error;
      }
    }
  } else if (originalImageUrl) {
    preparedImageUrl = originalImageUrl;
    imageUrls = [originalImageUrl];
    imageIsFallback = true;
    imageErrorMessage = "payload.prompt is missing, use payload.imageUrl as fallback";
  }
  updateWorkflow(workflowId, {
    outputs: {
      imageUrls,
      imageProvider: imageRoute.provider,
      imageModel: imageRoute.model,
      imageIsFallback,
      imageErrorMessage
    }
  });
  const videoRoute = routeModel("video");
  let videoUrl = `mock://${videoRoute.provider}/${videoRoute.model}?imageUrl=${encodeURIComponent(preparedImageUrl)}`;
  let videoIsFallback = true;
  let videoErrorMessage;
  try {
    const videoResp = await callWorkflowModelApi({
      op: "klingI2V",
      imageUrl: preparedImageUrl,
      prompt,
      model: videoRoute.model
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
      videoErrorMessage
    }
  });
  const beforeRender = getWorkflow(workflowId);
  if (!beforeRender) throw new Error("workflow not found");
  renderStep(beforeRender);
  updateWorkflow(workflowId, { status: "done", currentStep: "done" });
  return getWorkflow(workflowId);
}
function buildStoryboardFromScript(script, fallbackPrompt) {
  const segments = script.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 6);
  const source = segments.length > 0 ? segments : [fallbackPrompt];
  return source.map((line, idx) => ({
    sceneIndex: idx + 1,
    scenePrompt: line,
    duration: 5,
    camera: idx % 2 === 0 ? "medium" : "wide",
    mood: "cinematic"
  }));
}
function buildFallbackScript(prompt) {
  return [
    `\u5F00\u573A\uFF1A${prompt}\uFF0C\u5EFA\u7ACB\u4E16\u754C\u89C2\u4E0E\u4E3B\u8981\u51B2\u7A81\u3002`,
    "\u4E2D\u6BB5\uFF1A\u89D2\u8272\u5728\u9AD8\u538B\u73AF\u5883\u4E2D\u63A8\u8FDB\u76EE\u6807\uFF0C\u955C\u5934\u5207\u6362\u5F3A\u8C03\u901F\u5EA6\u4E0E\u5F20\u529B\u3002",
    "\u7ED3\u5C3E\uFF1A\u51B2\u7A81\u7206\u53D1\u540E\u51FA\u73B0\u53CD\u8F6C\uFF0C\u7559\u4E0B\u53EF\u5EF6\u5C55\u7684\u60C5\u7EEA\u5C3E\u97F3\u3002"
  ].join("\n");
}
async function generateStoryboardImages(storyboard) {
  const results = [];
  for (const scene of storyboard) {
    const sceneIndex = Number(scene?.sceneIndex || 0);
    const scenePrompt = String(scene?.scenePrompt || "").trim();
    if (!sceneIndex || !scenePrompt) continue;
    try {
      const imageResp = await callWorkflowModelApi({
        op: "bananaGenerate",
        prompt: scenePrompt,
        numImages: 2,
        aspectRatio: "16:9"
      });
      const images = Array.isArray(imageResp?.imageUrls) ? imageResp.imageUrls.map((url) => String(url)).filter(Boolean).slice(0, 2) : [];
      results.push({ sceneIndex, images });
    } catch {
      results.push({ sceneIndex, images: [] });
    }
  }
  return results;
}
async function callWorkflowModelApi(payload) {
  const mod = await import("../jobs.js");
  const handler = mod.default;
  const req = { method: "POST", body: payload, query: {}, headers: { "content-type": "application/json" } };
  const res = {
    statusCode: 200,
    body: void 0,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  await handler(req, res);
  return { statusCode: res.statusCode, ...res.body || {} };
}
export {
  getWorkflow,
  saveWorkflow,
  startWorkflow
};

import { routeModel } from "../../router/modelRouter";

function sleep(ms:number){
  return new Promise((r)=>setTimeout(r, ms));
}

function pickBaseUrl(){
  const raw =
    process.env.WORKFLOW_PUBLIC_BASE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_BRANCH_URL ||
    process.env.VERCEL_URL ||
    "";
  const v = String(raw || "").trim();
  if (!v) return "https://www.mvstudiopro.com";
  if (v.startsWith("http://") || v.startsWith("https://")) return v.replace(/\/+$/, "");
  return `https://${v.replace(/\/+$/, "")}`;
}

function pickReferenceImage(task:any){
  const storyboardImages = task?.outputs?.storyboardImages || [];
  const first = storyboardImages?.[0]?.images?.[0];
  return first || task?.payload?.imageUrl || task?.payload?.referenceImage || "";
}

function pickPrompt(task:any){
  return String(
    task?.payload?.prompt ||
    task?.outputs?.script?.prompt ||
    task?.outputs?.scriptText ||
    task?.outputs?.script ||
    ""
  ).trim();
}

export async function videoStep(task:any){
  task.outputs = task.outputs || {};
  const referenceImage = pickReferenceImage(task);
  if (!referenceImage) {
    throw new Error("missing_reference_image");
  }

  const videoRoute = routeModel("video");
  const provider = String(videoRoute?.provider || "pro");
  const model = String(videoRoute?.model || "veo-3.1-generate-001");
  const baseUrl = pickBaseUrl();

  const createResp = await fetch(`${baseUrl}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "video",
      provider,
      model,
      prompt: pickPrompt(task),
      imageUrl: referenceImage,
      duration: 8,
      aspectRatio: "16:9",
      resolution: "720p"
    })
  });

  const createJson:any = await createResp.json().catch(() => ({}));
  if (!createResp.ok) {
    throw new Error(createJson?.error || createJson?.detail || "video_create_failed");
  }

  let taskId = String(
    createJson?.taskId ||
    createJson?.operationName ||
    createJson?.id ||
    ""
  ).trim();

  let videoUrl = String(createJson?.videoUrl || "").trim();

  for (let i = 0; i < 120 && !videoUrl; i++) {
    if (!taskId) break;

    await sleep(5000);

    const statusResp = await fetch(
      `${baseUrl}/api/jobs?type=video&provider=${encodeURIComponent(provider)}&taskId=${encodeURIComponent(taskId)}`
    );

    const statusJson:any = await statusResp.json().catch(() => ({}));
    if (!statusResp.ok) {
      throw new Error(statusJson?.error || statusJson?.detail || "video_status_failed");
    }

    videoUrl = String(
      statusJson?.videoUrl ||
      statusJson?.url ||
      ""
    ).trim();

    const state = String(
      statusJson?.taskStatus ||
      statusJson?.status ||
      statusJson?.state ||
      ""
    ).toLowerCase();

    if (state in {"failed":1,"error":1,"cancelled":1,"canceled":1}) {
      throw new Error(statusJson?.error || state || "video_failed");
    }
  }

  if (!videoUrl) {
    throw new Error("video_timeout");
  }

  task.outputs.videoProvider = provider;
  task.outputs.videoModel = model;
  task.outputs.videoUrl = videoUrl;
  task.currentStep = "video";
  return task;
}

import { routeModel } from "../../router/modelRouter";

function sleep(ms:number){
  return new Promise((r)=>setTimeout(r, ms));
}

function s(v:any){
  if(v==null) return "";
  if(Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

function pickReferenceImages(task:any): string[] {
  const out = task?.outputs || {};
  const imgs = out?.storyboardImages || [];
  const collected:string[] = [];
  for (const scene of imgs) {
    const arr = Array.isArray(scene?.images) ? scene.images : [];
    for (const url of arr) {
      const u = String(url || "").trim();
      if (u) collected.push(u);
      if (collected.length >= 3) return collected;
    }
  }
  const fallback = String(task?.payload?.imageUrl || task?.payload?.referenceImage || "").trim();
  if (fallback) collected.push(fallback);
  return collected.slice(0, 3);
}

function pickPrompt(task:any){
  return String(
    task?.payload?.prompt ||
    task?.outputs?.scriptText ||
    task?.outputs?.script ||
    "Cinematic motion based on the reference images, preserve subject consistency, natural camera movement, high realism."
  ).trim();
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

export async function videoStep(task:any){
  task.outputs = task.outputs || {};

  const videoRoute = routeModel("video");
  const provider = String(videoRoute?.provider || "fal").trim() || "fal";
  const model = String(videoRoute?.model || "fal-ai/veo3.1/reference-to-video").trim() || "fal-ai/veo3.1/reference-to-video";
  const imageUrls = pickReferenceImages(task);
  const prompt = pickPrompt(task);

  if (!imageUrls.length) throw new Error("missing_reference_images");
  if (!process.env.FAL_KEY) throw new Error("missing_env_FAL_KEY");

  const baseUrl = pickBaseUrl();
  const createResp = await fetch(`${baseUrl}/api/workflow-model`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({
      op: "falVeoReferenceVideo",
      provider,
      model,
      prompt,
      image_urls: imageUrls,
      aspect_ratio: "16:9",
      duration: "8s",
      resolution: "720p",
      generate_audio: true,
      safety_tolerance: "4"
    })
  });

  const createJson:any = await createResp.json().catch(()=> ({}));
  if (!createResp.ok) {
    throw new Error(createJson?.error || createJson?.detail || "fal_veo_create_failed");
  }

  let requestId = String(createJson?.request_id || createJson?.requestId || createJson?.id || "").trim();
  let videoUrl = String(
    createJson?.video?.url ||
    createJson?.data?.video?.url ||
    createJson?.result?.video?.url ||
    ""
  ).trim();

  for (let i = 0; i < 90 && !videoUrl; i++) {
    if (!requestId) break;
    await sleep(4000);

    const st = await fetch(`${baseUrl}/api/workflow-model?op=falVeoReferenceVideoStatus&requestId=${encodeURIComponent(requestId)}&model=${encodeURIComponent(model)}`);
    const j:any = await st.json().catch(()=> ({}));
    if (!st.ok) throw new Error(j?.error || j?.detail || "fal_veo_status_failed");

    videoUrl = String(
      j?.video?.url ||
      j?.data?.video?.url ||
      j?.result?.video?.url ||
      j?.response?.video?.url ||
      ""
    ).trim();

    const status = String(j?.status || j?.state || "").toUpperCase();
    if (status in { "FAILED":1, "ERROR":1, "CANCELLED":1, "CANCELED":1 }) {
      throw new Error(j?.error || status || "fal_veo_failed");
    }
  }

  if (!videoUrl) throw new Error("fal_veo_timeout");

  task.outputs.videoProvider = provider;
  task.outputs.videoModel = model;
  task.outputs.videoUrl = videoUrl;
  task.outputs.finalVideoUrl = videoUrl;
  return task;
}

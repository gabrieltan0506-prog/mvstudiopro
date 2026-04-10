import { routeModel } from "../../router/modelRouter";
import { generateVideoWithVeo } from "../../models/veo";

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

export async function videoStep(task:any){
  task.outputs = task.outputs || {};

  const videoRoute = routeModel("video");
  const provider = String(videoRoute?.provider || "vertex").trim() || "vertex";
  const model = String(videoRoute?.model || "veo-3.1-generate-001").trim() || "veo-3.1-generate-001";
  const imageUrls = pickReferenceImages(task);
  const prompt = pickPrompt(task);

  if (!imageUrls.length) throw new Error("missing_reference_images");
  const generated = await generateVideoWithVeo({
    scenePrompt: prompt,
    referenceImages: imageUrls,
    imageUrls,
  });
  if (!generated.videoUrl) throw new Error(generated.errorMessage || "vertex_veo_failed");

  task.outputs.videoProvider = provider;
  task.outputs.videoModel = model;
  task.outputs.videoUrl = generated.videoUrl;
  task.outputs.finalVideoUrl = generated.videoUrl;
  return task;
}

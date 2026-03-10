import { getWorkflow, updateWorkflow } from "./store/workflowStore";
import { bananaGenerate } from "../models/banana";
import { videoStep } from "./steps/videoStep";

async function generateStoryboardImages(storyboard:any[]) {
  const results:any[] = [];

  for (const scene of storyboard || []) {
    try {
      const r = await bananaGenerate({
        prompt: scene.scenePrompt || scene.prompt || "",
        width: 1536,
        height: 864,
        num_images: 2
      });

      const imgs = Array.isArray(r?.imageUrls) ? r.imageUrls : [];
      results.push({
        sceneIndex: scene.sceneIndex,
        images: imgs
      });
    } catch (e:any) {
      results.push({
        sceneIndex: scene.sceneIndex,
        images: [],
        error: e?.message || "banana_error"
      });
    }
  }

  return results;
}

export async function continueWorkflow(workflowId:string){
  const wf = getWorkflow(workflowId);
  if(!wf) throw new Error("workflow_not_found");

  const latestOutputs = wf.outputs || {};
  const storyboard = Array.isArray(latestOutputs.storyboard) ? latestOutputs.storyboard : [];

  updateWorkflow(workflowId, {
    currentStep: "storyboardImages"
  });

  const storyboardImages =
    Array.isArray(latestOutputs.storyboardImages) && latestOutputs.storyboardImages.length
      ? latestOutputs.storyboardImages
      : await generateStoryboardImages(storyboard);

  updateWorkflow(workflowId, {
    outputs: {
      ...getWorkflow(workflowId)?.outputs,
      storyboardImages
    }
  });

  updateWorkflow(workflowId, {
    currentStep: "video"
  });

  const current = getWorkflow(workflowId);
  if(!current) throw new Error("workflow_not_found_after_storyboard_images");

  const stepped = await videoStep({
    ...current,
    outputs: {
      ...(current.outputs || {}),
      storyboardImages
    }
  });

  updateWorkflow(workflowId, {
    outputs: {
      ...getWorkflow(workflowId)?.outputs,
      ...(stepped.outputs || {})
    },
    currentStep: "done",
    status: "done"
  });

  return getWorkflow(workflowId);
}

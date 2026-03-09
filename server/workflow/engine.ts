import type { WorkflowTask } from "./types/workflow";
import { saveWorkflow, getWorkflow, updateWorkflow } from "./store/workflowStore.js";
import { scriptStep } from "./steps/scriptStep.js";
import { storyboardStep } from "./steps/storyboardStep.js";
import { storyboardImagesStep } from "./steps/storyboardImagesStep.js";
import { characterLockStep } from "./steps/characterLockStep.js";
import { backgroundRemoveStep } from "./steps/backgroundRemoveStep.js";
import { videoStep } from "./steps/videoStep.js";
import { voiceStep } from "./steps/voiceStep.js";
import { musicStep } from "./steps/musicStep.js";
import { renderStep } from "./steps/renderStep.js";

export async function startWorkflow(task: WorkflowTask) {
  saveWorkflow(task);

  try {
    updateWorkflow(task.workflowId, {
      status: "running",
      currentStep: "script",
    });

    const script = await scriptStep(task);
    updateWorkflow(task.workflowId, {
      currentStep: "script",
      outputs: { script },
    });

    updateWorkflow(task.workflowId, {
      currentStep: "storyboard",
    });
    const storyboard = await storyboardStep({
      script,
      targetScenes: task.payload?.targetScenes,
    });
    updateWorkflow(task.workflowId, {
      outputs: { storyboard },
    });

    updateWorkflow(task.workflowId, {
      currentStep: "storyboardImages",
    });
    const storyboardImages = await storyboardImagesStep(storyboard);
    updateWorkflow(task.workflowId, {
      outputs: { storyboardImages },
    });

    updateWorkflow(task.workflowId, {
      currentStep: "characterLock",
    });
    const firstSceneImages = storyboardImages[0]?.images || [];
    const sceneImageUrl = firstSceneImages[0] || "";
    const lockedCharacter = sceneImageUrl
      ? await characterLockStep({ sceneImageUrl })
      : { referenceCharacterUrl: "" };

    const referenceImagesBase =
      Array.isArray(task.payload?.referenceImages) && task.payload.referenceImages.length
        ? task.payload.referenceImages
        : firstSceneImages;
    const referenceImages = lockedCharacter.referenceCharacterUrl
      ? [lockedCharacter.referenceCharacterUrl, ...referenceImagesBase].filter(Boolean)
      : referenceImagesBase;

    updateWorkflow(task.workflowId, {
      outputs: {
        characterLocked: referenceImages.length > 0,
        referenceImages,
        referenceCharacterUrl: lockedCharacter.referenceCharacterUrl || undefined,
      },
    });

    updateWorkflow(task.workflowId, {
      currentStep: "backgroundRemove",
    });
    const removed = lockedCharacter.referenceCharacterUrl
      ? await backgroundRemoveStep({ imageUrl: lockedCharacter.referenceCharacterUrl })
      : { characterPngUrl: "" };
    updateWorkflow(task.workflowId, {
      outputs: {
        characterPngUrl: removed.characterPngUrl || undefined,
      },
    });

    updateWorkflow(task.workflowId, {
      currentStep: "confirmStoryboard",
      outputs: { storyboardConfirmed: true },
    });

    updateWorkflow(task.workflowId, {
      currentStep: "video",
    });
    const videoUrl = await videoStep({
      storyboard,
      storyboardImages,
      referenceImages,
      referenceCharacterUrl: lockedCharacter.referenceCharacterUrl || undefined,
    });
    updateWorkflow(task.workflowId, {
      outputs: { videoUrl },
    });

    updateWorkflow(task.workflowId, {
      currentStep: "voice",
    });
    const dialogueText = script;
    const voicePrompt = "中文自然播报，电影预告片旁白风格";
    const voiceUrl = await voiceStep({
      dialogueText,
      voicePrompt,
    });
    updateWorkflow(task.workflowId, {
      outputs: { voiceUrl },
    });

    updateWorkflow(task.workflowId, {
      currentStep: "music",
    });
    const musicUrl = await musicStep({ script });
    updateWorkflow(task.workflowId, {
      outputs: { musicUrl },
    });

    updateWorkflow(task.workflowId, {
      currentStep: "render",
    });
    const latest = getWorkflow(task.workflowId);
    if (!latest) throw new Error("workflow not found");
    const finalVideoUrl = await renderStep(latest);
    updateWorkflow(task.workflowId, {
      outputs: { finalVideoUrl },
      currentStep: "done",
      status: "done",
    });

    return getWorkflow(task.workflowId);
  } catch (error) {
    updateWorkflow(task.workflowId, {
      status: "failed",
      currentStep: "error",
    });
    throw error;
  }
}

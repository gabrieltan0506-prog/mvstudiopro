import { applyAdvisorPrevisCandidate, type AdvisorPrevisCandidate } from "@shared/manhuaAdvisorPrevisEdit";
import { manhuaPrevisSpecSchema } from "@shared/manhuaPrevis";
import { buildManhuaPrevisAudio } from "@shared/manhuaPrevisAudio";
import type { CanvasBlock } from "./canvasTypes";

/** 与实际提交使用同一配置及音轨契约；预检不建请求、不保存、不调用模型。 */
export function checkManhuaAdvisorPrevisLaunch(block: CanvasBlock | undefined, candidate?: AdvisorPrevisCandidate): string {
  try {
    if (!block?.previsStudio || block.archivedFromPreviousScript) throw new Error("请先打开当前片段的动作白模。");
    if (block.previsStudio.pending || block.status === "running" || block.videoTaskStatus === "queued") throw new Error("本段正在制作，请等待原任务结束。");
    const studio = block.previsStudio;
    const spec = candidate ? applyAdvisorPrevisCandidate(block.id, studio, candidate).spec : manhuaPrevisSpecSchema.parse(studio.spec);
    if (studio.audioEnabled === true) buildManhuaPrevisAudio(block.audioStudio, spec, studio.audioStartSec ?? 0, studio.loopBgm ?? false);
    return "";
  } catch (error) { return error instanceof Error ? error.message : "当前配置无法生成，请检查本段设置。"; }
}

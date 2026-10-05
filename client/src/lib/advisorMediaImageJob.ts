import { buildCanvasGptImage2JobInput } from "@shared/canvasGptImage2JobInput";
import { resolveOpenAiImageLaneForBlockId } from "@shared/openaiImageLane";
import { advisorImageEditPrompt, type AdvisorMediaPlan } from "@shared/manhuaAdvisorMediaEdit";
import { createJobSameOrigin, pollJobUntilTerminal } from "./jobs";
export async function resolveAdvisorMediaReferenceUrl(url: string): Promise<string> {
    if (!url.startsWith("/api/canvas-media/")) return url;
    // Stable private URLs require the current user's existing media authorization.
    // Never send a browser-local URL or an authenticated endpoint to a provider.
    const response = await fetch(`${url}?format=json`, { credentials: "include" });
    const value = await response.json().catch(() => null) as { url?: string } | null;
    if (!response.ok || !value?.url || !/^https:\/\//i.test(value.url)) throw new Error("参考素材读取失败，尚未提交生成；请检查素材权限");
    return value.url;
  }

/** Resume only polls the saved receipt. An unknown submission is never automatically resubmitted. */
export async function runAdvisorImageEdit(input: {
  plan: AdvisorMediaPlan; userId: string; variant: "flare" | "sunburst";
  previewUrl?: string; jobId?: string; onJob: (id: string) => void;
}): Promise<string> {
  if (input.plan.kind !== "image") throw new Error("不是图片方案");
  if (input.variant === "sunburst" && !input.previewUrl) throw new Error("请先确认Flare预览");
  let jobId = input.jobId;

  if (!jobId) {
    const referenceImageUrls = await Promise.all([input.plan.source.url, ...(input.previewUrl ? [input.previewUrl] : [])].map(resolveAdvisorMediaReferenceUrl)).catch(error => {
      // No job submission has happened: safe to fix access and try again.
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { terminal: true });
    });
    const receipt = await createJobSameOrigin({ type: "image", userId: input.userId, input: buildCanvasGptImage2JobInput({
      prompt: advisorImageEditPrompt(input.plan, input.variant === "sunburst" ? input.previewUrl : undefined),
      aspectRatio: input.plan.source.aspectRatio,
      referenceImageUrls,
      generalImageEdit: true, requireImageVariant: true, imageLane: resolveOpenAiImageLaneForBlockId(input.plan.blockId), openaiImageVariant: input.variant,
    }) });
    jobId = receipt.jobId; input.onJob(jobId);
  }
  const job = await pollJobUntilTerminal(jobId, { intervalMs: 2500, maxWaitMs: 20 * 60 * 1000 });
  if (job.status === "failed") throw Object.assign(new Error(job.error || "图片任务失败"), {
    terminal: !/无法确认|结果未知|对账|unknown/i.test(job.error || ""),
  });
  const url = String(job.output?.imageUrl || job.output?.imageUrls?.[0] || "");
  if (job.status !== "succeeded" || !/^https?:\/\//i.test(url)) throw new Error("尚未取得图片，保留任务编号，请查询原任务");
  return url;
}

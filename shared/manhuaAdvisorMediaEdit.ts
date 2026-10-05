import { z } from "zod";
export const advisorMediaProposalSchema = z.object({
  kind: z.enum(["image", "video"]), blockId: z.string().min(1).max(200),
  instruction: z.string().trim().min(2).max(2000),
}).strict().superRefine((v, ctx) => { if (v.kind === "video" && v.instruction.length > 240) ctx.addIssue({ code: "custom", message: "视频修改要求最多240字，请精简后确认" }); });
export type AdvisorMediaProposal = z.infer<typeof advisorMediaProposalSchema>;
export const advisorMediaSourceSchema = z.object({ blockId:z.string().min(1).max(200),kind:z.enum(["image","video"]),url:z.string().min(1).max(8192),revision:z.string().min(1).max(20000),label:z.string().max(300),aspectRatio:z.enum(["9:16","16:9"]) });
export type AdvisorMediaSource = z.infer<typeof advisorMediaSourceSchema>;
export type AdvisorMediaPlan = AdvisorMediaProposal & { source: AdvisorMediaSource };
export function parseAdvisorMediaProposal(text: string): AdvisorMediaProposal {
  return advisorMediaProposalSchema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
}
export function isAdvisorMediaSourceUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || (/^\/api\/canvas-media\/[A-Za-z0-9_/%.-]+$/.test(url) && !/\.\.|%2e|%2f|%5c/i.test(url));
}
export function prepareAdvisorMediaPlan(value: unknown, sources: AdvisorMediaSource[]): AdvisorMediaPlan {
  const proposal = advisorMediaProposalSchema.parse(value);
  const source = sources.find(s => s.blockId === proposal.blockId && s.kind === proposal.kind);
  if (!source || !isAdvisorMediaSourceUrl(source.url)) throw new Error("请选择当前作品中已有的图片或视频，素材未找到");
  return { ...proposal, source: { ...source } };
}
export function assertAdvisorMediaSource(plan: AdvisorMediaPlan, sources: AdvisorMediaSource[]) {
  const current = sources.find(s => s.blockId === plan.blockId && s.kind === plan.kind);
  if (!current || current.url !== plan.source.url || current.revision !== plan.source.revision) throw new Error("原素材已变化，请重新整理修改方案；未覆盖作品");
}
export function advisorImageEditPrompt(plan: AdvisorMediaPlan, previewUrl?: string) {
  return `${previewUrl ? "第一张是原图，第二张是用户确认的修改预览。按预览落实以下修改，保留原图未要求修改的身份、细节和画幅。" : "按以下要求修改参考图，保留未要求修改的身份、细节和画幅。"}\n${plan.instruction}`;
}

/** Voice adoption must never reinterpret the original as a new candidate on retry. */
export function selectAdvisorVideoCandidate<T extends { url: string; current: boolean }>(original: string, versions: T[]): T {
  const identity = (value: string) => {
    if (value.startsWith("/api/canvas-media/")) return value.split("?")[0];
    try {
      const u = new URL(value);
      if (u.hostname === "storage.googleapis.com" && u.pathname.startsWith("/mv-studio-pro-vertex-video-temp/"))
        return "/api/canvas-media/" + u.pathname.slice("/mv-studio-pro-vertex-video-temp/".length);
    } catch { /* Unknown addresses are compared verbatim. */ }
    return value;
  };
  const candidates = versions.filter(v => !v.current && identity(v.url) !== identity(original));
  if (candidates.length !== 1) throw new Error("没有唯一的新视频候选，请在版本对照中明确选择；未改当前片段。");
  return candidates[0];
}

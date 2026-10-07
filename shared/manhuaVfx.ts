import { z } from "zod";

/** A versioned, bounded effect recipe. Screen trajectories are authored, not inferred tracking. */
export const MANHUA_VFX_KINDS = ["sword_trail", "impact_burst", "particle_aura", "shield", "spirit", "fire_burst", "smoke_plume", "lightning", "shockwave", "speed_lines", "magic_circle", "image_overlay"] as const;
export const MANHUA_VFX_PRESET_LABELS: Record<typeof MANHUA_VFX_KINDS[number], string> = {
  image_overlay: "图片叠加", sword_trail: "剑气拖尾", impact_burst: "命中冲击", particle_aura: "粒子聚散",
  shield: "能量护盾", spirit: "灵体光晕",
  fire_burst: "火焰爆发", smoke_plume: "烟尘", lightning: "电弧", shockwave: "冲击波", speed_lines: "速度线", magic_circle: "法阵",
};
const coordinate = z.number().finite().min(0).max(1);
const time = z.number().finite().min(0).max(30);
const trajectorySchema = z.array(z.object({ timeSec: time, x: coordinate, y: coordinate }).strict())
  .min(2).max(120).superRefine((points, ctx) => {
    points.forEach((point, index) => {
      if (index && point.timeSec <= points[index - 1].timeSec)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "timeSec"], message: "轨迹时间必须依次增加" });
    });
  });
export const manhuaVfxEffectSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  kind: z.enum(MANHUA_VFX_KINDS),
  startSec: time,
  durationSec: z.number().finite().min(1 / 60).max(30),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  imageUri: z.string().trim().min(1).max(2048).regex(/^gs:\/\/[^/]+\/.+/).optional(),
  scale: z.number().finite().min(0.02).max(2),
  intensity: z.number().finite().min(0).max(2),
  anchor: z.object({ space: z.literal("screen"), position: z.tuple([coordinate, coordinate]), trajectory: trajectorySchema.optional() }).strict(),
}).strict();
export const manhuaVfxCompositionSchema = z.object({
  version: z.literal(1),
  seed: z.number().int().min(0).max(2147483647),
  effects: z.array(manhuaVfxEffectSchema).min(1).max(12),
}).strict().superRefine((recipe, ctx) => {
  const ids = new Set<string>();
  recipe.effects.forEach((effect, index) => {
    if (ids.has(effect.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effects", index, "id"], message: "特效编号重复" });
    ids.add(effect.id);
    if ((effect.kind === "image_overlay") !== Boolean(effect.imageUri))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effects", index, "imageUri"], message: "图片叠加须选择已保存的图片，其他特效不接收图片" });
    if (effect.startSec + effect.durationSec > 30 + 1e-9)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effects", index], message: "特效时间超出支持范围" });
  });
});
export const manhuaVfxParamsSchema = z.object({
  videoUri: z.string().trim().min(1).max(2048),
  sourceKey: z.string().min(1).max(4096),
  composition: manhuaVfxCompositionSchema,
}).strict();
export const manhuaVfxJobSchema = z.object({
  action: z.literal("manhua_vfx"), scopeKey: z.string().min(1).max(128),
  requestId: z.string().uuid(), params: manhuaVfxParamsSchema,
}).strict();
export type ManhuaVfxEffect = z.infer<typeof manhuaVfxEffectSchema>;
export type ManhuaVfxComposition = z.infer<typeof manhuaVfxCompositionSchema>;
export type ManhuaVfxParams = z.infer<typeof manhuaVfxParamsSchema>;
export type ManhuaVfxJob = z.infer<typeof manhuaVfxJobSchema>;
export type ManhuaVfxOutput = {
  gcsUri: string; url?: string; durationSec?: number; sourceKey: string;
  composition: ManhuaVfxComposition; requestId: string;
};
export type ManhuaVfxDraft = ManhuaVfxParams & { sourceId: string };
export type ManhuaVfxRequest = ManhuaVfxDraft & {
  requestId: string; createdAt: number; jobId?: string;
  status: "submitting" | "unknown" | "queued" | "running" | "succeeded" | "failed";
  output?: ManhuaVfxOutput; error?: string;
};
export type ManhuaVfxState = {
  version: 1; scopeKey: string; draft?: ManhuaVfxDraft;
  requests: Record<string, ManhuaVfxRequest>; adoptedRequestId?: string;
};
const draftSchema = manhuaVfxParamsSchema.extend({ sourceId: z.string().min(1).max(512) });
const outputSchema = z.object({
  gcsUri: z.string().regex(/^gs:\/\//), url: z.string().optional(), durationSec: z.number().finite().positive().optional(),
  sourceKey: z.string().min(1).max(4096), composition: manhuaVfxCompositionSchema, requestId: z.string().uuid(),
});
export const manhuaVfxStateSchema = z.object({
  version: z.literal(1), scopeKey: z.string().min(1).max(128), draft: draftSchema.optional(),
  requests: z.record(z.string().uuid(), draftSchema.extend({
    requestId: z.string().uuid(), createdAt: z.number().finite().min(0), jobId: z.string().max(80).optional(),
    status: z.enum(["submitting", "unknown", "queued", "running", "succeeded", "failed"]),
    output: outputSchema.optional(), error: z.string().max(2000).optional(),
  })), adoptedRequestId: z.string().uuid().optional(),
}).strict().superRefine((state, ctx) => {
  for (const [id, request] of Object.entries(state.requests)) {
    if (id !== request.requestId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "特效任务身份不一致", path: ["requests", id] });
    if (request.output && (request.output.requestId !== id || request.output.sourceKey !== request.sourceKey))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "特效产物来源不一致", path: ["requests", id, "output"] });
  }
  if (state.adoptedRequestId && !state.requests[state.adoptedRequestId])
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "已采用的特效任务记录缺失", path: ["adoptedRequestId"] });
});

/** A delayed UI save must not erase another receipt or rewrite an immutable submission intent. */
export function mergeManhuaVfxState(previous: ManhuaVfxState | undefined, raw: ManhuaVfxState): ManhuaVfxState {
  const next = manhuaVfxStateSchema.parse(raw);
  if (!previous) return next;
  const before = manhuaVfxStateSchema.parse(previous);
  if (before.scopeKey !== next.scopeKey) throw new Error("特效记录不属于当前作品");
  const requests = { ...before.requests };
  for (const [id, request] of Object.entries(next.requests)) {
    const old = requests[id];
    if (old) {
      const identity = (item: ManhuaVfxRequest) => JSON.stringify([item.requestId, item.sourceId, item.sourceKey, item.videoUri, item.composition, item.createdAt]);
      if (identity(old) !== identity(request) || (old.jobId && request.jobId && old.jobId !== request.jobId) ||
          (old.output && request.output && old.output.gcsUri !== request.output.gcsUri))
        throw new Error("已提交的特效记录不能改写，请保留原请求并另存新方案");
      const terminal = old.status === "succeeded" || (old.status === "failed" && ["submitting", "unknown", "queued", "running"].includes(request.status));
      requests[id] = terminal ? { ...old, ...(request.output ? { output: request.output } : {}) }
        : { ...old, ...request, jobId: request.jobId || old.jobId, output: request.output || old.output };
    } else requests[id] = request;
  }
  return manhuaVfxStateSchema.parse({ ...next, requests });
}

export function validateManhuaVfxSource(recipe: ManhuaVfxComposition, source: { durationSec: number; width: number; height: number; fps: number }) {
  const { durationSec, width, height, fps } = source;
  if (![durationSec, width, height, fps].every(Number.isFinite) || durationSec <= 0 || durationSec > 30 ||
      !Number.isInteger(width) || !Number.isInteger(height) || width % 2 || height % 2 ||
      width < 16 || height < 16 || width > 1920 || height > 1920 || width * height > 1920 * 1080 || fps < 12 || fps > 60 ||
      width * height * Math.ceil(durationSec * fps) > 1920 * 1080 * 900)
    throw new Error("当前特效支持30秒内、长边不超过1920的高清片段，请选择符合规格的原片");
  for (const effect of recipe.effects) {
    if (Math.ceil(effect.startSec * fps - 1e-9) >= Math.ceil((effect.startSec + effect.durationSec) * fps - 1e-9))
      throw new Error("特效时间窗未覆盖任何视频帧，请调整起止时间");
    if (effect.startSec + effect.durationSec > durationSec + 1e-9 || effect.anchor.trajectory?.some(point => point.timeSec > durationSec + 1e-9))
      throw new Error("特效或轨迹超出原片时间，请调整后提交");
  }
}

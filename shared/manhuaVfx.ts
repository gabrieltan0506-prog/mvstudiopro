import { z } from "zod";
import { manhuaVfxRoiSchema, manhuaVfxLiquidSchema, manhuaVfxGhostSchema, manhuaVfxWallSchema, manhuaVfxBulletSchema, manhuaVfxWaveSchema, manhuaVfxBlastSchema } from "./manhuaVfxPixelParameters";

/** A versioned, bounded effect recipe. Screen trajectories are authored, not inferred tracking. */
export const MANHUA_VFX_KINDS = ["sword_trail", "impact_burst", "particle_aura", "shield", "spirit", "fire_burst", "smoke_plume", "lightning", "shockwave", "speed_lines", "magic_circle", "image_overlay", "digital_rain", "liquid_mirror", "motion_ghost", "wall_fracture", "bullet_time", "bullet_wave", "directed_blast"] as const;
export const MANHUA_VFX_PRESET_LABELS: Record<typeof MANHUA_VFX_KINDS[number], string> = {
  bullet_wave: "弹道波纹（原片折射）", directed_blast: "定向爆破",
  liquid_mirror: "液态镜面", motion_ghost: "动作残影（手动区域）", wall_fracture: "幕墙撞击（程序墙体）", bullet_time: "子弹时间（三维环绕）",
  digital_rain: "数字雨", image_overlay: "图片叠加", sword_trail: "剑气拖尾", impact_burst: "命中冲击", particle_aura: "粒子聚散",
  shield: "能量护盾", spirit: "灵体光晕",
  fire_burst: "火焰爆发", smoke_plume: "烟尘", lightning: "电弧", shockwave: "冲击波", speed_lines: "速度线", magic_circle: "法阵",
};
export const MANHUA_VFX_RAIN_DEFAULTS = { columns: 24, speed: 0.28, trail: 12 } as const;
const rainSchema = z.object({ columns: z.number().int().min(8).max(36), speed: z.number().finite().min(0.05).max(1), trail: z.number().int().min(4).max(16),
  glyphSet: z.enum(["hex", "ritual", "custom"]).optional(), characters: z.string().min(1).max(64).regex(/^[^\s\x00-\x1f\x7f]+$/).optional(),
  layout: z.enum(["rain", "wall"]).optional(), direction: z.enum(["down", "up", "left", "right"]).optional(), glyphRate: z.number().finite().min(0).max(20).optional(),
}).strict();
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
  rain: rainSchema.optional(), wave: manhuaVfxWaveSchema.optional(), blast: manhuaVfxBlastSchema.optional(),
  roi: manhuaVfxRoiSchema.optional(), liquid: manhuaVfxLiquidSchema.optional(), ghost: manhuaVfxGhostSchema.optional(), wall: manhuaVfxWallSchema.optional(), bullet: manhuaVfxBulletSchema.optional(),
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
    validateManhuaVfxEffectParameters(effect, message => ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effects", index], message }));
    if ((effect.kind === "image_overlay") !== Boolean(effect.imageUri))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effects", index, "imageUri"], message: "图片叠加须选择已保存的图片，其他特效不接收图片" });
    if (effect.startSec + effect.durationSec > 30 + 1e-9)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effects", index], message: "特效时间超出支持范围" });
  });
  validateManhuaVfxLayerOrder(recipe.effects, message => ctx.addIssue({ code: "custom", message }));
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
/** 按真正的帧秒位判断半开时间窗，避免浮点乘法将边界帧错纳入。 */
export function manhuaVfxFrameSpan(startSec: number, durationSec: number, fps: number) {
  const end = startSec + durationSec;
  let first = Math.ceil(startSec * fps), stop = Math.ceil(end * fps);
  while (first / fps < startSec) first++;
  while (first > 0 && (first - 1) / fps >= startSec) first--;
  while (stop / fps < end) stop++;
  while (stop > first && (stop - 1) / fps >= end) stop--;
  return { first, stop };
}
export const isManhuaVfxPixelKind = (kind: string) => ["liquid_mirror", "motion_ghost", "bullet_wave"].includes(kind);
export function validateManhuaVfxLayerOrder(effects: ManhuaVfxEffect[], bad: (message: string) => void) {
  if (effects.filter(effect => effect.kind === "bullet_time").length > 1) bad("每次方案只渲染一个三维环绕时窗，请分段保存候选");
  const pixels = isManhuaVfxPixelKind;
  effects.forEach((effect, index) => effects.slice(0, index).forEach(previous => {
    const overlap = Math.max(effect.startSec, previous.startSec) < Math.min(effect.startSec + effect.durationSec, previous.startSec + previous.durationSec);
    if (!overlap) return;
    if (effect.kind === "bullet_time" || previous.kind === "bullet_time") bad("三维环绕时窗须与其他效果分开，避免二维与三维画面冲突");
    else if (pixels(effect.kind) && !pixels(previous.kind)) bad("重叠时窗的原片变形与残影须排在叠加层前面");
  }));
}
/** 工作流与顾问共享同一字段适用性门禁，拒绝静默忽略。 */
export function validateManhuaVfxEffectParameters(effect: ManhuaVfxEffect, bad: (message: string) => void) {
  if (effect.rain?.glyphSet === "custom" && !effect.rain.characters) bad("自定义字符层须填写实际字符");
  const contract = { wave: ["bullet_wave"], blast: ["directed_blast"], rain: ["digital_rain"], roi: ["liquid_mirror", "motion_ghost"], liquid: ["liquid_mirror"], ghost: ["motion_ghost"], wall: ["wall_fracture"], bullet: ["bullet_time"] };
  for (const [field, kinds] of Object.entries(contract)) {
    const present = effect[field as keyof typeof contract] !== undefined;
    if (present && !kinds.includes(effect.kind)) bad("本图层不接受" + field + "参数");
    if (!present && kinds.includes(effect.kind) && field !== "rain") bad("本图层缺少" + field + "参数");
  }
  if (effect.blast && effect.blast.ignitionSec >= effect.durationSec) bad("起爆秒位须位于图层时间窗内");
  if (effect.wall && effect.wall.impactSec >= effect.durationSec) bad("撞击秒位须位于图层时间窗内");
  if (effect.kind === "bullet_time" && (effect.scale !== 1 || effect.intensity !== 1 || effect.anchor.position[0] !== .5 || effect.anchor.position[1] !== .5 || effect.anchor.trajectory))
    bad("三维环绕使用完整画幅，不接受局部位置、轨迹或透明缩放");
}
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
    if (effect.blast && manhuaVfxFrameSpan(effect.startSec + effect.blast.ignitionSec, effect.durationSec - effect.blast.ignitionSec, fps).first >= manhuaVfxFrameSpan(effect.startSec, effect.durationSec, fps).stop) throw new Error("起爆后没有可见视频帧，请提前起爆或延长时窗");
    if (effect.bullet) {
      const { first, stop } = manhuaVfxFrameSpan(effect.startSec, effect.durationSec, fps);
      const frames = stop - first;
      if (frames < Math.max(3, Math.ceil(Math.abs(effect.bullet.sweepDeg) / 30) + 1)) throw new Error("三维环绕时间窗过短，请延长持续时间，保证相机相邻帧不超过30度");
    }
    if (effect.ghost && Math.ceil((effect.startSec + effect.durationSec) * fps - 1e-9) - Math.ceil(effect.startSec * fps - 1e-9) <= Math.max(1, Math.round(effect.ghost.spacingSec * fps))) throw new Error("残影时间窗不足以取得历史帧，请延长图层持续时间");
    if (Math.ceil(effect.startSec * fps - 1e-9) >= Math.ceil((effect.startSec + effect.durationSec) * fps - 1e-9))
      throw new Error("特效时间窗未覆盖任何视频帧，请调整起止时间");
    if (effect.startSec + effect.durationSec > durationSec + 1e-9 || effect.anchor.trajectory?.some(point => point.timeSec > durationSec + 1e-9))
      throw new Error("特效或轨迹超出原片时间，请调整后提交");
  }
}

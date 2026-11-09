/**
 * MV 镜头参考组装（2026-11-09）：「生成缺失镜头」一律 reference_to_video。
 *
 * 每镜参考 = 全片主锚图 ×1（五镜共用保连续）+ 本镜场景/光线/道具/色调图 2–4
 *          + 动作/运镜参考片 1–2（白模工作台产物优先，否则图库片段）+ 本镜歌曲切片 ×1。
 * 总数 ≤9，各类上限按官方文档：Mini 图 9 / 视频 3 / 音频 3；2.5 为 30 / 10 / 10（同一张组装表照用）。
 * 槽位编号 = 数组顺序（@图片1 恒为主锚图，@视频1 从视频数组 1 起，@音频1 为歌曲切片）；
 * 中文标记走既有 seedance 方言编译层，服务端 formatEvolinkReferencePrompt 出口转 @imageN/@videoN/@audioN。
 * 超限、缺锚、缺场景图与参考片 → 抛中文错误，不裁剪后放行，不静默退回 text_to_video。
 */
import { z } from "zod";

const text = z.string().trim().min(1);
const gcsUri = z.string().regex(/^gs:\/\/[^/]+\/.+/, "参考素材须为本人空间内的对象");

export const MV_SHOT_REFERENCE_TOTAL_MAX = 9;
export const MV_SHOT_REFERENCE_LIMITS = {
  "2.0-mini": { image: 9, video: 3, audio: 3 },
  "2.5": { image: 30, video: 10, audio: 10 },
} as const;
/** 本镜补充图建议区间（主锚图之外）。 */
export const MV_SHOT_SCENE_IMAGE_MIN = 2;
export const MV_SHOT_SCENE_IMAGE_MAX = 4;
export const MV_SHOT_MOTION_VIDEO_MAX = 2;

export const mvShotReferenceImageSchema = z
  .object({
    /** 图库已采用资产编号（sf_…）；上传图没有 assetId。 */
    assetId: z.string().regex(/^sf_[0-9a-f]{48}$/).optional(),
    gcsUri,
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    /** 图注（Pexels 署名或文件名），只用于 UI 显示。 */
    label: z.string().max(300).optional(),
    /** 用户勾选：素材含真人 → 通道直走不挡脸的供应商。 */
    hasRealPerson: z.boolean().optional(),
  })
  .strict();
export type MvShotReferenceImage = z.infer<typeof mvShotReferenceImageSchema>;

export const mvShotReferenceVideoSchema = z
  .object({
    /** previs = 白模工作台产物；stock = 图库片段。 */
    source: z.enum(["previs", "stock"]),
    assetId: z.string().regex(/^sf_[0-9a-f]{48}$/).optional(),
    /** 白模任务编号（source=previs）。 */
    previsRequestId: z.string().uuid().optional(),
    gcsUri,
    /** 取用区间（秒，相对素材自身）；白模整段送出时 inSec=0、outSec=durationSec。 */
    inSec: z.number().min(0),
    outSec: z.number().positive(),
    durationSec: z.number().positive(),
    label: z.string().max(300).optional(),
    hasRealPerson: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.outSec <= v.inSec) ctx.addIssue({ code: "custom", path: ["outSec"], message: "出点必须大于入点" });
    if (v.outSec > v.durationSec + 1e-6) ctx.addIssue({ code: "custom", path: ["outSec"], message: "出点超出素材时长" });
  });
export type MvShotReferenceVideo = z.infer<typeof mvShotReferenceVideoSchema>;

/** 歌曲切片：由服务端 audio_trim 任务按分镜秒位裁出（与对口型唱段同一条链）。 */
export const mvShotSongSliceSchema = z
  .object({
    jobId: text.max(200),
    gcsUri,
    startSec: z.number().min(0),
    endSec: z.number().positive(),
  })
  .strict();
export type MvShotSongSlice = z.infer<typeof mvShotSongSliceSchema>;

export const mvShotReferencesSchema = z
  .object({
    /** @图片1：全片主锚图（五镜共用）。 */
    anchorImage: mvShotReferenceImageSchema.optional(),
    /** @图片2…：本镜场景/光线/道具/色调。 */
    sceneImages: z.array(mvShotReferenceImageSchema).max(8).default([]),
    /** @视频1(–2)：站位/景别/运镜/动作参考。 */
    motionVideos: z.array(mvShotReferenceVideoSchema).max(3).default([]),
    /** @音频1：本镜歌曲切片。 */
    songSlice: mvShotSongSliceSchema.optional(),
  })
  .strict();
export type MvShotReferences = z.infer<typeof mvShotReferencesSchema>;
export type MvShotReferencesInput = z.input<typeof mvShotReferencesSchema>;

export const EMPTY_MV_SHOT_REFERENCES: MvShotReferences = { sceneImages: [], motionVideos: [] };

export type MvShotReferenceCounts = { image: number; video: number; audio: number; total: number };

export function countMvShotReferences(refs: MvShotReferencesInput | undefined): MvShotReferenceCounts {
  const r = mvShotReferencesSchema.parse(refs ?? EMPTY_MV_SHOT_REFERENCES);
  const image = (r.anchorImage ? 1 : 0) + r.sceneImages.length;
  const video = r.motionVideos.length;
  const audio = r.songSlice ? 1 : 0;
  return { image, video, audio, total: image + video + audio };
}

export type MvShotReferenceGap = { code: "anchor" | "scene" | "motion" | "song" | "over_limit"; messageZh: string };

/**
 * 缺项清单（UI 提示用，不抛错）。必填：主锚图、≥1 张场景图或 ≥1 段参考片、歌曲切片。
 * 场景图少于建议下限只提示不阻断（少图仍可出片，但连续性靠主锚图）。
 */
export function mvShotReferenceGaps(
  refs: MvShotReferencesInput | undefined,
  version: keyof typeof MV_SHOT_REFERENCE_LIMITS = "2.0-mini",
): { blocking: MvShotReferenceGap[]; advisory: MvShotReferenceGap[] } {
  const r = mvShotReferencesSchema.parse(refs ?? EMPTY_MV_SHOT_REFERENCES);
  const counts = countMvShotReferences(r);
  const limits = MV_SHOT_REFERENCE_LIMITS[version];
  const blocking: MvShotReferenceGap[] = [];
  const advisory: MvShotReferenceGap[] = [];
  if (!r.anchorImage) blocking.push({ code: "anchor", messageZh: "缺全片主锚图" });
  if (!r.sceneImages.length && !r.motionVideos.length)
    blocking.push({ code: "scene", messageZh: "缺本镜场景图或动作参考片（至少一项）" });
  if (!r.songSlice) blocking.push({ code: "song", messageZh: "缺本镜歌曲切片" });
  if (counts.total > MV_SHOT_REFERENCE_TOTAL_MAX)
    blocking.push({ code: "over_limit", messageZh: `参考共 ${counts.total} 项，超过 ${MV_SHOT_REFERENCE_TOTAL_MAX} 项上限` });
  if (counts.image > limits.image || counts.video > limits.video || counts.audio > limits.audio)
    blocking.push({
      code: "over_limit",
      messageZh: `图 ${counts.image}/${limits.image}、视频 ${counts.video}/${limits.video}、音频 ${counts.audio}/${limits.audio}，超过单类上限`,
    });
  if (r.anchorImage && r.sceneImages.length < MV_SHOT_SCENE_IMAGE_MIN)
    advisory.push({ code: "scene", messageZh: `建议补到 ${MV_SHOT_SCENE_IMAGE_MIN}–${MV_SHOT_SCENE_IMAGE_MAX} 张场景图` });
  if (!r.motionVideos.length) advisory.push({ code: "motion", messageZh: "建议加 1 段动作/运镜参考片" });
  return { blocking, advisory };
}

export type MvShotReferenceAssembly = {
  /** 有序：[主锚图, ...场景图]（gcsUri，出片前再现签成 https）。 */
  imageGcsUris: string[];
  videoGcsUris: string[];
  audioGcsUris: string[];
  /** 与数组同序的视频取用区间（秒）。 */
  videoWindows: Array<{ inSec: number; outSec: number }>;
  counts: MvShotReferenceCounts;
  /** 追加在既有镜头提示词之后的职责声明（@图片/@视频/@音频 按数组顺序编号）。 */
  promptAppendix: string;
  hasRealPerson: boolean;
};

/**
 * 组装出站参考与职责声明。任一阻断缺项 → 抛错（中文，逐条）。
 * 不改既有提示词编译规则，只追加一段固定格式的职责段（0908 白模工艺同语法）。
 */
export function assembleMvShotReferences(
  refs: MvShotReferencesInput | undefined,
  shot: { startSec: number; endSec: number; kind?: "generated" | "singing" | "footage" },
  version: keyof typeof MV_SHOT_REFERENCE_LIMITS = "2.0-mini",
): MvShotReferenceAssembly {
  const r = mvShotReferencesSchema.parse(refs ?? EMPTY_MV_SHOT_REFERENCES);
  const { blocking } = mvShotReferenceGaps(r, version);
  if (blocking.length) throw new Error(`本镜参考素材不完整：${blocking.map(g => g.messageZh).join("；")}`);
  const anchor = r.anchorImage!;
  const imageGcsUris = [anchor.gcsUri, ...r.sceneImages.map(i => i.gcsUri)];
  const videoGcsUris = r.motionVideos.map(v => v.gcsUri);
  const audioGcsUris = r.songSlice ? [r.songSlice.gcsUri] : [];
  const uniq = (list: string[]) => new Set(list).size === list.length;
  if (!uniq(imageGcsUris) || !uniq(videoGcsUris))
    throw new Error("本镜参考素材有重复项，请移除重复后再生成");
  const lines: string[] = [];
  lines.push("@图片1定义全片人物造型、服装与场景基调，所有镜头共用，不继承其构图。");
  if (r.sceneImages.length) {
    const tags = r.sceneImages.map((_, i) => `@图片${i + 2}`).join("、");
    lines.push(`${tags}定义本镜的场景、光线、道具与色调，只取氛围不取人物。`);
  }
  r.motionVideos.forEach((v, i) => {
    const role = v.source === "previs" ? "白模站位片" : "运镜参考片";
    lines.push(
      `@视频${i + 1}是${role}，提供本镜的站位、景别、机位运动与动作节拍，逐段照做；成片不继承其外观、材质与人物。`,
    );
  });
  if (r.songSlice) {
    const s = r.songSlice;
    lines.push(
      shot.kind === "singing"
        ? `@音频1是本镜 ${fmt(s.startSec)}–${fmt(s.endSec)} 秒的歌曲唱段，人物口型、呼吸与表情与其严格同步，保持原曲速度与声音；不改唱词、不另配音、不另生成音乐。`
        : `@音频1是本镜 ${fmt(s.startSec)}–${fmt(s.endSec)} 秒的歌曲切片，画面节奏与剪切点与其卡点严格同步；不另生成音乐。`,
    );
  }
  const hasRealPerson = Boolean(
    anchor.hasRealPerson || r.sceneImages.some(i => i.hasRealPerson) || r.motionVideos.some(v => v.hasRealPerson),
  );
  return {
    imageGcsUris,
    videoGcsUris,
    audioGcsUris,
    videoWindows: r.motionVideos.map(v => ({ inSec: v.inSec, outSec: v.outSec })),
    counts: countMvShotReferences(r),
    promptAppendix: lines.join("\n"),
    hasRealPerson,
  };
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 把主锚图套到一批镜头：只换 anchorImage，其他槽不动。 */
export function applyAnchorImageToAll<T extends Record<string, MvShotReferencesInput | undefined>>(
  byShot: T,
  shotIds: string[],
  anchor: MvShotReferenceImage,
): Record<string, MvShotReferences> {
  const out: Record<string, MvShotReferences> = {};
  for (const id of shotIds) {
    const current = mvShotReferencesSchema.parse(byShot[id] ?? EMPTY_MV_SHOT_REFERENCES);
    out[id] = { ...current, anchorImage: anchor };
  }
  return out;
}

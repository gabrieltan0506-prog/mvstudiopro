/**
 * MV 镜头参考组装（2026-11-09）：「生成缺失镜头」一律 reference_to_video。
 *
 * 每镜参考 = 全片主锚图 ×1（五镜共用保连续）+ 本镜场景/光线/道具/色调图 2–4
 *          + 动作/运镜参考片 1–2（白模工作台产物优先，否则图库片段）+ 本镜歌曲切片 ×1。
 * 总数 ≤9，各类上限按所选成片引擎读 COMPILER_ENGINE_LIMITS（漫剧现成引擎表）。
 * 槽位编号 = 数组顺序（@图片1 恒为主锚图，@视频1 从视频数组 1 起，@音频1 为歌曲切片）；
 * 中文标记走既有 seedance 方言编译层，服务端 formatEvolinkReferencePrompt 出口转 @imageN/@videoN/@audioN。
 * 超限、缺锚、缺场景图与参考片 → 抛中文错误，不裁剪后放行，不静默退回 text_to_video。
 */
import { z } from "zod";
import { COMPILER_ENGINE_LIMITS, normalizeCompilerEngineId, type CompilerEngineId, type CompilerReferenceLimits } from "./manhuaShotIR";

const text = z.string().trim().min(1);
const gcsUri = z.string().regex(/^gs:\/\/[^/]+\/.+/, "参考素材须为本人空间内的对象");

export const MV_SHOT_REFERENCE_TOTAL_MAX = 9;
/**
 * 1109 模型可选：单类上限不再写死 Mini/2.5 两档，按所选成片引擎读漫剧现成引擎表
 * COMPILER_ENGINE_LIMITS（Seedance 2.0 系 9/3/3、2.5 为 30/10/10、H3 9/3/3、Wan 3.0 10/5/5）；
 * 总数仍按用户拍板 ≤9。旧调用的 "2.0-mini" / "2.5" 写法兼容。
 */
export type MvShotEngineKey = CompilerEngineId | "2.0-mini" | "2.0" | "2.0-fast" | "2.5" | string;
export function mvShotEngineId(engine: MvShotEngineKey | undefined): CompilerEngineId {
  const key = String(engine || "seedance-2.0-mini").trim();
  const id = normalizeCompilerEngineId(/^2\.(0|5)/.test(key) ? `seedance-${key}` : key);
  if (!id) throw new Error("所选成片模型暂不支持 MV 镜头");
  return id;
}
export function mvShotReferenceLimits(engine: MvShotEngineKey | undefined) {
  const refs = COMPILER_ENGINE_LIMITS[mvShotEngineId(engine)].references as CompilerReferenceLimits;
  // 单条参考视频上限：引擎表有就用，没有按供应商实测口径 15 秒（1109 探针：EvoLink「maximum is 15.2 seconds」）
  return { image: refs.image, video: refs.video, audio: refs.audio, maxVideoItemSec: refs.maxVideoItemSec ?? MV_REFERENCE_VIDEO_MAX_SEC, ...(refs.maxVideoTotalSec !== undefined ? { maxVideoTotalSec: refs.maxVideoTotalSec } : {}) } as { image: number; video: number; audio: number; maxVideoItemSec: number; maxVideoTotalSec?: number };
}
/** 参考视频整条送出（取用区间只写进提示词），所以素材本身时长必须在上限内。 */
export const MV_REFERENCE_VIDEO_MAX_SEC = 15;
/** MV 镜头可用引擎：须能同时收主锚图+场景图（≥2 图）与歌曲切片（≥1 音频）。HappyHorse 仅首帧一图，不入选。 */
export function isMvShotEngineSupported(engine: MvShotEngineKey | undefined): boolean {
  try {
    const l = mvShotReferenceLimits(engine);
    return l.image >= 2 && l.audio >= 1;
  } catch {
    return false;
  }
}
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
    /** 1109 自动裁切：gcsUri 已是裁好的派生片，记录原素材与源内入出点（可在 UI 改入点重裁）。 */
    trimmedFrom: z.object({ gcsUri, inSec: z.number().min(0), outSec: z.number().positive(), sourceSec: z.number().positive(), auto: z.boolean() }).strict().optional(),
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
  version: MvShotEngineKey = "2.0-mini",
  /** 1109：镜头复杂度达阈值（多人/强动作/接触/多机位/多场景）时站位参考（@视频）必填。 */
  opts: { requiresStaging?: boolean } = {},
): { blocking: MvShotReferenceGap[]; advisory: MvShotReferenceGap[] } {
  const r = mvShotReferencesSchema.parse(refs ?? EMPTY_MV_SHOT_REFERENCES);
  const counts = countMvShotReferences(r);
  if (!isMvShotEngineSupported(version))
    return { blocking: [{ code: "over_limit", messageZh: "所选成片模型不支持 MV 多参考生视频，请换模型" }], advisory: [] };
  const limits = mvShotReferenceLimits(version);
  const blocking: MvShotReferenceGap[] = [];
  const advisory: MvShotReferenceGap[] = [];
  if (!r.anchorImage) blocking.push({ code: "anchor", messageZh: "缺全片主锚图" });
  if (!r.sceneImages.length && !r.motionVideos.length)
    blocking.push({ code: "scene", messageZh: "缺本镜场景图或动作参考片（至少一项）" });
  if (!r.songSlice) blocking.push({ code: "song", messageZh: "缺本镜歌曲切片" });
  const tooLong = r.motionVideos.filter(v => v.durationSec > limits.maxVideoItemSec + 1e-6);
  if (tooLong.length)
    blocking.push({ code: "over_limit", messageZh: `${tooLong.map(v => `${v.label || "参考片"} ${v.durationSec.toFixed(1)} 秒`).join("、")} 超过所选模型单条 ${limits.maxVideoItemSec} 秒上限且尚未自动裁切，请重试裁切` });
  const tooShort = r.motionVideos.filter(v => v.durationSec + 1e-6 < MV_REFERENCE_VIDEO_MIN_SEC);
  if (tooShort.length) blocking.push({ code: "motion", messageZh: `参考片短于 ${MV_REFERENCE_VIDEO_MIN_SEC} 秒，无法作站位/运镜参考，请换片` });
  const totalVideoSec = r.motionVideos.reduce((s, v) => s + v.durationSec, 0);
  if (limits.maxVideoTotalSec !== undefined && totalVideoSec > limits.maxVideoTotalSec + 1e-6)
    blocking.push({ code: "over_limit", messageZh: `参考片合计 ${totalVideoSec.toFixed(1)} 秒，超过所选模型合计 ${limits.maxVideoTotalSec} 秒上限` });
  if (opts.requiresStaging && !r.motionVideos.length)
    blocking.push({ code: "motion", messageZh: "该镜需白模站位或实拍运镜参考" });
  if (counts.total > MV_SHOT_REFERENCE_TOTAL_MAX)
    blocking.push({ code: "over_limit", messageZh: `参考共 ${counts.total} 项，超过 ${MV_SHOT_REFERENCE_TOTAL_MAX} 项上限` });
  if (counts.image > limits.image || counts.video > limits.video || counts.audio > limits.audio)
    blocking.push({
      code: "over_limit",
      messageZh: `图 ${counts.image}/${limits.image}、视频 ${counts.video}/${limits.video}、音频 ${counts.audio}/${limits.audio}，超过单类上限`,
    });
  if (r.anchorImage && r.sceneImages.length < MV_SHOT_SCENE_IMAGE_MIN)
    advisory.push({ code: "scene", messageZh: `建议补到 ${MV_SHOT_SCENE_IMAGE_MIN}–${MV_SHOT_SCENE_IMAGE_MAX} 张场景图` });
  if (!r.motionVideos.length && !opts.requiresStaging) advisory.push({ code: "motion", messageZh: "建议加 1 段动作/运镜参考片" });
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
  version: MvShotEngineKey = "2.0-mini",
  opts: { requiresStaging?: boolean } = {},
): MvShotReferenceAssembly {
  const r = mvShotReferencesSchema.parse(refs ?? EMPTY_MV_SHOT_REFERENCES);
  const { blocking } = mvShotReferenceGaps(r, version, opts);
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
  // 声音职责（1109 用户口径）：镜头只出环境音/特效音，成片时作背景层混在原歌曲之下。
  lines.push(shot.kind === "singing" ? MV_SHOT_SINGING_SOUND_RULE_ZH : MV_SHOT_SOUND_RULE_ZH);
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

/**
 * MV 镜头声音规则：保留模型自带音轨，但只允许环境音与特效音；音乐、人声、旋律一律禁止。
 * 成片以原歌曲为主音轨（0 dB），镜头声音作为背景层（默认 −20 dB）混入。
 */
/** 演唱段：自带音轨须按@音频1原唱同步复现，合成前用它与原歌互相关核对口型落位；成片仍只贴原歌整段。 */
export const MV_SHOT_SINGING_SOUND_RULE_ZH =
  "声音按@音频1原唱同步复现本窗唱句与环境声，不改词、不改调、不另配伴奏；成片以原歌曲为准，本镜声音只用于口型落位核验与环境层。";
export const MV_SHOT_SOUND_RULE_ZH =
  "声音只生成本镜画面里的环境音与特效音（如雨声、脚步声、远处城市车流、玻璃轻触声）；禁止生成任何音乐、配乐、人声、歌声、哼唱或旋律。";

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

/**
 * 1109 主锚图 = 生成的角色定妆帧（不再从图库硬找有人物的图）：复用漫剧角色卡/定妆同一条生图链
 * （canvas_gpt_image2，默认 Sunburst，资产线），按创作说明里的主角描述出一张全身定妆帧，作 @图片1 全片共用。
 */
export function mvAnchorKeyframePrompt(creativePrompt: string | undefined, aspectRatio: "9:16" | "16:9" = "9:16"): string {
  const text = String(creativePrompt || "");
  const protagonist = /主角[：:]\s*([^。\n]+)/.exec(text)?.[1]?.trim() || "MV 主角";
  const style = /风格[：:]\s*([^\n]+)/.exec(text)?.[1]?.trim() || "真实感电影画面";
  return [
    `MV character keyframe (${aspectRatio}), a single person, full body standing, facing camera at three-quarter angle, neutral relaxed expression, clear readable face.`,
    `Character (keep exactly, Chinese brief): ${protagonist}.`,
    `Wardrobe and look must be the one used across every shot of the MV; plain uncluttered background in the MV's color mood; soft even key light that shows face, hair and outfit clearly.`,
    `Overall style (Chinese brief): ${style}.`,
    "Photorealistic, natural skin texture, no text, no subtitles, no logo, no watermark, no second person.",
  ].join("\n");
}

/** 参考片自动裁切的最短可用长度（短于此不足以给出站位/运镜节拍）。 */
export const MV_REFERENCE_VIDEO_MIN_SEC = 2;
/**
 * 1109 参考片送出前自动裁切：长度 = min(本镜时长, 所选模型单条上限)；素材本身更短则整条用；短于 2 秒拒用。
 * 入点：用户在 UI 指定的优先，否则取运动最强的一段（motionScores 为每 stepSec 一个帧差均值）。
 */
export function planMvMotionTrim(input: {
  sourceSec: number;
  shotSec: number;
  maxSec: number;
  inSec?: number;
  motionScores?: readonly number[];
  stepSec?: number;
}): { inSec: number; outSec: number; lengthSec: number; auto: boolean } {
  if (!(input.sourceSec >= MV_REFERENCE_VIDEO_MIN_SEC)) throw new Error(`参考片只有 ${input.sourceSec.toFixed(1)} 秒，短于 ${MV_REFERENCE_VIDEO_MIN_SEC} 秒，无法作站位/运镜参考，请换片`);
  const len = Math.max(MV_REFERENCE_VIDEO_MIN_SEC, Math.min(input.shotSec, input.maxSec, input.sourceSec));
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const latest = input.sourceSec - len;
  if (input.inSec !== undefined) {
    const inSec = Math.max(0, Math.min(latest, input.inSec));
    return { inSec: r(inSec), outSec: r(inSec + len), lengthSec: r(len), auto: false };
  }
  const step = input.stepSec ?? 0.2;
  const scores = input.motionScores ?? [];
  let bestIn = 0;
  let best = -1;
  const win = Math.max(1, Math.round(len / step));
  for (let k = 0; k * step <= latest + 1e-9; k++) {
    let sum = 0;
    for (let i = k; i < Math.min(scores.length, k + win); i++) sum += scores[i]!;
    if (sum > best) { best = sum; bestIn = k * step; }
  }
  return { inSec: r(bestIn), outSec: r(bestIn + len), lengthSec: r(len), auto: true };
}

/** 1109 演唱者与叙事主角分开锁：从歌曲生成提示词/创作说明里读演唱声线性别。 */
export function detectPerformerGender(text: string | undefined): "男" | "女" | undefined {
  const t = String(text || "");
  const male = /男声|男歌手|男主唱|male vocal|male singer|baritone|tenor/i.test(t);
  const female = /女声|女歌手|女主唱|female vocal|female singer|soprano|alto/i.test(t);
  return male && !female ? "男" : female && !male ? "女" : undefined;
}

/**
 * 用户是否以本人形象作演唱者：按现有字段判断（创作要求文字与参考图文件名），不写死。
 * 例：「我本人出镜演唱」「歌手是我自己」「演唱者用我的照片」、参考图名「本人.jpg」「我自己-歌手.png」。
 */
export function isPerformerTheUser(target: { creativePrompt?: string; referenceSummaries?: string[] }): boolean {
  const prompt = String(target.creativePrompt || "");
  const self = /(?:我|本人|用户本人|我自己)/;
  if (/(?:我本人|我自己|用户本人|本人)[^。；\n]{0,10}(?:演唱|唱|歌手|出镜|形象|照片)|(?:演唱者|歌手|主唱)[^。；\n]{0,8}(?:是|为|用|就是)[^。；\n]{0,4}(?:我|本人)/.test(prompt)) return true;
  return (target.referenceSummaries || []).some(name => self.test(name) && /(?:歌手|演唱|本人|自拍|我自己)/.test(name));
}

/** 演唱者标签：本人上传形象作歌手时为「男歌手（用户本人）」，否则沿用「男歌手（演唱者，与叙事主角分开）」。 */
export function performerLabelZh(gender: "男" | "女", target: { creativePrompt?: string; referenceSummaries?: string[] }): string {
  return isPerformerTheUser(target) ? `${gender}歌手（用户本人）` : `${gender}歌手（演唱者，与叙事主角分开）`;
}

/** 演唱者定妆帧（演唱镜 @图片1）：与叙事主角分开，性别按声线；同一生图链（Sunburst / 资产线 / 禁字）。 */
export function mvSingerKeyframePrompt(gender: "男" | "女", styleText: string | undefined, aspectRatio: "9:16" | "16:9" = "9:16"): string {
  const who = gender === "男" ? "a male singer in his twenties, clean restrained look" : "a female singer in her twenties, clean restrained look";
  return [
    `MV performer keyframe (${aspectRatio}), ${who}, waist-up, facing camera at three-quarter angle, mouth relaxed and slightly open as if about to sing, clear readable face and lips.`,
    "This is the vocalist who lip-syncs the song; keep this exact face, hairstyle and outfit in every singing shot.",
    `Overall style (Chinese brief): ${String(styleText || "真实感电影画面").slice(0, 300)}.`,
    "Photorealistic, natural skin texture, no microphone covering the mouth, no text, no logo, no watermark, no second person.",
  ].join("\n");
}

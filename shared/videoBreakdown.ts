/**
 * 拉片（视频创作拆解）契约：服务端产出、前端消费的唯一结构。
 * 一支片子 → 全片创作拆解（视觉基因六维 + 反复出现的元素 + 复刻要点）→ 逐段镜头拆解（镜头构造、段落表达、复刻生成提示词）。
 * 所有秒位都是全片绝对秒；段与段首尾相接、覆盖 0..durationSec；镜头秒位落在所属段内。
 * 前台不出现模型名、通道名。
 */
import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const sec = z.number().finite().min(0).max(36_000);

/** 全片视觉基因：固定六维，缺一不可。 */
export const videoBreakdownVisualGenesSchema = z.object({
  mediumAndArtStyle: text(600), // 媒介与美术风格
  color: text(600), // 色彩体系
  lighting: text(600), // 光线体系
  materialTexture: text(600), // 材质与质感
  composition: text(600), // 构图体系
  camera: text(600), // 摄影机体系
}).strict();

export const videoBreakdownShotSchema = z.object({
  startSec: sec,
  endSec: sec,
  framing: text(300), // 画面景别
  camera: text(300), // 摄影机（机位、运动、焦段感）
  blockingAndFocus: text(600), // 调度 · 构图与焦点
}).strict();

/** 复刻生成提示词：按秒锁格式，每个时间窗写清表情/动作/光线/氛围。 */
export const videoBreakdownRecreatePromptSchema = z.object({
  subject: text(600), // 主体一致性
  scene: text(600), // 场景与美术
  timeline: z.array(z.object({ fromSec: sec, toSec: sec, text: text(600) }).strict()).min(1).max(40), // 镜头序列（段内相对秒）
  camera: text(400), // 摄影机与构图
  lightColor: text(400), // 光色与材质
  rhythm: text(400), // 节奏与声音
  constraints: text(600), // 生成约束（必须保留 / 必须避免）
}).strict();

export const videoBreakdownSegmentSchema = z.object({
  index: z.number().int().min(0).max(199),
  startSec: sec,
  endSec: sec,
  title: text(80),
  shots: z.array(videoBreakdownShotSchema).min(1).max(40),
  expression: z.object({
    narrativeIntent: text(600), // 叙事意图
    technique: text(600), // 表现手法
    rhythm: text(600), // 节奏与情绪
    sound: z.string().trim().max(600).optional(), // 声音（有音轨时）
  }).strict(),
  recreatePrompt: videoBreakdownRecreatePromptSchema,
}).strict();

export const videoBreakdownSchema = z.object({
  kind: z.literal("video_breakdown_v1"),
  durationSec: sec,
  summary: text(400),
  overview: z.object({
    visualGenes: videoBreakdownVisualGenesSchema,
    recurringElements: z.array(text(200)).min(1).max(12), // 反复出现的画面元素
    mustKeep: z.array(text(300)).min(1).max(12), // 复刻时要保留的要点
  }).strict(),
  segments: z.array(videoBreakdownSegmentSchema).min(1).max(200),
}).strict();

export type VideoBreakdown = z.infer<typeof videoBreakdownSchema>;
export type VideoBreakdownSegment = z.infer<typeof videoBreakdownSegmentSchema>;

/** 结构之外的硬校验：段覆盖全片、首尾相接、镜头落在段内、提示词时间窗落在段长内。返回中文问题清单，空数组即通过。 */
export function validateVideoBreakdownTiming(value: VideoBreakdown, tolerance = 0.35): string[] {
  const issues: string[] = [];
  const { segments, durationSec } = value;
  if (Math.abs(segments[0].startSec) > tolerance) issues.push("首段未从 0 秒开始");
  if (Math.abs(segments[segments.length - 1].endSec - durationSec) > tolerance) issues.push("末段未覆盖到片尾");
  segments.forEach((segment, i) => {
    if (segment.index !== i) issues.push(`第${i + 1}段编号不连续`);
    if (segment.endSec - segment.startSec < 0.2) issues.push(`第${i + 1}段时长过短`);
    if (i > 0 && Math.abs(segment.startSec - segments[i - 1].endSec) > tolerance) issues.push(`第${i + 1}段与上一段不相接`);
    for (const shot of segment.shots)
      if (shot.endSec <= shot.startSec || shot.startSec < segment.startSec - tolerance || shot.endSec > segment.endSec + tolerance) issues.push(`第${i + 1}段有镜头秒位越界`);
    const length = segment.endSec - segment.startSec;
    for (const window of segment.recreatePrompt.timeline)
      if (window.toSec <= window.fromSec || window.toSec > length + tolerance) issues.push(`第${i + 1}段复刻提示词时间窗越界`);
  });
  return Array.from(new Set(issues));
}

/** 把一段的复刻提示词拼成可直接复制的秒锁文本。 */
export function formatVideoBreakdownRecreatePrompt(segment: VideoBreakdownSegment): string {
  const p = segment.recreatePrompt;
  const stamp = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
  return [
    `【主体一致性】${p.subject}`,
    `【场景与美术】${p.scene}`,
    `【镜头序列】`,
    ...p.timeline.map(w => `${stamp(w.fromSec)}–${stamp(w.toSec)}秒：${w.text}`),
    `【摄影机与构图】${p.camera}`,
    `【光色与材质】${p.lightColor}`,
    `【节奏与声音】${p.rhythm}`,
    `【生成约束】${p.constraints}`,
  ].join("\n");
}

/** 接口契约（tRPC 路由名 videoBreakdown）。 */
export type VideoBreakdownJobStatus = "queued" | "running" | "succeeded" | "failed";
export type VideoBreakdownJobView = {
  jobId: string;
  status: VideoBreakdownJobStatus;
  /** 进行中的阶段：upload_checked | watching | segmenting | cutting | done */
  stage?: string;
  /** 片段可播放地址（签名，短期有效），下标与 segments 对应；裁切失败的段为空串。 */
  clipUrls?: string[];
  /** 原片可播放地址（签名，短期有效）。 */
  sourceUrl?: string;
  result?: VideoBreakdown;
  /** 只给业务提示，不含上游原文、模型名、通道名。 */
  error?: string;
};
/** 上传与时长上限：前后端共用。 */
export const VIDEO_BREAKDOWN_MAX_BYTES = 500 * 1024 * 1024;
export const VIDEO_BREAKDOWN_MAX_SECONDS = 300;
export const VIDEO_BREAKDOWN_ACCEPT = ["video/mp4", "video/quicktime", "video/webm"] as const;

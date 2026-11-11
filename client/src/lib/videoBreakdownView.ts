/**
 * 拉片前端纯函数：本地校验、阶段文案、时间格式、片段回退、复制/导出文本拼装。
 * 不依赖 React 与 tRPC，便于单测；页面与结果组件只从这里取文案和文本。
 */
import {
  VIDEO_BREAKDOWN_ACCEPT,
  VIDEO_BREAKDOWN_BASE_CREDITS,
  VIDEO_BREAKDOWN_BASE_SECONDS,
  VIDEO_BREAKDOWN_STEP_CREDITS,
  VIDEO_BREAKDOWN_STEP_SECONDS,
  videoBreakdownCredits,
  videoBreakdownShotLengthDistribution,
  VIDEO_BREAKDOWN_KEY_MOMENT_LABELS,
  VIDEO_BREAKDOWN_MAX_BYTES,
  VIDEO_BREAKDOWN_MAX_SECONDS,
  formatVideoBreakdownRecreatePrompt,
  type VideoBreakdown,
  type VideoBreakdownJobView,
  type VideoBreakdownSegment,
} from "@shared/videoBreakdown";
import { buildVideoBreakdownBgmPrompt } from "@shared/videoBreakdownBgm";

/** 计价规则一句话（数字取自契约常量，与服务端扣费同源）。 */
export const VIDEO_BREAKDOWN_PRICING_RULE_COPY = `按片长计费：${VIDEO_BREAKDOWN_BASE_SECONDS} 秒以内 ${VIDEO_BREAKDOWN_BASE_CREDITS} 积分，超出部分每 ${VIDEO_BREAKDOWN_STEP_SECONDS} 秒加 ${VIDEO_BREAKDOWN_STEP_CREDITS} 积分（不足 ${VIDEO_BREAKDOWN_STEP_SECONDS} 秒按 ${VIDEO_BREAKDOWN_STEP_SECONDS} 秒计）`;

/** 预估积分：与服务端一致，片长先取一位小数再用契约函数计价；读不出时长返回 null。 */
export function estimateVideoBreakdownCredits(durationSec: number | null | undefined): number | null {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) return null;
  const rounded = Math.round(durationSec * 10) / 10;
  return rounded > 0 ? videoBreakdownCredits(rounded) : null;
}

/** 开始按钮旁的价格文案：读出时长给具体积分，读不出给规则。 */
export function videoBreakdownPriceCopy(durationSec: number | null | undefined): string {
  const credits = estimateVideoBreakdownCredits(durationSec);
  return credits == null ? `${VIDEO_BREAKDOWN_PRICING_RULE_COPY}，以核对后的片长为准` : `本次消耗 ${credits} 积分`;
}

/** 轮询间隔（毫秒）。 */
export const VIDEO_BREAKDOWN_POLL_MS = 3000;

/** 本机只记最近一次 jobId（几十字节），结果以服务端为准。 */
export const VIDEO_BREAKDOWN_LAST_JOB_KEY = "videoBreakdown:lastJobId";

const EXTENSIONS: Record<string, (typeof VIDEO_BREAKDOWN_ACCEPT)[number]> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

/** 浏览器偶尔给空 type（尤其 MOV），按扩展名兜底。返回契约内 MIME，不支持则 null。 */
export function resolveVideoBreakdownContentType(file: { name: string; type: string }): (typeof VIDEO_BREAKDOWN_ACCEPT)[number] | null {
  const type = file.type.toLowerCase();
  if ((VIDEO_BREAKDOWN_ACCEPT as readonly string[]).includes(type)) return type as (typeof VIDEO_BREAKDOWN_ACCEPT)[number];
  if (type && type.startsWith("video/") === false && type !== "application/octet-stream") return null;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return EXTENSIONS[ext] ?? null;
}

/** 本地类型/大小校验；通过返回 null，否则返回给用户看的提示。 */
export function validateVideoBreakdownFile(file: { name: string; type: string; size: number }): string | null {
  if (!resolveVideoBreakdownContentType(file)) return "只支持 MP4、MOV、WebM 格式的视频。";
  if (file.size <= 0) return "这个文件是空的，请重新选择。";
  if (file.size > VIDEO_BREAKDOWN_MAX_BYTES) return `视频不能超过 ${Math.round(VIDEO_BREAKDOWN_MAX_BYTES / 1024 / 1024)} MB，请压缩或裁短后再试。`;
  return null;
}

/** 时长校验；读不到时长（浏览器不支持该编码）时不拦，交给服务端核对。 */
export function validateVideoBreakdownDuration(durationSec: number | null | undefined): string | null {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) return null;
  if (durationSec > VIDEO_BREAKDOWN_MAX_SECONDS + 0.5) return `视频时长不能超过 ${Math.round(VIDEO_BREAKDOWN_MAX_SECONDS / 60)} 分钟（当前约 ${formatDuration(durationSec)}），请裁短后再试。`;
  return null;
}

/** 00:04.2 */
export function formatClock(sec: number): string {
  const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const tenths = Math.round(safe * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

/** 4.2 秒 / 1 分 05 秒 */
export function formatDuration(sec: number): string {
  const safe = Math.max(0, sec);
  if (safe < 60) return `${(Math.round(safe * 10) / 10).toFixed(1)} 秒`;
  const total = Math.round(safe);
  return `${Math.floor(total / 60)} 分 ${String(total % 60).padStart(2, "0")} 秒`;
}

export function formatSegmentRange(segment: Pick<VideoBreakdownSegment, "startSec" | "endSec">): string {
  return `${formatClock(segment.startSec)} – ${formatClock(segment.endSec)}（${formatDuration(segment.endSec - segment.startSec)}）`;
}

export const VIDEO_BREAKDOWN_STAGES = [
  { key: "upload_checked", label: "核对视频" },
  { key: "watching", label: "逐镜观看" },
  { key: "segmenting", label: "分段整理" },
  { key: "cutting", label: "裁切片段" },
] as const;

/** 当前阶段在四步中的下标；排队或未知阶段为 -1，done 为 4。 */
export function videoBreakdownStageIndex(job: Pick<VideoBreakdownJobView, "status" | "stage">): number {
  if (job.status === "succeeded" || job.stage === "done") return VIDEO_BREAKDOWN_STAGES.length;
  if (job.status === "queued") return -1;
  return VIDEO_BREAKDOWN_STAGES.findIndex(s => s.key === job.stage);
}

export function videoBreakdownStageLabel(job: Pick<VideoBreakdownJobView, "status" | "stage">): string {
  if (job.status === "queued") return "排队中，马上开始";
  if (job.status === "failed") return "拉片未完成";
  if (job.status === "succeeded") return "拉片完成";
  const stage = VIDEO_BREAKDOWN_STAGES.find(s => s.key === job.stage);
  return stage ? `${stage.label}中…` : "正在拉片…";
}

export function isVideoBreakdownActive(job: Pick<VideoBreakdownJobView, "status"> | undefined | null): boolean {
  return !!job && (job.status === "queued" || job.status === "running");
}

/** 片段播放来源：有裁好的片段就播片段；为空时回退为在原片里按起止秒播放。 */
export type SegmentPlayback =
  | { mode: "clip"; src: string; startSec: 0; endSec: null }
  | { mode: "source"; src: string; startSec: number; endSec: number }
  | { mode: "none" };

export function segmentPlayback(segment: Pick<VideoBreakdownSegment, "startSec" | "endSec">, clipUrl: string | undefined, sourceUrl: string | undefined): SegmentPlayback {
  if (clipUrl && clipUrl.trim()) return { mode: "clip", src: clipUrl, startSec: 0, endSec: null };
  if (sourceUrl && sourceUrl.trim()) {
    const fragment = `#t=${segment.startSec.toFixed(2)},${segment.endSec.toFixed(2)}`;
    return { mode: "source", src: `${sourceUrl.split("#")[0]}${fragment}`, startSec: segment.startSec, endSec: segment.endSec };
  }
  return { mode: "none" };
}

export const VISUAL_GENE_ROWS: ReadonlyArray<{ key: keyof VideoBreakdown["overview"]["visualGenes"]; label: string }> = [
  { key: "mediumAndArtStyle", label: "媒介与美术风格" },
  { key: "color", label: "色彩体系" },
  { key: "lighting", label: "光线体系" },
  { key: "materialTexture", label: "材质与质感" },
  { key: "composition", label: "构图体系" },
  { key: "camera", label: "摄影机体系" },
];

export function expressionRows(segment: VideoBreakdownSegment): Array<{ label: string; value: string }> {
  const e = segment.expression;
  const rows = [
    { label: "叙事意图", value: e.narrativeIntent },
    { label: "表现手法", value: e.technique },
    { label: "节奏与情绪", value: e.rhythm },
  ];
  if (e.sound && e.sound.trim()) rows.push({ label: "声音", value: e.sound });
  return rows;
}

export function segmentHeading(segment: VideoBreakdownSegment): string {
  return `片段 ${segment.index + 1} · ${segment.title}`;
}

/** 「A → B → C」拆成阶段；没有箭头时返回单项。 */
export function splitArrowStages(text: string): string[] {
  return text.split(/\s*(?:→|->|➜|⟶)\s*/).map(part => part.trim()).filter(Boolean);
}

export type SortedKeyMoment = NonNullable<VideoBreakdown["overview"]["keyMoments"]>[number] & { originalIndex: number; frameUrl: string };

/** 重点时刻按秒位排序；截图地址按原下标对应（排序前取），空串表示只显示文字。 */
export function sortedKeyMoments(result: VideoBreakdown, frameUrls?: readonly string[]): SortedKeyMoment[] {
  return (result.overview.keyMoments || [])
    .map((moment, originalIndex) => ({ ...moment, originalIndex, frameUrl: String(frameUrls?.[originalIndex] || "").trim() }))
    .sort((a, b) => a.atSec - b.atSec || a.originalIndex - b.originalIndex);
}

/** 「复制全部提示词」文本：每段带标题与时间范围，段间空行分隔。 */
export function buildAllRecreatePromptsText(result: VideoBreakdown): string {
  return result.segments
    .map(segment => [`# ${segmentHeading(segment)}（${formatClock(segment.startSec)} – ${formatClock(segment.endSec)}）`, formatVideoBreakdownRecreatePrompt(segment)].join("\n"))
    .join("\n\n");
}

const cell = (value: string) => value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();

/** 「导出 Markdown」：全片拆解 + 逐段卡片，纯文本拼装。 */
export function buildVideoBreakdownMarkdown(result: VideoBreakdown): string {
  const lines: string[] = [];
  lines.push("# 拉片报告", "", `> ${result.summary}`, "", `全片时长：${formatDuration(result.durationSec)} · 共 ${result.segments.length} 段`, "");
  lines.push("## 全片创作拆解", "", "### 视觉基因", "", "| 维度 | 全片特征 |", "| --- | --- |");
  for (const row of VISUAL_GENE_ROWS) lines.push(`| ${row.label} | ${cell(result.overview.visualGenes[row.key])} |`);
  lines.push("", "### 反复出现的画面元素", "", ...result.overview.recurringElements.map(item => `- ${item}`));
  lines.push("", "### 复刻时要保留的要点", "", ...result.overview.mustKeep.map(item => `- ${item}`), "");
  lines.push("### 镜长分布", "", "| 镜长 | 镜头数 |", "| --- | --- |", ...videoBreakdownShotLengthDistribution(result).map(row => `| ${row.label} | ${row.count} |`), "");
  const { craft, sound } = result.overview;
  if (craft) {
    lines.push("### 可复用手法", "", ...craft.reusableTechniques.map(item => `- ${item}`), "");
    lines.push("### 节奏结构", "", craft.rhythmStructure, "", "### 情绪推进", "", craft.emotionArc, "");
    lines.push("### 风格判词", "", craft.styleTags.map(tag => `\`${tag}\``).join(" "), "");
  }
  if (sound) {
    lines.push("### 声音拆解", "", "| 维度 | 分析 |", "| --- | --- |",
      `| 声音节奏 | ${cell(sound.rhythm)} |`, `| 混音 | ${cell(sound.mix)} |`, `| 可复用声音手法 | ${cell(sound.reusableTechniques)} |`, `| 生成声音要素 | ${cell(sound.generationElements)} |`, "");
  }
  const moments = sortedKeyMoments(result);
  if (moments.length) {
    lines.push("### 重点时刻", "", "| 时间 | 类型 | 说明 |", "| --- | --- | --- |", ...moments.map(m => `| ${formatClock(m.atSec)} | ${VIDEO_BREAKDOWN_KEY_MOMENT_LABELS[m.type]} | ${cell(m.note)} |`), "");
  }
  for (const segment of result.segments) {
    lines.push(`## ${segmentHeading(segment)}`, "", `时间：${formatSegmentRange(segment)}`, "", "### 镜头构造", "", "| 时间 | 画面景别 | 摄影机 | 调度 · 构图与焦点 |", "| --- | --- | --- | --- |");
    for (const shot of segment.shots) lines.push(`| ${formatClock(shot.startSec)}–${formatClock(shot.endSec)} | ${cell(shot.framing)} | ${cell(shot.camera)} | ${cell(shot.blockingAndFocus)} |`);
    lines.push("", "### 段落表达", "", "| 维度 | 分析 |", "| --- | --- |");
    for (const row of expressionRows(segment)) lines.push(`| ${row.label} | ${cell(row.value)} |`);
    lines.push("", "### 复刻生成提示词", "", "```text", formatVideoBreakdownRecreatePrompt(segment), "```", "");
  }
  lines.push("## 配乐提示词", "", "```text", buildVideoBreakdownBgmPrompt(result), "```", "");
  return lines.join("\n");
}

/** 只放行看起来是业务提示的中文短句，其余一律用兜底文案（防止上游原文漏到前台）。 */
export function friendlyVideoBreakdownError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 120) return fallback;
  if (!/[一-鿿]/.test(trimmed)) return fallback;
  if (/https?:|gs:\/\/|[{}<>]|\bat\s+\S+\(/.test(trimmed)) return fallback;
  return trimmed;
}

export function readJobIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search.startsWith("?") ? search : `?${search}`).get("job");
  return id && /^[A-Za-z0-9_-]{4,128}$/.test(id) ? id : null;
}

export function markdownFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `拉片报告-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.md`;
}

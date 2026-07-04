import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  type GrowthAnalysisScores,
  growthAnalysisScoresSchema,
  parseGrowthAnalysisScores,
  growthLlmSchema,
  remixLlmSchema,
  growthPremiumContentSchema,
  type GrowthAnalysisProfile,
} from "@shared/growth";
import { transcribeAudio } from "../_core/voiceTranscription";
import { invokeLLM, extractJsonString } from "../_core/llm";
import { deleteGcsObject, downloadGcsObject, isGsUri, uploadBufferToGcs } from "../services/gcs";
import { storageRead } from "../storage";
import {
  resolveGrowthCampExtractorModel,
  resolveGrowthCampExtractScanEngine,
  resolveGrowthCampGpt55Engine,
  resolveGrowthCampPipelineMode,
  resolveGrowthCampStrategistEngine,
  type GrowthCampStrategistEngine,
} from "./extractorPipeline";
import { runGrowthCampStrategistMultimodalPass, ensureGrowthCoreScores } from "./growthCampStrategistPass";

const execFileAsync = promisify(execFile);

const AUDIO_TOKENS_PER_MINUTE = 1920;
const VIDEO_AUDIO_TOKENS_PER_MINUTE_AT_1FPS = 17700;
const TOKENS_PER_FRAME = Math.round((VIDEO_AUDIO_TOKENS_PER_MINUTE_AT_1FPS - AUDIO_TOKENS_PER_MINUTE) / 60);
const EXTRACTOR_SEGMENT_SECONDS = Math.max(300, Number(process.env.GROWTH_CAMP_SEGMENT_SECONDS || 35 * 60) || 35 * 60);
const STRATEGIST_MAX_FRAMES = Math.max(8, Number(process.env.GROWTH_CAMP_STRATEGIST_MAX_FRAMES || 12) || 12);
const GROWTH_ANALYSIS_MAX_CONCURRENCY = Math.max(1, Number(process.env.GROWTH_CAMP_ANALYSIS_CONCURRENCY || 3) || 3);
const SHOULD_CLEAN_GCS_TEMP = !/^(0|false|no)$/i.test(String(process.env.GROWTH_CAMP_KEEP_GCS_TEMP || ""));

let growthAnalysisActive = 0;
const growthAnalysisWaiters: Array<() => void> = [];

type VideoAnalysisResult = {
  analysis: GrowthAnalysisScores;
  videoMeta: {
    videoUrl: string;
    audioUrl: string;
    transcript: string;
    videoDuration: number;
    provider: string;
    model: string;
    fallback: boolean;
    pipeline: string;
    stageOneModel: string;
    stageTwoModel: string;
    sparseFrameCount: number;
    estimatedCostProfile: {
      audioOnlyTokens: number;
      video1fpsTokens: number;
      sparseRouteTokens: number;
      savingsVs1fpsTokens: number;
      savingsVs1fpsPct: number;
    };
    failureStage?: string;
    failureReason?: string;
  };
};

type VideoFailureStage =
  | "decode"
  | "frame_extraction"
  | "transcription"
  | "llm"
  | "unknown";

type SparseFrame = {
  timestamp: number;
  dataUrl: string;
};

/** BGM（背景音乐）识别结果
 *
 *  用户痛点：creator growth camp 只识别口播 / 转写，对原视频 BGM 完全无感。
 *  实际上 BGM 决定了视频的情绪基调（抖音爆款公式：BGM 选对 = 完播率 +30%）。
 *  解决：让 Gemini 在做 audio first pass 时一并听 BGM，输出 4 维元数据。
 */
export type BgmAnalysis = {
  /** 是否检测到 BGM（有可能是纯口播视频，也可能 BGM 与人声音量太接近无法分离） */
  detected: boolean;
  /** BGM 风格（中文，例：电子舞曲、City Pop、轻奢爵士、国风、抒情钢琴、Lo-fi、Hip-hop、Trap） */
  style?: string;
  /** 情绪标签（中文，例：紧迫、温柔、热血、治愈、性感、神秘、轻松） */
  mood?: string;
  /** 主要乐器（数组，例：["合成器", "电子鼓", "贝斯"]） */
  instruments?: string[];
  /** BPM（每分钟拍数，60-180 区间。⚠️ 模型估算，仅供参考） */
  bpm?: number;
  /** 与画面/口播的契合度评估（中文短句，例："BGM 节奏与画面剪辑同步度极高，强化了紧迫感"） */
  matchWithVisual?: string;
  /** 商业可用性 / 版权提醒（例："似为流行 hit 改编，商用需替换为版权安全曲" / "原创 / 免版权风险") */
  copyrightNote?: string;
};

type AudioFirstPass = {
  valueTier: "high" | "medium" | "low";
  contentSummary: string;
  hookSummary: string;
  audiencePromise: string;
  commercialPotential: number;
  creatorSignals: string[];
  priorityMoments: Array<{
    timestamp: string;
    reason: string;
    action: string;
  }>;
  riskMoments: Array<{
    timestamp: string;
    issue: string;
    fix: string;
  }>;
  deepDiveBrief: string;
  transcriptSummary: string;
  /** BGM 识别（新增） */
  bgmAnalysis?: BgmAnalysis;
};

type VisualFirstPass = {
  visualSummary: string;
  openingFrameAssessment: string;
  sceneConsistency: string;
  trustSignals: string[];
  visualRisks: string[];
  keyFrames: Array<{
    timestamp: string;
    whatShows: string;
    commercialUse: string;
    issue: string;
    fix: string;
    /** 情绪张力（新增）：景别+表情+剪辑节奏带来的情绪推力 */
    emotionalTension?: string;
  }>;
};

type StrategistRefinement = Partial<Pick<GrowthAnalysisScores,
  | "explosiveIndex"
  | "platformScores"
  | "realityCheck"
  | "reverseEngineering"
  | "premiumContent"
  | "growthStrategy"
  | "remixExecution"
  | "summary"
  | "strengths"
  | "improvements"
  | "languageExpression"
  | "emotionalExpression"
  | "cameraEmotionTension"
  | "bgmAnalysis"
  | "musicRecommendation"
  | "sunoPrompt"
  | "titleSuggestions"
  | "creatorCenterSignals"
  | "timestampSuggestions"
  | "weakFrameReferences"
  | "commercialAngles"
  | "followUpPrompt"
>>;

// Stage 1（音频/视觉初筛）默认 Gemini 3.5 Flash；提取模式抽帧分析与总结固定 GPT-5.5。
function growthCampFirstPassModel(): string {
  return resolveGrowthCampExtractorModel();
}
type GrowthAnalysisMode = "GROWTH" | "REMIX";

class VideoAnalysisFailure extends Error {
  failureStage: VideoFailureStage;
  failureReason: string;

  constructor(failureStage: VideoFailureStage, failureReason: string) {
    super(failureReason);
    this.name = "VideoAnalysisFailure";
    this.failureStage = failureStage;
    this.failureReason = failureReason;
  }
}

function resolveGrowthCampFinalModel(modelName?: string): string {
  return resolveGrowthCampStrategistEngine(modelName).modelName;
}

function strategistInvokeBase(engine: GrowthCampStrategistEngine) {
  return {
    model: "pro" as const,
    provider: engine.provider,
    modelName: engine.modelName,
  };
}

function parseLlmJsonResponse<T extends Record<string, unknown>>(raw: string): T {
  const content = String(raw || "").trim();
  if (!content) return {} as T;
  return JSON.parse(extractJsonString(content)) as T;
}

/** extract_only：Vertex 走 json_schema；GPT-5.5 可能直接回 Markdown，需兼容。 */
function parseExtractPassResponse(raw: string): { extractedContent: string; summary: string } {
  const content = String(raw || "").trim();
  if (!content) return { extractedContent: "", summary: "" };
  try {
    const parsed = parseLlmJsonResponse<{ extractedContent?: string; summary?: string }>(content);
    const extractedContent = String(parsed.extractedContent || "").trim();
    const summary = String(parsed.summary || "").trim();
    if (extractedContent) {
      return { extractedContent, summary: summary || extractedContent.slice(0, 80) };
    }
    if (summary) {
      return { extractedContent: content, summary };
    }
  } catch {
    /* GPT-5.5 / Evolink 常忽略 json_schema，直接输出 Markdown */
  }
  const firstLine = content
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean) || "内容提取完成";
  return { extractedContent: content, summary: firstLine.slice(0, 80) };
}

function normalizeFailureReason(error: unknown) {
  if (error instanceof Error) {
    return error.message || error.name || "未知错误";
  }
  return String(error || "未知错误");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toTimestamp(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function truncate(value: string, max = 5000) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

async function withGrowthAnalysisSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (growthAnalysisActive >= GROWTH_ANALYSIS_MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => {
      growthAnalysisWaiters.push(resolve);
    });
  }
  growthAnalysisActive += 1;
  try {
    return await fn();
  } finally {
    growthAnalysisActive = Math.max(0, growthAnalysisActive - 1);
    const next = growthAnalysisWaiters.shift();
    if (next) next();
  }
}

function isDeepStrategistModel(modelName: string) {
  return /3\.1/i.test(String(modelName || ""));
}

function estimateTokenProfile(durationSeconds: number, sparseFrameCount: number) {
  const minutes = durationSeconds / 60;
  const audioOnlyTokens = Math.round(minutes * AUDIO_TOKENS_PER_MINUTE);
  const video1fpsTokens = Math.round(minutes * VIDEO_AUDIO_TOKENS_PER_MINUTE_AT_1FPS);
  const sparseRouteTokens = audioOnlyTokens + sparseFrameCount * TOKENS_PER_FRAME;
  const savingsVs1fpsTokens = Math.max(0, video1fpsTokens - sparseRouteTokens);
  const savingsVs1fpsPct = video1fpsTokens > 0
    ? Math.round((savingsVs1fpsTokens / video1fpsTokens) * 100)
    : 0;
  return {
    audioOnlyTokens,
    video1fpsTokens,
    sparseRouteTokens,
    savingsVs1fpsTokens,
    savingsVs1fpsPct,
  };
}

function buildChunkRanges(durationSeconds: number) {
  if (durationSeconds <= EXTRACTOR_SEGMENT_SECONDS) {
    return [{ start: 0, duration: durationSeconds, index: 0 }];
  }
  const chunks: Array<{ start: number; duration: number; index: number }> = [];
  let start = 0;
  let index = 0;
  while (start < durationSeconds) {
    const duration = Math.min(EXTRACTOR_SEGMENT_SECONDS, durationSeconds - start);
    chunks.push({ start, duration, index });
    start += duration;
    index += 1;
  }
  return chunks;
}

function pickStrategistFrames(frames: SparseFrame[]) {
  if (frames.length <= STRATEGIST_MAX_FRAMES) return frames;
  const selected: SparseFrame[] = [];
  const step = (frames.length - 1) / Math.max(1, STRATEGIST_MAX_FRAMES - 1);
  for (let index = 0; index < STRATEGIST_MAX_FRAMES; index += 1) {
    selected.push(frames[Math.round(step * index)]);
  }
  return Array.from(new Map(selected.map((frame) => [frame.timestamp, frame])).values());
}

async function withTempVideo<T>(buffer: Buffer, fn: (videoPath: string) => Promise<T>): Promise<T> {
  const videoPath = path.join(
    os.tmpdir(),
    `growth-camp-video-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`,
  );
  await fs.writeFile(videoPath, buffer);
  try {
    return await fn(videoPath);
  } finally {
    await fs.unlink(videoPath).catch(() => undefined);
  }
}

async function getVideoDurationFromPath(videoPath: string): Promise<number> {
  const probe = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const parsed = Number(String(probe.stdout || "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("无法检测视频时长");
  }
  return parsed;
}

async function extractAudioTrackFromPath(videoPath: string, startSeconds = 0, durationSeconds?: number) {
  const audioPath = videoPath.replace(/\.mp4$/, `.${startSeconds}.mp3`);
  try {
    const probe = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "json",
      videoPath,
    ]).catch(() => ({ stdout: "{\"streams\":[]}" }));
    const probeJson = JSON.parse(String(probe.stdout || "{\"streams\":[]}"));
    const hasAudio = Array.isArray(probeJson.streams) && probeJson.streams.length > 0;
    if (!hasAudio) {
      return null;
    }

    const args = [
      "-y",
      ...(startSeconds > 0 ? ["-ss", String(startSeconds)] : []),
      "-i",
      videoPath,
      ...(durationSeconds && durationSeconds > 0 ? ["-t", String(durationSeconds)] : []),
      "-vn",
      "-acodec",
      "libmp3lame",
      "-ar",
      "16000",
      "-ac",
      "1",
      audioPath,
    ];
    await execFileAsync("ffmpeg", args);

    return await fs.readFile(audioPath);
  } finally {
    await fs.unlink(audioPath).catch(() => undefined);
  }
}

async function transcribeVideoAudio(audioBuffer: Buffer | null): Promise<string> {
  if (!audioBuffer) return "";
  try {
    const transcription = await transcribeAudio({
      audioBase64: audioBuffer.toString("base64"),
      mimeType: "audio/mpeg",
      language: "zh",
      prompt: "请转写视频里的口播、字幕或关键信息，并尽量保留时间线索。",
    });

    if ("text" in transcription && typeof transcription.text === "string") {
      return transcription.text.trim();
    }
  } catch (error) {
    console.warn("[growth.analyzeVideo] transcript fallback:", error);
  }
  return "";
}

/** 抽帧策略
 *
 * - "dense"（旧默认）：intro 4 帧 + middle 4-8 帧 + outro 3 帧；用于"逆向工程"场景，需要密集分析
 * - "slim"（新 GROWTH/REMIX）：≥ 5 分钟 = 8 帧均匀分布；< 5 分钟 = 10 帧均匀分布
 *   原因：长视频抽 8 帧足以代表骨架（每 ~37 秒一帧），降 LLM 推理成本
 *         短视频反而抽 10 帧（密度更高），保证短视频细节抓住
 */
type SparseFrameStrategy = "slim" | "dense";

function buildSparseFrameTimestamps(duration: number, strategy: SparseFrameStrategy = "dense") {
  if (strategy === "slim") {
    // GROWTH / REMIX：均匀分布，避开开头 1s + 结尾 1s
    const targetCount = duration >= 300 ? 8 : 10;
    const start = Math.min(1.0, duration * 0.02);
    const end = Math.max(duration - 1.0, duration * 0.98);
    const span = Math.max(0.1, end - start);
    return Array.from({ length: targetCount }, (_, i) => {
      const ratio = i / (targetCount - 1); // targetCount ∈ {8, 10}，不会为 1
      return Number((start + span * ratio).toFixed(2));
    }).filter((t) => t > 0 && t < duration);
  }

  // dense（逆向工程保留）
  const intro = [1, 4, 8, 12]
    .filter((second) => second < duration - 0.5)
    .map((second) => Number(second.toFixed(2)));

  const outroCandidates = [
    duration - 12,
    duration - 6,
    duration - 1.5,
  ]
    .filter((second) => second > 15)
    .map((second) => Number(clamp(second, 0.2, Math.max(0.2, duration - 0.2)).toFixed(2)));

  const middleCount = duration >= 900 ? 8 : duration >= 480 ? 6 : duration >= 180 ? 5 : 4;
  const middleStart = Math.min(duration * 0.18, Math.max(14, duration * 0.12));
  const middleEnd = Math.max(middleStart + 6, duration - 18);
  const middle = middleCount > 0
    ? Array.from({ length: middleCount }, (_, index) => {
        const ratio = (index + 1) / (middleCount + 1);
        return Number((middleStart + (middleEnd - middleStart) * ratio).toFixed(2));
      })
    : [];

  return Array.from(new Set([...intro, ...middle, ...outroCandidates]))
    .filter((value) => value > 0 && value < duration)
    .sort((a, b) => a - b);
}

async function extractSparseFramesAtTimestamps(videoPath: string, timestampsSeconds: number[]): Promise<SparseFrame[]> {
  const unique = Array.from(new Set(timestampsSeconds.map((t) => Number(t.toFixed(2)))))
    .filter((t) => t >= 0)
    .sort((a, b) => a - b);
  if (!unique.length) return [];

  const frameDir = path.join(
    os.tmpdir(),
    `growth-camp-target-frames-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(frameDir, { recursive: true });
  try {
    const frames: SparseFrame[] = [];
    for (let index = 0; index < unique.length; index += 1) {
      const absoluteTimestamp = unique[index];
      const outPath = path.join(frameDir, `frame-${String(index).padStart(2, "0")}.jpg`);
      await execFileAsync("ffmpeg", [
        "-y",
        "-ss",
        String(absoluteTimestamp),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-vf",
        "scale='min(960,iw)':-2",
        "-q:v",
        "5",
        outPath,
      ]);
      const frameBuffer = await fs.readFile(outPath);
      frames.push({
        timestamp: absoluteTimestamp,
        dataUrl: `data:image/jpeg;base64,${frameBuffer.toString("base64")}`,
      });
    }
    return frames;
  } finally {
    await fs.rm(frameDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function parseTimestampToSeconds(value: string): number | null {
  const trimmed = String(value || "").trim();
  const match = trimmed.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  if (match[3]) {
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 非关键点区域：约每 50 秒抽一帧 */
const EXTRACT_BASELINE_INTERVAL_SEC = 50;
/** 语音 scan 每个关键时刻：前后偏移多次抽帧（秒） */
const EXTRACT_KEY_FRAME_OFFSETS_SEC = [-6, -2, 0, 3] as const;
/** 关键点附近跳过 baseline，避免与 burst 重复 */
const EXTRACT_KEY_NEAR_BASELINE_SEC = 10;
/** 极端安全上限，防止异常 scan 爆量；关键点 burst 优先保留 */
const EXTRACT_ABSOLUTE_MAX_FRAMES = 40;

function buildKeyMomentExtractTimestamps(
  duration: number,
  priorityMoments: Array<{ timestamp?: string }>,
): number[] {
  const keySeconds = priorityMoments
    .map((item) => parseTimestampToSeconds(String(item.timestamp || "")))
    .filter((seconds): seconds is number => seconds != null && seconds >= 0 && seconds < duration);

  const timestamps: number[] = [];
  for (const center of keySeconds) {
    for (const offset of EXTRACT_KEY_FRAME_OFFSETS_SEC) {
      const t = Math.round((center + offset) * 10) / 10;
      if (t >= 0 && t < duration) timestamps.push(t);
    }
  }
  return timestamps;
}

function buildBaselineExtractAnchors(duration: number, keySeconds: number[]): number[] {
  const anchors: number[] = [2, 5].filter((t) => t < duration);
  for (let t = EXTRACT_BASELINE_INTERVAL_SEC; t < duration - 5; t += EXTRACT_BASELINE_INTERVAL_SEC) {
    const tooNearKey = keySeconds.some((k) => Math.abs(k - t) <= EXTRACT_KEY_NEAR_BASELINE_SEC);
    if (!tooNearKey) anchors.push(Math.round(t));
  }
  if (duration > 30) {
    const nearEnd = Math.max(1, duration - 8);
    const tooNearKey = keySeconds.some((k) => Math.abs(k - nearEnd) <= EXTRACT_KEY_NEAR_BASELINE_SEC);
    if (!tooNearKey) anchors.push(nearEnd);
  }
  return anchors;
}

function buildExtractTargetTimestamps(
  duration: number,
  priorityMoments: Array<{ timestamp?: string }>,
): number[] {
  const keySeconds = priorityMoments
    .map((item) => parseTimestampToSeconds(String(item.timestamp || "")))
    .filter((seconds): seconds is number => seconds != null && seconds >= 0 && seconds < duration);
  const keyBurst = buildKeyMomentExtractTimestamps(duration, priorityMoments);
  const baseline = buildBaselineExtractAnchors(duration, keySeconds);
  const merged = Array.from(new Set([...baseline, ...keyBurst]))
    .filter((t) => t >= 0 && t < duration)
    .sort((a, b) => a - b);

  if (merged.length <= EXTRACT_ABSOLUTE_MAX_FRAMES) return merged;

  // 超上限时：保留全部关键点 burst，baseline 按间隔稀疏化
  const keySet = new Set(keyBurst.map((t) => t.toFixed(1)));
  const baselineOnly = baseline.filter((t) => !keySet.has(t.toFixed(1)));
  const slotsLeft = Math.max(0, EXTRACT_ABSOLUTE_MAX_FRAMES - keyBurst.length);
  const thinnedBaseline =
    baselineOnly.length <= slotsLeft
      ? baselineOnly
      : baselineOnly.filter((_, i) => i % Math.ceil(baselineOnly.length / Math.max(1, slotsLeft)) === 0)
          .slice(0, slotsLeft);

  return Array.from(new Set([...thinnedBaseline, ...keyBurst]))
    .filter((t) => t >= 0 && t < duration)
    .sort((a, b) => a - b);
}

function computeExtractMinChars(duration: number, transcriptLength: number): number {
  const byDuration = Math.max(1800, Math.round((duration / 60) * 520));
  const byTranscript = transcriptLength >= 200 ? Math.round(transcriptLength * 0.45) : 0;
  return Math.max(byDuration, byTranscript);
}

function maxExtractScanMoments(duration: number): number {
  if (duration >= 480) return 14;
  if (duration >= 240) return 12;
  return 8;
}

function isExtractScanWeak(
  scan: { priorityMoments: Array<{ timestamp: string; label: string }> },
  transcript: string,
  duration: number,
): boolean {
  const text = transcript.trim();
  if (text.length < 40) return false;
  if (!scan.priorityMoments.length) return duration >= 90;
  if (duration >= 240 && scan.priorityMoments.length < 3) return true;
  const seconds = scan.priorityMoments
    .map((item) => parseTimestampToSeconds(item.timestamp))
    .filter((value): value is number => value != null);
  if (!seconds.length) return true;
  const maxSec = Math.max(...seconds);
  if (duration >= 300 && maxSec < duration * 0.25) return true;
  return false;
}

/** 提取模式 Phase 1：基于转写找重点时刻；默认 Gemini 3.5 Flash，效果差则改 GPT-5.5 */
async function runExtractTranscriptScan(params: {
  transcript: string;
  duration: number;
  context?: string;
  fileName?: string;
  scanEngine: GrowthCampStrategistEngine;
}) {
  const transcript = params.transcript.trim();
  if (transcript.length < 20) {
    return { priorityMoments: [] as Array<{ timestamp: string; label: string }>, topicHint: "" };
  }

  const response = await invokeLLM({
    ...strategistInvokeBase(params.scanEngine),
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `你是视频内容索引助手。根据口播/字幕转写，找出**画面/演示/论点转折**的关键时刻（主题切换、案例展示、投屏操作、数据金句、强视觉信息）。
规则：timestamp 用 mm:ss；本视频约 ${Math.round(params.duration / 60)} 分钟，最多 ${maxExtractScanMoments(params.duration)} 个时刻；**timestamp 尽量精确**（系统将每个关键点前后多次抽帧）；禁止编造转写里没有的内容。非关键点区域会另按约 50 秒间隔补帧，你只需标出真正重要的时刻。`,
      },
      {
        role: "user",
        content: JSON.stringify({
          fileName: params.fileName || "video",
          durationSeconds: params.duration,
          businessContext: params.context || "",
          transcript: truncate(transcript, 24000),
        }, null, 2),
      },
    ],
    response_format: params.scanEngine.provider === "openai"
      ? { type: "json_object" }
      : { type: "json_object" },
  });

  const parsed = parseLlmJsonResponse<{
    priorityMoments?: Array<{ timestamp?: string; label?: string }>;
    topicHint?: string;
  }>(String(response.choices[0]?.message?.content || "{}"));

  return {
    priorityMoments: Array.isArray(parsed.priorityMoments)
      ? parsed.priorityMoments
          .filter((item) => item && typeof item.timestamp === "string")
          .slice(0, maxExtractScanMoments(params.duration))
          .map((item) => ({
            timestamp: String(item.timestamp),
            label: String(item.label || "").trim(),
          }))
      : [],
    topicHint: String(parsed.topicHint || "").trim(),
  };
}

async function runExtractTranscriptScanWithFallback(params: {
  transcript: string;
  duration: number;
  context?: string;
  fileName?: string;
}) {
  const flashEngine = resolveGrowthCampExtractScanEngine();
  let scan = await runExtractTranscriptScan({ ...params, scanEngine: flashEngine });
  if (isExtractScanWeak(scan, params.transcript, params.duration)) {
    console.warn("[growth.analyzeVideo] extract transcript scan weak on Flash, retry with GPT-5.5");
    scan = await runExtractTranscriptScan({ ...params, scanEngine: resolveGrowthCampGpt55Engine() });
  }
  return scan;
}

async function runExtractOnlyPipeline(params: {
  videoPath: string;
  duration: number;
  safeName: string;
  chunkRanges: Array<{ start: number; duration: number; index: number }>;
  strategistEngine: GrowthCampStrategistEngine;
  videoGcsUri: string;
  context?: string;
  fileName?: string;
  extractPrompt?: string;
  mode: GrowthAnalysisMode;
}) {
  const extractEngine = resolveGrowthCampGpt55Engine();
  const transcriptChunks: string[] = [];

  for (const chunk of params.chunkRanges) {
    const audioBuffer = await extractAudioTrackFromPath(params.videoPath, chunk.start, chunk.duration).catch((error) => {
      console.warn("[growth.analyzeVideo] extract audio failed:", error);
      return null;
    });
    const transcriptChunk = await transcribeVideoAudio(audioBuffer).catch((error) => {
      console.warn("[growth.analyzeVideo] extract transcript failed:", error);
      return "";
    });
    if (transcriptChunk) {
      transcriptChunks.push(`[${toTimestamp(chunk.start)}-${toTimestamp(chunk.start + chunk.duration)}]\n${transcriptChunk}`);
    }
  }

  let transcript = transcriptChunks.join("\n\n");
  if (transcript.trim().length < 40) {
    const fallbackTranscript = await transcribeFullVideoFallback(params.videoPath, params.duration).catch(() => "");
    if (fallbackTranscript.trim().length > transcript.trim().length) {
      transcript = fallbackTranscript;
    }
  }

  const scan = await runExtractTranscriptScanWithFallback({
    transcript,
    duration: params.duration,
    context: params.context,
    fileName: params.fileName,
  });
  const targetTimestamps = buildExtractTargetTimestamps(params.duration, scan.priorityMoments);
  const sparseFrames = targetTimestamps.length
    ? await extractSparseFramesAtTimestamps(params.videoPath, targetTimestamps)
    : [];

  let visualFirstPass = buildEmptyVisualFirstPass();
  if (sparseFrames.length > 0) {
    visualFirstPass = await withGrowthAnalysisSlot(() => runExtractVisualFirstPass({
      strategistEngine: extractEngine,
      sparseFrames,
      context: params.context,
      duration: params.duration,
      fileName: params.fileName,
    }));
  }

  const extracted = await withGrowthAnalysisSlot(() => runContentExtractPass({
    strategistEngine: extractEngine,
    transcript,
    duration: params.duration,
    context: params.context,
    fileName: params.fileName,
    extractPrompt: params.extractPrompt,
    visualFirstPass,
    sparseFrames,
    videoGcsUri: params.videoGcsUri,
    scanTopicHint: scan.topicHint,
    priorityMoments: scan.priorityMoments,
  }));

  const analysisMode = params.mode === "REMIX" ? "REMIX" : "GROWTH";
  const parsed = parseGrowthAnalysisScores({
    ...extracted,
    mode: analysisMode,
    visualSummary: visualFirstPass.visualSummary || "",
  });

  return {
    analysis: parsed,
    transcript,
    sparseFrameCount: sparseFrames.length,
    costProfile: estimateTokenProfile(params.duration, sparseFrames.length),
  };
}

async function extractSparseFramesFromPath(
  videoPath: string,
  startSeconds = 0,
  durationSeconds?: number,
  strategy: SparseFrameStrategy = "dense",
) {
  const boundedDuration = durationSeconds ?? await getVideoDurationFromPath(videoPath);
  const timestamps = buildSparseFrameTimestamps(boundedDuration, strategy);
  const frameDir = path.join(
    os.tmpdir(),
    `growth-camp-frames-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(frameDir, { recursive: true });
  try {
    const frames: SparseFrame[] = [];
    for (let index = 0; index < timestamps.length; index += 1) {
      const chunkTimestamp = timestamps[index];
      const absoluteTimestamp = startSeconds + chunkTimestamp;
      const outPath = path.join(frameDir, `frame-${String(index).padStart(2, "0")}.jpg`);
      await execFileAsync("ffmpeg", [
        "-y",
        "-ss",
        String(absoluteTimestamp),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-vf",
        "scale='min(960,iw)':-2",
        "-q:v",
        "5",
        outPath,
      ]);
      const frameBuffer = await fs.readFile(outPath);
      frames.push({
        timestamp: absoluteTimestamp,
        dataUrl: `data:image/jpeg;base64,${frameBuffer.toString("base64")}`,
      });
    }
    return { duration: boundedDuration, frames };
  } finally {
    await fs.rm(frameDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function mergeAudioPasses(chunks: AudioFirstPass[]) {
  if (!chunks.length) {
    return {
      valueTier: "medium" as const,
      contentSummary: "",
      hookSummary: "",
      audiencePromise: "",
      commercialPotential: 0,
      creatorSignals: [],
      priorityMoments: [],
      riskMoments: [],
      deepDiveBrief: "",
      transcriptSummary: "",
    };
  }
  const tierScore = { low: 1, medium: 2, high: 3 } as const;
  const bestTier = chunks.slice().sort((left, right) => tierScore[right.valueTier] - tierScore[left.valueTier])[0]?.valueTier || "medium";

  // BGM 合并：取第一段 detected=true 的 chunk（avoid 多段重复噪声）
  const firstWithBgm = chunks.find((c) => c.bgmAnalysis?.detected);
  const mergedBgm: BgmAnalysis | undefined = firstWithBgm?.bgmAnalysis ?? chunks[0]?.bgmAnalysis;

  return {
    valueTier: bestTier,
    contentSummary: chunks.map((item) => item.contentSummary).filter(Boolean).join("；"),
    hookSummary: chunks.map((item) => item.hookSummary).filter(Boolean).slice(0, 3).join("；"),
    audiencePromise: chunks.map((item) => item.audiencePromise).filter(Boolean).slice(0, 3).join("；"),
    commercialPotential: Math.round(chunks.reduce((sum, item) => sum + item.commercialPotential, 0) / chunks.length),
    creatorSignals: Array.from(new Set(chunks.flatMap((item) => item.creatorSignals))).slice(0, 8),
    priorityMoments: chunks.flatMap((item) => item.priorityMoments).slice(0, 8),
    riskMoments: chunks.flatMap((item) => item.riskMoments).slice(0, 8),
    deepDiveBrief: chunks.map((item) => item.deepDiveBrief).filter(Boolean).join("；"),
    transcriptSummary: chunks.map((item) => item.transcriptSummary).filter(Boolean).join("；"),
    bgmAnalysis: mergedBgm,
  };
}

function mergeVisualPasses(chunks: VisualFirstPass[]) {
  if (!chunks.length) {
    return {
      visualSummary: "",
      openingFrameAssessment: "",
      sceneConsistency: "",
      trustSignals: [],
      visualRisks: [],
      keyFrames: [],
    };
  }
  return {
    visualSummary: chunks.map((item) => item.visualSummary).filter(Boolean).join("；"),
    openingFrameAssessment: chunks.map((item) => item.openingFrameAssessment).filter(Boolean).slice(0, 2).join("；"),
    sceneConsistency: chunks.map((item) => item.sceneConsistency).filter(Boolean).slice(0, 2).join("；"),
    trustSignals: Array.from(new Set(chunks.flatMap((item) => item.trustSignals))).slice(0, 10),
    visualRisks: Array.from(new Set(chunks.flatMap((item) => item.visualRisks))).slice(0, 10),
    keyFrames: chunks.flatMap((item) => item.keyFrames).sort((left, right) => left.timestamp.localeCompare(right.timestamp)).slice(0, 12),
  };
}

async function runAudioFirstPass(params: {
  audioGcsUri: string;
  transcript: string;
  duration: number;
  context?: string;
  fileName?: string;
}): Promise<AudioFirstPass> {
  const response = await invokeLLM({
    model: "pro",
    provider: "vertex",
    modelName: growthCampFirstPassModel(),
    messages: [
      {
        role: "system",
        content: `你是一位短视频内容策略分析师 + BGM 音乐人。你现在只做第一阶段“音频优先粗筛”，目标是用更低成本先判断这条视频值不值得深挖。

规则：
1. 优先依据音频和转写，不要假装看到了完整画面。
2. 重点识别：开头 hook、内容承诺、情绪转折、商业可承接性、需要深挖的秒点。
3. 所有时间点都必须返回 mm:ss。
4. creatorSignals 只写对创作者真正有帮助的经营信号，不写空话。
5. deepDiveBrief 要给第二阶段模型，告诉它应该重点看哪些画面、哪些段落、哪些商业问题。
6. 【新增 · BGM 识别】请用音乐人耳朵听音轨中的 BGM（背景音乐），即使被人声盖住也要尽力分离判断。输出：
   - detected: true/false（如果通篇都是干净人声 / 无 BGM 留白，写 false）
   - style: 风格中文标签（如：City Pop、Lo-fi、电子舞曲、国风、轻奢爵士、抒情钢琴、Hip-hop、Trap）
   - mood: 情绪关键词（如：紧迫、温柔、热血、治愈、神秘、轻松、性感）
   - instruments: 主要乐器中文（如：["合成器","电子鼓","贝斯"]）
   - bpm: 每分钟拍数（数字，60-180）
   - matchWithVisual: 与口播 / 画面节奏的契合度短句
   - copyrightNote: 版权风险提醒（"似为流行 hit 改编，商用需替换" 或 "未识别到流行 hit，相对安全"）

只返回 JSON：
{
  "valueTier": "high|medium|low",
  "contentSummary": "string",
  "hookSummary": "string",
  "audiencePromise": "string",
  "commercialPotential": number,
  "creatorSignals": ["string"],
  "priorityMoments": [
    { "timestamp": "00:08", "reason": "string", "action": "string" }
  ],
  "riskMoments": [
    { "timestamp": "00:42", "issue": "string", "fix": "string" }
  ],
  "deepDiveBrief": "string",
  "transcriptSummary": "string",
  "bgmAnalysis": {
    "detected": true,
    "style": "City Pop",
    "mood": "都市轻松",
    "instruments": ["合成器","电子鼓","贝斯"],
    "bpm": 110,
    "matchWithVisual": "BGM 节奏与镜头切换同步，强化生活惬意感",
    "copyrightNote": "未识别到流行 hit，相对安全"
  }
}`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `文件名：${params.fileName || "未命名视频"}`,
              `视频时长：${params.duration.toFixed(1)} 秒`,
              `业务背景：${params.context?.trim() || "未提供"}`,
              params.transcript
                ? `已有转写摘录：\n${truncate(params.transcript, 4500)}`
                : "已有转写摘录：暂无或转写失败，请你优先依据音频本身判断。",
            ].join("\n\n"),
          },
          {
            type: "file_url",
            file_url: {
              url: params.audioGcsUri,
              mime_type: "audio/mpeg",
            },
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "growth_camp_strategist_output",
        strict: true,
        schema: {
          type: "object",
          properties: {
            explosiveIndex: { type: "number", description: "1-10的综合爆款指数" },
            platformScores: {
              type: "object",
              description: "仅限小红书、抖音、B站、快手，给出1-10分。绝对不可包含任何其他未授权平台",
              properties: {
                xiaohongshu: { type: "number" },
                douyin: { type: "number" },
                bilibili: { type: "number" },
                kuaishou: { type: "number" },
              },
              required: ["xiaohongshu", "douyin", "bilibili", "kuaishou"],
            },
            realityCheck: { type: "string", description: "犀利冷酷的现实查验点评" },
            reverseEngineering: {
              type: "object",
              properties: {
                hookStrategy: { type: "string" },
                emotionalArc: { type: "string" },
                commercialLogic: { type: "string" },
              },
              required: ["hookStrategy", "emotionalArc", "commercialLogic"],
            },
            premiumContent: {
              type: "object",
              properties: {
                summary: { type: "string" },
	                topics: {
	                  type: "array",
	                  minItems: 4,
	                  maxItems: 4,
	                  description: "必须恰好输出 4 个实战选题",
	                  items: {
	                    type: "object",
                    properties: {
                      title: { type: "string" },
                      contentBrief: { type: "string", description: "超详细脚本，包含秒数、画面、口播与情绪" },
                    },
                    required: ["title", "contentBrief"],
                  },
                },
              },
              required: ["topics"],
            },
            growthStrategy: {
              type: "object",
              properties: {
                gapAnalysis: { type: "string" },
                commercialMatrix: { type: "string", description: "短视频/中长视频/图文笔记的转化埋点" },
              },
            },
            remixExecution: {
              type: "object",
              properties: {
                hookLibrary: { type: "array", items: { type: "string" } },
                emotionalPacing: { type: "string" },
                visualPaletteAndScript: { type: "string" },
                productMatrix: { type: "string" },
                shootingGuidance: { type: "string" },
                xiaohongshuLayout: { type: "string" },
              },
            },
          },
          required: ["explosiveIndex", "platformScores", "realityCheck", "reverseEngineering", "premiumContent"],
        },
      },
    },
  });

  const parsed = JSON.parse(extractJsonString(String(response.choices[0]?.message?.content || "{}")));
  return {
    valueTier: parsed.valueTier === "high" || parsed.valueTier === "low" ? parsed.valueTier : "medium",
    contentSummary: String(parsed.contentSummary || ""),
    hookSummary: String(parsed.hookSummary || ""),
    audiencePromise: String(parsed.audiencePromise || ""),
    commercialPotential: Number(parsed.commercialPotential || 0),
    creatorSignals: Array.isArray(parsed.creatorSignals) ? parsed.creatorSignals.map(String) : [],
    priorityMoments: Array.isArray(parsed.priorityMoments)
      ? parsed.priorityMoments.map((item: any) => ({
          timestamp: String(item?.timestamp || "00:00"),
          reason: String(item?.reason || ""),
          action: String(item?.action || ""),
        }))
      : [],
    riskMoments: Array.isArray(parsed.riskMoments)
      ? parsed.riskMoments.map((item: any) => ({
          timestamp: String(item?.timestamp || "00:00"),
          issue: String(item?.issue || ""),
          fix: String(item?.fix || ""),
        }))
      : [],
    deepDiveBrief: String(parsed.deepDiveBrief || ""),
    transcriptSummary: String(parsed.transcriptSummary || ""),
    bgmAnalysis: parsed.bgmAnalysis && typeof parsed.bgmAnalysis === "object"
      ? {
          detected: Boolean(parsed.bgmAnalysis.detected),
          style: parsed.bgmAnalysis.style ? String(parsed.bgmAnalysis.style) : undefined,
          mood: parsed.bgmAnalysis.mood ? String(parsed.bgmAnalysis.mood) : undefined,
          instruments: Array.isArray(parsed.bgmAnalysis.instruments)
            ? parsed.bgmAnalysis.instruments.map(String).slice(0, 6)
            : undefined,
          bpm: typeof parsed.bgmAnalysis.bpm === "number" && parsed.bgmAnalysis.bpm > 30 && parsed.bgmAnalysis.bpm < 220
            ? Math.round(parsed.bgmAnalysis.bpm)
            : undefined,
          matchWithVisual: parsed.bgmAnalysis.matchWithVisual ? String(parsed.bgmAnalysis.matchWithVisual) : undefined,
          copyrightNote: parsed.bgmAnalysis.copyrightNote ? String(parsed.bgmAnalysis.copyrightNote) : undefined,
        }
      : undefined,
  };
}

async function runVisualFirstPass(params: {
  sparseFrames: SparseFrame[];
  context?: string;
  duration: number;
  fileName?: string;
}): Promise<VisualFirstPass> {
  const response = await invokeLLM({
    model: "pro",
    provider: "vertex",
    modelName: growthCampFirstPassModel(),
    messages: [
      {
        role: "system",
        content: `你是一位短视频视觉策略分析师。你现在只做“关键帧视觉初判”，不要分析音频，不要假装看了完整视频。

规则：
1. 只能依据给你的关键帧做判断。
2. 必须判断开头画面是否足够抓人、人物/场景是否创建信任、画面风格是否统一、是否存在可直接转化的演示证据。
3. keyFrames 至少返回 4 条，时间点必须回 mm:ss。
4. 每条 keyFrame 都要回答：这帧展示了什么、可用于什么商业表达、问题是什么、怎么修。
5. 【新增】每条 keyFrame 必须额外评估"情绪张力"：
   - 人物表情/眼神/微表情（紧张？放松？挑衅？真诚？空洞？）
   - 镜头景别与运镜带来的情绪推力（特写=亲密；俯拍=压迫；快速推拉=紧迫）
   - 画面节奏与剪辑切点（停顿=悬念；快剪=兴奋；慢镜=回味）
6. visualSummary 整段必须含一段"画面整体情绪基调"描述（这与 audio first pass 的口播 + BGM 情绪互为印证）

只返回 JSON：
{
  "visualSummary": "string（必须含一段画面整体情绪基调）",
  "openingFrameAssessment": "string",
  "sceneConsistency": "string",
  "trustSignals": ["string"],
  "visualRisks": ["string"],
  "keyFrames": [
    {
      "timestamp": "00:08",
      "whatShows": "string（含人物表情/眼神/微表情）",
      "commercialUse": "string",
      "issue": "string",
      "fix": "string",
      "emotionalTension": "string（这一帧的情绪张力——景别+表情+剪辑节奏带来的情绪推力）"
    }
  ]
}`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `文件名：${params.fileName || "未命名视频"}`,
              `业务背景：${params.context?.trim() || "未提供"}`,
              `视频时长：${params.duration.toFixed(1)} 秒`,
              `关键帧时间点：${params.sparseFrames.map((item) => toTimestamp(item.timestamp)).join("、")}`,
            ].join("\n\n"),
          },
          ...params.sparseFrames.map((item, index) => ({
            type: "image_url" as const,
            image_url: {
              url: item.dataUrl,
              detail: index < 3 ? "high" as const : "auto" as const,
            },
          })),
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(extractJsonString(String(response.choices[0]?.message?.content || "{}")));
  return {
    visualSummary: String(parsed.visualSummary || ""),
    openingFrameAssessment: String(parsed.openingFrameAssessment || ""),
    sceneConsistency: String(parsed.sceneConsistency || ""),
    trustSignals: Array.isArray(parsed.trustSignals) ? parsed.trustSignals.map(String) : [],
    visualRisks: Array.isArray(parsed.visualRisks) ? parsed.visualRisks.map(String) : [],
    keyFrames: Array.isArray(parsed.keyFrames)
      ? parsed.keyFrames.map((item: any) => ({
          timestamp: String(item?.timestamp || "00:00"),
          whatShows: String(item?.whatShows || ""),
          commercialUse: String(item?.commercialUse || ""),
          issue: String(item?.issue || ""),
          fix: String(item?.fix || ""),
          emotionalTension: item?.emotionalTension ? String(item.emotionalTension) : undefined,
        }))
      : [],
  };
}

/** 提取模式：GPT-5.5 关键帧视觉描述（不做商业/钩子解读） */
async function runExtractVisualFirstPass(params: {
  strategistEngine: GrowthCampStrategistEngine;
  sparseFrames: SparseFrame[];
  context?: string;
  duration: number;
  fileName?: string;
}): Promise<VisualFirstPass> {
  const response = await invokeLLM({
    ...strategistInvokeBase(params.strategistEngine),
    temperature: 0.25,
    messages: [
      {
        role: "system",
        content: `你是视频画面记录员。仅依据关键帧做**客观画面描述**，供后续 Markdown 整理使用。

规则：
1. 只描述看得见的内容：人物、着装、姿态、场景、道具、大屏/投屏/UI 文字、镜头景别。
2. 禁止商业解读、钩子策略、情绪营销、变现建议。
3. keyFrames 覆盖所给每一帧；timestamp 用 mm:ss。
4. whatShows 写详尽（至少 2 句），含 UI 文字/界面模块如能辨认。

只返回 JSON：
{
  "visualSummary": "string（整体场景与投屏内容概述）",
  "openingFrameAssessment": "string",
  "sceneConsistency": "string",
  "trustSignals": [],
  "visualRisks": [],
  "keyFrames": [
    { "timestamp": "00:08", "whatShows": "string", "commercialUse": "", "issue": "", "fix": "" }
  ]
}`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `文件名：${params.fileName || "未命名视频"}`,
              `业务背景：${params.context?.trim() || "未提供"}`,
              `视频时长：${params.duration.toFixed(1)} 秒`,
              `关键帧时间点：${params.sparseFrames.map((item) => toTimestamp(item.timestamp)).join("、")}`,
            ].join("\n\n"),
          },
          ...params.sparseFrames.map((item, index) => ({
            type: "image_url" as const,
            image_url: {
              url: item.dataUrl,
              detail: index < 4 ? "high" as const : "auto" as const,
            },
          })),
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(extractJsonString(String(response.choices[0]?.message?.content || "{}")));
  return {
    visualSummary: String(parsed.visualSummary || ""),
    openingFrameAssessment: String(parsed.openingFrameAssessment || ""),
    sceneConsistency: String(parsed.sceneConsistency || ""),
    trustSignals: [],
    visualRisks: [],
    keyFrames: Array.isArray(parsed.keyFrames)
      ? parsed.keyFrames.map((item: any) => ({
          timestamp: String(item?.timestamp || "00:00"),
          whatShows: String(item?.whatShows || ""),
          commercialUse: "",
          issue: "",
          fix: "",
        }))
      : [],
  };
}

function normalizePremiumTopics(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    title: String(item?.title || ""),
    formatType: item?.formatType === "IMAGE_TEXT" ? "IMAGE_TEXT" : "VIDEO",
    businessInsight: String(item?.businessInsight || ""),
    contentBrief: String(item?.contentBrief || ""),
    directorExecution: {
      storyboard: Array.isArray(item?.directorExecution?.storyboard)
        ? item.directorExecution.storyboard.map(String).filter(Boolean)
        : [],
      lighting: String(item?.directorExecution?.lighting || ""),
      blocking: String(item?.directorExecution?.blocking || ""),
      emotionalTension: String(item?.directorExecution?.emotionalTension || ""),
    },
  })).filter((item) => item.title || item.contentBrief);
}

function normalizeShootingBlueprint(value: unknown, fallback = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const item = value as any;
    return {
      storyboard: Array.isArray(item.storyboard)
        ? item.storyboard.map(String).filter(Boolean)
        : [],
      lighting: String(item.lighting || ""),
      blocking: String(item.blocking || ""),
      shotSize: String(item.shotSize || ""),
      emotionalTension: String(item.emotionalTension || ""),
      cameraPerformance: String(item.cameraPerformance || ""),
    };
  }

  const text = String(value || fallback || "");
  return {
    storyboard: text ? [text] : [],
    lighting: "",
    blocking: "",
    shotSize: "",
    emotionalTension: "",
    cameraPerformance: "",
  };
}

function buildLegacyFieldsFromStrategist(parsed: any) {
  const platformScores = {
    xiaohongshu: Number(parsed?.platformScores?.xiaohongshu || 0),
    douyin: Number(parsed?.platformScores?.douyin || 0),
    bilibili: Number(parsed?.platformScores?.bilibili || 0),
    kuaishou: Number(parsed?.platformScores?.kuaishou || 0),
  };
  const reverseEngineering = {
    hookStrategy: String(parsed?.reverseEngineering?.hookStrategy || ""),
    emotionalArc: String(parsed?.reverseEngineering?.emotionalArc || ""),
    commercialLogic: String(parsed?.reverseEngineering?.commercialLogic || ""),
  };
  const basePremium =
    parsed?.premiumContent && typeof parsed.premiumContent === "object" && !Array.isArray(parsed.premiumContent)
      ? (parsed.premiumContent as Record<string, unknown>)
      : {};
  const fromParsedTopics = normalizePremiumTopics(parsed?.premiumContent?.topics);
  const premiumTopics =
    fromParsedTopics.length > 0 ? fromParsedTopics : normalizePremiumTopics(basePremium.topics);
  const premiumSummary = String(parsed?.premiumContent?.summary || basePremium.summary || "");
  const growthStrategy = {
    gapAnalysis: String(parsed?.growthStrategy?.gapAnalysis || ""),
    commercialMatrix: String(parsed?.growthStrategy?.commercialMatrix || ""),
  };
  const remixExecution = {
    hookLibrary: Array.isArray(parsed?.remixExecution?.hookLibrary)
      ? parsed.remixExecution.hookLibrary.map(String)
      : [],
    emotionalPacing: String(parsed?.remixExecution?.emotionalPacing || ""),
    visualPaletteAndScript: String(parsed?.remixExecution?.visualPaletteAndScript || ""),
    productMatrix: String(parsed?.remixExecution?.productMatrix || ""),
    shootingGuidance: String(parsed?.remixExecution?.shootingGuidance || ""),
    businessInsight: {
      video: String(parsed?.remixExecution?.businessInsight?.video || ""),
      imageText: String(parsed?.remixExecution?.businessInsight?.imageText || ""),
      monetizationLogic: String(parsed?.remixExecution?.businessInsight?.monetizationLogic || ""),
    },
    shootingBlueprint: normalizeShootingBlueprint(
      parsed?.remixExecution?.shootingBlueprint,
      parsed?.remixExecution?.shootingGuidance,
    ),
    imageTextNoteGuide: {
      coverSetup: String(parsed?.remixExecution?.imageTextNoteGuide?.coverSetup || ""),
      titleOptions: Array.isArray(parsed?.remixExecution?.imageTextNoteGuide?.titleOptions)
        ? parsed.remixExecution.imageTextNoteGuide.titleOptions.map(String)
        : [],
      structuredBody: String(parsed?.remixExecution?.imageTextNoteGuide?.structuredBody || ""),
    },
    xiaohongshuLayout: String(parsed?.remixExecution?.xiaohongshuLayout || ""),
  };

  return {
    explosiveIndex: Number(parsed?.explosiveIndex || 0),
    platformScores,
    realityCheck: String(parsed?.realityCheck || ""),
    reverseEngineering,
    premiumContent: {
      ...basePremium,
      summary: premiumSummary,
      topics: premiumTopics,
    },
    growthStrategy,
    remixExecution,
    summary: String(
      parsed?.summary
      || parsed?.realityCheck
      || growthStrategy.gapAnalysis
      || reverseEngineering.commercialLogic
      || premiumSummary
      || "",
    ),
    strengths: Array.isArray(parsed?.strengths) && parsed.strengths.length
      ? parsed.strengths.map(String)
      : [reverseEngineering.hookStrategy, reverseEngineering.emotionalArc].filter(Boolean),
    improvements: Array.isArray(parsed?.improvements) && parsed.improvements.length
      ? parsed.improvements.map(String)
      : [String(parsed?.realityCheck || ""), reverseEngineering.commercialLogic].filter(Boolean),
    titleSuggestions: Array.isArray(parsed?.titleSuggestions) && parsed.titleSuggestions.length
      ? parsed.titleSuggestions.map(String)
      : premiumTopics.slice(0, 4).map((item) => item.title).filter(Boolean),
    commercialAngles: Array.isArray(parsed?.commercialAngles) && parsed.commercialAngles.length
      ? parsed.commercialAngles
      : premiumTopics.slice(0, 4).map((item) => ({
          title: item.title || "二次创作方向",
          scenario: premiumSummary || "把原视频改造成更有情绪张力和商业承接的版本。",
          whyItFits: reverseEngineering.commercialLogic || "这条方向更容易创建信任并承接成交动作。",
          brands: [],
          execution: item.contentBrief || "把人物、灯光、场景和结果镜头重组成更能停留的脚本。",
          hook: reverseEngineering.hookStrategy || "先抛最刺痛的问题或结果。",
          veoPrompt: "",
        })),
    followUpPrompt: String(
      parsed?.followUpPrompt
      || `请基于以下商业拆解与二次创作方向，继续输出一版可直接拍摄的脚本：钩子策略：${reverseEngineering.hookStrategy}；情绪弧线：${reverseEngineering.emotionalArc}；商业逻辑：${reverseEngineering.commercialLogic}`,
    ),
  };
}

const STRATEGIST_PREMIUM_TOPIC_ITEM_JSON: Record<string, unknown> = {
  type: "object",
  properties: {
    title: { type: "string" },
    formatType: { type: "string", enum: ["VIDEO", "IMAGE_TEXT"] },
    businessInsight: {
      type: "string",
      description: "引流品、利润品、转化路径的顾问级深度分析，不少于200字",
    },
    contentBrief: { type: "string" },
    directorExecution: {
      type: "object",
      properties: {
        storyboard: { type: "array", items: { type: "string" }, description: "完整分镜脚本" },
        lighting: { type: "string", description: "灯光布置" },
        blocking: { type: "string", description: "走位调度" },
        emotionalTension: { type: "string", description: "情绪控制" },
      },
      required: ["storyboard", "lighting", "blocking", "emotionalTension"],
    },
  },
  required: ["title", "formatType", "businessInsight", "contentBrief", "directorExecution"],
};

function strategistPremiumVertexSchema(mode: GrowthAnalysisMode): Record<string, unknown> {
  if (mode === "GROWTH") {
    return {
      type: "object",
      properties: {
        strategy: { type: "string", description: "顶级商业顾问：人设拆解与产品矩阵规划" },
        actionableTopics: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          description: "恰好 3 个即时可执行选题，导演级分镜",
          items: STRATEGIST_PREMIUM_TOPIC_ITEM_JSON,
        },
        topics: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          description: "恰好 3 个核心爆款选题，导演级分镜",
          items: STRATEGIST_PREMIUM_TOPIC_ITEM_JSON,
        },
        explosiveTopicAnalysis: { type: "string", description: "爆款选题深度综述" },
        musicAndExpressionAnalysis: { type: "string", description: "原视频表达与配乐分析，不少于 100 字" },
        musicPrompt: {
          type: "string",
          description: "Suno/Udio：[Music Style], [Instruments], [Mood], [Tempo]",
        },
      },
      required: [
        "strategy",
        "actionableTopics",
        "topics",
        "explosiveTopicAnalysis",
        "musicAndExpressionAnalysis",
        "musicPrompt",
      ],
    };
  }
  return {
    type: "object",
    properties: {
      actionableTopics: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        description:
          "针对用户背景量身定制的 3 个即时改编选题；每个 businessInsight 引流品/利润品深度不少于 300 字",
        items: STRATEGIST_PREMIUM_TOPIC_ITEM_JSON,
      },
      topics: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        description:
          "恰好 3 个深度二次创作选题，与 actionableTopics 递进延伸，导演级分镜，每个 businessInsight 不少于 200 字",
        items: STRATEGIST_PREMIUM_TOPIC_ITEM_JSON,
      },
      remixVisualAnalysis: {
        type: "string",
        description:
          "二次创作视觉分析（借鉴与避坑）：分析原视频优缺点，明确指出新选题该借鉴什么、避开什么。",
      },
      remixExpressionAnalysis: {
        type: "string",
        description:
          "二次创作专属表达指导：必须含 **参考语言表达力**、**参考情感表达方式**、**参考镜头表现与情绪张力** 三个加粗小标题（用字一致）。",
      },
      musicPrompt: {
        type: "string",
        description: "仅针对用户【新选题】的英文 BGM（Style, Mood, Instruments, Tempo/BPM）",
      },
    },
    required: ["actionableTopics", "topics", "remixVisualAnalysis", "remixExpressionAnalysis", "musicPrompt"],
  };
}

function buildStrategistMultimodalUserContent(params: {
  fileName?: string;
  context?: string;
  videoGcsUri: string;
  duration: number;
  sparseFrameCount: number;
  audioFirstPass: AudioFirstPass;
  visualFirstPass: VisualFirstPass;
  transcript: string;
  sparseFrames: SparseFrame[];
}) {
  // ✨ BGM + 口播情绪张力 → 显式提取出来作为高优先级"情绪信号块"，
  //    不要只埋在 JSON.stringify(audioFirstPass) 里，那样模型很容易忽略
  //    用户要求：把 BGM 与语言表达情绪张力，喂进【视觉洞察 + 情绪】字段
  const bgm = params.audioFirstPass.bgmAnalysis;
  const bgmBlock = bgm?.detected
    ? [
        `【BGM（背景音乐）识别 — 必须融入 emotionalArc / emotionalPacing / shootingBlueprint.emotionalTension】`,
        `· 风格：${bgm.style || "未识别"}`,
        `· 情绪：${bgm.mood || "未识别"}`,
        `· 主要乐器：${(bgm.instruments || []).join("、") || "未识别"}`,
        `· BPM：${bgm.bpm ?? "未识别"}（每分钟拍数，影响剪辑节奏与口播语速）`,
        `· 与画面契合度：${bgm.matchWithVisual || "未识别"}`,
        `· 版权风险：${bgm.copyrightNote || "未识别"}`,
      ].join("\n")
    : `【BGM（背景音乐）识别】未检测到明显 BGM（可能是纯口播 / 无配乐）。emotionalArc / emotionalPacing 应主要从口播语调与画面节奏判断。`;

  // 口播情绪张力线索：从 priorityMoments + riskMoments 中提取（这些是 audioFirstPass 已经标好的"情绪转折点"）
  const speechTensionPoints = [
    ...params.audioFirstPass.priorityMoments.map((p) => `${p.timestamp} 情绪高点：${p.reason}`),
    ...params.audioFirstPass.riskMoments.map((r) => `${r.timestamp} 情绪低/风险：${r.issue}`),
  ].slice(0, 8);
  const speechTensionBlock = [
    `【口播语言表达 · 情绪张力轨迹 — 必须融入 emotionalArc / emotionalPacing】`,
    `· 钩子情绪：${params.audioFirstPass.hookSummary || "未识别"}`,
    `· 受众承诺：${params.audioFirstPass.audiencePromise || "未识别"}`,
    speechTensionPoints.length
      ? `· 情绪张力时间轴：\n  - ${speechTensionPoints.join("\n  - ")}`
      : `· 情绪张力时间轴：暂无明显转折点，请结合 BGM + 画面综合判断`,
  ].join("\n");

  return [
    {
      type: "text" as const,
      text: [
        `文件名：${params.fileName || "未命名视频"}`,
        `业务背景：${params.context?.trim() || "未提供"}`,
        `视频 GCS 地址：${params.videoGcsUri}`,
        `视频时长：${params.duration.toFixed(1)} 秒`,
        `稀疏关键帧数量：${params.sparseFrameCount}`,
        bgmBlock,
        speechTensionBlock,
        `第一阶段音频粗筛结论（完整 JSON）：\n${JSON.stringify(params.audioFirstPass, null, 2)}`,
        `第一阶段关键帧视觉初判：\n${JSON.stringify(params.visualFirstPass, null, 2)}`,
        params.transcript
          ? `转写摘录：\n${truncate(params.transcript, 5000)}`
          : "转写摘录：暂无或转写失败，请依第一阶段音频结论和关键帧判断。",
      ].join("\n\n"),
    },
    ...params.sparseFrames.map((item, index) => ({
      type: "image_url" as const,
      image_url: {
        url: item.dataUrl,
        detail: index < 2 ? ("high" as const) : ("auto" as const),
      },
    })),
  ];
}

function mapStrategistPremiumLlmToPremiumContent(mode: GrowthAnalysisMode, raw: unknown) {
  const r = raw as Record<string, unknown>;
  if (mode === "GROWTH") {
    const parsed = growthLlmSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("[GROWTH LLM] Zod parse failed, using partial data:", parsed.error.message.slice(0, 200));
    }
    const llm = parsed.success ? parsed.data : {
      strategy: String(r?.strategy || ""),
      actionableTopics: Array.isArray(r?.actionableTopics) ? r.actionableTopics : [],
      topics: Array.isArray(r?.topics) ? r.topics : [],
      explosiveTopicAnalysis: String(r?.explosiveTopicAnalysis || ""),
      musicAndExpressionAnalysis: String(r?.musicAndExpressionAnalysis || ""),
      musicPrompt: String(r?.musicPrompt || ""),
    };
    return growthPremiumContentSchema.parse({
      summary: "",
      strategy: llm.strategy,
      actionableTopics: llm.actionableTopics,
      topics: llm.topics,
      explosiveTopicAnalysis: llm.explosiveTopicAnalysis,
      musicAndExpressionAnalysis: llm.musicAndExpressionAnalysis,
      remixVisualAnalysis: "",
      remixExpressionAnalysis: "",
      musicPrompt: llm.musicPrompt,
    });
  }
  // REMIX
  const parsed = remixLlmSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[REMIX LLM] Zod parse failed, using partial data:", parsed.error.message.slice(0, 200));
  }
  const llm = parsed.success ? parsed.data : {
    actionableTopics: Array.isArray(r?.actionableTopics) ? r.actionableTopics : [],
    topics: Array.isArray(r?.topics) ? r.topics : [],
    remixVisualAnalysis: String(r?.remixVisualAnalysis || ""),
    remixExpressionAnalysis: String(r?.remixExpressionAnalysis || ""),
    musicPrompt: String(r?.musicPrompt || ""),
  };
  return growthPremiumContentSchema.parse({
    summary: "",
    strategy: "",
    actionableTopics: llm.actionableTopics,
    topics: llm.topics,
    explosiveTopicAnalysis: "",
    musicAndExpressionAnalysis: "",
    remixVisualAnalysis: llm.remixVisualAnalysis,
    remixExpressionAnalysis: llm.remixExpressionAnalysis,
    musicPrompt: llm.musicPrompt,
  });
}

function buildEmptyVisualFirstPass(): VisualFirstPass {
  return {
    visualSummary: "",
    openingFrameAssessment: "",
    sceneConsistency: "",
    trustSignals: [],
    visualRisks: [],
    keyFrames: [],
  };
}

function looksLikeEmptyExtractStub(content: string): boolean {
  const text = String(content || "").trim();
  if (text.length < 80) return true;
  return /未提供转写|无法精确整理|缺少.*转写|无法从.*整理|未能从视频/i.test(text)
    && !/(?:^|\n)- .{20,}/m.test(text);
}

function looksLikeTooBriefExtract(content: string, duration: number, transcriptLength: number): boolean {
  const text = String(content || "").trim();
  const minChars = computeExtractMinChars(duration, transcriptLength);
  if (text.length < minChars * 0.65) return true;
  const hasTranscriptSection = /##\s*(\d+\.\s*)?口播|##\s*口播/i.test(text);
  const hasVisualSection = /##\s*(\d+\.\s*)?画面描述/i.test(text);
  if (!hasTranscriptSection || !hasVisualSection) return true;
  const h3Count = (text.match(/^###\s+/gm) || []).length;
  const minSegments = Math.max(3, Math.round(duration / 120));
  if (duration >= 240 && h3Count < minSegments) return true;
  return false;
}

function looksLikeDuplicativeExtract(content: string): boolean {
  const text = String(content || "").trim();
  if (/去重后的重点|精确结论|重点信息汇总/i.test(text)) return true;
  return false;
}

function buildExtractSystemPrompt(params: {
  duration: number;
  transcriptLength: number;
  scanTopicHint?: string;
  priorityBlock: string;
  customPrompt: string;
  strictRetry?: boolean;
}): string {
  const minChars = computeExtractMinChars(params.duration, params.transcriptLength);
  const minTranscriptSegments = Math.max(3, Math.round(params.duration / 90));
  const minVisualEntries = Math.max(4, Math.round(params.duration / 75));

  return `
你是视频内容整理助手（GPT-5.5）。后台已用 Gemini 3.5 Flash 完成语音 scan；你负责把转写、关键帧画面整理成**流畅、详尽、去重**的 Markdown。

【任务目标】
像培训实录文档：大纲清晰、正文流畅详尽。**同一事实不要在多个章节全文重复**——各章分工明确，后章只可一句交叉引用。

【禁止输出】
- 情绪弧线、钩子、分镜脚本、商业路径、选题、平台评分、变现、配乐
- 「未提供转写」等推托
- 章节「去重后的重点信息汇总」「精确结论」「演示要点整理」等重复摘要

【必须按此结构（## 标题字面一致，可带序号如 ## 1.）】

## 视频基本信息
文件名、时长、内容类型、主要场景 — **各一行列表，不展开**

## 口播/字幕整理
按时间轴分段（### mm:ss 左右 或 mm:ss–mm:ss），**只写说了什么 / 讲解逻辑**
- 至少 ${minTranscriptSegments} 段；转写稀疏时写「本段以画面演示为主：…」
- 每段流畅通顺，保留关键句，禁止只写主题词

## 内容大纲
**结构索引**：主题（1 小段）、核心论点（3–6 条短句）、段落结构（时间范围 + **一句话**）
- 不得复制「口播整理」整段正文

## 画面描述
**只写看得见的内容**：整体风格、主讲人、场景道具、大屏/UI/投屏细节
- 按子节组织；至少 ${minVisualEntries} 处带 mm:ss
- 不与「口播整理」逐段复述同一段话

## 关键时刻
每个 scan 重点时刻 1 条：**mm:ss｜一句口播要点｜一句画面要点**（禁止复制上文长段）

【篇幅与文风】总字数建议 ≥ ${minChars} 字；行文通顺可读
${params.strictRetry ? "\n【重试】上次重复过多或过短。删重复摘要章，扩写口播与画面正文。\n" : ""}
${params.scanTopicHint ? `【语音 scan 主题】${params.scanTopicHint}` : ""}
${params.priorityBlock ? `【语音 scan 关键时刻】\n${params.priorityBlock}` : ""}
${params.customPrompt ? `\n【用户额外要求】\n${params.customPrompt}` : ""}

【输出格式】JSON（无代码围栏）：extractedContent + summary（50 字内）
`.trim();
}

function buildExtractMultimodalUserContent(params: {
  fileName?: string;
  context?: string;
  duration: number;
  transcript: string;
  visualFirstPass: VisualFirstPass;
  sparseFrames: SparseFrame[];
  videoGcsUri: string;
}) {
  const keyFrameLines = params.visualFirstPass.keyFrames
    .slice(0, 12)
    .map((item) => `[${item.timestamp}] ${item.whatShows}${item.issue ? `（问题：${item.issue}）` : ""}`)
    .join("\n");

  return [
    {
      type: "text" as const,
      text: [
        `文件名：${params.fileName || "未命名视频"}`,
        `业务背景：${params.context?.trim() || "未提供"}`,
        `视频 GCS：${params.videoGcsUri}`,
        `视频时长：${params.duration.toFixed(1)} 秒`,
        params.transcript.trim()
          ? `【口播/字幕转写 — 必须据此整理，禁止声称未提供】\n${truncate(params.transcript, 32000)}`
          : "【口播/字幕转写】本视频无明显口播或转写失败，请依据下方画面摘要与关键帧整理。",
        params.visualFirstPass.visualSummary.trim()
          ? `【画面描述 — 必须据此整理，禁止声称未提供】\n${params.visualFirstPass.visualSummary.trim()}`
          : "",
        params.visualFirstPass.openingFrameAssessment.trim()
          ? `【开场画面】\n${params.visualFirstPass.openingFrameAssessment.trim()}`
          : "",
        keyFrameLines
          ? `【关键帧时间轴】\n${keyFrameLines}`
          : "",
        `【视觉初判 JSON】\n${JSON.stringify(params.visualFirstPass, null, 2)}`,
      ].filter(Boolean).join("\n\n"),
    },
    ...params.sparseFrames.map((item, index) => ({
      type: "image_url" as const,
      image_url: {
        url: item.dataUrl,
        detail: index < 4 ? ("high" as const) : ("auto" as const),
      },
    })),
  ];
}

async function transcribeFullVideoFallback(videoPath: string, duration: number): Promise<string> {
  const audioBuffer = await extractAudioTrackFromPath(videoPath, 0, duration).catch(() => null);
  if (!audioBuffer?.length) return "";
  return transcribeVideoAudio(audioBuffer);
}

async function runContentExtractPass(params: {
  strategistEngine: GrowthCampStrategistEngine;
  transcript: string;
  duration: number;
  context?: string;
  fileName?: string;
  extractPrompt?: string;
  visualFirstPass: VisualFirstPass;
  sparseFrames: SparseFrame[];
  videoGcsUri: string;
  scanTopicHint?: string;
  priorityMoments?: Array<{ timestamp: string; label: string }>;
}) {
  const customPrompt = (params.extractPrompt || "").trim();
  const visualFirstPass = params.visualFirstPass;
  const visualSummary = visualFirstPass.visualSummary.trim();
  const transcript = params.transcript.trim();
  const hasTranscript = transcript.length >= 20;
  const hasVisual = visualSummary.length >= 20 || params.sparseFrames.length > 0;

  if (!hasTranscript && !hasVisual) {
    throw new VideoAnalysisFailure(
      "transcription",
      "未能从视频提取口播转写或画面信息。请确认视频含清晰音轨或画面后再试。",
    );
  }

  const priorityBlock = params.priorityMoments?.length
    ? params.priorityMoments.map((m) => `- ${m.timestamp} ${m.label}`).join("\n")
    : "";

  const useOpenAiJsonObject = params.strategistEngine.provider === "openai";
  const userMultimodalContent = buildExtractMultimodalUserContent({
    fileName: params.fileName,
    context: params.context,
    duration: params.duration,
    transcript,
    visualFirstPass,
    sparseFrames: params.sparseFrames,
    videoGcsUri: params.videoGcsUri,
  });

  const invokeExtractPass = async (strictRetry: boolean) => {
    const systemPrompt = buildExtractSystemPrompt({
      duration: params.duration,
      transcriptLength: transcript.length,
      scanTopicHint: params.scanTopicHint,
      priorityBlock,
      customPrompt,
      strictRetry,
    });
    return invokeLLM({
      ...strategistInvokeBase(params.strategistEngine),
      temperature: strictRetry ? 0.35 : 0.3,
      topP: 0.92,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMultimodalContent },
      ],
      response_format: useOpenAiJsonObject
        ? { type: "json_object" }
        : {
        type: "json_schema",
        json_schema: {
          name: "growth_camp_content_extract",
          strict: true,
          schema: {
            type: "object",
            properties: {
              extractedContent: {
                type: "string",
                description: `详尽 Markdown 正文，不少于 ${computeExtractMinChars(params.duration, transcript.length)} 字`,
              },
              summary: {
                type: "string",
                description: "50 字以内一句话摘要",
              },
            },
            required: ["extractedContent", "summary"],
          },
        },
      },
    });
  };

  let response = await invokeExtractPass(false);
  let parsed = parseExtractPassResponse(String(response.choices[0]?.message?.content || ""));
  let extractedContent = String(parsed.extractedContent || "").trim();

  if (
    (hasTranscript || hasVisual)
    && (
      looksLikeTooBriefExtract(extractedContent, params.duration, transcript.length)
      || looksLikeDuplicativeExtract(extractedContent)
    )
  ) {
    console.warn("[growth.analyzeVideo] extract pass too brief or duplicative, retrying with strict prompt");
    response = await invokeExtractPass(true);
    parsed = parseExtractPassResponse(String(response.choices[0]?.message?.content || ""));
    extractedContent = String(parsed.extractedContent || "").trim();
  }

  if (looksLikeEmptyExtractStub(extractedContent) && (hasTranscript || hasVisual)) {
    throw new VideoAnalysisFailure(
      "llm",
      "内容提取模型返回空模板（未使用已提供的转写/画面）。请缩短视频或稍后重试。",
    );
  }
  if (looksLikeTooBriefExtract(extractedContent, params.duration, transcript.length) && (hasTranscript || hasVisual)) {
    throw new VideoAnalysisFailure(
      "llm",
      `内容提取结果过短（仅 ${extractedContent.length} 字，需详尽 Markdown）。请重试。`,
    );
  }
  if (looksLikeDuplicativeExtract(extractedContent) && (hasTranscript || hasVisual)) {
    throw new VideoAnalysisFailure(
      "llm",
      "内容提取结果重复章节过多。请重试或补充提取要求（去重、只要一份正文）。",
    );
  }

  return {
    composition: 0,
    color: 0,
    lighting: 0,
    impact: 0,
    viralPotential: 0,
    explosiveIndex: 0,
    analysisProfile: "extract_only" as GrowthAnalysisProfile,
    extractedContent: String(parsed.extractedContent || "").trim(),
    summary: String(parsed.summary || "").trim(),
    realityCheck: "",
    reverseEngineering: { hookStrategy: "", emotionalArc: "", commercialLogic: "" },
    premiumContent: {
      summary: "",
      strategy: "",
      actionableTopics: [],
      topics: [],
      explosiveTopicAnalysis: "",
      musicAndExpressionAnalysis: "",
      remixVisualAnalysis: "",
      remixExpressionAnalysis: "",
      musicPrompt: "",
    },
  };
}

async function runDeepDivePass(params: {
  strategistEngine: GrowthCampStrategistEngine;
  sparseFrames: SparseFrame[];
  audioFirstPass: AudioFirstPass;
  visualFirstPass: VisualFirstPass;
  transcript: string;
  duration: number;
  context?: string;
  fileName?: string;
  videoGcsUri: string;
  mode: GrowthAnalysisMode;
}) {
  const mode = params.mode;
  const businessGoal = (params.context || "未提供").trim() || "未提供";
  const bgm = params.audioFirstPass.bgmAnalysis;
  const STRATEGIST_SYSTEM_MAIN = `
你是顶级商业IP操盘手与大师级导演。
模式：${mode === "REMIX" ? "实战爆款 · 二次创作" : "商业成长营"}
用户业务背景（必须严格对齐，禁止忽略）：${businessGoal}

【排版禁令：禁止文本墙】
所有长文必须 Markdown 条列（- ）与 **加粗**；段落间空行。禁止「暂无」「待补充」。禁止「请建议」「您可以」等软弱语气。
平台仅限【抖音、快手、小红书、B站】，严禁「视频号」。

【情绪与音乐分析 · 强制规则】
我已在 user message 顶部把【BGM 识别】+【口播语言表达情绪张力轨迹】抽出来给你。在以下三个字段里你必须明确引用这两个信号：
1. reverseEngineering.emotionalArc：必须写"BGM 风格 ${bgm?.style || "（待识别）"} × 口播语调（开场→高潮→收尾）的情绪张力曲线"，并指出哪一秒是情绪峰值。
2. remixExecution.emotionalPacing：必须写"BGM BPM ${bgm?.bpm ?? "（未识别）"} 主导剪辑节奏 × 口播停顿/重音/语速节奏"。
3. remixExecution.shootingBlueprint.emotionalTension：必须把"BGM 情绪基调（${bgm?.mood || "（待识别）"}）+ 口播张力 + 镜头表情/眼神"三者绑在一起描述。
另外 visualPaletteAndScript / openingFrameAssessment 等"视觉洞察"字段，请同时考虑 BGM 与画面剪辑节奏的同步度（不是只看画面）。

【本轮输出】
请完整产出 JSON Schema 所要求的评分、reverseEngineering、remixExecution 等字段。不要输出 premiumContent（该区块由下一轮专模单独生成；禁止在 JSON 中加入 premiumContent 键）。
`;

  const userMultimodalContent = buildStrategistMultimodalUserContent({
    fileName: params.fileName,
    context: params.context,
    videoGcsUri: params.videoGcsUri,
    duration: params.duration,
    sparseFrameCount: params.sparseFrames.length,
    audioFirstPass: params.audioFirstPass,
    visualFirstPass: params.visualFirstPass,
    transcript: params.transcript,
    sparseFrames: params.sparseFrames,
  });

  return runGrowthCampStrategistMultimodalPass({
    systemMain: STRATEGIST_SYSTEM_MAIN,
    userContent: userMultimodalContent,
    mode,
    strategistEngine: params.strategistEngine,
    businessGoal,
    mediaKind: "video",
  });
}

async function runStrategistRefinementPass(params: {
  finalModel: string;
  context?: string;
  duration: number;
  transcript: string;
  audioFirstPass: AudioFirstPass;
  visualFirstPass: VisualFirstPass;
  deepDive: unknown;
}) {
  const response = await invokeLLM({
    model: "pro",
    provider: "vertex",
    modelName: params.finalModel,
    messages: [
      {
        role: "system",
        content: `你现在是第三阶段“成文操盘手”。不要重新看视频，也不要回到泛分析。你只基于前两阶段提炼出来的结构化文本证据，把结果打磨成明显优于 2.5 Pro 的版本。

要求：
1. 重点拉开差异的字段只有：summary、strengths、improvements、languageExpression、emotionalExpression、cameraEmotionTension、bgmAnalysis、musicRecommendation、sunoPrompt、titleSuggestions、commercialAngles、followUpPrompt、timestampSuggestions。
2. 不要改变前面已经确定的事实与时间点，只能把它们写得更精准、更有商业判断、更像能直接拿去用的报告。
3. titleSuggestions 不能只是换近义词，要能拉开情绪张力、结果承诺和平台适配。
4. commercialAngles 必须更像“内容操盘方案”，而不是泛泛场景描述。
5. followUpPrompt 必须能直接交给下一个 Gemini 会话继续产出图文稿或视频脚本。

只返回 JSON：
{
 "summary": "string",
  "strengths": ["string"],
  "improvements": ["string"],
  "languageExpression": "string",
  "emotionalExpression": "string",
  "cameraEmotionTension": "string",
  "bgmAnalysis": "string",
  "musicRecommendation": "string",
  "sunoPrompt": "string",
  "titleSuggestions": ["string"],
  "timestampSuggestions": [
    { "timestamp": "00:08", "issue": "string", "fix": "string", "opportunity": "string" }
  ],
  "commercialAngles": [
    {
      "title": "string",
      "scenario": "string",
      "whyItFits": "string",
      "brands": ["string"],
      "execution": "string",
      "hook": "string",
      "veoPrompt": "string"
    }
  ],
  "followUpPrompt": "string"
}`,
      },
      {
        role: "user",
        content: JSON.stringify({
          context: params.context || "",
          duration: params.duration,
          transcript: truncate(params.transcript, 3000),
          audioFirstPass: params.audioFirstPass,
          visualFirstPass: params.visualFirstPass,
          deepDive: params.deepDive,
        }, null, 2),
      },
    ],
    response_format: { type: "json_object" },
  });
  return parseLlmJsonResponse<StrategistRefinement>(String(response.choices[0]?.message?.content || "{}"));
}

export async function analyzeVideo(params: {
  gcsUri?: string;
  fileBase64?: string;
  fileUrl?: string;
  fileKey?: string;
  mimeType: string;
  fileName?: string;
  context?: string;
  modelName?: string;
  mode?: GrowthAnalysisMode;
  /** @deprecated 已废弃：每次分析均复制到新 GCS 路径，不再复用 gs:// */
  forceRefresh?: boolean;
  analysisProfile?: GrowthAnalysisProfile;
  extractPrompt?: string;
}): Promise<VideoAnalysisResult> {
  const uploadedObjects: string[] = [];
  try {
    const strategistEngine = resolveGrowthCampStrategistEngine(params.modelName);
    const finalModel = strategistEngine.modelName;
    let buffer: Buffer;
    let videoGcsUri = "";
    if (typeof params.gcsUri === "string" && isGsUri(params.gcsUri)) {
      const storedObject = await downloadGcsObject({ gcsUri: params.gcsUri });
      buffer = storedObject.buffer;
      // 每次分析都复制到新 GCS 路径，避免 Vertex 对同一 gs:// 对象的多模态缓存导致结果串台
      videoGcsUri = "";
    } else if (typeof params.fileKey === "string" && params.fileKey.trim()) {
      const storedBuffer = await storageRead(params.fileKey).catch(() => null);
      if (storedBuffer?.length) {
        buffer = storedBuffer;
      } else if (typeof params.fileUrl === "string" && params.fileUrl.trim()) {
        const response = await fetch(params.fileUrl);
        if (!response.ok) {
          throw new VideoAnalysisFailure("decode", `下载上传视频失败: ${response.status}`);
        }
        buffer = Buffer.from(await response.arrayBuffer());
      } else {
        throw new VideoAnalysisFailure("decode", "无法读取上传视频");
      }
    } else if (typeof params.fileUrl === "string" && params.fileUrl.trim()) {
      const response = await fetch(params.fileUrl);
      if (!response.ok) {
        throw new VideoAnalysisFailure("decode", `下载上传视频失败: ${response.status}`);
      }
      buffer = Buffer.from(await response.arrayBuffer());
    } else if (typeof params.fileBase64 === "string" && params.fileBase64.trim()) {
      buffer = Buffer.from(params.fileBase64, "base64");
    } else {
      throw new VideoAnalysisFailure("decode", "缺少视频内容");
    }

    const safeName = (params.fileName || "video.mp4").replace(/[^a-z0-9._-]/gi, "-");
    if (!videoGcsUri) {
      const storedVideo = await uploadBufferToGcs({
        objectName: `growth-camp/videos/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`,
        buffer,
        contentType: params.mimeType || "video/mp4",
      });
      uploadedObjects.push(storedVideo.objectName);
      videoGcsUri = storedVideo.gcsUri;
    }

    const result = await withTempVideo(buffer, async (videoPath) => {
      const duration = await getVideoDurationFromPath(videoPath);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new VideoAnalysisFailure("decode", "无法读取视频时长");
      }

      const chunkRanges = buildChunkRanges(duration);
      const isExtractOnly = params.analysisProfile === "extract_only";

      if (isExtractOnly) {
        const extractResult = await runExtractOnlyPipeline({
          videoPath,
          duration,
          safeName,
          chunkRanges,
          strategistEngine,
          videoGcsUri,
          context: params.context,
          fileName: params.fileName,
          extractPrompt: params.extractPrompt,
          mode: params.mode === "REMIX" ? "REMIX" : "GROWTH",
        });
        return {
          analysis: extractResult.analysis,
          videoMeta: {
            videoUrl: videoGcsUri,
            audioUrl: "",
            transcript: extractResult.transcript,
            videoDuration: duration,
            provider: resolveGrowthCampGpt55Engine().provider,
            model: resolveGrowthCampGpt55Engine().modelName,
            fallback: false,
            pipeline: "extract_only_flash_scan_gpt55_visual_summary",
            stageOneModel: resolveGrowthCampExtractScanEngine().modelName,
            stageTwoModel: resolveGrowthCampGpt55Engine().modelName,
            sparseFrameCount: extractResult.sparseFrameCount,
            estimatedCostProfile: extractResult.costProfile,
            failureStage: undefined,
            failureReason: undefined,
          },
        };
      }

      const transcriptChunks: string[] = [];
      const audioPassChunks: AudioFirstPass[] = [];
      const visualPassChunks: VisualFirstPass[] = [];
      const allFrames: SparseFrame[] = [];

      for (const chunk of chunkRanges) {
        const audioBuffer = await extractAudioTrackFromPath(videoPath, chunk.start, chunk.duration).catch((error) => {
          console.warn("[growth.analyzeVideo] audio extraction failed:", error);
          return null;
        });

        const transcriptChunk = await transcribeVideoAudio(audioBuffer).catch((error) => {
          console.warn("[growth.analyzeVideo] transcript fallback:", error);
          return "";
        });
        if (transcriptChunk) {
          transcriptChunks.push(`[${toTimestamp(chunk.start)}-${toTimestamp(chunk.start + chunk.duration)}]\n${transcriptChunk}`);
        }

        if (audioBuffer) {
          const audioStorage = await uploadBufferToGcs({
            objectName: `growth-camp/audio/${Date.now()}-${chunk.index}-${safeName.replace(/\.[^.]+$/, "")}.mp3`,
            buffer: audioBuffer,
            contentType: "audio/mpeg",
          });
          uploadedObjects.push(audioStorage.objectName);
          const audioPass = await withGrowthAnalysisSlot(() => runAudioFirstPass({
            audioGcsUri: audioStorage.gcsUri,
            transcript: transcriptChunk,
            duration: chunk.duration,
            context: params.context,
            fileName: `${params.fileName || "video"}#${chunk.index + 1}`,
          }));
          audioPassChunks.push(audioPass);
        }

        // ✨ GROWTH / REMIX 模式用 slim 策略（≥5min=8帧 / <5min=10帧），降本提速
        const frameStrategy: SparseFrameStrategy = (params.mode === "GROWTH" || params.mode === "REMIX") ? "slim" : "dense";
        const sparseFrames = await extractSparseFramesFromPath(videoPath, chunk.start, chunk.duration, frameStrategy).catch((error) => {
          console.warn("[growth.analyzeVideo] sparse frame extraction failed:", error);
          throw new VideoAnalysisFailure("frame_extraction", normalizeFailureReason(error));
        });
        allFrames.push(...sparseFrames.frames);

        const visualPass = await withGrowthAnalysisSlot(() => runVisualFirstPass({
          sparseFrames: sparseFrames.frames,
          context: params.context,
          duration: chunk.duration,
          fileName: `${params.fileName || "video"}#${chunk.index + 1}`,
        }).catch((error) => {
          console.warn("[growth.analyzeVideo] visual first pass failed:", error);
          throw new VideoAnalysisFailure("llm", normalizeFailureReason(error));
        }));
        visualPassChunks.push(visualPass);
      }

      const transcript = transcriptChunks.join("\n\n");
      const analysisModePre = params.mode === "REMIX" ? "REMIX" : "GROWTH";
      const costProfile = estimateTokenProfile(duration, allFrames.length);

      const audioFirstPass = mergeAudioPasses(audioPassChunks);
      const visualFirstPass = mergeVisualPasses(visualPassChunks);
      // 长视频 REMIX 模式：缩减抽帧数量，降低 LLM 推理时间，避免触发 Fly.io 60s proxy timeout
      const remixLongVideoFrameCap = analysisModePre === "REMIX" && duration > 480 ? 8 : undefined;
      const strategistFrames = remixLongVideoFrameCap
        ? pickStrategistFrames(allFrames).slice(0, remixLongVideoFrameCap)
        : pickStrategistFrames(allFrames);

      let deepDive = await withGrowthAnalysisSlot(() => runDeepDivePass({
        strategistEngine,
        sparseFrames: strategistFrames,
        audioFirstPass,
        visualFirstPass,
        transcript,
        duration,
        context: params.context,
        fileName: params.fileName,
        videoGcsUri,
        mode: params.mode === "REMIX" ? "REMIX" : "GROWTH",
      })) as Record<string, unknown>;

      // 实作残留清洗 (Data Wiping)
      // 如果是二次创作（REMIX）模式，强制将所有可能导致 UI 重复渲染的字段物理清空
      const analysisMode = params.mode === "REMIX" ? "REMIX" : "GROWTH";
      if (analysisMode === "REMIX") {
        // 诊断数组全部清空
        deepDive.keyFrames = [];
        deepDive.visualRisks = [];
        deepDive.strengths = [];
        deepDive.improvements = [];
        deepDive.timestampSuggestions = [];
        deepDive.weakFrameReferences = [];
        deepDive.openingFrameAssessment = "";
        deepDive.sceneConsistency = "";
        deepDive.visualSummary = "";
        deepDive.trustSignals = [];
        // 旧版「表达与配乐」直通字段清空，避免与 remixExpressionAnalysis / musicPrompt 重复渲染
        deepDive.languageExpression = "";
        deepDive.emotionalExpression = "";
        deepDive.cameraEmotionTension = "";
        deepDive.bgmAnalysis = "";
        deepDive.musicRecommendation = "";
        deepDive.sunoPrompt = "";
        // premiumContent 文本字段全部清空，防止前端二次渲染
        if (deepDive.premiumContent) {
          const pc = deepDive.premiumContent as {
            summary?: string;
            strategy?: string;
            explosiveTopicAnalysis?: string;
            musicAndExpressionAnalysis?: string;
          };
          pc.summary = "";
          pc.strategy = "";
          pc.explosiveTopicAnalysis = undefined;
          pc.musicAndExpressionAnalysis = "";
        }
      }

      deepDive = await ensureGrowthCoreScores(deepDive, {
        strategistEngine,
        context: params.context,
        evidenceText: JSON.stringify({
          durationSeconds: duration,
          transcriptExcerpt: truncate(transcript, 3000),
          audioFirstPass,
          visualFirstPass,
          realityCheck: deepDive.realityCheck,
          summary: deepDive.summary,
          platformScores: deepDive.platformScores,
          reverseEngineering: deepDive.reverseEngineering,
        }, null, 2),
      });

      const strategistRefinement = null;

      const remixStripFirstPassVisual = analysisMode === "REMIX";
      const parsed = parseGrowthAnalysisScores({
        ...deepDive,
        mode: analysisMode,
        ...(strategistRefinement || {}),
        visualSummary: remixStripFirstPassVisual
          ? ""
          : String(deepDive?.visualSummary || visualFirstPass.visualSummary || ""),
        openingFrameAssessment: remixStripFirstPassVisual
          ? ""
          : String(deepDive?.openingFrameAssessment || visualFirstPass.openingFrameAssessment || ""),
        sceneConsistency: remixStripFirstPassVisual
          ? ""
          : String(deepDive?.sceneConsistency || visualFirstPass.sceneConsistency || ""),
        trustSignals: remixStripFirstPassVisual
          ? []
          : Array.isArray(deepDive?.trustSignals) && deepDive.trustSignals.length
            ? deepDive.trustSignals
            : visualFirstPass.trustSignals,
        visualRisks: remixStripFirstPassVisual
          ? []
          : Array.isArray(deepDive?.visualRisks) && deepDive.visualRisks.length
            ? deepDive.visualRisks
            : visualFirstPass.visualRisks,
        keyFrames: remixStripFirstPassVisual
          ? []
          : Array.isArray(deepDive?.keyFrames) && deepDive.keyFrames.length
            ? deepDive.keyFrames
            : visualFirstPass.keyFrames,
      });

      return {
          analysis: parsed,
          videoMeta: {
            videoUrl: videoGcsUri,
            audioUrl: "",
            transcript,
          videoDuration: duration,
          provider: strategistEngine.provider,
          model: finalModel,
          fallback: false,
          pipeline: resolveGrowthCampPipelineMode(params.modelName),
          stageOneModel: growthCampFirstPassModel(),
          stageTwoModel: finalModel,
          sparseFrameCount: allFrames.length,
          estimatedCostProfile: costProfile,
          failureStage: undefined,
          failureReason: undefined,
        },
      };
    });

    return result;
  } catch (error) {
    if (error instanceof VideoAnalysisFailure) {
      throw error;
    }
    console.warn("[growth.analyzeVideo] video analysis failed:", error);
    throw new VideoAnalysisFailure("unknown", normalizeFailureReason(error));
  } finally {
    if (SHOULD_CLEAN_GCS_TEMP && uploadedObjects.length) {
      await Promise.all(uploadedObjects.map((objectName) =>
        deleteGcsObject({ objectName }).catch((error) => {
          console.warn("[growth.analyzeVideo] gcs cleanup failed:", objectName, error);
        })));
    }
  }
}

import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { type GrowthAnalysisScores, growthAnalysisScoresSchema } from "@shared/growth";
import { transcribeAudio } from "../_core/voiceTranscription";
import { invokeLLM } from "../_core/llm";
import { deleteGcsObject, downloadGcsObject, isGsUri, uploadBufferToGcs } from "../services/gcs";
import { storageRead } from "../storage";
import { resolveGrowthCampPipelineMode } from "./extractorPipeline";

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

const GROWTH_CAMP_FIRST_PASS_MODEL = "gemini-2.5-pro";
const GROWTH_CAMP_STRATEGIST_MODEL = "gemini-3.1-pro-preview";
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
  return GROWTH_CAMP_STRATEGIST_MODEL;
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

function buildSparseFrameTimestamps(duration: number) {
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

async function extractSparseFramesFromPath(videoPath: string, startSeconds = 0, durationSeconds?: number) {
  const boundedDuration = durationSeconds ?? await getVideoDurationFromPath(videoPath);
  const timestamps = buildSparseFrameTimestamps(boundedDuration);
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
    modelName: GROWTH_CAMP_FIRST_PASS_MODEL,
    messages: [
      {
        role: "system",
        content: `你是一位短视频内容策略分析师。你现在只做第一阶段“音频优先粗筛”，目标是用更低成本先判断这条视频值不值得深挖。

规则：
1. 优先依据音频和转写，不要假装看到了完整画面。
2. 重点识别：开头 hook、内容承诺、情绪转折、商业可承接性、需要深挖的秒点。
3. 所有时间点都必须返回 mm:ss。
4. creatorSignals 只写对创作者真正有帮助的经营信号，不写空话。
5. deepDiveBrief 要给第二阶段模型，告诉它应该重点看哪些画面、哪些段落、哪些商业问题。

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
  "transcriptSummary": "string"
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
              description: "仅限小红书、抖音、B站、快手，给出1-10分。绝对不可包含视频号",
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

  const parsed = JSON.parse(String(response.choices[0]?.message?.content || "{}"));
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
    modelName: GROWTH_CAMP_FIRST_PASS_MODEL,
    messages: [
      {
        role: "system",
        content: `你是一位短视频视觉策略分析师。你现在只做“关键帧视觉初判”，不要分析音频，不要假装看了完整视频。

规则：
1. 只能依据给你的关键帧做判断。
2. 必须判断开头画面是否足够抓人、人物/场景是否建立信任、画面风格是否统一、是否存在可直接转化的演示证据。
3. keyFrames 至少返回 4 条，时间点必须回 mm:ss。
4. 每条 keyFrame 都要回答：这帧展示了什么、可用于什么商业表达、问题是什么、怎么修。

只返回 JSON：
{
  "visualSummary": "string",
  "openingFrameAssessment": "string",
  "sceneConsistency": "string",
  "trustSignals": ["string"],
  "visualRisks": ["string"],
  "keyFrames": [
    {
      "timestamp": "00:08",
      "whatShows": "string",
      "commercialUse": "string",
      "issue": "string",
      "fix": "string"
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
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "growth_camp_strategist_output",
        strict: true,
        schema: {
          type: "object",
          properties: {
            composition: { type: "number" },
            color: { type: "number" },
            lighting: { type: "number" },
            impact: { type: "number" },
            viralPotential: { type: "number" },
            explosiveIndex: { type: "number" },
            platformScores: {
              type: "object",
              properties: {
                xiaohongshu: { type: "number" },
                douyin: { type: "number" },
                bilibili: { type: "number" },
                kuaishou: { type: "number" },
              },
              required: ["xiaohongshu", "douyin", "bilibili", "kuaishou"],
            },
            realityCheck: { type: "string" },
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
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      contentBrief: { type: "string" },
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
                commercialMatrix: { type: "string" },
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
            summary: { type: "string" },
            strengths: { type: "array", items: { type: "string" } },
            improvements: { type: "array", items: { type: "string" } },
            languageExpression: { type: "string" },
            emotionalExpression: { type: "string" },
            cameraEmotionTension: { type: "string" },
            bgmAnalysis: { type: "string" },
            musicRecommendation: { type: "string" },
            sunoPrompt: { type: "string" },
            titleSuggestions: { type: "array", items: { type: "string" } },
            creatorCenterSignals: { type: "array", items: { type: "string" } },
            timestampSuggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  timestamp: { type: "string" },
                  issue: { type: "string" },
                  fix: { type: "string" },
                  opportunity: { type: "string" },
                },
                required: ["timestamp", "issue", "fix"],
              },
            },
            weakFrameReferences: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  timestamp: { type: "string" },
                  reason: { type: "string" },
                  fix: { type: "string" },
                },
                required: ["timestamp", "reason", "fix"],
              },
            },
            commercialAngles: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  scenario: { type: "string" },
                  whyItFits: { type: "string" },
                  brands: { type: "array", items: { type: "string" } },
                  execution: { type: "string" },
                  hook: { type: "string" },
                  veoPrompt: { type: "string" },
                },
                required: ["title", "scenario", "whyItFits", "brands", "execution", "hook"],
              },
            },
            followUpPrompt: { type: "string" },
          },
          required: [
            "composition",
            "color",
            "lighting",
            "impact",
            "viralPotential",
            "explosiveIndex",
            "platformScores",
            "realityCheck",
            "reverseEngineering",
            "premiumContent",
          ],
        },
      },
    },
  });

  const parsed = JSON.parse(String(response.choices[0]?.message?.content || "{}"));
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
        }))
      : [],
  };
}

function buildFallbackVideoAnalysis(summary: string, context: string) {
  const normalized = `${summary}\n${context}`;
  const isCommercial = /品牌|招商|服务|转化|案例/.test(normalized);
  return growthAnalysisScoresSchema.parse({
    composition: 76,
    color: 78,
    lighting: 72,
    impact: 82,
    viralPotential: isCommercial ? 84 : 78,
    explosiveIndex: isCommercial ? 8 : 7,
    platformScores: {
      xiaohongshu: isCommercial ? 8 : 7,
      douyin: isCommercial ? 7 : 6,
      bilibili: isCommercial ? 8 : 7,
      kuaishou: isCommercial ? 6 : 6,
    },
    realityCheck: "当前内容有基础，但还没有强到可以靠自嗨拿结果。先把钩子、证据和商业承接三件事做实，再谈放大。",
    reverseEngineering: {
      hookStrategy: "先把结果或最扎心的问题丢到前两秒，不要先铺背景。",
      emotionalArc: "从不舒服或不确定切入，中段给动作和证据，结尾释放结果并给出唯一行动。",
      commercialLogic: "内容先证明你真的解决问题，再把用户导向私信、预约或服务介绍，不要只讲理念。",
    },
    premiumContent: {
      summary: "适合延展成更强情绪张力的二创脚本，让用户先停留，再被结果与人物信任带走。",
      topics: [
        {
          title: "把最痛的问题前置",
          contentBrief: "开头用近景人物状态和明确灯光反差，先拍不舒服或焦虑的状态，再切到解决后的松弛与结果。",
        },
        {
          title: "把方法讲成可代入的故事",
          contentBrief: "中段用柔和主光加侧逆光拍动作示范，镜头跟随人物完成一个动作闭环，字幕只保留最关键的一句结果解释。",
        },
      ],
    },
    growthStrategy: {
      gapAnalysis: "竞品常见问题是只讲观点不讲证据、只做情绪不做承接。你的机会在于把结果证据和用户场景讲清楚。",
      commercialMatrix: "短视频负责首发钩子，中长视频承接完整案例，图文笔记沉淀清单与购买理由，最后导向私信、预约或服务页。",
    },
    remixExecution: {
      hookLibrary: [
        "你以为你缺的是努力，其实你缺的是一个能被看懂的开头。",
        "这条视频如果前 3 秒不改，后面讲得再好也没人等。",
        "真正能成交的内容，第一句话就让用户知道和自己有关。",
      ],
      emotionalPacing: "前 3 秒制造问题感，10 秒内给出反差，中段补证据和动作，结尾给一个明确的行动出口。",
      visualPaletteAndScript: "用低饱和背景、干净主光和近景人物开场；每 5-8 秒切一次证据或动作画面；口播围绕问题、证据、结果推进。",
      productMatrix: "把内容拆成免费认知、低门槛资料、深度服务三层，不要一上来直接卖高价方案。",
      shootingGuidance: "短视频先拍一个强钩子和结果镜头；中长视频补完整故事、案例、方法；图文笔记用封面、清单和对比图承接搜索流量。",
      xiaohongshuLayout: "封面写结果和人群，正文先给痛点，再给三条方法，最后用评论区关键词或私信动作承接。",
    },
    visualSummary: "已完成关键帧抽取，但当前只保留保守视觉结论，建议重点看开头抓力、人物信任感和结果画面是否明确。",
    openingFrameAssessment: "开头最好在 2 秒内直接出现人物状态、痛点或结果，不要只给环境铺垫。",
    sceneConsistency: "人物、场景和动作示范需要统一服务于同一个结论，避免信息分散。",
    languageExpression: "当前语言表达以基础信息传达为主，但缺少更强的结果句、反差句和能直接刺中目标用户的短促表达。",
    emotionalExpression: "情绪表达偏稳，适合专业感建立，但如果想提高停留，需要在开头和结尾加更强的担忧、期待或结果释压。",
    cameraEmotionTension: "镜头信息足够，但情绪张力还不够集中。建议把开头镜头、动作镜头和结果镜头的情绪功能分得更明确。",
    bgmAnalysis: "当前保守分析无法确认真实 BGM 编排，建议优先选择不会压住口播的人声下垫型配乐，用节奏和质感来承接专业感。",
    musicRecommendation: "适合选择低频稳定、轻鼓点、带空气感钢琴或氛围 pad 的现代商业配乐；如果是健康、知识、咨询类内容，避免太热血或太戏剧化。",
    sunoPrompt: "Warm modern ambient corporate soundtrack, gentle pulse, soft piano, subtle electronic texture, calm confidence, premium wellness brand mood, supports spoken voiceover, no aggressive drops, 95 BPM.",
    trustSignals: [
      "真实人物出镜能建立信任。",
      "动作示范和前后对比比空镜头更容易承接转化。",
    ],
    visualRisks: [
      "如果开头先铺环境、后讲重点，停留会掉得很快。",
      "如果结果画面不够直接，用户会把它当成泛内容略过。",
    ],
    keyFrames: [],
    strengths: [
      "视频已经具备可拆解的节奏和视觉亮点。",
      "适合继续拆成平台适配版和商业承接版。",
      "可以沉淀为创作工作流的执行 brief。",
    ],
    improvements: [
      "建议进一步强化前三秒钩子和口播重点。",
      "需要更明确的平台版本策略和转化动作。",
      "最好把高潮段与 CTA 的连接再做紧一些。",
    ],
    platforms: ["抖音", "小红书", "B站"],
    summary: summary || "视频已完成基础音频优先分析，当前更适合围绕节奏、平台适配和商业承接来输出成长营报告。",
  });
}

function normalizePremiumTopics(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    title: String(item?.title || ""),
    contentBrief: String(item?.contentBrief || ""),
  })).filter((item) => item.title || item.contentBrief);
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
  const premiumTopics = normalizePremiumTopics(parsed?.premiumContent?.topics);
  const premiumSummary = String(parsed?.premiumContent?.summary || "");
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
    xiaohongshuLayout: String(parsed?.remixExecution?.xiaohongshuLayout || ""),
  };

  return {
    explosiveIndex: Number(parsed?.explosiveIndex || 0),
    platformScores,
    realityCheck: String(parsed?.realityCheck || ""),
    reverseEngineering,
    premiumContent: {
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
      : premiumTopics.slice(0, 3).map((item) => item.title).filter(Boolean),
    commercialAngles: Array.isArray(parsed?.commercialAngles) && parsed.commercialAngles.length
      ? parsed.commercialAngles
      : premiumTopics.slice(0, 3).map((item) => ({
          title: item.title || "二创方向",
          scenario: premiumSummary || "把原视频改造成更有情绪张力和商业承接的版本。",
          whyItFits: reverseEngineering.commercialLogic || "这条方向更容易建立信任并承接成交动作。",
          brands: [],
          execution: item.contentBrief || "把人物、灯光、场景和结果镜头重组成更能停留的脚本。",
          hook: reverseEngineering.hookStrategy || "先抛最刺痛的问题或结果。",
          veoPrompt: "",
        })),
    followUpPrompt: String(
      parsed?.followUpPrompt
      || `请基于以下商业拆解与二创方向，继续输出一版可直接拍摄的脚本：钩子策略：${reverseEngineering.hookStrategy}；情绪弧线：${reverseEngineering.emotionalArc}；商业逻辑：${reverseEngineering.commercialLogic}`,
    ),
  };
}

async function runDeepDivePass(params: {
  finalModel: string;
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
  const response = await invokeLLM({
    model: "pro",
    provider: "vertex",
    modelName: GROWTH_CAMP_STRATEGIST_MODEL,
    temperature: 0.7,
    topP: 0.9,
    messages: [
      {
        role: "system",
        content: `你是一位隐身于顶级网红与商业巨头背后的首席 IP 战略架构师。你精通行为经济学与传播心理学，眼中没有『内容』，只有『流量路径』与『转化效率』。

当前分析模式：${params.mode === "REMIX" ? "爆款拆解二创" : "商业成长营"}。

请执行以下核心任务并严格输出 JSON：
1. 爆款预判：结合 2.5 Pro 第一阶段音频与视觉数据、15 天大盘趋势和平台活动推流加成，冷酷评估视频是否在自嗨，给出 1-10 的综合爆款指数 explosiveIndex 与犀利现实查验 realityCheck。
2. 平台评分：platformScores 仅限小红书、抖音、B站、快手四个平台，必须分别给出 1-10 分。绝对不可输出视频号、头条、微信或其他平台。
3. 战略拆解：拆解视觉钩子、情绪起伏与底层变现逻辑 reverseEngineering。
4. 若为 GROWTH 模式：重点输出竞品漏网之鱼 gapAnalysis 与商业转化产品矩阵 commercialMatrix，矩阵必须包含短视频、中长视频、图文笔记的引流与转化埋点。
5. 若为 REMIX 模式：重点输出黄金三秒钩子库、情绪控制曲线、视觉调色盘与分镜复刻、产品矩阵设计、短/中长视频拍摄指导、小红书图文布局。
6. 1:1 二创：premiumContent.topics 提供 3-5 个高价值选题，contentBrief 必须包含秒数、画面、口播、灯光、场景与情绪，不要写空话。
7. 同时保留原有成长营报告字段，避免前端旧板块缺数据。

拒绝废话，给予极具商业杀伤力的干货。所有文字使用简体中文。`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `文件名：${params.fileName || "未命名视频"}`,
              `业务背景：${params.context?.trim() || "未提供"}`,
              `视频 GCS 地址：${params.videoGcsUri}`,
              `视频时长：${params.duration.toFixed(1)} 秒`,
              `稀疏关键帧数量：${params.sparseFrames.length}`,
              `第一阶段音频粗筛结论：\n${JSON.stringify(params.audioFirstPass, null, 2)}`,
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
              detail: index < 2 ? "high" as const : "auto" as const,
            },
          })),
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(String(response.choices[0]?.message?.content || "{}"));
  return {
    ...parsed,
    ...buildLegacyFieldsFromStrategist(parsed),
  };
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
  return JSON.parse(String(response.choices[0]?.message?.content || "{}")) as StrategistRefinement;
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
}): Promise<VideoAnalysisResult> {
  const uploadedObjects: string[] = [];
  try {
    const finalModel = resolveGrowthCampFinalModel(params.modelName);
    let buffer: Buffer;
    let videoGcsUri = "";
    if (typeof params.gcsUri === "string" && isGsUri(params.gcsUri)) {
      const storedObject = await downloadGcsObject({ gcsUri: params.gcsUri });
      buffer = storedObject.buffer;
      videoGcsUri = params.gcsUri;
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
        objectName: `growth-camp/videos/${Date.now()}-${safeName}`,
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

        const sparseFrames = await extractSparseFramesFromPath(videoPath, chunk.start, chunk.duration).catch((error) => {
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
          console.warn("[growth.analyzeVideo] visual first pass fallback:", error);
          return {
            visualSummary: "已抽取关键帧，但视觉初判失败，转入保守视觉判断。",
            openingFrameAssessment: "需重点复查开头是否足够直接、是否能一眼建立问题感。",
            sceneConsistency: "优先保证人物、场景和动作示范能建立信任。",
            trustSignals: [],
            visualRisks: [],
            keyFrames: sparseFrames.frames.slice(0, 4).map((item) => ({
              timestamp: toTimestamp(item.timestamp),
              whatShows: "关键帧已抽取，待进一步视觉判断。",
              commercialUse: "可用来承接人物状态、动作示范或前后对比。",
              issue: "视觉初判暂缺，需人工或下一轮模型补看。",
              fix: "优先检查开头帧、人物主体和结果证据帧。",
            })),
          };
        }));
        visualPassChunks.push(visualPass);
      }

      const transcript = transcriptChunks.join("\n\n");
      const audioFirstPass = mergeAudioPasses(audioPassChunks);
      const visualFirstPass = mergeVisualPasses(visualPassChunks);
      const strategistFrames = pickStrategistFrames(allFrames);

      const deepDive = await withGrowthAnalysisSlot(() => runDeepDivePass({
        finalModel,
        sparseFrames: strategistFrames,
        audioFirstPass,
        visualFirstPass,
        transcript,
        duration,
        context: params.context,
        fileName: params.fileName,
        videoGcsUri,
        mode: params.mode === "REMIX" ? "REMIX" : "GROWTH",
      }));

      const strategistRefinement = null;

      const parsed = growthAnalysisScoresSchema.parse({
        ...deepDive,
        ...(strategistRefinement || {}),
        visualSummary: String(deepDive?.visualSummary || visualFirstPass.visualSummary || ""),
        openingFrameAssessment: String(deepDive?.openingFrameAssessment || visualFirstPass.openingFrameAssessment || ""),
        sceneConsistency: String(deepDive?.sceneConsistency || visualFirstPass.sceneConsistency || ""),
        trustSignals: Array.isArray(deepDive?.trustSignals) && deepDive.trustSignals.length
          ? deepDive.trustSignals
          : visualFirstPass.trustSignals,
        visualRisks: Array.isArray(deepDive?.visualRisks) && deepDive.visualRisks.length
          ? deepDive.visualRisks
          : visualFirstPass.visualRisks,
        keyFrames: Array.isArray(deepDive?.keyFrames) && deepDive.keyFrames.length
          ? deepDive.keyFrames
          : visualFirstPass.keyFrames,
      });
      const costProfile = estimateTokenProfile(duration, allFrames.length);

      return {
          analysis: parsed,
          videoMeta: {
            videoUrl: videoGcsUri,
            audioUrl: "",
            transcript,
          videoDuration: duration,
          provider: "vertex",
          model: finalModel,
          fallback: false,
          pipeline: resolveGrowthCampPipelineMode(finalModel),
          stageOneModel: GROWTH_CAMP_FIRST_PASS_MODEL,
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

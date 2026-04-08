import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { type GrowthAnalysisScores, growthAnalysisScoresSchema } from "@shared/growth";
import { transcribeAudio } from "../_core/voiceTranscription";
import { invokeLLM } from "../_core/llm";
import { uploadBufferToGcs } from "../services/gcs";
import { storageRead } from "../storage";
import { validateDuration } from "../videoAnalysis";

const execFileAsync = promisify(execFile);

const AUDIO_FIRST_PASS_MODEL = "gemini-2.5-pro";
const VISUAL_FIRST_PASS_MODEL = "gemini-2.5-pro";
const AUDIO_TOKENS_PER_MINUTE = 1920;
const VIDEO_AUDIO_TOKENS_PER_MINUTE_AT_1FPS = 17700;
const TOKENS_PER_FRAME = Math.round((VIDEO_AUDIO_TOKENS_PER_MINUTE_AT_1FPS - AUDIO_TOKENS_PER_MINUTE) / 60);

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
  return String(
    modelName
      || process.env.GROWTH_CAMP_FINAL_MODEL
      || process.env.VERTEX_GROWTH_FINAL_MODEL
      || "gemini-2.5-pro",
  ).trim() || "gemini-2.5-pro";
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

async function extractAudioTrack(videoBuffer: Buffer) {
  return withTempVideo(videoBuffer, async (videoPath) => {
    const audioPath = videoPath.replace(/\.mp4$/, ".mp3");
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

      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        videoPath,
        "-vn",
        "-acodec",
        "libmp3lame",
        "-ar",
        "16000",
        "-ac",
        "1",
        audioPath,
      ]);

      return await fs.readFile(audioPath);
    } finally {
      await fs.unlink(audioPath).catch(() => undefined);
    }
  });
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

async function extractSparseFrames(videoBuffer: Buffer) {
  return withTempVideo(videoBuffer, async (videoPath) => {
    const duration = await getVideoDurationFromPath(videoPath);
    const timestamps = buildSparseFrameTimestamps(duration);
    const frameDir = path.join(
      os.tmpdir(),
      `growth-camp-frames-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(frameDir, { recursive: true });
    try {
      const frames: SparseFrame[] = [];
      for (let index = 0; index < timestamps.length; index += 1) {
        const timestamp = timestamps[index];
        const outPath = path.join(frameDir, `frame-${String(index).padStart(2, "0")}.jpg`);
        await execFileAsync("ffmpeg", [
          "-y",
          "-ss",
          String(timestamp),
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
          timestamp,
          dataUrl: `data:image/jpeg;base64,${frameBuffer.toString("base64")}`,
        });
      }
      return { duration, frames };
    } finally {
      await fs.rm(frameDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
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
    modelName: AUDIO_FIRST_PASS_MODEL,
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
    response_format: { type: "json_object" },
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
    modelName: VISUAL_FIRST_PASS_MODEL,
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
    response_format: { type: "json_object" },
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
}) {
  const response = await invokeLLM({
    model: "pro",
    provider: "vertex",
    modelName: params.finalModel,
    messages: [
      {
        role: "system",
        content: `你是一位资深短视频商业策略顾问兼生成式视频导演。你现在做第二阶段“深度洞察”，输入是：
1. 第一阶段的音频优先粗筛结论
2. 第一阶段的关键帧视觉初判
3. 稀疏关键帧
4. 转写摘录

规则：
1. 必须先吸收第一阶段音频结论和视觉结论，再用关键帧纠偏，不能把第二阶段写成重复摘要。
2. 不能假装看了完整逐帧视频；你的视觉判断只能来自提供的关键帧。
3. summary、strengths、improvements 至少一半要直接引用“音频结论、视觉结论或关键帧证据”。
4. 必须给出 3 到 5 个标题建议、至少 3 个具体秒点优化建议，以及 2 到 4 个 AI 资产延展方案（含 Veo prompt）。
5. 如果素材属于户外探店、美食旅行、人物体验这类商业视频，要优先回答“如何提高转化与复用”，而不是空泛讲故事。
6. 秒点建议必须回到 mm:ss。
7. weakFrameReferences 必须优先使用视觉初判里已经指出的问题帧，不要空写。

评分字段语义：
- composition: 叙事结构与段落组织
- color: 视觉包装与风格统一
- lighting: 信息清晰度与表达可读性
- impact: 节奏钩子与传播冲击力
- viralPotential: 商业放大与增长潜力

只返回 JSON：
{
  "composition": number,
  "color": number,
  "lighting": number,
  "impact": number,
  "viralPotential": number,
  "strengths": ["string"],
  "improvements": ["string"],
  "platforms": ["string"],
  "summary": "string",
  "titleSuggestions": ["string"],
  "creatorCenterSignals": ["string"],
  "timestampSuggestions": [
    { "timestamp": "00:19", "issue": "string", "fix": "string", "opportunity": "string" }
  ],
  "weakFrameReferences": [
    { "timestamp": "00:08", "reason": "string", "fix": "string" }
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

  return JSON.parse(String(response.choices[0]?.message?.content || "{}"));
}

export async function analyzeVideo(params: {
  fileBase64?: string;
  fileUrl?: string;
  fileKey?: string;
  mimeType: string;
  fileName?: string;
  context?: string;
  modelName?: string;
}): Promise<VideoAnalysisResult> {
  try {
    const finalModel = resolveGrowthCampFinalModel(params.modelName);
    let buffer: Buffer;
    if (typeof params.fileKey === "string" && params.fileKey.trim()) {
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

    const duration = await withTempVideo(buffer, getVideoDurationFromPath);
    const validation = validateDuration(duration);
    if (!validation.valid) {
      throw new VideoAnalysisFailure("decode", validation.error || "视频时长不符合要求");
    }

    const safeName = (params.fileName || "video.mp4").replace(/[^a-z0-9._-]/gi, "-");
    const storedVideo = await uploadBufferToGcs({
      objectName: `growth-camp/videos/${Date.now()}-${safeName}`,
      buffer,
      contentType: params.mimeType || "video/mp4",
    });

    const audioBuffer = await extractAudioTrack(buffer).catch((error) => {
      console.warn("[growth.analyzeVideo] audio extraction failed:", error);
      return null;
    });
    const audioStorage = audioBuffer
      ? await uploadBufferToGcs({
          objectName: `growth-camp/audio/${Date.now()}-${safeName.replace(/\.[^.]+$/, "")}.mp3`,
          buffer: audioBuffer,
          contentType: "audio/mpeg",
        })
      : null;

    let sparseFrames;
    try {
      sparseFrames = await extractSparseFrames(buffer);
    } catch (error) {
      console.warn("[growth.analyzeVideo] sparse frame extraction failed:", error);
      throw new VideoAnalysisFailure("frame_extraction", normalizeFailureReason(error));
    }

    const transcript = await transcribeVideoAudio(audioBuffer).catch((error) => {
      console.warn("[growth.analyzeVideo] transcript fallback:", error);
      return "";
    });

    const audioFirstPass = audioStorage
      ? await runAudioFirstPass({
          audioGcsUri: audioStorage.gcsUri,
          transcript,
          duration,
          context: params.context,
          fileName: params.fileName,
        })
      : {
          valueTier: "medium" as const,
          contentSummary: transcript ? truncate(transcript, 300) : "无音轨，转入视觉优先保守判断。",
          hookSummary: "未检测到可靠音轨证据，需要更多依靠视觉结构判断。",
          audiencePromise: "",
          commercialPotential: 60,
          creatorSignals: [],
          priorityMoments: [],
          riskMoments: [],
          deepDiveBrief: "优先根据关键帧判断开头是否有明确 hook、信息承诺和商业承接动作。",
          transcriptSummary: transcript ? truncate(transcript, 500) : "",
        };

    const visualFirstPass = await runVisualFirstPass({
      sparseFrames: sparseFrames.frames,
      context: params.context,
      duration,
      fileName: params.fileName,
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
    });

    const deepDive = await runDeepDivePass({
      finalModel,
      sparseFrames: sparseFrames.frames,
      audioFirstPass,
      visualFirstPass,
      transcript,
      duration,
      context: params.context,
      fileName: params.fileName,
      videoGcsUri: storedVideo.gcsUri,
    });

    const parsed = growthAnalysisScoresSchema.parse(deepDive);
    const costProfile = estimateTokenProfile(duration, sparseFrames.frames.length);

    return {
      analysis: parsed,
      videoMeta: {
        videoUrl: storedVideo.gcsUri,
        audioUrl: audioStorage?.gcsUri || "",
        transcript,
        videoDuration: duration,
        provider: "vertex",
        model: finalModel,
        fallback: false,
        pipeline: "audio-first-sparse-frames-two-stage",
        stageOneModel: AUDIO_FIRST_PASS_MODEL,
        stageTwoModel: finalModel,
        sparseFrameCount: sparseFrames.frames.length,
        estimatedCostProfile: costProfile,
        failureStage: undefined,
        failureReason: undefined,
      },
    };
  } catch (error) {
    if (error instanceof VideoAnalysisFailure) {
      throw error;
    }
    console.warn("[growth.analyzeVideo] video analysis failed:", error);
    throw new VideoAnalysisFailure("unknown", normalizeFailureReason(error));
  }
}

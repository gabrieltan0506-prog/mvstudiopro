import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { type GrowthAnalysisScores, growthAnalysisScoresSchema } from "@shared/growth";
import { transcribeAudio } from "../_core/voiceTranscription";
import { invokeLLM } from "../_core/llm";
import { storagePut } from "../storage";
import { uploadBufferToGcs } from "../services/gcs";
import { validateDuration } from "../videoAnalysis";

const execFileAsync = promisify(execFile);

function resolveGrowthCampFinalModel(modelName?: string): string {
  return String(
    modelName
      || process.env.GROWTH_CAMP_FINAL_MODEL
      || process.env.VERTEX_GROWTH_FINAL_MODEL
      || "gemini-2.5-pro",
  ).trim() || "gemini-2.5-pro";
}

type VideoAnalysisResult = {
  analysis: GrowthAnalysisScores;
  videoMeta: {
    videoUrl: string;
    transcript: string;
    videoDuration: number;
    provider: string;
    model: string;
    fallback: boolean;
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

async function transcribeVideoAudio(videoBuffer: Buffer): Promise<string> {
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
        console.info("[growth.analyzeVideo] no audio stream detected, skip transcription");
        return "";
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

      const audioBuffer = await fs.readFile(audioPath);
      const transcription = await transcribeAudio({
        audioBase64: audioBuffer.toString("base64"),
        mimeType: "audio/mpeg",
        language: "zh",
        prompt: "请转写视频里的口播、字幕或关键信息。",
      });

      if ("text" in transcription && typeof transcription.text === "string") {
        return transcription.text.trim();
      }

      return "";
    } catch (error) {
      console.warn("[growth.analyzeVideo] transcript fallback:", error);
      return "";
    } finally {
      await fs.unlink(audioPath).catch(() => undefined);
    }
  });
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

async function extractKeyframes(videoBuffer: Buffer) {
  return withTempVideo(videoBuffer, async (videoPath) => {
    const duration = await getVideoDurationFromPath(videoPath);
    const timestamps = Array.from(
      new Set([
        Math.max(0.2, Math.min(duration * 0.12, Math.max(duration - 0.2, 0.2))),
        Math.max(0.2, Math.min(duration * 0.32, Math.max(duration - 0.2, 0.2))),
        Math.max(0.2, Math.min(duration * 0.58, Math.max(duration - 0.2, 0.2))),
        Math.max(0.2, Math.min(duration * 0.84, Math.max(duration - 0.2, 0.2))),
      ].map((value) => Number(value.toFixed(3)))),
    );
    const frameDir = path.join(
      os.tmpdir(),
      `growth-camp-frames-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(frameDir, { recursive: true });
    try {
      const frames: Array<{ timestamp: number; dataUrl: string; storageUrl: string }> = [];
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
          "-q:v",
          "3",
          outPath,
        ]);
        const frameBuffer = await fs.readFile(outPath);
        const stored = await storagePut(
          `growth-camp/frames/${Date.now()}-${index}.jpg`,
          frameBuffer,
          "image/jpeg",
        );
        frames.push({
          timestamp,
          dataUrl: `data:image/jpeg;base64,${frameBuffer.toString("base64")}`,
          storageUrl: stored.url,
        });
      }
      return { duration, frames };
    } finally {
      await fs.rm(frameDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
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
    summary: summary || "视频已完成基础多帧分析，当前更适合围绕节奏、平台适配和商业承接来输出成长营报告。",
  });
}

function normalizeFailureReason(error: unknown) {
  if (error instanceof Error) {
    return error.message || error.name || "未知错误";
  }
  return String(error || "未知错误");
}

function formatFrameEvidence(
  frameAnalyses: Array<{
    frameIndex: number;
    timestamp: number;
    frameScore: number;
    analysis: { detail: string };
  }>,
  mode: "strong" | "weak",
  limit: number,
) {
  const sorted = [...frameAnalyses].sort((a, b) =>
    mode === "strong"
      ? b.frameScore - a.frameScore
      : a.frameScore - b.frameScore,
  );

  return sorted
    .slice(0, limit)
    .map((item) => `第${item.frameIndex + 1}帧 ${item.timestamp.toFixed(1)}s（${item.frameScore}分）：${item.analysis.detail}`)
    .join("\n");
}

export async function analyzeVideo(params: {
  fileBase64?: string;
  fileUrl?: string;
  mimeType: string;
  fileName?: string;
  context?: string;
  modelName?: string;
}): Promise<VideoAnalysisResult> {
  try {
    const finalModel = resolveGrowthCampFinalModel(params.modelName);
    let buffer: Buffer;
    if (typeof params.fileBase64 === "string" && params.fileBase64.trim()) {
      buffer = Buffer.from(params.fileBase64, "base64");
    } else if (typeof params.fileUrl === "string" && params.fileUrl.trim()) {
      const response = await fetch(params.fileUrl);
      if (!response.ok) {
        throw new VideoAnalysisFailure("decode", `下载上传视频失败: ${response.status}`);
      }
      buffer = Buffer.from(await response.arrayBuffer());
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
    let keyframes;
    try {
      keyframes = await extractKeyframes(buffer);
    } catch (error) {
      console.warn("[growth.analyzeVideo] keyframe extraction failed:", error);
      throw new VideoAnalysisFailure("frame_extraction", normalizeFailureReason(error));
    }

    const transcript = await transcribeVideoAudio(buffer).catch((error) => {
      console.warn("[growth.analyzeVideo] transcript fallback:", error);
      return "";
    });

    const response = await invokeLLM({
      model: "pro",
      provider: "vertex",
      modelName: finalModel,
      messages: [
        {
          role: "system",
          content: `你是一位资深短视频商业策略顾问兼生成式视频导演。请根据关键帧、时间点证据、转写内容和用户身份，返回 Creator Growth Camp 的统一分析结构。

注意：
0. 必须优先依据“关键帧 / 时间点 / 转写”做判断，不能只根据业务背景给建议。summary、strengths、improvements 里至少要有一半内容直接来自画面或转写证据。
1. 如果没有音轨或转写为空，只能依据关键帧和画面结构做判断，不能编造口播内容。
2. 不要输出互相矛盾的建议。低成熟度阶段先给短期验证路径，不要同时堆多个商业化方向。
3. 严禁输出与用户身份无关的泛模板路径，例如户外运动/美食博主不应该默认给知识付费、社群会员。商业方向必须直接解释“为什么适合这个用户”和“为什么是这条视频”。
4. 必须给出 3 到 5 个标题建议、至少 3 个具体秒点优化建议，以及 2 到 4 个 AI 资产延展方案（含 Veo prompt）。
5. 输出要像真人顾问在给初步解决方案，不要只说“讲清楚、重构、优化”，而要说明怎么改、改哪一秒、为什么这样改。
6. 如果用户上传的是跨域素材，例如户外/旅行/美食博主上传比赛、赛事、风景或社会事件视频，你必须先回答“这条素材怎么借回原业务”，而不是直接跳到卖课、社群或咨询。

评分字段语义：
- composition: 叙事结构与段落组织
- color: 视觉包装与风格统一
- lighting: 信息清晰度与表达可读性
- impact: 节奏钩子与传播冲击力
- viralPotential: 商业放大与增长潜力

summary 必须覆盖：
- 画面节奏
- 视觉亮点
- 叙事结构
- 口播/字幕重点
- 商业转化潜力
- 平台适配建议
- 创作延展方向

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
    {
      "timestamp": "00:19",
      "issue": "string",
      "fix": "string",
      "opportunity": "string"
    }
  ],
  "weakFrameReferences": [
    {
      "timestamp": "00:08",
      "reason": "string",
      "fix": "string"
    }
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
                `视频 GCS 地址：${storedVideo.gcsUri}`,
                `视频时长：${duration.toFixed(1)} 秒`,
                `关键帧时间点：${keyframes.frames.map((item, index) => `第${index + 1}帧 ${item.timestamp.toFixed(1)}s`).join("；")}`,
                transcript ? `口播/字幕转写：\n${transcript.slice(0, 5000)}` : "口播/字幕转写：暂无或转写失败",
              ].join("\n\n"),
            },
            {
              type: "file_url" as const,
              file_url: {
                url: storedVideo.gcsUri,
                mime_type: (params.mimeType === "video/quicktime" ? "video/quicktime" : "video/mp4"),
              },
            },
            ...keyframes.frames.map((item, index) => ({
              type: "image_url" as const,
              image_url: {
                url: item.dataUrl,
                detail: index === 0 ? "high" as const : "auto" as const,
              },
            })),
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(String(response.choices[0]?.message?.content || "{}"));
    return {
      analysis: growthAnalysisScoresSchema.parse(parsed),
      videoMeta: {
        videoUrl: storedVideo.gcsUri,
        transcript,
        videoDuration: duration,
        provider: response.provider || "unknown",
        model: response.model || "unknown",
        fallback: false,
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

import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { type GrowthAnalysisScores, growthAnalysisScoresSchema } from "@shared/growth";
import { analyzeVideoMultiFrameFromLocalFile } from "../videoAnalysis";
import { transcribeAudio } from "../_core/voiceTranscription";
import { invokeLLM } from "../_core/llm";

const execFileAsync = promisify(execFile);

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

function buildVideoFallbackResult(params: {
  mimeType: string;
  context?: string;
  summary?: string;
  transcript?: string;
  videoDuration?: number;
  failureStage: VideoFailureStage;
  failureReason: string;
}): VideoAnalysisResult {
  return {
    analysis: buildFallbackVideoAnalysis(params.summary || "", params.context || ""),
    videoMeta: {
      videoUrl: "",
      transcript: params.transcript || "",
      videoDuration: params.videoDuration || 0,
      provider: "fallback",
      model: "deterministic",
      fallback: true,
      failureStage: params.failureStage,
      failureReason: params.failureReason,
    },
  };
}

export async function analyzeVideo(params: {
  fileBase64: string;
  mimeType: string;
  fileName?: string;
  context?: string;
}): Promise<VideoAnalysisResult> {
  try {
    const buffer = Buffer.from(params.fileBase64, "base64");
    const videoUrl = `data:${params.mimeType};base64,${params.fileBase64}`;
    let multiFrame;
    try {
      multiFrame = await withTempVideo(buffer, async (videoPath) => analyzeVideoMultiFrameFromLocalFile(videoPath));
    } catch (error) {
      console.warn("[growth.analyzeVideo] frame extraction fallback:", error);
      return buildVideoFallbackResult({
        mimeType: params.mimeType,
        context: params.context,
        failureStage: "frame_extraction",
        failureReason: normalizeFailureReason(error),
      });
    }

    const transcript = await transcribeVideoAudio(buffer).catch((error) => {
      console.warn("[growth.analyzeVideo] transcript fallback:", error);
      return "";
    });
    const frameHighlights = multiFrame.frameAnalyses
      .filter((item) => !item.dropped)
      .slice(0, 6)
      .map((item) => `第${item.frameIndex + 1}帧 ${item.timestamp.toFixed(1)}s：${item.analysis.detail}`)
      .join("\n");

    const response = await invokeLLM({
      model: "pro",
      provider: "vertex",
      messages: [
        {
          role: "system",
          content: `你是一位创作者商业增长顾问。请根据视频多帧分析结果和转写内容，返回 Creator Growth Camp 的统一分析结构。

注意：
0. 必须优先依据“多帧综合摘要 / 亮点 / 改进 / 帧细节 / 转写”做判断，不能只根据业务背景给建议。summary、strengths、improvements 里至少要有一半内容直接来自画面或转写证据。
1. 如果没有音轨或转写为空，只能依据关键帧和画面结构做判断，不能编造口播内容。
2. 不要输出互相矛盾的建议。低成熟度阶段先给短期验证路径，不要同时堆多个商业化方向。

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
  "summary": "string"
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
                `视频时长：${multiFrame.videoDuration.toFixed(1)} 秒`,
                `多帧综合摘要：${multiFrame.summary}`,
                `亮点：${multiFrame.highlights.join("；")}`,
                `改进：${multiFrame.improvements.join("；")}`,
                `帧细节：\n${frameHighlights}`,
                transcript ? `口播/字幕转写：\n${transcript.slice(0, 5000)}` : "口播/字幕转写：暂无或转写失败",
              ].join("\n\n"),
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(String(response.choices[0]?.message?.content || "{}"));
    return {
      analysis: growthAnalysisScoresSchema.parse(parsed),
      videoMeta: {
        videoUrl,
        transcript,
        videoDuration: multiFrame.videoDuration,
        provider: response.provider || "unknown",
        model: response.model || "unknown",
        fallback: false,
      },
    };
  } catch (error) {
    console.warn("[growth.analyzeVideo] Falling back to deterministic analysis:", error);
    return buildVideoFallbackResult({
      mimeType: params.mimeType,
      context: params.context,
      failureStage: "unknown",
      failureReason: normalizeFailureReason(error),
    });
  }
}

import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { type GrowthAnalysisScores, growthAnalysisScoresSchema } from "@shared/growth";
import { storagePut } from "../storage";
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
  };
};

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
      const { url: audioUrl } = await storagePut(
        `growth-camp/audio/${Date.now()}-${path.basename(audioPath)}`,
        audioBuffer,
        "audio/mpeg",
      );

      const transcription = await transcribeAudio({
        audioUrl,
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

export async function analyzeVideo(params: {
  fileBase64: string;
  mimeType: string;
  fileName?: string;
  context?: string;
}): Promise<VideoAnalysisResult> {
  const buffer = Buffer.from(params.fileBase64, "base64");
  const keyName = params.fileName || `video-${Date.now()}.mp4`;
  const { url: videoUrl } = await storagePut(`growth-camp/videos/${Date.now()}-${keyName}`, buffer, params.mimeType);
  const multiFrame = await withTempVideo(buffer, async (videoPath) => analyzeVideoMultiFrameFromLocalFile(videoPath));
  const transcript = await transcribeVideoAudio(buffer).catch(() => "");
  const frameHighlights = multiFrame.frameAnalyses
    .filter((item) => !item.dropped)
    .slice(0, 6)
    .map((item) => `第${item.frameIndex + 1}帧 ${item.timestamp.toFixed(1)}s：${item.analysis.detail}`)
    .join("\n");

  try {
    const response = await invokeLLM({
      model: "pro",
      messages: [
        {
          role: "system",
          content: `你是一位创作者商业增长顾问。请根据视频多帧分析结果和转写内容，返回 Creator Growth Camp 的统一分析结构。

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
    return {
      analysis: buildFallbackVideoAnalysis(multiFrame.summary, params.context || ""),
      videoMeta: {
        videoUrl,
        transcript,
        videoDuration: multiFrame.videoDuration,
        provider: "fallback",
        model: "deterministic",
        fallback: true,
      },
    };
  }
}

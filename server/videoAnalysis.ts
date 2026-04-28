/**
 * 视频多帧分析模块
 *
 * 抽帧策略：
 * - 基础层：按 3 秒 1 帧均匀抽样，使用向上取整
 * - 高潮层：识别张力最高的时间区间后，对该区间按 1 秒 1 帧补采样
 * - 所有帧都参与分析，不再丢弃低分帧
 *
 * 低分帧会保留给 Growth Camp 作为“弱帧参考”，提示用户具体在哪几秒优化。
 */

import { invokeLLM } from "./_core/llm";
import { storagePut } from "./storage";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import sharp from "sharp";

const execAsync = promisify(exec);

// ─── 常量 ──────────────────────────────────────────
const MAX_DURATION_SECONDS = 1200; // 20 分钟
const SHORT_VIDEO_THRESHOLD = 300; // 5 分钟
const BASE_FRAME_INTERVAL_SECONDS = 3;
const HIGHLIGHT_PADDING_SECONDS = 2;
const HIGHLIGHT_MIN_SPAN_SECONDS = 4;

// ─── 类型定义 ──────────────────────────────────────
export interface FrameAnalysis {
  frameIndex: number;
  timestamp: number; // 秒
  imageUrl: string;
  dropped: boolean;  // 为兼容旧链路保留，当前固定为 false
  frameScore: number; // 该帧的综合分数
  analysis: {
    composition: number;     // 构图 0-100
    colorGrading: number;    // 色彩 0-100
    lighting: number;        // 光线 0-100
    emotionalImpact: number; // 情感冲击力 0-100
    technicalQuality: number; // 技术质量 0-100
    narrativeValue: number;  // 叙事价值 0-100
    detail: string;          // 详细分析文本
  };
}

export interface ScoringStrategy {
  totalExtracted: number;   // 抽取总帧数
  droppedCount: number;     // 兼容旧口径，当前固定为 0
  scoringFrames: number;    // 计分帧数
  durationCategory: "short" | "long"; // 时长类别
  durationSeconds: number;
  baseFrameIntervalSeconds: number;
  highlightRange?: { start: number; end: number; extraFrames: number };
}

export interface MultiFrameResult {
  totalFrames: number;
  extractedFrames: number;
  videoDuration: number;
  scoringStrategy: ScoringStrategy;
  frameAnalyses: FrameAnalysis[];
  overallVisualScore: number;
  dimensionScores: {
    openingAttraction: { score: number; detail: string };
    visualComposition: { score: number; detail: string };
    colorAndLighting: { score: number; detail: string };
    rhythmAndPacing: { score: number; detail: string };
    climaxImpact: { score: number; detail: string };
    endingClosure: { score: number; detail: string };
    consistency: { score: number; detail: string };
  };
  summary: string;
  highlights: string[];
  improvements: string[];
}

export type ProgressCallback = (stage: string, progress: number, detail?: string) => void;

// ─── 获取视频时长 ──────────────────────────────────
async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
  );
  return parseFloat(stdout.trim()) || 0;
}

// ─── 验证视频时长 ──────────────────────────────────
export function validateDuration(durationSeconds: number): {
  valid: boolean;
  error?: string;
  strategy?: ScoringStrategy;
} {
  if (durationSeconds > MAX_DURATION_SECONDS) {
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = Math.round(durationSeconds % 60);
    return {
      valid: false,
      error: `视频时长 ${minutes}分${seconds}秒 超过 20 分钟限制。请将视频裁剪为两段（每段不超过 20 分钟）后分别上传。`,
    };
  }

  if (durationSeconds <= 0) {
    return { valid: false, error: "无法读取视频时长，请确认视频文档完整。" };
  }

  const isShort = durationSeconds <= SHORT_VIDEO_THRESHOLD;
  const baseFrames = Math.ceil(durationSeconds / BASE_FRAME_INTERVAL_SECONDS);
  const strategy: ScoringStrategy = {
    totalExtracted: baseFrames,
    droppedCount: 0,
    scoringFrames: baseFrames,
    durationCategory: isShort ? "short" : "long",
    durationSeconds,
    baseFrameIntervalSeconds: BASE_FRAME_INTERVAL_SECONDS,
  };

  return { valid: true, strategy };
}

// ─── 从视频中抽取帧 ────────────────────────────────
function buildBaseTimestamps(duration: number): number[] {
  const totalFrames = Math.ceil(duration / BASE_FRAME_INTERVAL_SECONDS);
  if (totalFrames <= 1) {
    return [Math.max(0, Math.min(duration, duration / 2 || 0.1))];
  }

  const startOffset = Math.min(0.5, duration * 0.02);
  const endOffset = Math.min(0.5, duration * 0.02);
  const usableDuration = Math.max(0.1, duration - startOffset - endOffset);
  const interval = usableDuration / Math.max(1, totalFrames - 1);
  return Array.from({ length: totalFrames }, (_, index) =>
    Number((startOffset + interval * index).toFixed(3))
  );
}

function buildHighlightTimestamps(
  frameAnalyses: FrameAnalysis[],
  duration: number,
  existingTimestamps: number[]
): { timestamps: number[]; range?: { start: number; end: number; extraFrames: number } } {
  if (frameAnalyses.length === 0) {
    return { timestamps: [] };
  }

  const strongestFrame = [...frameAnalyses].sort((a, b) => b.frameScore - a.frameScore)[0];
  const start = Math.max(0, Math.floor(strongestFrame.timestamp) - HIGHLIGHT_PADDING_SECONDS);
  const end = Math.min(
    Math.ceil(duration),
    Math.max(start + HIGHLIGHT_MIN_SPAN_SECONDS, Math.ceil(strongestFrame.timestamp) + HIGHLIGHT_PADDING_SECONDS)
  );

  const extra = new Set<number>();
  for (let second = start; second <= end; second += 1) {
    const exists = existingTimestamps.some((ts) => Math.abs(ts - second) < 0.45);
    if (!exists) {
      extra.add(Number(second.toFixed(3)));
    }
  }

  return {
    timestamps: Array.from(extra).sort((a, b) => a - b),
    range: extra.size > 0 ? { start, end, extraFrames: extra.size } : undefined,
  };
}

async function extractFramesAtTimestamps(
  videoPath: string,
  timestamps: number[],
  label: string,
  onProgress?: ProgressCallback
): Promise<{ framePaths: string[]; duration: number }> {
  const duration = await getVideoDuration(videoPath);
  if (duration <= 0) throw new Error("无法读取视频时长");

  // 验证时长
  const validation = validateDuration(duration);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // 创建临时目录
  const tmpDir = path.join(os.tmpdir(), `mv-frames-${Date.now()}`);
  await fs.promises.mkdir(tmpDir, { recursive: true });

  const framePaths: string[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const outPath = path.join(tmpDir, `frame_${String(i).padStart(3, "0")}.jpg`);

    onProgress?.(
      "extracting",
      Math.round(((i + 1) / timestamps.length) * 100),
      `正在抽取${label}第 ${i + 1}/${timestamps.length} 帧（${ts.toFixed(1)}s）`
    );

    await execAsync(
      `ffmpeg -ss ${ts.toFixed(3)} -i "${videoPath}" -vframes 1 -q:v 2 -y "${outPath}" 2>/dev/null`
    );

    if (fs.existsSync(outPath)) {
      framePaths.push(outPath);
    }
  }

  return { framePaths, duration };
}

// ─── 下载视频到临时文件 ────────────────────────────
async function downloadVideo(
  videoUrl: string,
  onProgress?: ProgressCallback
): Promise<string> {
  onProgress?.("downloading", 0, "正在下载视频文档...");

  const tmpPath = path.join(os.tmpdir(), `mv-video-${Date.now()}.mp4`);

  // Use fetch to download
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`下载视频失败: ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(tmpPath, buffer);

  onProgress?.("downloading", 100, "视频下载完成");
  return tmpPath;
}

// ─── 上传帧图片到存储，并生成内联数据供 Vertex 使用 ──────────────────────────────
async function uploadFrame(
  framePath: string,
  index: number
): Promise<{ url: string; dataUrl: string }> {
  const originalBuffer = await fs.promises.readFile(framePath);
  let buffer = originalBuffer;
  try {
    buffer = await sharp(originalBuffer, { failOnError: false })
      .resize({
        width: 1280,
        height: 1280,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 72,
        mozjpeg: true,
      })
      .toBuffer();
  } catch {
    buffer = originalBuffer;
  }
  const key = `video-frames/${Date.now()}_frame_${index}.jpg`;
  const { url } = await storagePut(key, buffer, "image/jpeg");
  return {
    url,
    dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`,
  };
}

// ─── AI 分析单帧 ───────────────────────────────────
async function analyzeFrame(
  imageUrl: string,
  imageDataUrl: string,
  frameIndex: number,
  totalFrames: number,
  timestamp: number,
  videoDuration: number
): Promise<FrameAnalysis["analysis"]> {
  // 判断帧在视频中的位置
  const position = timestamp / videoDuration;
  let positionLabel = "中段";
  if (position < 0.15) positionLabel = "开场";
  else if (position < 0.35) positionLabel = "前段";
  else if (position < 0.65) positionLabel = "中段";
  else if (position < 0.85) positionLabel = "高潮段";
  else positionLabel = "结尾";

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `你是一位专业的影视视觉分析师。请分析这张视频截帧的视觉质量。

这是视频的第 ${frameIndex + 1}/${totalFrames} 帧，位于视频的【${positionLabel}】部分（时间点: ${timestamp.toFixed(1)}s / 总时长: ${videoDuration.toFixed(1)}s）。

请从以下维度评分（0-100）：
1. **构图** (composition): 画面构图是否专业、有层次感、视觉引导清晰
2. **色彩** (colorGrading): 色彩搭配是否和谐、有风格、色调统一
3. **光线** (lighting): 光线运用是否到位、有氛围感
4. **情感冲击力** (emotionalImpact): 画面是否能引起情感共鸣、有张力
5. **技术质量** (technicalQuality): 清晰度、稳定性、无明显瑕疵
6. **叙事价值** (narrativeValue): 画面是否有故事性、能推动叙事

请以 JSON 格式返回：
{
  "composition": 分数,
  "colorGrading": 分数,
  "lighting": 分数,
  "emotionalImpact": 分数,
  "technicalQuality": 分数,
  "narrativeValue": 分数,
  "detail": "一段 50-80 字的分析说明，描述这一帧的视觉特点和亮点/不足"
}`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `请分析这张视频截帧（第 ${frameIndex + 1} 帧，${positionLabel}，${timestamp.toFixed(1)}s）：`,
          },
          {
            type: "image_url",
            image_url: { url: imageDataUrl, detail: "high" },
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const result = JSON.parse(response.choices[0].message.content as string);

  return {
    composition: Math.min(100, Math.max(0, Number(result.composition) || 50)),
    colorGrading: Math.min(100, Math.max(0, Number(result.colorGrading) || 50)),
    lighting: Math.min(100, Math.max(0, Number(result.lighting) || 50)),
    emotionalImpact: Math.min(100, Math.max(0, Number(result.emotionalImpact) || 50)),
    technicalQuality: Math.min(100, Math.max(0, Number(result.technicalQuality) || 50)),
    narrativeValue: Math.min(100, Math.max(0, Number(result.narrativeValue) || 50)),
    detail: String(result.detail || ""),
  };
}

// ─── 计算单帧综合分数 ─────────────────────────────
function calculateFrameScore(analysis: FrameAnalysis["analysis"]): number {
  return Math.round(
    analysis.composition * 0.18 +
    analysis.colorGrading * 0.18 +
    analysis.lighting * 0.14 +
    analysis.emotionalImpact * 0.20 +
    analysis.technicalQuality * 0.15 +
    analysis.narrativeValue * 0.15
  );
}

// ─── AI 综合评分（使用全部帧） ──────────────────
async function synthesizeScores(
  allFrameAnalyses: FrameAnalysis[],
  videoDuration: number,
  strategy: ScoringStrategy
): Promise<Omit<MultiFrameResult, "totalFrames" | "extractedFrames" | "videoDuration" | "frameAnalyses" | "scoringStrategy">> {
  const scoringFrames = allFrameAnalyses;
  const totalScoringFrames = scoringFrames.length;

  // 按位置分组
  const openingFrames = scoringFrames.slice(0, 2);
  const middleFrames = scoringFrames.slice(2, totalScoringFrames - 2);
  const climaxFrames = scoringFrames.slice(
    Math.floor(totalScoringFrames * 0.6),
    Math.floor(totalScoringFrames * 0.85)
  );
  const endingFrames = scoringFrames.slice(-2);

  const avg = (frames: FrameAnalysis[], key: keyof FrameAnalysis["analysis"]) => {
    if (frames.length === 0) return 0;
    const vals = frames.map((f) => {
      const v = f.analysis[key];
      return typeof v === "number" ? v : 0;
    });
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };

  const allAvg = (key: keyof FrameAnalysis["analysis"]) => avg(scoringFrames, key);

  // 计算各维度分数
  const openingAttraction = Math.round(
    avg(openingFrames, "emotionalImpact") * 0.4 +
    avg(openingFrames, "composition") * 0.3 +
    avg(openingFrames, "colorGrading") * 0.3
  );

  const visualComposition = allAvg("composition");
  const colorAndLighting = Math.round(
    allAvg("colorGrading") * 0.5 + allAvg("lighting") * 0.5
  );

  // 节奏感：中间帧的多样性（标准差越大节奏越丰富）
  const middleEmotions = middleFrames.map((f) => f.analysis.emotionalImpact);
  const emotionMean = middleEmotions.reduce((a, b) => a + b, 0) / (middleEmotions.length || 1);
  const emotionStd = Math.sqrt(
    middleEmotions.reduce((sum, v) => sum + (v - emotionMean) ** 2, 0) / (middleEmotions.length || 1)
  );
  const rhythmScore = Math.min(100, Math.round(
    avg(middleFrames, "narrativeValue") * 0.5 +
    Math.min(emotionStd * 3, 50) +
    avg(middleFrames, "composition") * 0.2
  ));

  const climaxImpact = Math.round(
    avg(climaxFrames.length > 0 ? climaxFrames : scoringFrames, "emotionalImpact") * 0.5 +
    avg(climaxFrames.length > 0 ? climaxFrames : scoringFrames, "colorGrading") * 0.25 +
    avg(climaxFrames.length > 0 ? climaxFrames : scoringFrames, "lighting") * 0.25
  );

  const endingClosure = Math.round(
    avg(endingFrames, "emotionalImpact") * 0.3 +
    avg(endingFrames, "composition") * 0.3 +
    avg(endingFrames, "narrativeValue") * 0.4
  );

  // 一致性：所有计分帧的色彩和构图标准差越小越一致
  const compScores = scoringFrames.map((f) => f.analysis.composition);
  const colorScores = scoringFrames.map((f) => f.analysis.colorGrading);
  const compMean = compScores.reduce((a, b) => a + b, 0) / compScores.length;
  const colorMean = colorScores.reduce((a, b) => a + b, 0) / colorScores.length;
  const compStd = Math.sqrt(compScores.reduce((sum, v) => sum + (v - compMean) ** 2, 0) / compScores.length);
  const colorStd = Math.sqrt(colorScores.reduce((sum, v) => sum + (v - colorMean) ** 2, 0) / colorScores.length);
  const consistency = Math.min(100, Math.round(
    100 - (compStd + colorStd) * 1.5
  ));

  // 综合视觉评分（加权平均）
  const overallVisualScore = Math.min(100, Math.max(0, Math.round(
    openingAttraction * 0.15 +
    visualComposition * 0.15 +
    colorAndLighting * 0.15 +
    rhythmScore * 0.15 +
    climaxImpact * 0.15 +
    endingClosure * 0.10 +
    consistency * 0.15
  )));

  const sortedFrames = [...allFrameAnalyses].sort((a, b) => a.frameScore - b.frameScore);
  const weakFrames = sortedFrames.slice(0, Math.min(3, sortedFrames.length));
  const weakInfo = weakFrames.length > 0
    ? `\n\n低分参考帧（保留给优化使用）：\n${weakFrames.map((f) => `第${f.frameIndex + 1}帧(${f.timestamp.toFixed(1)}s, 综合分${f.frameScore}): ${f.analysis.detail}`).join("\n")}`
    : "";

  const highlightInfo = strategy.highlightRange
    ? `；高潮补采样区间 ${strategy.highlightRange.start}s-${strategy.highlightRange.end}s，共补 ${strategy.highlightRange.extraFrames} 帧`
    : "";
  const scoringInfo = `评分策略：视频时长 ${Math.floor(videoDuration / 60)}分${Math.round(videoDuration % 60)}秒（${strategy.durationCategory === "short" ? "≤5分钟" : "5-10分钟"}），基础层按每 ${strategy.baseFrameIntervalSeconds} 秒抽取 ${Math.ceil(videoDuration / strategy.baseFrameIntervalSeconds)} 帧${highlightInfo}，全部帧共同参与分析，不再丢弃低分帧。`;

  // 用 AI 生成总结
  const summaryResponse = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `你是一位专业的影视评论家。请根据以下视频多帧分析数据，撰写一段精简的总结评价。

${scoringInfo}

分析数据（仅计分帧）：
- 开场吸引力: ${openingAttraction}/100
- 视觉构图: ${visualComposition}/100
- 色彩与光线: ${colorAndLighting}/100
- 节奏感: ${rhythmScore}/100
- 高潮表现: ${climaxImpact}/100
- 结尾收束: ${endingClosure}/100
- 一致性: ${consistency}/100
- 综合评分: ${overallVisualScore}/100

各计分帧分析摘要：
${scoringFrames.map((f) => `第${f.frameIndex + 1}帧(${f.timestamp.toFixed(1)}s, 分数${f.frameScore}): ${f.analysis.detail}`).join("\n")}
${weakInfo}

请以 JSON 格式返回：
{
  "summary": "2-3 句话的整体评价，需提及评分策略（基础抽帧、高潮补帧、保留弱帧）",
  "highlights": ["亮点1", "亮点2", "亮点3"],
  "improvements": ["改进建议1", "改进建议2"],
  "dimensionDetails": {
    "openingAttraction": "开场吸引力的具体评价",
    "visualComposition": "视觉构图的具体评价",
    "colorAndLighting": "色彩与光线的具体评价",
    "rhythmAndPacing": "节奏感的具体评价",
    "climaxImpact": "高潮表现的具体评价",
    "endingClosure": "结尾收束的具体评价",
    "consistency": "一致性的具体评价"
  }
}`,
      },
      {
        role: "user",
        content: "请根据以上数据撰写视频视觉质量的总结评价。",
      },
    ],
    response_format: { type: "json_object" },
  });

  const summaryResult = JSON.parse(summaryResponse.choices[0].message.content as string);

  return {
    overallVisualScore,
    dimensionScores: {
      openingAttraction: {
        score: openingAttraction,
        detail: summaryResult.dimensionDetails?.openingAttraction || "",
      },
      visualComposition: {
        score: visualComposition,
        detail: summaryResult.dimensionDetails?.visualComposition || "",
      },
      colorAndLighting: {
        score: colorAndLighting,
        detail: summaryResult.dimensionDetails?.colorAndLighting || "",
      },
      rhythmAndPacing: {
        score: rhythmScore,
        detail: summaryResult.dimensionDetails?.rhythmAndPacing || "",
      },
      climaxImpact: {
        score: climaxImpact,
        detail: summaryResult.dimensionDetails?.climaxImpact || "",
      },
      endingClosure: {
        score: endingClosure,
        detail: summaryResult.dimensionDetails?.endingClosure || "",
      },
      consistency: {
        score: consistency,
        detail: summaryResult.dimensionDetails?.consistency || "",
      },
    },
    summary: summaryResult.summary || "",
    highlights: summaryResult.highlights || [],
    improvements: summaryResult.improvements || [],
  };
}

// ─── 清理临时文件 ──────────────────────────────────
async function cleanup(paths: string[]) {
  for (const p of paths) {
    try {
      const stat = await fs.promises.stat(p);
      if (stat.isDirectory()) {
        await fs.promises.rm(p, { recursive: true, force: true });
      } else {
        await fs.promises.unlink(p);
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

// ─── 预查看频时长（不下载完整视频） ──────────────
export async function preCheckVideoDuration(
  videoUrl: string
): Promise<{ valid: boolean; duration: number; error?: string; strategy?: ScoringStrategy }> {
  let tmpPath = "";
  try {
    // 下载视频到临时文件
    tmpPath = path.join(os.tmpdir(), `mv-precheck-${Date.now()}.mp4`);
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`下载视频失败: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.promises.writeFile(tmpPath, buffer);

    const duration = await getVideoDuration(tmpPath);
    const validation = validateDuration(duration);

    return {
      valid: validation.valid,
      duration,
      error: validation.error,
      strategy: validation.strategy,
    };
  } catch (error: any) {
    return {
      valid: false,
      duration: 0,
      error: error.message || "无法检测视频时长",
    };
  } finally {
    if (tmpPath) {
      cleanup([tmpPath]).catch(() => {});
    }
  }
}

// ─── 主函数：多帧视频分析 ──────────────────────────
async function analyzeVideoMultiFrameFromPath(
  videoPath: string,
  onProgress?: ProgressCallback
): Promise<MultiFrameResult> {
  let tmpDir = "";

  try {
    onProgress?.("checking", 0, "正在检测视频时长...");
    const duration = await getVideoDuration(videoPath);
    const validation = validateDuration(duration);

    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const strategy = validation.strategy!;
    const durationMin = Math.floor(duration / 60);
    const durationSec = Math.round(duration % 60);

    onProgress?.(
      "checking",
      100,
      `视频时长 ${durationMin}分${durationSec}秒，` +
      `策略：基础层按每 ${strategy.baseFrameIntervalSeconds} 秒抽取 ${strategy.totalExtracted} 帧，` +
      `识别高潮区间后补充逐秒帧，不再丢弃低分帧`
    );

    const baseTimestamps = buildBaseTimestamps(duration);
    onProgress?.("extracting", 0, `正在按每 ${strategy.baseFrameIntervalSeconds} 秒抽取基础帧，共 ${baseTimestamps.length} 帧...`);
    const { framePaths } = await extractFramesAtTimestamps(videoPath, baseTimestamps, "基础层", onProgress);
    tmpDir = path.dirname(framePaths[0] || "");

    if (framePaths.length === 0) {
      throw new Error("无法从视频中抽取任何帧");
    }

    onProgress?.("extracting", 100, `成功抽取 ${framePaths.length} 帧`);

    onProgress?.("uploading", 0, "正在上传帧图片...");
    const frameUrls: { path: string; url: string; dataUrl: string; timestamp: number }[] = [];

    for (let i = 0; i < framePaths.length; i++) {
      const uploaded = await uploadFrame(framePaths[i], i);
      const timestamp = baseTimestamps[i] ?? 0;

      frameUrls.push({ path: framePaths[i], url: uploaded.url, dataUrl: uploaded.dataUrl, timestamp });
      onProgress?.(
        "uploading",
        Math.round(((i + 1) / framePaths.length) * 100),
        `已上传 ${i + 1}/${framePaths.length} 帧`
      );
    }

    const rawFrameAnalyses: FrameAnalysis[] = [];

    for (let i = 0; i < frameUrls.length; i++) {
      const { url, dataUrl, timestamp } = frameUrls[i];

      onProgress?.(
        "analyzing",
        Math.round(((i + 1) / frameUrls.length) * 100),
        `AI 正在分析第 ${i + 1}/${frameUrls.length} 帧（${timestamp.toFixed(1)}s）`
      );

      try {
        const analysis = await analyzeFrame(
          url, dataUrl, i, frameUrls.length, timestamp, duration
        );

        rawFrameAnalyses.push({
          frameIndex: i,
          timestamp,
          imageUrl: url,
          dropped: false,
          frameScore: calculateFrameScore(analysis),
          analysis,
        });
      } catch (error) {
        console.error(`[VideoAnalysis] Frame ${i} analysis failed:`, error);
        const fallbackAnalysis = {
          composition: 50, colorGrading: 50, lighting: 50,
          emotionalImpact: 50, technicalQuality: 50, narrativeValue: 50,
          detail: "此帧分析失败，使用默认中等评分",
        };
        rawFrameAnalyses.push({
          frameIndex: i,
          timestamp,
          imageUrl: url,
          dropped: false,
          frameScore: calculateFrameScore(fallbackAnalysis),
          analysis: fallbackAnalysis,
        });
      }
    }

    const highlightPlan = buildHighlightTimestamps(rawFrameAnalyses, duration, baseTimestamps);
    let finalFrameAnalyses = rawFrameAnalyses;
    if (highlightPlan.timestamps.length > 0) {
      onProgress?.(
        "extracting",
        0,
        `识别到高潮区间 ${highlightPlan.range?.start ?? 0}s-${highlightPlan.range?.end ?? 0}s，补充 ${highlightPlan.timestamps.length} 帧逐秒分析...`
      );
      const { framePaths: highlightPaths } = await extractFramesAtTimestamps(videoPath, highlightPlan.timestamps, "高潮层", onProgress);
      for (let i = 0; i < highlightPaths.length; i++) {
        const uploaded = await uploadFrame(highlightPaths[i], baseTimestamps.length + i);
        const timestamp = highlightPlan.timestamps[i] ?? 0;
        const analysis = await analyzeFrame(
          uploaded.url,
          uploaded.dataUrl,
          rawFrameAnalyses.length + i,
          rawFrameAnalyses.length + highlightPaths.length,
          timestamp,
          duration
        );
        finalFrameAnalyses.push({
          frameIndex: rawFrameAnalyses.length + i,
          timestamp,
          imageUrl: uploaded.url,
          dropped: false,
          frameScore: calculateFrameScore(analysis),
          analysis,
        });
      }
      finalFrameAnalyses = [...finalFrameAnalyses].sort((a, b) => a.timestamp - b.timestamp).map((item, index) => ({
        ...item,
        frameIndex: index,
      }));
      strategy.highlightRange = highlightPlan.range;
      strategy.totalExtracted = finalFrameAnalyses.length;
      strategy.scoringFrames = finalFrameAnalyses.length;
    }

    onProgress?.("scoring", 35, `正在综合分析 ${finalFrameAnalyses.length} 帧的数据，并保留低分帧作为优化参考...`);

    const synthesized = await synthesizeScores(finalFrameAnalyses, duration, strategy);

    onProgress?.("scoring", 100, "评分完成！");

    return {
      totalFrames: strategy.totalExtracted,
      extractedFrames: finalFrameAnalyses.length,
      videoDuration: duration,
      scoringStrategy: strategy,
      frameAnalyses: finalFrameAnalyses,
      ...synthesized,
    };
  } finally {
    if (tmpDir) cleanup([tmpDir]).catch(() => {});
  }
}

export async function analyzeVideoMultiFrame(
  videoUrl: string,
  onProgress?: ProgressCallback
): Promise<MultiFrameResult> {
  let videoPath = "";

  try {
    onProgress?.("downloading", 0, "正在下载视频文档...");
    videoPath = await downloadVideo(videoUrl, onProgress);
    return analyzeVideoMultiFrameFromPath(videoPath, onProgress);
  } finally {
    if (videoPath) cleanup([videoPath]).catch(() => {});
  }
}

export async function analyzeVideoMultiFrameFromLocalFile(
  videoPath: string,
  onProgress?: ProgressCallback
): Promise<MultiFrameResult> {
  return analyzeVideoMultiFrameFromPath(videoPath, onProgress);
}

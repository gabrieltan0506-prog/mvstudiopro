/**
 * 漫剧节奏模板 · 服务端学习流水线（Platform「学节奏」一点触发）。
 * 下片 → Gemini 语音高潮扫 → 自适应抽帧 → Terra 读帧 → 提案 JSON 落 GCS（status=proposed）。
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildAdaptiveFramePlan,
  speechRegionsFromSilenceDetectLog,
} from "../../shared/manhuaTemplateLearnFramePlan.js";
import {
  applyFrameVisionToProposal,
  selectFramesForVisionAnalysis,
} from "../../shared/manhuaTemplateLearnFrameVision.js";
import {
  parseManhuaViralTemplateCard,
  type ManhuaViralTemplateCard,
  type ManhuaViralTemplateLane,
} from "../../shared/manhuaViralTemplateBank.js";
import {
  analyzeManhuaDramaAudioWithGemini,
  isGeminiAudioAvailable,
  type ManhuaDramaAudioScanResult,
} from "../gemini-audio.js";
import { analyzeManhuaTemplateFramesWithTerra } from "../manhuaTemplateFrameVision.js";
import { uploadBufferToGcs, signGsUriV4ReadUrl } from "./gcs.js";

const execFileAsync = promisify(execFile);

export type ManhuaTemplateLearnInput = {
  url?: string;
  title?: string;
  mixId?: string;
  rank?: number;
  onProgress?: (phase: string, detailZh: string) => void | Promise<void>;
};

export type ManhuaTemplateLearnResult = {
  proposal: ManhuaViralTemplateCard;
  proposalGcsUri: string;
  proposalReadUrl?: string;
  visionFilled: boolean;
  audioModel: string | null;
  visionModel: string | null;
  durationSec: number;
  frameCount: number;
  workId: string;
};

function ytDlpBin(): string {
  return String(process.env.YOUTUBE_DL_PATH || "yt-dlp").trim() || "yt-dlp";
}

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0 && stderr) {
        console.warn(`[manhuaTemplateLearn] ${cmd} exit=${code}:`, stderr.slice(0, 400));
      }
      resolve(code ?? 1);
    });
  });
}

function slugId(seed: string): string {
  const h = createHash("sha1").update(seed).digest("hex").slice(0, 8);
  const raw = seed
    .replace(/https?:\/\//, "")
    .replace(/[^\u4e00-\u9fffa-zA-Z0-9]+/g, "")
    .slice(0, 16);
  return `tpl_learn_${raw || "clip"}_${h}`;
}

function guessLane(text: string): ManhuaViralTemplateLane {
  const t = text;
  if (/种田|边关|古言|开荒/.test(t)) return "古言种田";
  if (/系统|吞噬|进化|觉醒/.test(t)) return "系统觉醒";
  if (/电竞|游戏|操作|竞技/.test(t)) return "游戏竞技";
  if (/甜宠|恋爱|霸总/.test(t)) return "甜宠";
  if (/悬疑|权谋|宫斗/.test(t)) return "悬疑权谋";
  if (/沙雕|搞笑/.test(t)) return "搞笑沙雕";
  return "爽文逆袭";
}

async function ffprobeDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const n = Number(String(stdout).trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error("无法读取成片时长");
  return n;
}

async function extractAudioMp3(videoPath: string, audioPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "64k",
    audioPath,
  ]);
}

async function silenceDetectLog(audioPath: string): Promise<string> {
  try {
    const { stderr } = await execFileAsync("ffmpeg", [
      "-i",
      audioPath,
      "-af",
      "silencedetect=noise=-32dB:d=0.45",
      "-f",
      "null",
      "-",
    ]);
    return String(stderr || "");
  } catch (e: unknown) {
    const err = e as { stderr?: string };
    return String(err.stderr || "");
  }
}

async function extractFrames(
  videoPath: string,
  timestamps: number[],
  framesDir: string,
): Promise<string[]> {
  await fs.mkdir(framesDir, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i]!;
    const out = path.join(
      framesDir,
      `f${String(i).padStart(3, "0")}_${t.toFixed(2).replace(".", "p")}.jpg`,
    );
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss",
      String(t),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      out,
    ]);
    paths.push(out);
  }
  return paths;
}

async function downloadVideo(url: string, workDir: string): Promise<string> {
  await fs.mkdir(workDir, { recursive: true });
  if (/douyin\.com\/search\//i.test(url)) {
    throw new Error("当前是搜索页链接，请改用成片/合集页地址后再学节奏");
  }
  const outTpl = path.join(workDir, "source.%(ext)s");
  const code = await run(ytDlpBin(), [
    "-f",
    "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
    "--merge-output-format",
    "mp4",
    "-o",
    outTpl,
    "--no-playlist",
    "--max-filesize",
    "180M",
    url,
  ]);
  if (code !== 0) throw new Error("成片下载失败，请确认链接可访问或稍后重试");
  const files = await fs.readdir(workDir);
  const vid = files.find((f) => /\.(mp4|webm|mkv)$/i.test(f));
  if (!vid) throw new Error("下载完成但未找到视频文件");
  return path.join(workDir, vid);
}

function draftCard(input: {
  id: string;
  titleHint: string;
  url?: string;
  durationSec: number;
  timestamps: number[];
  climaxNotes: string[];
  transcriptPreview: string;
}): ManhuaViralTemplateCard {
  const today = new Date().toISOString().slice(0, 10);
  const laneZh = guessLane(input.titleHint + input.transcriptPreview);
  const beats = input.timestamps.slice(0, 16).map((t) => ({
    atSec: Math.round(t),
    conflictZh: "待视觉读帧补全",
    visualZh: `关键帧 @${t.toFixed(1)}s`,
  }));
  return {
    id: input.id,
    nameZh: "学习草案（待读帧补全）".slice(0, 32),
    laneZh,
    summaryZh: "云端学习草案：读帧未完成时保留待补字段，须人审批准才进库。",
    hook3sZh: "待补：根据前 5 秒关键帧写可见冲突钩子（勿写外部剧名）。",
    beatGrid: beats.length ? beats : [{ atSec: 0, conflictZh: "开场", visualZh: "待补" }],
    scenePoolHints: [],
    castShape: { leadDesireZh: "待补", pressureZh: "待补" },
    densityHints: {
      minBodyChars: 280,
      minDialogueLines: 8,
      minLocationHits: 2,
    },
    sourceRefs: [
      {
        url: input.url || "server://learn",
        fetchedAt: today,
        noteZh: [
          `时长${Math.round(input.durationSec)}s`,
          `帧数${input.timestamps.length}`,
          input.climaxNotes.slice(0, 2).join("；") || "无高潮加密",
          input.transcriptPreview ? `转写摘要：${input.transcriptPreview.slice(0, 40)}` : "",
        ]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 120),
      },
    ],
    status: "proposed",
    updatedAt: new Date().toISOString(),
  };
}

async function rmrf(dir: string) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

export async function runManhuaTemplateLearn(
  input: ManhuaTemplateLearnInput,
): Promise<ManhuaTemplateLearnResult> {
  const title = String(input.title || "").trim();
  let url = String(input.url || "").trim();
  if (!url && !title) throw new Error("缺少成片链接或剧名");
  if (!url && title) {
    throw new Error("无成片链接：请用榜单带链接的条目，或先打开成片页再学节奏");
  }

  const workId = slugId(url || title || input.mixId || "clip");
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `manhua-learn-${workId}-`));
  const progress = async (phase: string, detailZh: string) => {
    try {
      await input.onProgress?.(phase, detailZh);
    } catch {
      /* ignore */
    }
  };

  try {
    await progress("download", "正在下载成片…");
    const videoPath = await downloadVideo(url, workDir);
    const durationSec = await ffprobeDuration(videoPath);
    if (durationSec > 12 * 60) {
      throw new Error("成片过长（超过 12 分钟），请换短样片再学节奏");
    }

    await progress("audio", "正在分析语音节奏…");
    const audioPath = path.join(workDir, "audio.mp3");
    await extractAudioMp3(videoPath, audioPath);
    let geminiScan: ManhuaDramaAudioScanResult | null = null;
    if (isGeminiAudioAvailable()) {
      try {
        const buf = await fs.readFile(audioPath);
        if (buf.length <= 18 * 1024 * 1024) {
          geminiScan = await analyzeManhuaDramaAudioWithGemini({
            audioBase64: buf.toString("base64"),
            mimeType: "audio/mpeg",
          });
        }
      } catch (e) {
        console.warn(
          "[manhuaTemplateLearn] audio scan failed:",
          e instanceof Error ? e.message : e,
        );
      }
    }
    const silenceLog = await silenceDetectLog(audioPath);
    const speechRegions = speechRegionsFromSilenceDetectLog(silenceLog, durationSec);
    const plan = buildAdaptiveFramePlan({
      durationSec,
      geminiSections: geminiScan?.sections,
      speechRegions,
    });

    await progress("frames", `正在抽帧（${plan.timestamps.length}）…`);
    const framesDir = path.join(workDir, "frames");
    const framePaths = await extractFrames(videoPath, plan.timestamps, framesDir);
    const transcriptPreview = String(geminiScan?.transcriptSummary || "")
      .replace(/\s+/g, " ")
      .slice(0, 400);

    let card = draftCard({
      id: workId,
      titleHint: title || "未命名学习片",
      url,
      durationSec,
      timestamps: plan.timestamps,
      climaxNotes: plan.climaxWindows.map((w) => w.reasonZh),
      transcriptPreview,
    });

    await progress("vision", "正在读帧提炼节奏骨架…");
    let visionFilled = false;
    let visionModel: string | null = null;
    try {
      const paired = framePaths.map((p, i) => ({
        path: p,
        atSec: Number(plan.timestamps[i]) || 0,
      }));
      const selected = selectFramesForVisionAnalysis(paired);
      const frames = [];
      for (const item of selected) {
        const buf = await fs.readFile(item.path);
        frames.push({
          atSec: item.atSec,
          dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`,
          mimeType: "image/jpeg",
        });
      }
      if (frames.length) {
        const vision = await analyzeManhuaTemplateFramesWithTerra({
          frames,
          titleHint: title || "未命名学习片",
          durationSec,
          transcriptPreview,
          climaxNotes: plan.climaxWindows.map((w) => w.reasonZh),
          fallbackLane: card.laneZh,
        });
        visionModel = vision.model;
        const filled = applyFrameVisionToProposal(card, vision);
        if (filled) {
          card = filled;
          visionFilled = true;
        }
      }
    } catch (e) {
      console.warn(
        "[manhuaTemplateLearn] vision failed:",
        e instanceof Error ? e.message : e,
      );
    }

    const validated = parseManhuaViralTemplateCard(card);
    if (!validated) throw new Error("提案校验失败");

    await progress("persist", "正在保存提案…");
    const objectName = `manhua-template-learn/proposals/${validated.id}.json`;
    const uploaded = await uploadBufferToGcs({
      objectName,
      buffer: Buffer.from(`${JSON.stringify(validated, null, 2)}\n`, "utf8"),
      contentType: "application/json",
    });
    let proposalReadUrl: string | undefined;
    try {
      proposalReadUrl = signGsUriV4ReadUrl(uploaded.gcsUri, 7 * 24 * 3600);
    } catch {
      proposalReadUrl = undefined;
    }

    return {
      proposal: validated,
      proposalGcsUri: uploaded.gcsUri,
      proposalReadUrl,
      visionFilled,
      audioModel: geminiScan?.model || null,
      visionModel,
      durationSec,
      frameCount: framePaths.length,
      workId,
    };
  } finally {
    await rmrf(workDir);
  }
}

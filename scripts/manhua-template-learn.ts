/**
 * 漫剧节奏模板学习（B+2）：剧名/URL/飙升榜条目 → 本机下片 → 语音预扫 → 自适应抽帧 → 提案卡。
 *
 * 抽帧：前 5s 钩子帧 + 约每 10s；语音/高潮窗内改为约每 3s。
 * 产物：downloads/manhua-template-learn/（gitignore）+ docs/manhua-template-lab/proposals/
 * 红线：只借结构；成稿不写外部剧名/不抄台词画面；须人审批准才进审定库。
 *
 * 用法：
 *   pnpm run manhua:template-learn -- --url "https://www.douyin.com/..."
 *   pnpm run manhua:template-learn -- --title "剧名"
 *   pnpm run manhua:template-learn -- --rising-json path.json --rank 1
 *   pnpm run manhua:template-learn -- --video ./local.mp4 --title "已有成片"
 *
 * 依赖：本机 yt-dlp、ffmpeg/ffprobe。
 * 抖音下片登录态：与 Fly 趋势采集同源（DOUYIN_COOKIE / DOUYIN_COOKIE_BACKUP）；
 *   或 MANHUA_LEARN_YTDLP_COOKIES_FILE=Netscape cookies.txt；
 *   或 MANHUA_LEARN_YTDLP_COOKIES_FROM_BROWSER=chrome。
 * 语音分析（方案 A，默认）：本机 PUT → GCS → Fly `/api/google?op=manhuaAudioClimaxScan`。
 * 读帧分析（默认）：本机 PUT 帧 → GCS → Fly `manhuaTemplateFrameScan`→ 自动填提案，仍待人审。
 * 可选本机直打：MANHUA_LEARN_LOCAL_GEMINI=1 / MANHUA_LEARN_LOCAL_TERRA=1。
 * 语音失败则静音检测估高潮；读帧失败则保留「待读帧」草案。
 *
 * 环境：
 *   MANHUA_LEARN_FLY_ORIGIN=https://mvstudiopro.fly.dev  （或 api.mvstudiopro.com）
 *   MANHUA_LEARN_VIA_FLY=0  关闭 Fly 通路
 *   DOUYIN_COOKIE=…  （与 Fly secrets 同名即可本机复用）
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "dotenv";
import {
  buildAdaptiveFramePlan,
  speechRegionsFromSilenceDetectLog,
} from "../shared/manhuaTemplateLearnFramePlan.js";
import {
  parseManhuaViralTemplateCard,
  type ManhuaViralTemplateCard,
  type ManhuaViralTemplateLane,
} from "../shared/manhuaViralTemplateBank.js";
import {
  applyFrameVisionToProposal,
  selectFramesForVisionAnalysis,
  type ManhuaTemplateFrameVisionResult,
} from "../shared/manhuaTemplateLearnFrameVision.js";
import {
  MANHUA_LEARN_STAGE,
  formatManhuaLearnEpisodeDetail,
  getManhuaLearnPipelineMeta,
  manhuaLearnStageLabelZh,
} from "../shared/manhuaTemplateLearnPipeline.js";
import {
  analyzeManhuaDramaAudioWithGemini,
  isGeminiAudioAvailable,
  type ManhuaDramaAudioScanResult,
} from "../server/gemini-audio.js";
import { mapManhuaLearnFetchError } from "../shared/manhuaLearnYtdlp.js";
import {
  assertYtdlpCookieReadyForUrl,
  openYtdlpCookieSession,
  runYtdlp,
  throwMappedYtdlpFailure,
} from "../server/services/manhuaLearnYtdlpRuntime.js";

function logLearnStage(stage: string, detailZh?: string) {
  console.log(`[learn·${stage}] ${manhuaLearnStageLabelZh(stage, detailZh)}`);
}

config({ path: ".env.local" });
config({ path: ".env" });

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const OUT_ROOT = path.join(ROOT, "downloads", "manhua-template-learn");
const PROPOSALS = path.join(ROOT, "docs/manhua-template-lab/proposals");
const CHANGELOG = path.join(ROOT, "docs/manhua-template-lab/CHANGELOG.md");
const DEFAULT_FLY_ORIGIN = "https://mvstudiopro.fly.dev";

function flyOrigin(): string {
  return (
    String(process.env.MANHUA_LEARN_FLY_ORIGIN || process.env.VITE_FLY_API_ORIGIN || "")
      .trim()
      .replace(/\/$/, "") || DEFAULT_FLY_ORIGIN
  );
}

function viaFlyEnabled(): boolean {
  const raw = String(process.env.MANHUA_LEARN_VIA_FLY ?? "1").trim();
  return !/^(0|false|no|off)$/i.test(raw);
}

type RisingEntry = {
  mixName?: string;
  url?: string;
  sampleTitle?: string;
  author?: string;
  mixId?: string;
};

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
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

function run(cmd: string, args: string[], opts?: { cwd?: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", cwd: opts?.cwd });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
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
  if (!Number.isFinite(n) || n <= 0) throw new Error("ffprobe duration failed");
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

/** 方案 A：签名上传 GCS → Fly 代下 → Gemini 3.5 Flash */
async function geminiAudioScanViaFly(audioPath: string): Promise<ManhuaDramaAudioScanResult | null> {
  const origin = flyOrigin();
  const buf = await fs.readFile(audioPath);
  const sizeMB = buf.length / (1024 * 1024);
  if (sizeMB > 18) {
    console.warn(`[learn] 音频 ${sizeMB.toFixed(1)}MB 过大，跳过 Fly/GCS 通路`);
    return null;
  }
  const fileName = `learn-${Date.now()}.mp3`;
  console.log(`[learn] Fly 取 GCS 上传签名… ${origin}`);
  const upRes = await fetch(`${origin}/api/google?op=manhuaAudioGetUploadUrl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, mimeType: "audio/mpeg" }),
  });
  const upJson = (await upRes.json().catch(() => null)) as {
    ok?: boolean;
    uploadUrl?: string;
    gcsUri?: string;
    requiredHeaders?: Record<string, string>;
    detail?: string;
    error?: string;
  } | null;
  if (!upRes.ok || !upJson?.ok || !upJson.uploadUrl || !upJson.gcsUri) {
    console.warn(
      "[learn] Fly 签名上传失败:",
      upJson?.detail || upJson?.error || upRes.status,
    );
    return null;
  }
  const putHeaders: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    ...(upJson.requiredHeaders || {}),
  };
  console.log(`[learn] PUT GCS… ${upJson.gcsUri}`);
  const putRes = await fetch(upJson.uploadUrl, {
    method: "PUT",
    headers: putHeaders,
    body: buf,
  });
  if (!putRes.ok) {
    const t = await putRes.text().catch(() => "");
    console.warn("[learn] GCS PUT 失败:", putRes.status, t.slice(0, 160));
    return null;
  }
  console.log("[learn] Fly manhuaAudioClimaxScan…");
  const scanRes = await fetch(`${origin}/api/google?op=manhuaAudioClimaxScan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gcsUri: upJson.gcsUri, mimeType: "audio/mpeg" }),
  });
  const scanJson = (await scanRes.json().catch(() => null)) as {
    ok?: boolean;
    model?: string;
    language?: string;
    transcriptSummary?: string;
    sections?: ManhuaDramaAudioScanResult["sections"];
    detail?: string;
    error?: string;
  } | null;
  if (!scanRes.ok || !scanJson?.ok || !Array.isArray(scanJson.sections)) {
    console.warn(
      "[learn] Fly 音频扫描失败:",
      scanJson?.detail || scanJson?.error || scanRes.status,
    );
    return null;
  }
  console.log(
    `[learn] Fly Gemini ok · model=${scanJson.model || "?"} · sections=${scanJson.sections.length}`,
  );
  return {
    model: String(scanJson.model || "gemini-3.5-flash"),
    language: String(scanJson.language || ""),
    transcriptSummary: String(scanJson.transcriptSummary || ""),
    sections: scanJson.sections,
  };
}

async function geminiAudioScanLocal(audioPath: string): Promise<ManhuaDramaAudioScanResult | null> {
  if (!isGeminiAudioAvailable()) return null;
  const buf = await fs.readFile(audioPath);
  if (buf.length > 18 * 1024 * 1024) return null;
  try {
    const scan = await analyzeManhuaDramaAudioWithGemini({
      audioBase64: buf.toString("base64"),
      mimeType: "audio/mpeg",
    });
    console.log(
      `[learn] 本机 Gemini ok · model=${scan.model} · sections=${scan.sections.length}`,
    );
    return scan;
  } catch (e) {
    console.warn("[learn] 本机 Gemini 失败:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function geminiAudioScan(audioPath: string): Promise<ManhuaDramaAudioScanResult | null> {
  const preferLocal = /^(1|true|yes|on)$/i.test(
    String(process.env.MANHUA_LEARN_LOCAL_GEMINI || "").trim(),
  );
  if (preferLocal) {
    const local = await geminiAudioScanLocal(audioPath);
    if (local) return local;
  }
  if (viaFlyEnabled()) {
    const via = await geminiAudioScanViaFly(audioPath);
    if (via) return via;
  }
  if (!preferLocal) {
    const local = await geminiAudioScanLocal(audioPath);
    if (local) return local;
  }
  console.warn("[learn] 语音分析不可用，改用静音检测估高潮");
  return null;
}

async function uploadFrameToGcsViaFly(
  origin: string,
  framePath: string,
  atSec: number,
): Promise<{ atSec: number; gcsUri: string; mimeType: string } | null> {
  const buf = await fs.readFile(framePath);
  const fileName = `f_${atSec.toFixed(2).replace(".", "p")}_${path.basename(framePath)}`.slice(0, 80);
  const upRes = await fetch(`${origin}/api/google?op=manhuaTemplateFrameGetUploadUrl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, mimeType: "image/jpeg" }),
  });
  const upJson = (await upRes.json().catch(() => null)) as {
    ok?: boolean;
    uploadUrl?: string;
    gcsUri?: string;
    requiredHeaders?: Record<string, string>;
    detail?: string;
    error?: string;
  } | null;
  if (!upRes.ok || !upJson?.ok || !upJson.uploadUrl || !upJson.gcsUri) {
    console.warn(
      "[learn] 帧签名上传失败:",
      upJson?.detail || upJson?.error || upRes.status,
    );
    return null;
  }
  const putRes = await fetch(upJson.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "image/jpeg",
      ...(upJson.requiredHeaders || {}),
    },
    body: buf,
  });
  if (!putRes.ok) {
    const t = await putRes.text().catch(() => "");
    console.warn("[learn] 帧 GCS PUT 失败:", putRes.status, t.slice(0, 120));
    return null;
  }
  return { atSec, gcsUri: upJson.gcsUri, mimeType: "image/jpeg" };
}

async function terraFrameScanViaFly(input: {
  framePaths: string[];
  timestamps: number[];
  titleHint: string;
  durationSec: number;
  transcriptPreview: string;
  climaxNotes: string[];
  fallbackLane: ManhuaViralTemplateLane;
}): Promise<ManhuaTemplateFrameVisionResult | null> {
  const origin = flyOrigin();
  const paired = input.framePaths
    .map((p, i) => ({ path: p, atSec: Number(input.timestamps[i]) || 0 }))
    .filter((x) => x.path);
  const selected = selectFramesForVisionAnalysis(paired);
  if (!selected.length) return null;

  console.log(`[learn] Fly 上传 ${selected.length} 帧 → GCS…`);
  const uploaded: Array<{ atSec: number; gcsUri: string; mimeType: string }> = [];
  for (const item of selected) {
    const one = await uploadFrameToGcsViaFly(origin, item.path, item.atSec);
    if (one) uploaded.push(one);
  }
  if (!uploaded.length) {
    console.warn("[learn] 无一帧上传成功，跳过读帧");
    return null;
  }

  console.log("[learn] Fly manhuaTemplateFrameScan（Terra · high）…");
  const scanRes = await fetch(`${origin}/api/google?op=manhuaTemplateFrameScan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      frames: uploaded,
      titleHint: input.titleHint,
      durationSec: input.durationSec,
      transcriptPreview: input.transcriptPreview,
      climaxNotes: input.climaxNotes,
      fallbackLane: input.fallbackLane,
    }),
  });
  const scanJson = (await scanRes.json().catch(() => null)) as {
    ok?: boolean;
    vision?: ManhuaTemplateFrameVisionResult;
    detail?: string;
    error?: string;
  } | null;
  if (!scanRes.ok || !scanJson?.ok || !scanJson.vision) {
    console.warn(
      "[learn] Fly 读帧失败:",
      scanJson?.detail || scanJson?.error || scanRes.status,
    );
    return null;
  }
  console.log(
    `[learn] Fly Terra 读帧 ok · nameZh=${scanJson.vision.nameZh} · beats=${scanJson.vision.beatGrid?.length || 0}`,
  );
  return scanJson.vision;
}

async function terraFrameScanLocal(input: {
  framePaths: string[];
  timestamps: number[];
  titleHint: string;
  durationSec: number;
  transcriptPreview: string;
  climaxNotes: string[];
  fallbackLane: ManhuaViralTemplateLane;
}): Promise<ManhuaTemplateFrameVisionResult | null> {
  try {
    const { analyzeManhuaTemplateFramesWithTerra } = await import(
      "../server/manhuaTemplateFrameVision.js"
    );
    const paired = input.framePaths
      .map((p, i) => ({ path: p, atSec: Number(input.timestamps[i]) || 0 }))
      .filter((x) => x.path);
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
    if (!frames.length) return null;
    const vision = await analyzeManhuaTemplateFramesWithTerra({
      frames,
      titleHint: input.titleHint,
      durationSec: input.durationSec,
      transcriptPreview: input.transcriptPreview,
      climaxNotes: input.climaxNotes,
      fallbackLane: input.fallbackLane,
    });
    console.log(
      `[learn] 本机 Terra 读帧 ok · nameZh=${vision.nameZh} · beats=${vision.beatGrid.length}`,
    );
    return vision;
  } catch (e) {
    console.warn("[learn] 本机 Terra 读帧失败:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function terraFrameScan(input: {
  framePaths: string[];
  timestamps: number[];
  titleHint: string;
  durationSec: number;
  transcriptPreview: string;
  climaxNotes: string[];
  fallbackLane: ManhuaViralTemplateLane;
}): Promise<ManhuaTemplateFrameVisionResult | null> {
  const preferLocal = /^(1|true|yes|on)$/i.test(
    String(process.env.MANHUA_LEARN_LOCAL_TERRA || "").trim(),
  );
  if (preferLocal) {
    const local = await terraFrameScanLocal(input);
    if (local) return local;
  }
  if (viaFlyEnabled()) {
    const via = await terraFrameScanViaFly(input);
    if (via) return via;
  }
  if (!preferLocal) {
    const local = await terraFrameScanLocal(input);
    if (local) return local;
  }
  console.warn("[learn] 读帧分析不可用，提案保留待补字段");
  return null;
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
    const out = path.join(framesDir, `f${String(i).padStart(3, "0")}_${t.toFixed(2).replace(".", "p")}.jpg`);
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
  assertYtdlpCookieReadyForUrl(url);
  const cookies = await openYtdlpCookieSession();
  try {
    const outTpl = path.join(workDir, "source.%(ext)s");
    console.log("[learn] 下载成片…", url.slice(0, 120), cookies.hasCookies ? "(已带登录态)" : "");
    const { code, stderr } = await runYtdlp([
      ...cookies.args,
      "-f",
      "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
      "--merge-output-format",
      "mp4",
      "-o",
      outTpl,
      "--no-playlist",
      "--max-filesize",
      "180M",
      "--no-warnings",
      url,
    ]);
    if (code !== 0) throwMappedYtdlpFailure(stderr);
  } catch (e) {
    throw new Error(mapManhuaLearnFetchError(e));
  } finally {
    await cookies.cleanup();
  }
  const files = await fs.readdir(workDir);
  const vid = files.find((f) => /\.(mp4|webm|mkv)$/i.test(f));
  if (!vid) throw new Error("下载完成但未找到视频文件");
  return path.join(workDir, vid);
}

function titleToSearchUrl(title: string): string {
  return `https://www.douyin.com/search/${encodeURIComponent(title.trim())}`;
}

async function loadRisingEntry(jsonPath: string, rank: number): Promise<RisingEntry> {
  const raw = JSON.parse(await fs.readFile(jsonPath, "utf8")) as {
    entries?: RisingEntry[];
    aiManhuaRising?: { entries?: RisingEntry[] };
  };
  const entries = raw.entries || raw.aiManhuaRising?.entries || [];
  if (!entries.length) throw new Error("rising json 无 entries");
  const idx = Math.max(1, Math.floor(rank)) - 1;
  const row = entries[idx];
  if (!row) throw new Error(`rank=${rank} 超出榜单长度 ${entries.length}`);
  return row;
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
    summaryZh: "本机抽帧学习草案：请用多模态读帧补全钩子/节拍后再批准进库。",
    hook3sZh: "待补：根据前 5 秒关键帧写可见冲突钩子（勿写外部剧名）。",
    beatGrid: beats.length
      ? beats
      : [{ atSec: 0, conflictZh: "开场", visualZh: "待补" }],
    scenePoolHints: [],
    castShape: { leadDesireZh: "待补", pressureZh: "待补" },
    densityHints: {
      minBodyChars: 280,
      minDialogueLines: 8,
      minLocationHits: 2,
    },
    sourceRefs: [
      {
        url: input.url || "local://video",
        fetchedAt: today,
        noteZh: [
          `时长${Math.round(input.durationSec)}s`,
          `帧数${input.timestamps.length}`,
          input.climaxNotes.slice(0, 2).join("；") || "无高潮加密",
          input.transcriptPreview ? `转写摘要：${input.transcriptPreview.slice(0, 60)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      },
    ],
    status: "proposed",
    updatedAt: new Date().toISOString(),
  };
}

async function appendChangelog(id: string, note: string) {
  const line = `| ${new Date().toISOString().slice(0, 10)} | learn-proposed | ${id} | ${note} |\n`;
  await fs.appendFile(CHANGELOG, line, "utf8").catch(() => undefined);
}

async function main() {
  const risingJson = argValue("--rising-json");
  const rank = Number(argValue("--rank") || "1");
  let title = String(argValue("--title") || "").trim();
  let url = String(argValue("--url") || "").trim();
  let videoPath = String(argValue("--video") || "").trim();
  const dry = hasFlag("--dry-plan");
  const meta = getManhuaLearnPipelineMeta();
  logLearnStage(MANHUA_LEARN_STAGE.local_run, `本机学节奏 · ${meta.summaryZh}`);
  for (const step of meta.stepsZh) {
    console.log(`[learn·plan] ${step}`);
  }

  if (risingJson) {
    const row = await loadRisingEntry(path.resolve(risingJson), rank);
    title = title || String(row.mixName || row.sampleTitle || "").trim();
    url = url || String(row.url || "").trim();
    console.log(`[learn] 榜单 #${rank} · ${title || "—"} · ${url || "无 url"}`);
  }

  if (!videoPath) {
    if (!url && title) url = titleToSearchUrl(title);
    if (!url) {
      console.error(
        "用法: --url | --title | --rising-json <file> --rank N | --video <mp4>",
      );
      process.exit(1);
    }
  }

  const workId = slugId(url || title || videoPath || "clip");
  const workDir = path.join(OUT_ROOT, workId);
  await fs.mkdir(workDir, { recursive: true });

  if (!videoPath) {
    // 搜索页不能直接下片：若是 search URL，提示用户改成成片页；仍尝试 yt-dlp
    if (/douyin\.com\/search\//i.test(url)) {
      console.warn(
        "[learn] 当前是抖音搜索页链接。若下载失败，请打开搜索结果里的成片/合集页，改用 --url 成片地址。",
      );
    }
    logLearnStage(
      MANHUA_LEARN_STAGE.download,
      formatManhuaLearnEpisodeDetail(MANHUA_LEARN_STAGE.download, 1),
    );
    videoPath = await downloadVideo(url, workDir);
  } else {
    videoPath = path.resolve(videoPath);
  }

  const durationSec = await ffprobeDuration(videoPath);
  console.log(`[learn] duration=${durationSec.toFixed(1)}s`);

  logLearnStage(
    MANHUA_LEARN_STAGE.audio,
    formatManhuaLearnEpisodeDetail(MANHUA_LEARN_STAGE.audio, 1),
  );
  const audioPath = path.join(workDir, "audio.mp3");
  await extractAudioMp3(videoPath, audioPath);
  const geminiScan = await geminiAudioScan(audioPath);
  const silenceLog = await silenceDetectLog(audioPath);
  const speechRegions = speechRegionsFromSilenceDetectLog(silenceLog, durationSec);

  const plan = buildAdaptiveFramePlan({
    durationSec,
    geminiSections: geminiScan?.sections,
    speechRegions,
  });

  const planPath = path.join(workDir, "frame-plan.json");
  await fs.writeFile(
    planPath,
    JSON.stringify(
      {
        title,
        url,
        videoPath,
        ...plan,
        geminiModel: geminiScan?.model || null,
        geminiSectionCount: geminiScan?.sections.length || 0,
        transcriptSummary: geminiScan?.transcriptSummary || "",
        redLineZh: "帧与转写仅内部研究；成稿禁止外部剧名/抄台词画面",
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(
    `[learn] 抽帧计划 base=${plan.baseTimestamps.length} → final=${plan.timestamps.length} (+${plan.densifiedCount} 高潮加密) windows=${plan.climaxWindows.length}`,
  );

  if (dry) {
    console.log("[learn] --dry-plan 仅写 frame-plan.json，跳过抽帧与提案");
    console.log(planPath);
    return;
  }

  logLearnStage(
    MANHUA_LEARN_STAGE.frames,
    formatManhuaLearnEpisodeDetail(
      MANHUA_LEARN_STAGE.frames,
      1,
      `${plan.timestamps.length} 张`,
    ),
  );
  const framesDir = path.join(workDir, "frames");
  const framePaths = await extractFrames(videoPath, plan.timestamps, framesDir);
  console.log(`[learn] 已抽 ${framePaths.length} 帧 → ${framesDir}`);
  logLearnStage(
    MANHUA_LEARN_STAGE.vision,
    formatManhuaLearnEpisodeDetail(MANHUA_LEARN_STAGE.vision, 1),
  );

  const transcriptPreview = String(geminiScan?.transcriptSummary || "")
    .replace(/\s+/g, " ")
    .slice(0, 400);

  let card = draftCard({
    id: workId,
    titleHint: title || "未命名学习片",
    url: url || undefined,
    durationSec,
    timestamps: plan.timestamps,
    climaxNotes: plan.climaxWindows.map((w) => w.reasonZh),
    transcriptPreview,
  });

  const vision = await terraFrameScan({
    framePaths,
    timestamps: plan.timestamps,
    titleHint: title || "未命名学习片",
    durationSec,
    transcriptPreview,
    climaxNotes: plan.climaxWindows.map((w) => w.reasonZh),
    fallbackLane: card.laneZh,
  });
  let visionFilled = false;
  if (vision) {
    const filled = applyFrameVisionToProposal(card, vision);
    if (filled) {
      card = filled;
      visionFilled = true;
    } else {
      console.warn("[learn] 读帧结果校验失败，保留草案字段");
    }
  }

  const validated = parseManhuaViralTemplateCard(card);
  if (!validated) throw new Error("提案卡校验失败");

  await fs.mkdir(PROPOSALS, { recursive: true });
  const proposalPath = path.join(PROPOSALS, `${validated.id}.json`);
  await fs.writeFile(proposalPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  await appendChangelog(
    validated.id,
    `frames=${framePaths.length} climax=${plan.climaxWindows.length} vision=${visionFilled ? "terra" : "skip"}`,
  );

  const manifestPath = path.join(workDir, "manifest.json");
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        proposalPath,
        framesDir,
        framePaths,
        planPath,
        visionFilled,
        visionModel: vision?.model || null,
        nextStepZh: visionFilled
          ? "读帧已自动填提案（status=proposed）；人审「批准进库」后才进产品库。"
          : "读帧未完成：可重跑学习或人工改 proposals JSON；产品只吃 approved。",
      },
      null,
      2,
    ),
    "utf8",
  );

  logLearnStage(MANHUA_LEARN_STAGE.done, manhuaLearnStageLabelZh(MANHUA_LEARN_STAGE.done));
  console.log(`[learn] 提案 → ${proposalPath}`);
  console.log(`[learn] 清单 → ${manifestPath}`);
  console.log(
    visionFilled
      ? "[learn] 读帧已填提案字段；下一步：人审「批准进库」"
      : "[learn] 读帧未填；可检查 Fly 部署/密钥后重跑，或人工补全后再「批准进库」",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

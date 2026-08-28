/**
 * 漫剧节奏模板学习（B+2）：剧名/URL/飙升榜条目 → 本机分段下片 → 语音预扫 → 自适应抽帧 → 提案卡。
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
  getManhuaLearnPipelineMeta,
  manhuaLearnStageLabelZh,
} from "../shared/manhuaTemplateLearnPipeline.js";
import {
  MANHUA_LEARN_CHECKPOINT_SEC,
  MANHUA_LEARN_MAX_DURATION_SEC,
} from "../shared/manhuaTemplateLearnSeries.js";
import {
  MANHUA_LEARN_SEGMENT_MAX_BYTES,
  buildManhuaLearnYtdlpMetadataArgs,
  buildManhuaLearnYtdlpSegmentArgs,
  nextManhuaLearnVideoSegment,
  parseManhuaLearnRemoteDurationSec,
} from "../shared/manhuaLearnVideoSegments.js";
import {
  analyzeManhuaDramaAudioWithGemini,
  isGeminiAudioAvailable,
  type ManhuaDramaAudioScanResult,
} from "../server/gemini-audio.js";
import {
  isDouyinHostUrl,
  mapManhuaLearnFetchError,
  normalizeDouyinVideoUrl,
} from "../shared/manhuaLearnYtdlp.js";
import {
  assertYtdlpCookieReadyForUrl,
  execYtdlpJson,
  openYtdlpCookieSession,
  runYtdlp,
  throwMappedYtdlpFailure,
  ytdlpCookieCandidateCount,
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

async function extractAudioMp3(
  videoPath: string,
  audioPath: string,
  opts?: { startSec?: number; durationSec?: number },
): Promise<void> {
  const args = ["-y"];
  const startSec = Math.max(0, Number(opts?.startSec) || 0);
  const durationSec = Math.max(0, Number(opts?.durationSec) || 0);
  if (startSec > 0) args.push("-ss", String(startSec));
  args.push("-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k");
  if (durationSec > 0) args.push("-t", String(durationSec));
  args.push(audioPath);
  await execFileAsync("ffmpeg", args);
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

async function withYtdlpCookieCandidates<T>(
  url: string,
  run: (cookieArgs: string[], candidateIndex: number) => Promise<T>,
): Promise<T> {
  const attemptCount = isDouyinHostUrl(url) ? ytdlpCookieCandidateCount() : 1;
  let lastError: unknown = new Error("成片下载失败");
  for (let candidateIndex = 0; candidateIndex < attemptCount; candidateIndex++) {
    const cookies = await openYtdlpCookieSession(candidateIndex);
    try {
      return await run(cookies.args, candidateIndex);
    } catch (error) {
      lastError = error;
      if (candidateIndex + 1 < attemptCount) {
        console.warn(
          `[learn] Cookie 候选 ${candidateIndex + 1}/${attemptCount} 失败，改试下一账号：${mapManhuaLearnFetchError(error)}`,
        );
      }
    } finally {
      await cookies.cleanup();
    }
  }
  throw lastError;
}

async function probeRemoteVideoDuration(url: string): Promise<number> {
  if (/douyin\.com\/search\//i.test(url)) {
    throw new Error("当前是搜索页链接，请改用成片/合集页地址后再学节奏");
  }
  assertYtdlpCookieReadyForUrl(url);
  try {
    return await withYtdlpCookieCandidates(url, async (cookieArgs) => {
      const payload = await execYtdlpJson(
        buildManhuaLearnYtdlpMetadataArgs({ url, cookieArgs }),
      );
      const durationSec = parseManhuaLearnRemoteDurationSec(payload);
      if (durationSec <= 0) throw new Error("无法读取成片时长，不能安全分段下载");
      return durationSec;
    });
  } catch (e) {
    throw new Error(mapManhuaLearnFetchError(e));
  }
}

async function downloadVideoSegment(input: {
  url: string;
  workDir: string;
  startSec: number;
  endSec: number;
}): Promise<string> {
  await fs.mkdir(input.workDir, { recursive: true });
  assertYtdlpCookieReadyForUrl(input.url);
  try {
    return await withYtdlpCookieCandidates(input.url, async (cookieArgs, candidateIndex) => {
      const prefix = `source-c${candidateIndex + 1}`;
      const outTpl = path.join(input.workDir, `${prefix}.%(ext)s`);
      console.log(
        `[learn] 分段下载 ${Math.floor(input.startSec / 60)}–${Math.ceil(input.endSec / 60)} 分…`,
        cookieArgs.length ? `(登录态候选 ${candidateIndex + 1})` : "",
      );
      const result = await runYtdlp(
        buildManhuaLearnYtdlpSegmentArgs({
          url: input.url,
          outputTemplate: outTpl,
          startSec: input.startSec,
          endSec: input.endSec,
          cookieArgs,
        }),
      );
      if (result.code !== 0) throwMappedYtdlpFailure(result.stderr);
      const files = await fs.readdir(input.workDir);
      const vid = files.find(
        (file) => file.startsWith(`${prefix}.`) && /\.(mp4|webm|mkv)$/i.test(file),
      );
      if (!vid) {
        throw new Error(
          result.stderr.trim()
            ? mapManhuaLearnFetchError(result.stderr)
            : "分段下载未生成视频文件，请确认链接可访问或稍后重试",
        );
      }
      const videoPath = path.join(input.workDir, vid);
      const stat = await fs.stat(videoPath);
      if (stat.size > MANHUA_LEARN_SEGMENT_MAX_BYTES) {
        throw new Error("当前 10 分钟片段超过 800MB，已停止处理以保护本机容量");
      }
      await ffprobeDuration(videoPath);
      return videoPath;
    });
  } catch (e) {
    throw new Error(mapManhuaLearnFetchError(e));
  }
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
  const beats = input.timestamps.map((t) => ({
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

type LocalSegmentAnalysis = {
  startSec: number;
  endSec: number;
  transcriptPreview: string;
  timestamps: number[];
  climaxNotes: string[];
  framePaths: string[];
  planPath: string;
  visionCard: ManhuaViralTemplateCard | null;
  visionModel: string | null;
};

function combineTranscriptPreviews(parts: readonly string[], maxChars = 400): string {
  const clean = parts.map((s) => String(s || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!clean.length) return "";
  const perPart = Math.max(24, Math.floor((maxChars - clean.length * 3) / clean.length));
  return clean.map((s) => s.slice(0, perPart)).join(" … ").slice(0, maxChars);
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

async function readLocalSegmentCheckpoint(
  filePath: string,
  expected: { startSec: number; endSec: number },
): Promise<LocalSegmentAnalysis | null> {
  try {
    const value = JSON.parse(await fs.readFile(filePath, "utf8")) as LocalSegmentAnalysis;
    if (
      Number(value.startSec) !== expected.startSec
      || Number(value.endSec) !== expected.endSec
      || !Array.isArray(value.timestamps)
      || !Array.isArray(value.framePaths)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

async function analyzeLocalSegment(input: {
  workId: string;
  title: string;
  url?: string;
  videoPath: string;
  mediaStartSec: number;
  startSec: number;
  endSec: number;
  segmentDir: string;
  dry: boolean;
}): Promise<LocalSegmentAnalysis> {
  const segmentLen = Math.max(1, input.endSec - input.startSec);
  const localStartSec = Math.max(0, input.startSec - input.mediaStartSec);
  await fs.mkdir(input.segmentDir, { recursive: true });

  logLearnStage(
    MANHUA_LEARN_STAGE.audio,
    `正在分析 ${Math.floor(input.startSec / 60)}–${Math.ceil(input.endSec / 60)} 分语音与节奏…`,
  );
  const audioPath = path.join(input.segmentDir, "audio.mp3");
  await extractAudioMp3(input.videoPath, audioPath, {
    startSec: localStartSec,
    durationSec: segmentLen,
  });
  const geminiScan = await geminiAudioScan(audioPath);
  const silenceLog = await silenceDetectLog(audioPath);
  const speechRegions = speechRegionsFromSilenceDetectLog(silenceLog, segmentLen);
  const plan = buildAdaptiveFramePlan({
    durationSec: segmentLen,
    geminiSections: geminiScan?.sections,
    speechRegions,
  });
  const relativeTimestamps = plan.timestamps.filter((t) => t >= 0 && t <= segmentLen);
  const timestamps = relativeTimestamps.map((t) => t + input.startSec);
  const mediaTimestamps = relativeTimestamps.map((t) => t + localStartSec);
  const planPath = path.join(input.segmentDir, "frame-plan.json");
  await writeJsonAtomic(planPath, {
    title: input.title,
    url: input.url,
    sourceRangeSec: [input.startSec, input.endSec],
    ...plan,
    timestamps,
    geminiModel: geminiScan?.model || null,
    geminiSectionCount: geminiScan?.sections.length || 0,
    transcriptSummary: geminiScan?.transcriptSummary || "",
    redLineZh: "帧与转写仅内部研究；成稿禁止外部剧名/抄台词画面",
  });

  const transcriptPreview = String(geminiScan?.transcriptSummary || "")
    .replace(/\s+/g, " ")
    .slice(0, 400);
  const empty: LocalSegmentAnalysis = {
    startSec: input.startSec,
    endSec: input.endSec,
    transcriptPreview,
    timestamps,
    climaxNotes: plan.climaxWindows.map((w) => w.reasonZh),
    framePaths: [],
    planPath,
    visionCard: null,
    visionModel: null,
  };
  if (input.dry) {
    await fs.unlink(audioPath).catch(() => undefined);
    return empty;
  }

  logLearnStage(
    MANHUA_LEARN_STAGE.frames,
    `正在抽取 ${Math.floor(input.startSec / 60)}–${Math.ceil(input.endSec / 60)} 分关键帧（${timestamps.length} 张）…`,
  );
  const framesDir = path.join(input.segmentDir, "frames");
  const framePaths = await extractFrames(input.videoPath, mediaTimestamps, framesDir);
  let card = draftCard({
    id: `${input.workId}_${Math.floor(input.startSec)}`,
    titleHint: input.title || "未命名学习片",
    url: input.url,
    durationSec: segmentLen,
    timestamps,
    climaxNotes: plan.climaxWindows.map((w) => w.reasonZh),
    transcriptPreview,
  });
  logLearnStage(
    MANHUA_LEARN_STAGE.vision,
    `正在读帧 ${Math.floor(input.startSec / 60)}–${Math.ceil(input.endSec / 60)} 分…`,
  );
  const vision = await terraFrameScan({
    framePaths,
    timestamps,
    titleHint: `${input.title || "未命名学习片"} · ${Math.floor(input.startSec / 60)}–${Math.ceil(input.endSec / 60)} 分`,
    durationSec: segmentLen,
    transcriptPreview,
    climaxNotes: plan.climaxWindows.map((w) => w.reasonZh),
    fallbackLane: card.laneZh,
  });
  if (vision) {
    const filled = applyFrameVisionToProposal(card, vision);
    if (filled) {
      card = {
        ...filled,
        beatGrid: filled.beatGrid.map((beat) => ({
          ...beat,
          atSec:
            Number(beat.atSec) <= segmentLen + 1
              ? Math.round(Number(beat.atSec) + input.startSec)
              : Math.round(Number(beat.atSec) || 0),
        })),
      };
    }
  }
  await fs.unlink(audioPath).catch(() => undefined);
  return {
    ...empty,
    framePaths,
    visionCard: vision ? card : null,
    visionModel: vision?.model || null,
  };
}

function mergeLocalSegmentCards(input: {
  workId: string;
  title: string;
  url?: string;
  durationSec: number;
  segments: LocalSegmentAnalysis[];
}): ManhuaViralTemplateCard {
  const timestamps = input.segments.flatMap((s) => s.timestamps).sort((a, b) => a - b);
  const transcriptPreview = combineTranscriptPreviews(
    input.segments.map((s) => s.transcriptPreview),
  );
  const climaxNotes = input.segments.flatMap((s) => s.climaxNotes);
  let card = draftCard({
    id: input.workId,
    titleHint: input.title || "未命名学习片",
    url: input.url,
    durationSec: input.durationSec,
    timestamps,
    climaxNotes,
    transcriptPreview,
  });
  const filled = input.segments.map((s) => s.visionCard).filter(Boolean) as ManhuaViralTemplateCard[];
  if (!filled.length) return card;
  const first = filled[0]!;
  card = {
    ...card,
    nameZh: first.nameZh,
    laneZh: first.laneZh,
    summaryZh: "长片按时间分段学习后合成的节奏草案；只借结构与节拍，须人审后入库。",
    hook3sZh: first.hook3sZh,
    beatGrid: filled.flatMap((item) => item.beatGrid).sort((a, b) => a.atSec - b.atSec),
    scenePoolHints: Array.from(new Set(filled.flatMap((item) => item.scenePoolHints))),
    castShape: first.castShape,
    densityHints: first.densityHints,
  };
  return card;
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
  const remoteUrl = videoPath ? "" : normalizeDouyinVideoUrl(url);
  if (remoteUrl && /douyin\.com\/search\//i.test(remoteUrl)) {
    throw new Error("当前是抖音搜索页链接，请改用成片/合集页地址后再学节奏");
  }
  if (videoPath) videoPath = path.resolve(videoPath);
  const durationSec = videoPath
    ? await ffprobeDuration(videoPath)
    : await probeRemoteVideoDuration(remoteUrl);
  if (durationSec > MANHUA_LEARN_MAX_DURATION_SEC) {
    throw new Error(`成片超过 ${Math.round(MANHUA_LEARN_MAX_DURATION_SEC / 60)} 分钟，已停止处理`);
  }
  console.log(`[learn] duration=${durationSec.toFixed(1)}s · 分段=${Math.round(MANHUA_LEARN_CHECKPOINT_SEC / 60)}分钟`);

  const segmentsDir = path.join(workDir, "segments");
  await fs.mkdir(segmentsDir, { recursive: true });
  const analyses: LocalSegmentAnalysis[] = [];
  let cursor = 0;
  while (cursor < durationSec - 0.5) {
    const segment = nextManhuaLearnVideoSegment({
      cursorSec: cursor,
      durationSec,
      segmentSec: MANHUA_LEARN_CHECKPOINT_SEC,
    });
    if (!segment) break;
    const segmentDir = path.join(
      segmentsDir,
      `segment_${String(Math.floor(segment.startSec)).padStart(5, "0")}`,
    );
    const checkpointPath = path.join(segmentDir, "analysis.json");
    const checkpoint = await readLocalSegmentCheckpoint(checkpointPath, segment);
    if (checkpoint) {
      console.log(
        `[learn] 已有检查点，跳过 ${Math.floor(segment.startSec / 60)}–${Math.ceil(segment.endSec / 60)} 分`,
      );
      analyses.push(checkpoint);
      cursor = segment.endSec;
      continue;
    }
    await fs.rm(segmentDir, { recursive: true, force: true });
    await fs.mkdir(segmentDir, { recursive: true });
    let currentVideoPath = videoPath;
    let mediaStartSec = 0;
    if (!currentVideoPath) {
      logLearnStage(
        MANHUA_LEARN_STAGE.download,
        `正在下载 ${Math.floor(segment.startSec / 60)}–${Math.ceil(segment.endSec / 60)} 分片段…`,
      );
      currentVideoPath = await downloadVideoSegment({
        url: remoteUrl,
        workDir: segmentDir,
        startSec: segment.startSec,
        endSec: segment.endSec,
      });
      mediaStartSec = segment.startSec;
    }
    const analysis = await analyzeLocalSegment({
      workId,
      title,
      url: remoteUrl || undefined,
      videoPath: currentVideoPath,
      mediaStartSec,
      startSec: segment.startSec,
      endSec: segment.endSec,
      segmentDir,
      dry,
    });
    await writeJsonAtomic(checkpointPath, analysis);
    if (!videoPath) await fs.unlink(currentVideoPath).catch(() => undefined);
    analyses.push(analysis);
    console.log(
      `[learn] 检查点已落盘 ${Math.round(segment.endSec / 60)}/${Math.round(durationSec / 60)} 分`,
    );
    cursor = segment.endSec;
  }

  if (dry) {
    console.log(`[learn] --dry-plan 已写 ${analyses.length} 个分段计划，跳过提案`);
    return;
  }

  let card = mergeLocalSegmentCards({
    workId,
    title,
    url: remoteUrl || undefined,
    durationSec,
    segments: analyses,
  });
  const visionFilled = analyses.some((item) => Boolean(item.visionCard));
  const framePaths = analyses.flatMap((item) => item.framePaths);

  const validated = parseManhuaViralTemplateCard(card);
  if (!validated) throw new Error("提案卡校验失败");

  await fs.mkdir(PROPOSALS, { recursive: true });
  const proposalPath = path.join(PROPOSALS, `${validated.id}.json`);
  await fs.writeFile(proposalPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  await appendChangelog(
    validated.id,
    `segments=${analyses.length} frames=${framePaths.length} vision=${visionFilled ? "terra" : "skip"}`,
  );

  const manifestPath = path.join(workDir, "manifest.json");
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        proposalPath,
        framePaths,
        segmentCheckpoints: analyses.map((item) => ({
          rangeSec: [item.startSec, item.endSec],
          planPath: item.planPath,
        })),
        visionFilled,
        visionModels: Array.from(new Set(analyses.map((item) => item.visionModel).filter(Boolean))),
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

/**
 * 按戏抽帧探针（¥0，零模型调用）：给已完成的探针轮按「六原则」重抽关键帧，
 * 替代每镜中点的机械抽法。帧带 reason 标签（camera/composition/emotion/lighting/plot/audio）：
 *   1. camera —— 运动镜头抽起止两帧（短镜只抽中点）；
 *   2. composition —— 景别与前一镜突变（等级差 ≥2）抽镜头起点；
 *   3. emotion —— 微表情非琐碎抽一帧，爆发动作取镜内 60% 时点；
 *   4. lighting —— 光线与前一镜显著不同，成对抽前镜收尾帧 + 本镜开场帧；
 *   5. audio/plot —— 声音事件 cue 与冲突台词的秒位落进哪个镜就在哪抽；
 *   6. 密度 —— 平淡镜跳过，同镜近帧合并去重，单轮上限 180 帧按 reason 数保留。
 * 抽出的帧永久存 GCS probes/<run>/frames-v2/，并写 frames-v2-summary.json。广告镜头零帧。
 * 用法：--run=<probe seriesKey> --source=douyin|0996 --url=<片源URL>
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { fetchManhua0996EpisodePlayback } from "../server/services/manhuaLearn0996Source.js";
import { resolveDouyinMediaUrl } from "../server/services/manhuaDouyinMediaResolve.js";
import {
  describeErrorChain,
  sanitizeSensitiveText,
} from "../server/services/manhuaMediaSanitize.js";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcsIfAbsent,
} from "../server/services/gcs.js";

const run = promisify(execFile);
const RUN = String(process.argv.find((a) => a.startsWith("--run="))?.slice(6) || "").trim();
const SOURCE = String(process.argv.find((a) => a.startsWith("--source="))?.slice(9) || "").trim();
const URL_ARG = String(process.argv.find((a) => a.startsWith("--url="))?.slice(6) || "").trim();
if (!RUN || !URL_ARG) throw new Error("缺少 --run= 或 --url=");
if (SOURCE !== "douyin" && SOURCE !== "0996") throw new Error("--source= 只接受 douyin 或 0996");
if (process.env.FLY_APP_NAME !== "mvstudiopro") throw new Error("本探针只允许在 Fly 容器内运行");

const bucket = getGcsBucketName();
const MAX_FRAMES = 180;
const MERGE_GAP_SEC = 0.8;
const EDGE_PAD_SEC = 0.3;

function pickMedia(info: Record<string, unknown>): string {
  const formats = Array.isArray(info.formats) ? info.formats as Array<Record<string, unknown>> : [];
  const candidates = formats
    .filter((row) => String(row.url || "") && String(row.vcodec || "none") !== "none" && String(row.acodec || "none") !== "none")
    .sort((a, b) => Number(a.filesize || a.filesize_approx || 9e15) - Number(b.filesize || b.filesize_approx || 9e15));
  const url = String(candidates[0]?.url || info.url || "");
  if (!/^https:\/\//.test(url)) throw new Error("未解析到带音画的抖音媒体流");
  return url;
}

type FrameReason = "camera" | "composition" | "emotion" | "lighting" | "plot" | "audio";
const REASON_ORDER: FrameReason[] = ["camera", "composition", "emotion", "lighting", "plot", "audio"];

type ShotRow = {
  seg: number;
  shot: number;
  startSec: number;
  endSec: number;
  cameraMoveZh: string;
  shotSizeZh: string;
  microExpressionZh: string;
  bodyActionZh: string;
  actionZh: string;
  lightingZh: string;
};

type PlannedFrame = { seg: number; shot: number; atSec: number; reasons: FrameReason[] };

const field = (shot: Record<string, unknown>, key: string): string => String(shot[key] ?? "").trim();

/** 原则1（camera）：cameraMoveZh 非固定/静止/无 视为运动镜头。 */
function isMovingCamera(cameraMoveZh: string): boolean {
  if (!cameraMoveZh) return false;
  return !/^(固定机位|固定|静止|无)$/.test(cameraMoveZh);
}

/** 原则2（composition）：景别映射等级；未识别返回 null 不参与突变判定。 */
function shotSizeLevel(shotSizeZh: string): number | null {
  if (!shotSizeZh) return null;
  if (shotSizeZh.includes("大特写")) return 0;
  if (shotSizeZh.includes("特写")) return 1;
  if (shotSizeZh.includes("近景")) return 2;
  if (shotSizeZh.includes("中景")) return 3;
  if (shotSizeZh.includes("大远景") || shotSizeZh.includes("远景")) return 5;
  if (shotSizeZh.includes("全景")) return 4;
  return null;
}

/** 原则3（emotion）：琐碎微表情集合，不值得为其抽帧。 */
function isTrivialMicroExpression(microExpressionZh: string): boolean {
  if (!microExpressionZh) return true;
  if (/^(无|平静|面无表情)$/.test(microExpressionZh)) return true;
  return microExpressionZh.includes("无明显");
}

const BURST_ACTION = /爆发|哭|吼|颤抖|崩溃|怒|惊/;

/** 原则4（lighting）：光线相对前一镜是否显著变化。 */
function isLightingShift(prev: string, current: string): boolean {
  if (!current) return false;
  if (/转|变|切|骤/.test(current)) return true;
  if (!prev) return false;
  const strongWord = /逆光|剪影|轮廓|冷|暖|红|蓝|闪|暗|亮/;
  return prev.slice(0, 6) !== current.slice(0, 6) && strongWord.test(current);
}

/** 原则5（plot）：字幕冲突词。 */
const PLOT_WORDS = /身份|真相|竟然|原来|死|杀|滚|废物|跪/;

/** 把时点夹回镜头内（离终点留 0.1s，避免 -ss 落到下一镜首帧）。 */
function clampIntoShot(atSec: number, shot: ShotRow): number {
  const upper = Math.max(shot.startSec, shot.endSec - 0.1);
  return Math.round(Math.min(Math.max(atSec, shot.startSec), upper) * 10) / 10;
}

/**
 * 六原则选帧计划：输入按序全部 story 镜头 + 全片绝对秒位的 cue/plot 时间点，
 * 输出去重合并、限量后的帧计划。纯函数，便于对照原则逐条审计。
 */
function computeFramePlan(
  shots: ShotRow[],
  audioCueSecs: number[],
  plotSubtitleSecs: number[],
): { frames: PlannedFrame[]; skippedShotCount: number } {
  const perShot = new Map<string, PlannedFrame[]>();
  const push = (shot: ShotRow, atSec: number, reason: FrameReason) => {
    const key = `${shot.seg}#${shot.shot}`;
    const rows = perShot.get(key) ?? [];
    if (rows.length === 0) perShot.set(key, rows);
    rows.push({ seg: shot.seg, shot: shot.shot, atSec: clampIntoShot(atSec, shot), reasons: [reason] });
  };

  const containing = (absSec: number): ShotRow | undefined =>
    shots.find((s) => absSec >= s.startSec && absSec < Math.max(s.endSec, s.startSec + 0.1));

  for (let i = 0; i < shots.length; i += 1) {
    const shot = shots[i]!;
    const prev = i > 0 ? shots[i - 1]! : undefined;
    const durationSec = Math.max(0, shot.endSec - shot.startSec);

    // 原则1 camera：运动镜头抽起止两帧；镜长 <1.5s 只抽中点一帧。
    if (isMovingCamera(shot.cameraMoveZh)) {
      if (durationSec < 1.5) {
        push(shot, shot.startSec + durationSec / 2, "camera");
      } else {
        push(shot, shot.startSec + EDGE_PAD_SEC, "camera");
        push(shot, shot.endSec - EDGE_PAD_SEC, "camera");
      }
    }

    // 原则2 composition：景别与前一镜等级差 ≥2 → 本镜起点 +0.3 一帧。
    const level = shotSizeLevel(shot.shotSizeZh);
    const prevLevel = prev ? shotSizeLevel(prev.shotSizeZh) : null;
    if (level !== null && prevLevel !== null && Math.abs(level - prevLevel) >= 2) {
      push(shot, shot.startSec + EDGE_PAD_SEC, "composition");
    }

    // 原则3 emotion：微表情非琐碎一帧；爆发动作取镜内 60% 时点，否则中点。
    if (!isTrivialMicroExpression(shot.microExpressionZh)) {
      const burst = BURST_ACTION.test(`${shot.bodyActionZh}${shot.actionZh}`);
      push(shot, shot.startSec + durationSec * (burst ? 0.6 : 0.5), "emotion");
    }

    // 原则4 lighting：与前一镜显著不同 → 成对抽前镜 endSec-0.3 + 本镜 startSec+0.3。
    if (prev && isLightingShift(prev.lightingZh, shot.lightingZh)) {
      push(prev, prev.endSec - EDGE_PAD_SEC, "lighting");
      push(shot, shot.startSec + EDGE_PAD_SEC, "lighting");
    }
  }

  // 原则5 audio/plot：全片绝对秒位落进哪个 story 镜头，就在该秒位抽一帧。
  for (const absSec of audioCueSecs) {
    const shot = containing(absSec);
    if (shot) push(shot, absSec, "audio");
  }
  for (const absSec of plotSubtitleSecs) {
    const shot = containing(absSec);
    if (shot) push(shot, absSec, "plot");
  }

  // 原则6 密度：同镜内帧间距 <0.8s 视为同帧，reason 合并成数组；
  // 平淡镜（上面五条一条都没命中）自然零帧，只计入 skippedShotCount。
  const merged: PlannedFrame[] = [];
  for (const rows of perShot.values()) {
    rows.sort((a, b) => a.atSec - b.atSec);
    let current: PlannedFrame | undefined;
    for (const row of rows) {
      if (current && row.atSec - current.atSec < MERGE_GAP_SEC) {
        current.reasons = [...new Set([...current.reasons, ...row.reasons])];
      } else {
        current = { ...row, reasons: [...row.reasons] };
        merged.push(current);
      }
    }
  }
  for (const frame of merged) {
    frame.reasons.sort((a, b) => REASON_ORDER.indexOf(a) - REASON_ORDER.indexOf(b));
  }

  // 原则6 限量：超过 180 帧按 reason 数多者优先保留，再回到时间轴顺序。
  const kept = merged
    .slice()
    .sort((a, b) => b.reasons.length - a.reasons.length || a.atSec - b.atSec)
    .slice(0, MAX_FRAMES)
    .sort((a, b) => a.seg - b.seg || a.shot - b.shot || a.atSec - b.atSec);

  const shotsWithFrames = new Set(kept.map((f) => `${f.seg}#${f.shot}`));
  const skippedShotCount = shots.filter((s) => !shotsWithFrames.has(`${s.seg}#${s.shot}`)).length;
  return { frames: kept, skippedShotCount };
}

async function resolveMedia(): Promise<{ mediaUrl: string; referer: string }> {
  if (SOURCE === "douyin") {
    // 进程内页面解析：cookie 只进服务端 fetch 请求头，绝不进 argv/子进程。
    // 页面法失败回退匿名 yt-dlp（零 Cookie/凭证 argv）。
    try {
      const resolved = await resolveDouyinMediaUrl(URL_ARG);
      return { mediaUrl: resolved.mediaUrl, referer: "https://www.douyin.com/" };
    } catch (pageError) {
      console.error(`[frames-v2] 页面解析失败，回退匿名 yt-dlp：${sanitizeSensitiveText(pageError)}`);
      const videoId = URL_ARG.match(/(?:modal_id=|\/video\/)(\d{10,24})/)?.[1] || "";
      if (!videoId) throw new Error("抖音 --url= 需要 /video/<id> 或带 modal_id 的链接");
      const { stdout } = await run("yt-dlp", [
        "-J", "--no-warnings", `https://www.douyin.com/video/${videoId}`,
      ], { timeout: 150_000, maxBuffer: 64 * 1024 * 1024 });
      return { mediaUrl: pickMedia(JSON.parse(stdout) as Record<string, unknown>), referer: "https://www.douyin.com/" };
    }
  }
  const playback = await fetchManhua0996EpisodePlayback(URL_ARG);
  const mediaUrl = playback.playbackUrls[0];
  if (!mediaUrl) throw new Error("未解析到媒体地址");
  return { mediaUrl, referer: playback.referer };
}

async function main() {
  console.info(`[frames-v2] 阶段：解析片源媒体地址（${SOURCE}）`);
  const { mediaUrl, referer } = await resolveMedia();

  console.info(`[frames-v2] 阶段：读取 ${RUN} parsed 段卡`);
  const names = await listGcsObjectNamesByPrefix({
    prefix: `manhua-template-learn/segment-evidence/tpl_native_${RUN}_ep001/`,
    literalPrefix: true,
    maxResults: 20,
  });
  if (names.length === 0) throw new Error(`未找到 ${RUN} 的 parsed 段卡`);

  const shots: ShotRow[] = [];
  const audioCueSecs: number[] = [];
  const plotSubtitleSecs: number[] = [];
  const dedupedBySegment = new Map<number, string>();
  for (const name of names.sort()) {
    const m = /\/seg(\d+)-/.exec(name);
    dedupedBySegment.set(Number(m?.[1] ?? -1), name);
  }
  for (const name of Array.from(dedupedBySegment.values()).sort()) {
    const { buffer } = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${name}` });
    const entry = JSON.parse(buffer.toString("utf8")) as {
      segmentIndex: number;
      raw?: {
        shots?: Array<Record<string, unknown>>;
        subtitles?: Array<{ atSec?: unknown; textZh?: unknown }>;
        audioResolution?: Array<{ chunkIndex?: unknown; analysis?: { audioTrack?: Array<{ cues?: Array<{ atSec?: unknown }> }> } }>;
      };
    };
    const rawShots = Array.isArray(entry.raw?.shots) ? entry.raw.shots : [];
    for (let shotIndex = 0; shotIndex < rawShots.length; shotIndex += 1) {
      const shot = rawShots[shotIndex]!;
      if (shot.evidenceRole === "non_story_ad") continue; // 广告镜头零帧
      const startSec = Number(shot.startSec) || 0;
      shots.push({
        seg: entry.segmentIndex,
        shot: shotIndex,
        startSec,
        endSec: Math.max(startSec, Number(shot.endSec) || startSec),
        cameraMoveZh: field(shot, "cameraMoveZh"),
        shotSizeZh: field(shot, "shotSizeZh"),
        microExpressionZh: field(shot, "microExpressionZh"),
        bodyActionZh: field(shot, "bodyActionZh"),
        actionZh: field(shot, "actionZh"),
        lightingZh: field(shot, "lightingZh"),
      });
    }
    // 原则5 audio：cue 局部秒 → 全片绝对秒 = chunkIndex*300 + atSec（全 JSON 唯一局部秒例外）。
    for (const row of entry.raw?.audioResolution ?? []) {
      const chunkIndex = Number(row?.chunkIndex) || 0;
      for (const track of row?.analysis?.audioTrack ?? []) {
        for (const cue of track?.cues ?? []) {
          const atSec = Number(cue?.atSec);
          if (Number.isFinite(atSec)) audioCueSecs.push(chunkIndex * 300 + atSec);
        }
      }
    }
    // 原则5 plot：字幕 atSec 已是全片绝对秒。
    for (const subtitle of entry.raw?.subtitles ?? []) {
      const atSec = Number(subtitle?.atSec);
      if (Number.isFinite(atSec) && PLOT_WORDS.test(String(subtitle?.textZh || ""))) {
        plotSubtitleSecs.push(atSec);
      }
    }
  }
  shots.sort((a, b) => a.startSec - b.startSec || a.seg - b.seg || a.shot - b.shot);

  const plan = computeFramePlan(shots, audioCueSecs, plotSubtitleSecs);
  console.info(`[frames-v2] 选帧计划：story 镜头 ${shots.length} 个 → 计划 ${plan.frames.length} 帧，平淡镜跳过 ${plan.skippedShotCount} 个`);

  const frames: Array<{ seg: number; shot: number; atSec: number; reasons: FrameReason[]; objectName: string; bytes: number }> = [];
  const errors: string[] = [];
  for (const planned of plan.frames) {
    const local = `/tmp/principled-frame-${planned.seg}-${planned.shot}-${Math.round(planned.atSec * 10)}.jpg`;
    try {
      await run("ffmpeg", [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-user_agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "-headers", `Referer: ${referer}\r\n`,
        "-ss", String(planned.atSec), "-i", mediaUrl, "-frames:v", "1", "-q:v", "4", local,
      ], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
      const jpg = await readFile(local);
      const objectName = `manhua-template-learn/probes/${RUN}/frames-v2/seg${planned.seg}/shot${String(planned.shot).padStart(3, "0")}-${Math.round(planned.atSec * 10)}ds-${planned.reasons[0]}.jpg`;
      await uploadBufferToGcsIfAbsent({ bucket, objectName, contentType: "image/jpeg", buffer: jpg });
      frames.push({ ...planned, objectName, bytes: jpg.byteLength });
      await rm(local, { force: true });
      if (frames.length % 20 === 0) console.info(`[frames-v2] 已抽 ${frames.length}/${plan.frames.length} 帧`);
    } catch (error) {
      errors.push(`seg${planned.seg}#${planned.shot}@${planned.atSec}s ${sanitizeSensitiveText(error)}`.slice(0, 120));
      await rm(local, { force: true }).catch(() => {});
    }
  }

  const summary = {
    schemaVersion: 1,
    runId: RUN,
    stage: "principled_frames",
    source: SOURCE,
    plannedFrameCount: plan.frames.length,
    skippedShotCount: plan.skippedShotCount,
    frames,
    errors: errors.length ? errors : undefined,
  };
  const buf = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await uploadBufferToGcsIfAbsent({
    bucket,
    objectName: `manhua-template-learn/probes/${RUN}/frames-v2-summary.json`,
    contentType: "application/json",
    buffer: buf,
  });
  console.info(JSON.stringify({
    runId: RUN,
    frameCount: frames.length,
    skippedShotCount: plan.skippedShotCount,
    errorCount: errors.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
  }));
}

main().catch((error) => {
  console.error(`[frames-v2] 失败：${sanitizeSensitiveText(error)}`);
  console.error(`[frames-v2] 根因链：${JSON.stringify(describeErrorChain(error))}`);
  process.exitCode = 1;
});

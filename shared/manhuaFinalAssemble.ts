/**
 * 漫剧成片坞 → Workflow Render 同源拼接入参 + 配乐提示词。
 * 前台文案禁止出现供应商 / 渲染栈名。
 */

export type ManhuaAssembleClipInput = {
  episodeIndex: number;
  episodeTitle?: string;
  /** 成片视频 URL（必填才进拼接） */
  clipUrl?: string | null;
  /** 可选静帧作集间垫帧 */
  keyartUrl?: string | null;
  /** 成片时长秒，默认 15 */
  durationSec?: number;
};

export type ManhuaAssembleSceneVideo = {
  sceneIndex: number;
  url: string;
  duration: string;
  stillImageUrl?: string;
  stillDuration?: string;
};

export type ManhuaAssemblePlan = {
  sceneVideos: ManhuaAssembleSceneVideo[];
  skippedEpisodes: Array<{ episodeIndex: number; reason: string; title?: string }>;
  episodeIndexes: number[];
};

export type ManhuaSunoPromptInput = {
  topic?: string;
  seriesTitle?: string;
  logline?: string;
};

/**
 * 一次配乐生成约 4 分钟，通常够覆盖约两集；上游常一次出两首，三集一轮够用。
 * 客户端/服务端默认按此时长请求（Udio 侧会再 clamp 到其上限）。
 */
export const MANHUA_ASSEMBLE_MUSIC_DURATION_SEC = 240;

/** 从坞条目（按集）组装 sceneVideos；缺 clip 的集记入 skipped */
export function buildManhuaAssemblePlan(
  clips: ManhuaAssembleClipInput[],
  opts?: { episodeIndexes?: number[]; defaultDurationSec?: number },
): ManhuaAssemblePlan {
  const defaultDur = Math.max(5, Math.min(30, Math.floor(Number(opts?.defaultDurationSec) || 15)));
  const allow = opts?.episodeIndexes?.length
    ? new Set(opts.episodeIndexes.map((n) => Math.floor(Number(n))).filter((n) => n >= 1))
    : null;

  const byEp = new Map<number, ManhuaAssembleClipInput>();
  for (const c of clips) {
    const ep = Math.floor(Number(c.episodeIndex) || 0);
    if (ep < 1) continue;
    if (allow && !allow.has(ep)) continue;
    const prev = byEp.get(ep);
    // 同集优先保留已有 clipUrl 的条目；否则合并 keyart
    if (!prev) {
      byEp.set(ep, { ...c, episodeIndex: ep });
      continue;
    }
    byEp.set(ep, {
      episodeIndex: ep,
      episodeTitle: prev.episodeTitle || c.episodeTitle,
      clipUrl: String(prev.clipUrl || c.clipUrl || "").trim() || undefined,
      keyartUrl: String(prev.keyartUrl || c.keyartUrl || "").trim() || undefined,
      durationSec: prev.durationSec ?? c.durationSec,
    });
  }

  const sortedEps = Array.from(byEp.keys()).sort((a, b) => a - b);
  const sceneVideos: ManhuaAssembleSceneVideo[] = [];
  const skippedEpisodes: ManhuaAssemblePlan["skippedEpisodes"] = [];

  for (const ep of sortedEps) {
    const row = byEp.get(ep)!;
    const url = String(row.clipUrl || "").trim();
    if (!url) {
      skippedEpisodes.push({
        episodeIndex: ep,
        title: row.episodeTitle,
        reason: "缺成片",
      });
      continue;
    }
    const dur = Math.max(5, Math.min(30, Math.floor(Number(row.durationSec) || defaultDur)));
    const still = String(row.keyartUrl || "").trim();
    sceneVideos.push({
      sceneIndex: ep,
      url,
      duration: `${dur}s`,
      stillImageUrl: still || undefined,
      stillDuration: still ? "1.2s" : undefined,
    });
  }

  return {
    sceneVideos,
    skippedEpisodes,
    episodeIndexes: sceneVideos.map((s) => s.sceneIndex),
  };
}

/**
 * 配乐英文提示（给上游音乐生成用；UI 不展示供应商名）。
 * 纯器乐、服务竖屏连载情绪，不抢对白。
 */
export function buildManhuaSunoPrompt(input: ManhuaSunoPromptInput): string {
  const title = String(input.seriesTitle || "").trim() || "serialized short drama";
  const topic = String(input.topic || "").trim();
  const logline = String(input.logline || "").trim();
  const blend = `${topic} ${logline} ${title}`;
  let mood =
    "cinematic tension, restrained pulse, dry percussion, low strings, subtle traditional color, no vocals";
  if (/江湖|刀|剑|武|客栈|雨夜/.test(blend)) {
    mood =
      "jianghu tension score, sparse guqin colors, low taiko pulse, rain-soaked atmosphere, no vocals, under dialogue";
  }
  if (/朝堂|宫廷|权谋|密令|印|宫/.test(blend)) {
    mood =
      "court intrigue underscore, cold strings, distant ceremonial drums, suspense without melody hook, no vocals";
  }
  if (/甜宠|校园|恋爱|情感/.test(blend)) {
    mood =
      "soft modern drama underscore, warm piano, light pads, gentle tempo ~90 BPM, no vocals, leave room for dialogue";
  }
  if (/婚礼|红妆|凤冠|成亲|花嫁|喜堂/.test(blend)) {
    mood =
      "ancient wedding underscore, ceremonial drums distant, soft suona colors restrained, warm strings, festive but under dialogue, no vocals";
  }
  const themeLine = truncateAscii(
    logline || topic || title,
    90,
  );
  return `${themeLine}\nInstrumental BGM for vertical short-drama episodes: ${mood}. Max 100 words. Purely instrumental.`.slice(
    0,
    480,
  );
}

function truncateAscii(s: string, max: number): string {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t || "short drama atmosphere";
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}

/** 蓝/红轨是否已有笔迹或锚点（工作台状态行） */
export function summarizeManhuaPathTrackStatus(annotation: unknown): {
  hasBlueCamera: boolean;
  hasRedSubject: boolean;
  labelZh: string;
} {
  const o = annotation && typeof annotation === "object" ? (annotation as Record<string, unknown>) : null;
  const anchors = Array.isArray(o?.anchors) ? o!.anchors : [];
  const strokes = Array.isArray(o?.strokes) ? o!.strokes : [];
  let hasBlueCamera = false;
  let hasRedSubject = false;
  for (const a of anchors) {
    if (!a || typeof a !== "object") continue;
    const role = String((a as { trackRole?: string }).trackRole || "subject");
    if (role === "camera") hasBlueCamera = true;
    else hasRedSubject = true;
  }
  for (const s of strokes) {
    if (!s || typeof s !== "object") continue;
    const role = String((s as { trackRole?: string }).trackRole || "");
    if (role === "camera") hasBlueCamera = true;
    if (role === "subject") hasRedSubject = true;
  }
  const labelZh = `运镜标注：蓝轨${hasBlueCamera ? "✓" : "—"} · 动作红轨${hasRedSubject ? "✓" : "—"}`;
  return { hasBlueCamera, hasRedSubject, labelZh };
}

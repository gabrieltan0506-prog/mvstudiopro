/**
 * 漫剧成片坞 → Workflow Render 同源拼接入参 + 配乐提示词。
 * 前台文案禁止出现供应商 / 渲染栈名。
 */

import type { ManhuaSubtitleSource } from "./manhuaRenderedSubtitle.js";

export type ManhuaAssembleShotPieceInput = {
  shotIndex: number;
  /** 同一集内的最终播放顺序（1-based）；缺失时保持旧版段序。 */
  timelineOrder?: number;
  /** 源片绝对入点（秒） */
  trimInSec: number;
  /** 源片绝对出点（秒） */
  trimOutSec: number;
  durationSec?: number;
};

export type ManhuaAssembleClipInput = {
  subtitleSource?: ManhuaSubtitleSource;
  episodeIndex: number;
  episodeTitle?: string;
  /** 成片视频 URL（必填才进拼接） */
  clipUrl?: string | null;
  /** 可选静帧作集间垫帧 */
  keyartUrl?: string | null;
  /** 成片时长秒，默认 15 */
  durationSec?: number;
  /** 同集多段时的段号（1-based）；有则按段序拼接，不再每集只留一条 */
  segmentIndex?: number;
  /** 整段裁切（无 shotPieces 时生效） */
  trimInSec?: number;
  trimOutSec?: number;
  /** 按镜绝对秒切片（优先；同源 URL 多段裁切） */
  shotPieces?: ManhuaAssembleShotPieceInput[];
};

export type ManhuaAssembleSceneVideo = {
  subtitleSource?: ManhuaSubtitleSource;
  subtitleShotIndex?: number;
  sceneIndex: number;
  url: string;
  duration: string;
  stillImageUrl?: string;
  stillDuration?: string;
  /** ffmpeg 源片裁切入点 */
  trimInSec?: number;
  /** ffmpeg 源片裁切出点 */
  trimOutSec?: number;
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

export const MANHUA_ASSEMBLE_INVALID_TIMELINE_ORDER_CODE =
  "manhua_assemble_invalid_timeline_order" as const;

type TimelineEntry = {
  row: ManhuaAssembleClipInput;
  piece?: ManhuaAssembleShotPieceInput;
};

function invalidTimelineOrderError(): Error & { code: string } {
  const error = new Error(
    "粗剪顺序不完整或重复，请重新确认本集镜头顺序"
  ) as Error & {
    code: string;
  };
  error.code = MANHUA_ASSEMBLE_INVALID_TIMELINE_ORDER_CODE;
  return error;
}

function hasTimelineOrder(
  piece: unknown
): piece is ManhuaAssembleShotPieceInput {
  return (
    Boolean(piece) &&
    typeof piece === "object" &&
    Object.prototype.hasOwnProperty.call(piece, "timelineOrder")
  );
}

/**
 * 同一集只接受两种合同：全旧稿（完全没有 timelineOrder），或所有可播镜片均有
 * 唯一连续的 1..N。只要出现新字段，就禁止混入整段、缺号或部分标记。
 */
function buildEpisodeTimelineEntries(
  rows: ManhuaAssembleClipInput[]
): TimelineEntry[] {
  const playable = rows.filter(row =>
    Boolean(String(row.clipUrl || "").trim())
  );
  const pieces = playable.flatMap(row =>
    (Array.isArray(row.shotPieces) ? row.shotPieces : []).map(piece => ({
      row,
      piece,
    }))
  );
  const hasAnyOrder = pieces.some(({ piece }) => hasTimelineOrder(piece));

  if (!hasAnyOrder) {
    return playable.flatMap(row => {
      const legacyPieces = Array.isArray(row.shotPieces) ? row.shotPieces : [];
      return legacyPieces.length
        ? legacyPieces.map(piece => ({ row, piece }))
        : [{ row }];
    });
  }

  if (
    playable.some(
      row => !Array.isArray(row.shotPieces) || row.shotPieces.length === 0
    ) ||
    pieces.some(
      ({ piece }) =>
        !hasTimelineOrder(piece) ||
        !Number.isInteger(piece.timelineOrder) ||
        Number(piece.timelineOrder) < 1 ||
        !Number.isInteger(piece.shotIndex) ||
        piece.shotIndex < 1 ||
        !Number.isFinite(piece.trimInSec) ||
        !Number.isFinite(piece.trimOutSec) ||
        piece.trimOutSec - piece.trimInSec < 0.5
    )
  ) {
    throw invalidTimelineOrderError();
  }

  const orders = pieces.map(({ piece }) => Number(piece.timelineOrder));
  const sortedOrders = [...orders].sort((a, b) => a - b);
  const shotIndexes = pieces.map(({ piece }) => piece.shotIndex);
  if (
    new Set(orders).size !== orders.length ||
    new Set(shotIndexes).size !== shotIndexes.length ||
    sortedOrders.some((order, index) => order !== index + 1)
  ) {
    throw invalidTimelineOrderError();
  }

  return pieces.sort(
    (a, b) => Number(a.piece.timelineOrder) - Number(b.piece.timelineOrder)
  );
}

function normalizeTrimPair(
  inSec: unknown,
  outSec: unknown,
  fallbackDur: number,
): { trimInSec?: number; trimOutSec?: number; durationSec: number } {
  const tin = Number(inSec);
  const tout = Number(outSec);
  if (Number.isFinite(tin) && Number.isFinite(tout) && tout - tin >= 0.5) {
    const trimInSec = Math.max(0, Math.round(tin * 10) / 10);
    const trimOutSec = Math.max(trimInSec + 0.5, Math.round(tout * 10) / 10);
    return {
      trimInSec,
      trimOutSec,
      durationSec: Math.round((trimOutSec - trimInSec) * 10) / 10,
    };
  }
  return { durationSec: fallbackDur };
}

/**
 * renderer 会把 still 追加在其所属 scene 之后，因此这里只能把垫帧挂到本集最后一条
 * scene。最后一集不挂；缺片集不在 episodeIndexes 中，也不会凭空生成垫帧。
 */
function attachInterEpisodeStills(
  sceneVideos: ManhuaAssembleSceneVideo[],
  episodeIndexes: number[],
  lastScenePositionByEpisode: Map<number, number>,
  keyartByEpisode: Map<number, string>,
): void {
  for (const episodeIndex of episodeIndexes.slice(0, -1)) {
    const stillImageUrl = keyartByEpisode.get(episodeIndex);
    const scenePosition = lastScenePositionByEpisode.get(episodeIndex);
    if (!stillImageUrl || scenePosition == null) continue;
    sceneVideos[scenePosition] = {
      ...sceneVideos[scenePosition]!,
      stillImageUrl,
      stillDuration: "1.2s",
    };
  }
}

/** 从坞条目组装 sceneVideos；支持同集多段 + 镜级/段级 trim */
export function buildManhuaAssemblePlan(
  clips: ManhuaAssembleClipInput[],
  opts?: { episodeIndexes?: number[]; defaultDurationSec?: number },
): ManhuaAssemblePlan {
  const defaultDur = Math.max(5, Math.min(30, Math.floor(Number(opts?.defaultDurationSec) || 15)));
  const allow = opts?.episodeIndexes?.length
    ? new Set(opts.episodeIndexes.map((n) => Math.floor(Number(n))).filter((n) => n >= 1))
    : null;

  const list = (Array.isArray(clips) ? clips : [])
    .map((c) => ({
      ...c,
      episodeIndex: Math.floor(Number(c.episodeIndex) || 0),
      segmentIndex: Math.max(0, Math.floor(Number(c.segmentIndex) || 0)),
    }))
    .filter((c) => c.episodeIndex >= 1 && (!allow || allow.has(c.episodeIndex)));

  const multiSegment = list.some((c) => c.segmentIndex >= 1) ||
    list.filter((c) => String(c.clipUrl || "").trim()).length >
      new Set(list.filter((c) => String(c.clipUrl || "").trim()).map((c) => c.episodeIndex)).size;

  const sceneVideos: ManhuaAssembleSceneVideo[] = [];
  const skippedEpisodes: ManhuaAssemblePlan["skippedEpisodes"] = [];
  const seenEps = new Set<number>();
  const lastScenePositionByEpisode = new Map<number, number>();

  if (multiSegment) {
    const sorted = [...list].sort((a, b) => {
      if (a.episodeIndex !== b.episodeIndex) return a.episodeIndex - b.episodeIndex;
      return (a.segmentIndex || 0) - (b.segmentIndex || 0);
    });
    const keyartByEp = new Map<number, string>();
    for (const row of sorted) {
      const still = String(row.keyartUrl || "").trim();
      if (still && !keyartByEp.has(row.episodeIndex)) keyartByEp.set(row.episodeIndex, still);
    }
    let sceneNo = 0;
    const epsWithClip = new Set<number>();
    const episodeRows = new Map<number, ManhuaAssembleClipInput[]>();
    for (const row of sorted) {
      if (!String(row.clipUrl || "").trim()) continue;
      epsWithClip.add(row.episodeIndex);
      const rows = episodeRows.get(row.episodeIndex) || [];
      rows.push(row);
      episodeRows.set(row.episodeIndex, rows);
    }
    for (const episodeIndex of Array.from(episodeRows.keys()).sort(
      (a, b) => a - b
    )) {
      for (const entry of buildEpisodeTimelineEntries(
        episodeRows.get(episodeIndex)!
      )) {
        const row = entry.row;
        const url = String(row.clipUrl || "").trim();
        if (entry.piece) {
          const p = entry.piece;
          const fb = Math.max(0.5, Number(p.durationSec) || defaultDur);
          const trim = normalizeTrimPair(p.trimInSec, p.trimOutSec, fb);
          sceneNo += 1;
          sceneVideos.push({
            subtitleSource: row.subtitleSource,
            subtitleShotIndex: p.shotIndex,
            sceneIndex: sceneNo,
            url,
            duration: `${trim.durationSec}s`,
            trimInSec: trim.trimInSec,
            trimOutSec: trim.trimOutSec,
          });
          lastScenePositionByEpisode.set(row.episodeIndex, sceneVideos.length - 1);
        } else {
          const fb = Math.max(5, Math.min(30, Math.floor(Number(row.durationSec) || defaultDur)));
          const trim = normalizeTrimPair(row.trimInSec, row.trimOutSec, fb);
          sceneNo += 1;
          sceneVideos.push({
            subtitleSource: row.subtitleSource,
            sceneIndex: sceneNo,
            url,
            duration: `${trim.durationSec}s`,
            trimInSec: trim.trimInSec,
            trimOutSec: trim.trimOutSec,
          });
          lastScenePositionByEpisode.set(row.episodeIndex, sceneVideos.length - 1);
        }
      }
    }
    for (const row of sorted) {
      if (seenEps.has(row.episodeIndex)) continue;
      seenEps.add(row.episodeIndex);
      if (!epsWithClip.has(row.episodeIndex)) {
        skippedEpisodes.push({
          episodeIndex: row.episodeIndex,
          title: row.episodeTitle,
          reason: "缺成片",
        });
      }
    }
    const episodeIndexes = Array.from(epsWithClip).sort((a, b) => a - b);
    attachInterEpisodeStills(
      sceneVideos,
      episodeIndexes,
      lastScenePositionByEpisode,
      keyartByEp,
    );
    return {
      sceneVideos,
      skippedEpisodes,
      episodeIndexes,
    };
  }

  // 兼容：每集一条（旧坞）
  const byEp = new Map<number, ManhuaAssembleClipInput>();
  for (const c of list) {
    const ep = c.episodeIndex;
    const prev = byEp.get(ep);
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
      trimInSec: prev.trimInSec ?? c.trimInSec,
      trimOutSec: prev.trimOutSec ?? c.trimOutSec,
      shotPieces: prev.shotPieces?.length ? prev.shotPieces : c.shotPieces,
      subtitleSource: prev.subtitleSource || c.subtitleSource,
    });
  }

  const sortedEps = Array.from(byEp.keys()).sort((a, b) => a - b);
  const keyartByEp = new Map<number, string>();
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
    const still = String(row.keyartUrl || "").trim();
    if (still) keyartByEp.set(ep, still);
    const entries = buildEpisodeTimelineEntries([row]);
    if (entries[0]?.piece) {
      for (const entry of entries) {
        const p = entry.piece!;
        const fb = Math.max(0.5, Number(p.durationSec) || defaultDur);
        const trim = normalizeTrimPair(p.trimInSec, p.trimOutSec, fb);
        sceneVideos.push({
          subtitleSource: row.subtitleSource,
          subtitleShotIndex: p.shotIndex,
          sceneIndex: sceneVideos.length + 1,
          url,
          duration: `${trim.durationSec}s`,
          trimInSec: trim.trimInSec,
          trimOutSec: trim.trimOutSec,
        });
        lastScenePositionByEpisode.set(ep, sceneVideos.length - 1);
      }
    } else {
      const fb = Math.max(5, Math.min(30, Math.floor(Number(row.durationSec) || defaultDur)));
      const trim = normalizeTrimPair(row.trimInSec, row.trimOutSec, fb);
      sceneVideos.push({
        subtitleSource: row.subtitleSource,
        sceneIndex: ep,
        url,
        duration: `${trim.durationSec}s`,
        trimInSec: trim.trimInSec,
        trimOutSec: trim.trimOutSec,
      });
      lastScenePositionByEpisode.set(ep, sceneVideos.length - 1);
    }
  }

  const episodeIndexes = sceneVideos.length
    ? Array.from(
        new Set(
          sortedEps.filter((ep) => {
            const row = byEp.get(ep);
            return Boolean(String(row?.clipUrl || "").trim());
          }),
        ),
      )
    : [];
  attachInterEpisodeStills(
    sceneVideos,
    episodeIndexes,
    lastScenePositionByEpisode,
    keyartByEp,
  );

  return {
    sceneVideos,
    skippedEpisodes,
    episodeIndexes,
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

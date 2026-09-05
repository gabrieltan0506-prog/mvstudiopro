/**
 * 漫剧成片坞：配乐 + 同源 Final Render。
 * 供 Fly jobs worker 异步执行；前端经 Vercel→Fly 短请求入队后轮询 GET /api/jobs/:id。
 */
import { renderWorkflowFinalVideo } from "../vercel-api-core/render.js";
import { normalizeManhuaSubtitleSource, type ManhuaRenderedSubtitle } from "../../shared/manhuaRenderedSubtitle.js";
import {
  MANHUA_ASSEMBLE_INVALID_TIMELINE_ORDER_CODE,
  buildManhuaAssemblePlan,
  type ManhuaAssembleClipInput,
  type ManhuaAssembleSceneVideo,
} from "../../shared/manhuaFinalAssemble.js";
import {
  inspectManhuaAssembleCompleteness,
  type ManhuaAssembleSegmentRef,
} from "../../shared/manhuaAssembleCompleteness.js";

function s(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

function invalidTimelineOrderError(): Error & { code: string } {
  const error = new Error(
    "粗剪顺序不完整或重复，请重新确认本集镜头顺序"
  ) as Error & {
    code: string;
  };
  error.code = MANHUA_ASSEMBLE_INVALID_TIMELINE_ORDER_CODE;
  return error;
}

export type ManhuaAssembleFinalInput = {
  clips?: ManhuaAssembleClipInput[];
  sceneVideos?: ManhuaAssembleSceneVideo[];
  episodeIndexes?: number[];
  expectedSegments?: ManhuaAssembleSegmentRef[];
  musicUrl?: string;
  musicPrompt?: string;
  topic?: string;
  seriesTitle?: string;
  logline?: string;
  musicDuration?: number;
  musicProvider?: string;
  musicVolume?: number;
  musicFadeInSec?: number;
  musicFadeOutSec?: number;
  transition?: string;
  resolution?: string;
};

export type ManhuaAssembleFinalResult = {
  subtitleTimeline?: ManhuaRenderedSubtitle;
  finalVideoUrl: string;
  musicUrl?: string;
  musicPrompt?: string;
  musicProvider?: string;
  sceneCount: number;
  episodeIndexes: number[];
  skippedEpisodes: Array<{ episodeIndex: number; reason: string; title?: string }>;
};

export async function runManhuaAssembleFinal(
  raw: ManhuaAssembleFinalInput,
): Promise<ManhuaAssembleFinalResult> {
  let sceneVideos: ManhuaAssembleSceneVideo[] = [];
  let skippedEpisodes: ManhuaAssembleFinalResult["skippedEpisodes"] = [];

  if (Array.isArray(raw.sceneVideos) && raw.sceneVideos.length) {
    sceneVideos = raw.sceneVideos
      .map((row, i) => {
        const trimIn = Number((row as { trimInSec?: number })?.trimInSec);
        const trimOut = Number((row as { trimOutSec?: number })?.trimOutSec);
        const hasTrim =
          Number.isFinite(trimIn) && Number.isFinite(trimOut) && trimOut - trimIn >= 0.5;
        return {
          subtitleSource: normalizeManhuaSubtitleSource(row.subtitleSource),
          subtitleShotIndex: row.subtitleShotIndex,
          sceneIndex: Math.max(1, Math.floor(Number(row?.sceneIndex) || i + 1)),
          url: s(row?.url).trim(),
          duration: s(row?.duration).trim() || "15s",
          stillImageUrl: s(row?.stillImageUrl).trim() || undefined,
          stillDuration: s(row?.stillDuration).trim() || undefined,
          trimInSec: hasTrim ? trimIn : undefined,
          trimOutSec: hasTrim ? trimOut : undefined,
        };
      })
      .filter((row) => Boolean(row.url));
  } else {
    const clipsRaw = Array.isArray(raw.clips) ? raw.clips : [];
    const clips: ManhuaAssembleClipInput[] = clipsRaw.map((row) => {
      const piecesRaw = Array.isArray((row as { shotPieces?: unknown[] }).shotPieces)
        ? (row as { shotPieces: unknown[] }).shotPieces
        : [];
      const orderedPieceContract = piecesRaw.some(
        (piece) =>
          Boolean(piece) &&
          typeof piece === "object" &&
          Object.prototype.hasOwnProperty.call(piece, "timelineOrder")
      );
      const shotPieces = piecesRaw
        .map((p) => {
          const o =
            p && typeof p === "object"
              ? (p as {
                  shotIndex?: number;
                  timelineOrder?: number;
                  trimInSec?: number;
                  trimOutSec?: number;
                  durationSec?: number;
                })
              : {};
          const hasTimelineOrder = Object.prototype.hasOwnProperty.call(o, "timelineOrder");
          const timelineOrder = o?.timelineOrder;
          const shotIndex = Math.floor(Number(o?.shotIndex) || 0);
          const trimInSec = Number(o?.trimInSec);
          const trimOutSec = Number(o?.trimOutSec);
          const validPiece = shotIndex >= 1 && Number.isFinite(trimInSec) &&
            Number.isFinite(trimOutSec) && trimOutSec - trimInSec >= 0.5;
          if (
            (hasTimelineOrder &&
              (typeof timelineOrder !== "number" ||
                !Number.isInteger(timelineOrder) ||
                timelineOrder < 1)) ||
            (orderedPieceContract && (!hasTimelineOrder || !validPiece))
          ) {
            throw invalidTimelineOrderError();
          }
          return {
            shotIndex,
            ...(hasTimelineOrder ? { timelineOrder } : {}),
            trimInSec,
            trimOutSec,
            durationSec: Number(o?.durationSec) || undefined,
          };
        })
        .filter(
          (p) =>
            p.shotIndex >= 1 &&
            Number.isFinite(p.trimInSec) &&
            Number.isFinite(p.trimOutSec) &&
            p.trimOutSec - p.trimInSec >= 0.5,
        );
      const trimIn = Number((row as { trimInSec?: number }).trimInSec);
      const trimOut = Number((row as { trimOutSec?: number }).trimOutSec);
      return {
        subtitleSource: normalizeManhuaSubtitleSource(row.subtitleSource),
        episodeIndex: Math.floor(Number(row?.episodeIndex) || 0),
        episodeTitle: s(row?.episodeTitle).trim() || undefined,
        clipUrl: s(row?.clipUrl || (row as { url?: string })?.url).trim() || undefined,
        keyartUrl:
          s(row?.keyartUrl || (row as { stillImageUrl?: string })?.stillImageUrl).trim() ||
          undefined,
        durationSec: Number(row?.durationSec) || undefined,
        segmentIndex: Math.floor(Number((row as { segmentIndex?: number }).segmentIndex) || 0) || undefined,
        trimInSec:
          Number.isFinite(trimIn) && Number.isFinite(trimOut) && trimOut - trimIn >= 0.5
            ? trimIn
            : undefined,
        trimOutSec:
          Number.isFinite(trimIn) && Number.isFinite(trimOut) && trimOut - trimIn >= 0.5
            ? trimOut
            : undefined,
        shotPieces: shotPieces.length ? shotPieces : undefined,
      };
    });
    const episodeIndexes = Array.isArray(raw.episodeIndexes)
      ? raw.episodeIndexes.map((n) => Math.floor(Number(n) || 0)).filter((n) => n >= 1)
      : undefined;
    const expectedSegments = Array.isArray(raw.expectedSegments)
      ? raw.expectedSegments
      : [];
    if (expectedSegments.length) {
      const completeness = inspectManhuaAssembleCompleteness({
        planned: expectedSegments,
        selected: clips
          .filter((clip) => Boolean(String(clip.clipUrl || "").trim()))
          .map((clip) => ({
            episodeIndex: clip.episodeIndex,
            segmentIndex: Math.max(1, Math.floor(Number(clip.segmentIndex) || 1)),
          })),
      });
      if (!completeness.complete) {
        const error = new Error(completeness.hintZh);
        (error as Error & { code?: string }).code = "manhua_assemble_incomplete";
        throw error;
      }
    }
    const plan = buildManhuaAssemblePlan(clips, { episodeIndexes });
    sceneVideos = plan.sceneVideos;
    skippedEpisodes = plan.skippedEpisodes;
  }

  if (!sceneVideos.length) {
    const err = new Error("至少需要一集成片才能合成长片");
    (err as Error & { code?: string }).code = "manhua_assemble_no_clips";
    throw err;
  }

  // 配乐必须在配乐间由用户另行确认；合成只复用选定音轨，不隐式调用上游。
  const musicUrl = s(raw.musicUrl).trim();
  const musicPrompt = "";
  const musicProviderUsed = "";

  const musicVolume = Number.isFinite(Number(raw.musicVolume))
    ? Math.max(0, Number(raw.musicVolume))
    : 0.35;
  const musicFadeInSec = Number.isFinite(Number(raw.musicFadeInSec))
    ? Math.max(0, Number(raw.musicFadeInSec))
    : 1;
  const musicFadeOutSec = Number.isFinite(Number(raw.musicFadeOutSec))
    ? Math.max(0, Number(raw.musicFadeOutSec))
    : 2;

  let subtitleTimeline: ManhuaRenderedSubtitle | undefined;
  const finalVideoUrl = await renderWorkflowFinalVideo({
    onSubtitleTimeline: timeline => { subtitleTimeline = timeline; },
    preserveSourceAudio: true,
    sceneVideos: sceneVideos.map((sv) => ({
      subtitleSource: sv.subtitleSource,
      subtitleShotIndex: sv.subtitleShotIndex,
      sceneIndex: sv.sceneIndex,
      url: sv.url,
      duration: sv.duration,
      stillImageUrl: sv.stillImageUrl,
      stillDuration: sv.stillDuration,
      trimInSec: sv.trimInSec,
      trimOutSec: sv.trimOutSec,
    })),
    musicUrl: musicUrl || undefined,
    musicVolume,
    musicFadeInSec,
    musicFadeOutSec,
    transition: s(raw.transition).trim() || "fade",
    resolution: s(raw.resolution).trim() || "9:16",
  });

  return {
    subtitleTimeline,
    finalVideoUrl,
    musicUrl: musicUrl || undefined,
    musicPrompt: musicPrompt || undefined,
    musicProvider: musicProviderUsed || undefined,
    sceneCount: sceneVideos.length,
    episodeIndexes: sceneVideos.map((sv) => sv.sceneIndex),
    skippedEpisodes,
  };
}

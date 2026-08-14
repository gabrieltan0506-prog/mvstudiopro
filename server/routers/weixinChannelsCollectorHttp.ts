import { createHash, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  containsWeixinChannelsAdvertisement,
  qualifyWeixinChannelsObservationLocally,
  weixinChannelsCaptureBudgetMs,
  WEIXIN_CHANNELS_TERRA_CLEANUP_BATCH_COUNT,
} from "../../shared/weixinChannelsRules";
import {
  getWeixinChannelsMinerState,
  ingestWeixinChannelsObservations,
  pauseWeixinChannelsCaptureForSafetyFuse,
  recordWeixinChannelsHeartbeat,
  refreshWeixinChannelsCandidates,
  summarizeCandidateSources,
} from "../growth/weixinChannelsMinerStore";
import { isTrendCoverCollectionActive } from "../growth/trendCoverSelection";

function tokenDigest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function verifyWeixinChannelsCollectorToken(token: string) {
  const expected = String(process.env.WEIXIN_CHANNELS_COLLECTOR_TOKEN || "").trim();
  const actual = String(token || "").trim();
  if (!expected || !actual) return false;
  return timingSafeEqual(tokenDigest(expected), tokenDigest(actual));
}

function authorize(req: Request, res: Response) {
  const bearer = String(req.headers.authorization || "");
  const token = String(req.headers["x-weixin-channels-collector-token"] || (bearer.toLowerCase().startsWith("bearer ") ? bearer.slice(7) : "")).trim();
  if (verifyWeixinChannelsCollectorToken(token)) return true;
  res.status(401).json({ ok: false, error: "unauthorized" });
  return false;
}

const metric = z.number().finite().nonnegative().optional();
export const weixinChannelsObservationSchema = z.object({
  observationId: z.string().min(6).max(120),
  videoIdentity: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  taskId: z.string().min(6).max(120),
  query: z.string().min(1).max(100),
  resultRank: z.number().int().positive().max(500),
  title: z.string().min(1).max(500),
  author: z.string().max(200).optional(),
  url: z.string().url().max(2_000).optional(),
  coverImageBase64: z.string().max(700_000).optional(),
  visualImageBase64: z.string().max(700_000).optional(),
  visualAssetKind: z.enum(["platform_cover", "representative_frame"]).optional(),
  visualFrameProgress: z.number().finite().min(0).max(1).optional(),
  publishedAt: z.string().datetime().optional(),
  observedAt: z.string().datetime(),
  likes: metric,
  comments: metric,
  shares: metric,
  favorites: metric,
  views: metric,
  followers: metric,
  friendsFollowing: metric,
  commentSamples: z.array(z.object({
    author: z.string().max(100).optional(),
    text: z.string().min(1).max(500),
    likeCount: metric,
    signals: z.array(z.enum(["high_like", "repeated", "controversial", "question"])).max(4).optional(),
  })).max(20).optional(),
  ocrTexts: z.array(z.string().max(4_000)).max(12).optional(),
  videoDurationSec: z.number().finite().positive().max(86_400).optional(),
  captureBudgetMs: z.number().int().positive().max(8_642_000).optional(),
  captureElapsedMs: z.number().int().nonnegative().max(8_642_000).optional(),
  evidence: z.enum(["capture", "manual"]),
  runKind: z.enum(["formal", "probe"]).optional(),
}).refine((item) => [item.likes, item.comments, item.shares, item.favorites, item.views].filter((value) => value !== undefined).length >= 2, {
  message: "至少需要两个真实互动指标，禁止用估算值补齐",
}).refine((item) => {
  const qualification = qualifyWeixinChannelsObservationLocally(item);
  return !qualification.requiresComments || Boolean(item.commentSamples?.length);
}, {
  message: "评论数达到 80 时必须采集真实评论样本，不能只记评论数量",
}).refine((item) => {
  if (item.captureElapsedMs === undefined || item.videoDurationSec === undefined) return true;
  const authoritativeBudget = weixinChannelsCaptureBudgetMs(item.videoDurationSec);
  return item.captureElapsedMs <= authoritativeBudget
    && (item.captureBudgetMs === undefined || item.captureBudgetMs <= authoritativeBudget);
}, {
  message: "单条采集总耗时不得超过视频时长约十分之一加 2 秒容差",
});

const ingestSchema = z.object({
  taskId: z.string().min(6).max(120),
  observations: z.array(weixinChannelsObservationSchema).min(1).max(100),
});

export function registerWeixinChannelsCollectorHttpRoutes(app: Express) {
  app.post("/api/internal/weixin-channels/heartbeat", async (req, res) => {
    if (!authorize(req, res)) return;
    const parsed = z.object({ clientId: z.string().min(3).max(120) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "invalid_heartbeat" });
      return;
    }
    try {
      const result = await recordWeixinChannelsHeartbeat(parsed.data.clientId);
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/internal/weixin-channels/pause", async (req, res) => {
    if (!authorize(req, res)) return;
    const parsed = z.object({
      reason: z.enum(["persistent_black_screen", "persistent_same_content"]),
      consecutiveFailures: z.number().int().min(3).max(100),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "invalid_safety_pause" });
      return;
    }
    try {
      const state = await pauseWeixinChannelsCaptureForSafetyFuse(parsed.data.reason);
      res.json({ ok: true, capture: state.capture });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/internal/weixin-channels/status", async (req, res) => {
    if (!authorize(req, res)) return;
    try {
      const state = await getWeixinChannelsMinerState();
      const hourStartedAt = Date.now() - 60 * 60_000;
      res.json({
        ok: true,
        capture: state.capture,
        aggregationPaused: state.aggregationPaused,
        accumulatedQualifiedCount: state.observations.filter((item) => item.runKind !== "probe" && item.qualified && !item.invalid && !item.consumedAt && !item.aggregationJobId).length,
        probeQualifiedCount: state.observations.filter((item) => item.runKind === "probe" && item.qualified && !item.invalid).length,
        deepseekCompletedBatchCount: state.jobs.filter((item) => item.kind === "formal" && item.stage === "deepseek_batch" && item.status === "completed" && !item.cleanedByJobId).length,
        terraCleanupBatchTarget: WEIXIN_CHANNELS_TERRA_CLEANUP_BATCH_COUNT,
        totalUniqueScanned: state.observations.length,
        lastHourPersistedUnique: state.observations.filter((item) => item.runKind !== "probe"
          && item.qualified
          && !item.invalid
          && Boolean(item.persistedAt)
          && Date.parse(item.persistedAt!) >= hourStartedAt).length,
        lastHourDuplicateCount: state.recentDuplicatePersistEvents.filter((item) => Date.parse(item) >= hourStartedAt).length,
        collectorVersion: "weixin-channels-v3",
        jobs: state.jobs,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/internal/weixin-channels/candidates", async (req, res) => {
    if (!authorize(req, res)) return;
    try {
      const state = req.query.refresh === "0"
        ? await getWeixinChannelsMinerState()
        : await refreshWeixinChannelsCandidates();
      res.json({
        ok: true,
        updatedAt: state.updatedAt,
        candidates: state.candidates,
        sourceCounts: summarizeCandidateSources(state.candidates),
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/internal/weixin-channels/persisted-identities", async (req, res) => {
    if (!authorize(req, res)) return;
    const parsed = z.object({ since: z.string().datetime() }).safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "invalid_since" });
      return;
    }
    try {
      const sinceMs = Date.parse(parsed.data.since);
      const state = await getWeixinChannelsMinerState();
      const records = state.observations
        .filter((item) => Boolean(item.persistedAt) && Date.parse(item.persistedAt!) >= sinceMs)
        .map((item) => ({ videoIdentity: item.videoIdentity, observationId: item.observationId, persistedAt: item.persistedAt }));
      res.json({ ok: true, records });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/internal/weixin-channels/observations", async (req, res) => {
    if (!authorize(req, res)) return;
    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "invalid_observations", issues: parsed.error.issues });
      return;
    }
    try {
      const observations = await Promise.all(parsed.data.observations.map(async (observation) => {
        const qualification = qualifyWeixinChannelsObservationLocally(observation);
        const isRepresentativeFrame = Boolean(observation.visualImageBase64);
        const visualImageBase64 = observation.visualImageBase64 || observation.coverImageBase64;
        if (!qualification.qualified || !visualImageBase64 || (!isRepresentativeFrame && !isTrendCoverCollectionActive())) {
          return observation;
        }
        const buffer = Buffer.from(visualImageBase64, "base64");
        if (buffer.length < 64 || buffer.length > 500_000) throw new Error("weixin_channels_cover_invalid");
        const { uploadBufferToPlatformStorage } = await import("../services/evolinkGptImage2.js");
        const assetUrl = await uploadBufferToPlatformStorage(
          buffer,
          isRepresentativeFrame ? "growth_visual_frames/weixin_channels" : "growth_cover_candidates/weixin_channels",
        );
        return {
          ...observation,
          coverImageBase64: undefined,
          visualImageBase64: undefined,
          ...(isRepresentativeFrame
            ? { visualUrl: assetUrl, visualCapturedAt: new Date().toISOString(), visualAssetKind: "representative_frame" as const }
            : { coverUrl: assetUrl, coverCapturedAt: new Date().toISOString() }),
        };
      }));
      const result = await ingestWeixinChannelsObservations({ ...parsed.data, observations });
      res.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

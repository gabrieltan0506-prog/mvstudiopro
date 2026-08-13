import { createHash, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  containsWeixinChannelsAdvertisement,
  WEIXIN_CHANNELS_COMMENT_THRESHOLD,
  WEIXIN_CHANNELS_TERRA_CLEANUP_BATCH_COUNT,
} from "../../shared/weixinChannelsRules";
import {
  getWeixinChannelsMinerState,
  ingestWeixinChannelsObservations,
  recordWeixinChannelsHeartbeat,
  refreshWeixinChannelsCandidates,
  summarizeCandidateSources,
} from "../growth/weixinChannelsMinerStore";

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
  taskId: z.string().min(6).max(120),
  query: z.string().min(1).max(100),
  resultRank: z.number().int().positive().max(500),
  title: z.string().min(1).max(500),
  author: z.string().max(200).optional(),
  url: z.string().url().max(2_000).optional(),
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
  captureBudgetMs: z.number().int().positive().max(8_640_000).optional(),
  captureElapsedMs: z.number().int().nonnegative().max(8_640_000).optional(),
  evidence: z.enum(["capture", "manual"]),
  runKind: z.enum(["formal", "probe"]).optional(),
}).refine((item) => [item.likes, item.comments, item.shares, item.favorites, item.views].filter((value) => value !== undefined).length >= 2, {
  message: "至少需要两个真实互动指标，禁止用估算值补齐",
}).refine((item) => (
  containsWeixinChannelsAdvertisement(item.ocrTexts)
  || item.comments === undefined
  || item.comments < WEIXIN_CHANNELS_COMMENT_THRESHOLD
  || Boolean(item.commentSamples?.length)
), {
  message: "评论数达到 80 时必须采集真实评论样本，不能只记评论数量",
}).refine((item) => item.captureElapsedMs === undefined || item.captureBudgetMs === undefined || item.captureElapsedMs <= item.captureBudgetMs, {
  message: "单条采集总耗时不得超过视频时长的十分之一",
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

  app.get("/api/internal/weixin-channels/status", async (req, res) => {
    if (!authorize(req, res)) return;
    try {
      const state = await getWeixinChannelsMinerState();
      res.json({
        ok: true,
        capture: state.capture,
        aggregationPaused: state.aggregationPaused,
        accumulatedQualifiedCount: state.observations.filter((item) => item.runKind !== "probe" && item.qualified && !item.invalid && !item.consumedAt && !item.aggregationJobId).length,
        probeQualifiedCount: state.observations.filter((item) => item.runKind === "probe" && item.qualified && !item.invalid).length,
        deepseekCompletedBatchCount: state.jobs.filter((item) => item.kind === "formal" && item.stage === "deepseek_batch" && item.status === "completed" && !item.cleanedByJobId).length,
        terraCleanupBatchTarget: WEIXIN_CHANNELS_TERRA_CLEANUP_BATCH_COUNT,
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

  app.post("/api/internal/weixin-channels/observations", async (req, res) => {
    if (!authorize(req, res)) return;
    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "invalid_observations", issues: parsed.error.issues });
      return;
    }
    try {
      const result = await ingestWeixinChannelsObservations(parsed.data);
      res.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

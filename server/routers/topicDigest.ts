import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "../_core/trpc.js";
import { topicCreationBrief, topicPreferenceSchema, topicPeriod, TOPIC_DIGEST_INTERVAL_MS } from "../../shared/topicDigest.js";
import { readTopicPreference, saveTopicPreference, listTopicNotifications, getTopicNotification, updateTopicNotification, topicPoolState, readTopicRecommendationCount } from "../services/topicDigestStore.js";

async function safe<T>(fn: () => Promise<T>) {
  try { return await fn(); } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new TRPCError({ code: "BAD_REQUEST", message: /^[\u3400-\u9fff]/.test(message) ? message : "选题通知暂不可用，请稍后再试。" });
  }
}
const scope = z.object({ scope: z.string().max(64) });
const target = z.object({ id: z.string().min(1).max(80), topicId: z.string().min(1).max(30) });
export const topicDigestProcedures = {
  topicDigestInbox: protectedProcedure.input(scope).query(({ ctx }) => safe(async () => {
    const preference = await readTopicPreference(ctx.user.id);
    return { preference, notifications: await listTopicNotifications(ctx.user.id), recommendationCount: await readTopicRecommendationCount(ctx.user.id),
      batchState: preference?.enabled ? await topicPoolState(preference.lane, topicPeriod()) : "off" as const,
      nextAt: new Date((topicPeriod() + 1) * TOPIC_DIGEST_INTERVAL_MS).toISOString() };
  })),
  saveTopicDigestPreference: protectedProcedure.input(topicPreferenceSchema).mutation(({ ctx, input }) => safe(() => saveTopicPreference(ctx.user.id, input))),
  readTopicDigest: protectedProcedure.input(z.object({ id: z.string().min(1).max(80) })).mutation(({ ctx, input }) => safe(async () => {
    await updateTopicNotification(ctx.user.id, input.id, "read"); return { ok: true };
  })),
  dismissTopicDigest: protectedProcedure.input(target).mutation(({ ctx, input }) => safe(async () => {
    await updateTopicNotification(ctx.user.id, input.id, "dismiss", input.topicId); return { ok: true };
  })),
  getTopicDigestDraft: protectedProcedure.input(target.extend({ scope: z.string().max(64) })).query(({ ctx, input }) => safe(async () => {
    const n = await getTopicNotification(ctx.user.id, input.id);
    const topic = n.digest.topics.find(t => t.id === input.topicId);
    if (!topic) throw new Error("选题不存在");
    return { title: topic.title, brief: topicCreationBrief(n.digest, topic), expired: Date.now() > Date.parse(n.digest.expiresAt)
      || topic.sources.some(source => Date.now() - Date.parse(source.observedAt) > TOPIC_DIGEST_INTERVAL_MS) };
  })),
  adoptTopicDigest: protectedProcedure.input(target).mutation(({ ctx, input }) => safe(async () => {
    await updateTopicNotification(ctx.user.id, input.id, "adopt", input.topicId); return { ok: true };
  })),
};

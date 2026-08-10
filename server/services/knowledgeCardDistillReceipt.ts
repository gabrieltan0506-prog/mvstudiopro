/**
 * 图文卡提炼 receipt（2026-08-10 审查必须修 P0·6）。
 *
 * 洞：提炼档位（含超凡 claude-opus-5）此前只由客户端 `input.distillModel` 声明——
 * 用超凡档提炼成功后在出图确认框点「取消」，phase 回 idle 即可切轻量档，
 * 同一份超凡提炼稿按轻量页费出图。
 *
 * 收口：提炼真实跑完的那一刻，服务端落 {userId, sha256(提炼稿), model}；
 * 出图页费按 receipt 里的 model 结算，客户端声明仅在查无 receipt 时参考
 * （手写文本/未走提炼的存量路径）。
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { knowledgeCardDistillReceipts } from "../../drizzle/schema-stripe";
import {
  knowledgeCardPageCreditsForModel,
  resolveKnowledgeCardDistillModel,
  type KnowledgeCardDistillModelId,
} from "../../shared/knowledgeCardDistillModels";

function hashDistilledText(text: string): string {
  return createHash("sha256").update(String(text || "").trim()).digest("hex").slice(0, 64);
}

/** 提炼成功后调用（真实跑了 LLM 才记；skippedDistill 不记） */
export async function recordKnowledgeCardDistillReceipt(
  userId: number,
  model: string,
  distilledMarkdown: string,
): Promise<void> {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new Error("Invalid user id (distill receipt not recorded)");
  }
  const text = String(distilledMarkdown || "").trim();
  if (!text) throw new Error("Empty distilled text (distill receipt not recorded)");
  const db = await getDb();
  if (!db) throw new Error("Database not available (distill receipt not recorded)");
  const textHash = hashDistilledText(text);
  const resolvedModel = resolveKnowledgeCardDistillModel(model);
  // 同一份稿可能被不同档位产出：三元组都留存，查询时取页费最高档，
  // 防止后跑一次低档 receipt 覆盖高档 receipt 后降价。
  await db
    .insert(knowledgeCardDistillReceipts)
    .values({ userId: uid, textHash, model: resolvedModel })
    .onConflictDoNothing();
}

/** 出图计费前查档：命中即以服务端账本为准 */
export async function lookupKnowledgeCardDistillReceiptModel(
  userId: number,
  distilledMarkdown: string,
): Promise<KnowledgeCardDistillModelId | null> {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new Error("Invalid user id (distill receipt unavailable)");
  }
  const text = String(distilledMarkdown || "").trim();
  if (!text) return null;
  const db = await getDb();
  // 查不了服务端账本时必须 fail-closed；回退客户端声明会重新打开“超凡稿按轻量档出图”。
  if (!db) throw new Error("Database not available (distill receipt unavailable)");
  const rows = await db
    .select({ model: knowledgeCardDistillReceipts.model })
    .from(knowledgeCardDistillReceipts)
    .where(
      and(
        eq(knowledgeCardDistillReceipts.userId, uid),
        eq(knowledgeCardDistillReceipts.textHash, hashDistilledText(text)),
      ),
    );
  if (!rows.length) return null;
  const models = rows.map((row) => resolveKnowledgeCardDistillModel(row.model));
  return models.reduce((highest, model) =>
    knowledgeCardPageCreditsForModel(model).full > knowledgeCardPageCreditsForModel(highest).full
      ? model
      : highest,
  );
}

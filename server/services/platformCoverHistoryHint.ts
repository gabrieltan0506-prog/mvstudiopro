/**
 * 平台選題封面前：讀用戶在 user_creations 中歷史成功的 platform_topic_frame，拼短語境給視覺鏈路。
 */
import { and, desc, eq } from "drizzle-orm";
import * as db from "../db";
import { userCreations } from "../../drizzle/schema-creations";

const PLATFORM_TOPIC_FRAME = "platform_topic_frame";

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isLikelyValidImageUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  if (!u) return false;
  if (u.includes("timeout") || u.includes("error")) return false;
  return u.startsWith("http://") || u.startsWith("https://");
}

export async function buildPlatformCoverHistoryHintFromDb(params: {
  userId: number;
  limit?: number;
}): Promise<string> {
  const limit = Math.min(24, Math.max(6, params.limit ?? 12));
  const database = await db.getDb();
  if (!database) return "";

  try {
    const rows = await database
      .select({
        title: userCreations.title,
        outputUrl: userCreations.outputUrl,
        metadata: userCreations.metadata,
      })
      .from(userCreations)
      .where(
        and(
          eq(userCreations.userId, params.userId),
          eq(userCreations.type, PLATFORM_TOPIC_FRAME),
          eq(userCreations.status, "completed"),
        ),
      )
      .orderBy(desc(userCreations.createdAt))
      .limit(limit);

    const good = rows.filter((r) => isLikelyValidImageUrl(String(r.outputUrl || "")));
    if (good.length === 0) return "";

    const titles = good
      .map((r) => String(r.title || "").replace(/\s+/g, " ").trim())
      .filter((t) => t.length >= 4)
      .slice(0, 6);

    let fallbackHeavy = 0;
    for (const r of good.slice(0, 10)) {
      if (parseMetadata(r.metadata).fallbackUsed === true) fallbackHeavy += 1;
    }

    const parts: string[] = [];
    parts.push(
      `【历史竖版封面】此账号已有 ${good.length} 条成功出图。以下为近期主标题语感（供构图与字级，勿照抄全文）：`,
    );
    if (titles.length) {
      parts.push(titles.map((t) => (t.length > 40 ? `「${t.slice(0, 40)}…」` : `「${t}」`)).join(" "));
    }
    if (fallbackHeavy >= 4) {
      parts.push("过往版式兜底较多：本次优先极简大号主标、强对比、少装饰，利信息流缩略图识别。");
    } else {
      parts.push("延续偏好：主信息前置、封面主句字号偏大、对比足。");
    }

    return parts.join("\n").slice(0, 1600);
  } catch (e) {
    console.warn("[buildPlatformCoverHistoryHintFromDb] skip:", e instanceof Error ? e.message : e);
    return "";
  }
}

export function mergeCoverContextWithDbHint(baseContext: string | undefined, hint: string): string | undefined {
  const h = String(hint || "").trim();
  if (!h) return baseContext;
  const b = String(baseContext || "").trim();
  if (!b) return h;
  return `${b}\n\n${h}`;
}

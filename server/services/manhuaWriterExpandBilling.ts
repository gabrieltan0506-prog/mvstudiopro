/**
 * /canvas 编剧室连载扩写用量落库：三档计价、按集扣费；免费额度口径同 `/platform` 人物背景优化。
 */
import { and, count, eq, gte } from "drizzle-orm";
import { getDb } from "../db.js";
import { stripeUsageLogs } from "../../drizzle/schema-stripe.js";
import { type PlatformEngineTierId } from "../../shared/manhuaWriterExpandPricing.js";

export const MANHUA_WRITER_EXPAND_ACTION = "manhuaWriterExpand";

const TIER_LABEL_ZH: Record<PlatformEngineTierId, string> = {
  excellent: "优秀",
  superb: "卓越",
  top: "顶级",
};

function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 历史累计用过多少次（含免费那几次）。 */
export async function countManhuaWriterExpandEver(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ c: count() })
    .from(stripeUsageLogs)
    .where(
      and(eq(stripeUsageLogs.userId, userId), eq(stripeUsageLogs.action, MANHUA_WRITER_EXPAND_ACTION)),
    );
  return Number(row?.c || 0);
}

/** 今天用过多少次。 */
export async function countManhuaWriterExpandToday(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ c: count() })
    .from(stripeUsageLogs)
    .where(
      and(
        eq(stripeUsageLogs.userId, userId),
        eq(stripeUsageLogs.action, MANHUA_WRITER_EXPAND_ACTION),
        gte(stripeUsageLogs.createdAt, startOfTodayLocal()),
      ),
    );
  return Number(row?.c || 0);
}

/**
 * 记一笔用量。免费那几次也要落库，否则「头 3 次 + 每天 1 次」数不出来
 * （0 积分时 `deductCreditsAmount` 不会调用，不会自动留痕）。
 */
export async function logManhuaWriterExpandUse(params: {
  userId: number;
  tier: PlatformEngineTierId;
  episodeCount: number;
  creditsCost: number;
  isFreeQuota: boolean;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(stripeUsageLogs).values({
    userId: params.userId,
    action: MANHUA_WRITER_EXPAND_ACTION,
    creditsCost: Math.max(0, Math.floor(params.creditsCost)),
    isFreeQuota: params.isFreeQuota ? 1 : 0,
    description: `编剧室连载扩写·${TIER_LABEL_ZH[params.tier]}${
      params.isFreeQuota ? "（免费额度）" : "（付费）"
    } · ${params.episodeCount} 集`,
    balanceAfter: null,
  });
}

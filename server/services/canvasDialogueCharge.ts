/** 单句原单恢复只认权威账目，不能因已扣后的余额不足再次拒绝领取音频。 */
import { and, eq } from "drizzle-orm";
import { stripeUsageLogs } from "../../drizzle/schema";
import { CANVAS_TTS_CREDITS_PER_LINE } from "../../shared/canvasGenerationPricing";
import { getDb } from "../db";
import { deductCreditsAmount } from "../credits";

type Charge = { action: string; creditsCost: number };
export type CanvasDialogueChargeDeps = {
  read: (userId: number, chargeKey: string) => Promise<Charge | null>;
  deduct: typeof deductCreditsAmount;
};
const realDeps: CanvasDialogueChargeDeps = {
  async read(userId, chargeKey) {
    const db = await getDb();
    if (!db) throw new Error("配音账目暂时不可用，请稍后恢复原单");
    const [row] = await db.select({ action: stripeUsageLogs.action, creditsCost: stripeUsageLogs.creditsCost })
      .from(stripeUsageLogs).where(and(eq(stripeUsageLogs.userId, userId), eq(stripeUsageLogs.chargeKey, chargeKey))).limit(1);
    return row ?? null;
  },
  deduct: deductCreditsAmount,
};

export async function settleCanvasDialogueCharge(userId: number, requestId: string, deps: CanvasDialogueChargeDeps = realDeps): Promise<void> {
  const chargeKey = `manhua-tts:${userId}:${requestId}`;
  const recorded = async () => {
    const prior = await deps.read(userId, chargeKey);
    if (!prior) return false;
    if (prior.action !== "manhuaDialogueTts" || prior.creditsCost !== CANVAS_TTS_CREDITS_PER_LINE) {
      throw new Error("原配音账目不一致，请保留原单等待核对");
    }
    return true;
  };
  if (await recorded()) return;
  try {
    await deps.deduct(userId, CANVAS_TTS_CREDITS_PER_LINE, "manhuaDialogueTts", "漫剧对白配音（一句）", { chargeKey });
  } catch (error) {
    // 并发另一腿已扣完／数据库回包中断时，再读原账；绝不把未知结果当未扣。
    if (await recorded()) return;
    throw error;
  }
}

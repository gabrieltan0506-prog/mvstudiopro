/**
 * 爆款复刻的分镜（buildPremiumRemix）与出片（generatePremiumRemixAssets）已并入拉片（站长 2026-11-11）。
 * 两个过程保留名字与登录校验，登录后一律走这里：不扣积分、不发任何上游请求、不入队，直接给业务提示。
 * 旧实现 server/growth/premiumRemix.ts 已于 1113 删除。
 * 这两个过程历来是同步返回、不落任务表，没有在途任务需要轮询或退款。
 */
import { TRPCError } from "@trpc/server";
import { PREMIUM_REMIX_RETIRED_CODE, PREMIUM_REMIX_RETIRED_MESSAGE_ZH } from "../../shared/premiumRemixRetired";

export type RetiredPremiumRemixProcedure = "buildPremiumRemix" | "generatePremiumRemixAssets";

export function rejectRetiredPremiumRemix(procedure: RetiredPremiumRemixProcedure, userId?: number): never {
  console.warn(`[premiumRemix] retired_call procedure=${procedure} user=${userId ?? "-"} code=${PREMIUM_REMIX_RETIRED_CODE}`);
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: PREMIUM_REMIX_RETIRED_MESSAGE_ZH });
}

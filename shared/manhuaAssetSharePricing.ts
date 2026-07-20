/**
 * 漫剧资产静帧（人物/场景/服装道具）· 授权进库半价。
 * 产品口径：仅资产图半价；匿名进平台参考库供他人融图。
 * 兑换码/授权码赠送积分：不享半价，生成后无条件入库。
 */

/** 与画布 GPT-Image-2 单张一致 */
export const MANHUA_ASSET_STILL_FULL_CREDITS = 54;
export const MANHUA_ASSET_STILL_SHARE_HALF_CREDITS = Math.round(
  MANHUA_ASSET_STILL_FULL_CREDITS / 2,
);

export type ManhuaAssetStillRole = "character" | "scene" | "prop";

export type ManhuaAssetStillBillingInput = {
  /** 用户勾选授权进库（付费积分路径） */
  shareRequested: boolean;
  /**
   * 估算：尚未花完的兑换码/赠送积分（beta / bonus / referral）。
   * > 0 时按「赠送积分扣费」处理：原价 + 强制入库。
   */
  remainingGiftedCredits: number;
};

export type ManhuaAssetStillBilling = {
  credits: number;
  contribute: boolean;
  halfPriceApplied: boolean;
  /** 因赠送积分阻断半价并强制入库 */
  giftedBlocksHalfPrice: boolean;
  noticeZh: string;
};

/** 付费积分勾选授权时的说明 */
export const MANHUA_ASSET_SHARE_CONSENT_HINT_ZH =
  "勾选授权后，本单人物/场景/服装道具图半价，并匿名收录进平台参考库供他人融图；成片与分镜静帧不享受半价。兑换码/授权码赠送的积分不享半价，生成后仍无条件匿名进库。";

/** 当前将用赠送积分扣费时的说明 */
export const MANHUA_ASSET_SHARE_GIFTED_NOTICE_ZH =
  "当前扣费将使用兑换码/授权码赠送积分：按原价结算，半价不适用；生成后无条件匿名进平台参考库供他人融图。";

export function resolveManhuaAssetStillBilling(
  input: ManhuaAssetStillBillingInput,
): ManhuaAssetStillBilling {
  const giftedBlocksHalfPrice = Number(input.remainingGiftedCredits) > 0;
  if (giftedBlocksHalfPrice) {
    return {
      credits: MANHUA_ASSET_STILL_FULL_CREDITS,
      contribute: true,
      halfPriceApplied: false,
      giftedBlocksHalfPrice: true,
      noticeZh: MANHUA_ASSET_SHARE_GIFTED_NOTICE_ZH,
    };
  }
  if (input.shareRequested) {
    return {
      credits: MANHUA_ASSET_STILL_SHARE_HALF_CREDITS,
      contribute: true,
      halfPriceApplied: true,
      giftedBlocksHalfPrice: false,
      noticeZh: MANHUA_ASSET_SHARE_CONSENT_HINT_ZH,
    };
  }
  return {
    credits: MANHUA_ASSET_STILL_FULL_CREDITS,
    contribute: false,
    halfPriceApplied: false,
    giftedBlocksHalfPrice: false,
    noticeZh: MANHUA_ASSET_SHARE_CONSENT_HINT_ZH,
  };
}

export function manhuaAssetStillCredits(opts: {
  shareToLibrary: boolean;
  remainingGiftedCredits?: number;
}): number {
  return resolveManhuaAssetStillBilling({
    shareRequested: opts.shareToLibrary,
    remainingGiftedCredits: opts.remainingGiftedCredits ?? 0,
  }).credits;
}

export function manhuaAssetStillPriceLabelZh(opts: {
  shareToLibrary: boolean;
  remainingGiftedCredits?: number;
}): string {
  const billing = resolveManhuaAssetStillBilling({
    shareRequested: opts.shareToLibrary,
    remainingGiftedCredits: opts.remainingGiftedCredits ?? 0,
  });
  if (billing.giftedBlocksHalfPrice) {
    return `${billing.credits} 积分（兑换码积分·原价·进库）`;
  }
  if (billing.halfPriceApplied) {
    return `${billing.credits} 积分（授权进库半价）`;
  }
  return `${billing.credits} 积分`;
}

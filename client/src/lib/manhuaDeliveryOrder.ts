/**
 * 漫剧交付纯判据。漫剧工厂与自由画布都必须复用同一顺序：
 * 可交付视频 -> 可选 2K/4K 超分 -> BGM 贴装。
 *
 * 本模块不发请求、不扣费，也不依赖某个页面的局部状态，避免两处入口各守一套规则。
 */

export const MANHUA_DELIVERY_SURFACES = ["manhua_factory", "free_canvas"] as const;
export type ManhuaDeliverySurface = (typeof MANHUA_DELIVERY_SURFACES)[number];

/** 交付超分只开放 2K / 4K；生成分辨率不属于这套判据。 */
export const MANHUA_DELIVERY_UPSCALE_TARGETS = ["2k", "4k"] as const;
export type ManhuaDeliveryUpscaleTarget =
  (typeof MANHUA_DELIVERY_UPSCALE_TARGETS)[number];

export const MANHUA_DELIVERY_UPSCALE_LABEL_ZH: Record<
  ManhuaDeliveryUpscaleTarget,
  string
> = {
  "2k": "2K · 日常发布与常规交付",
  "4k": "4K · 高画质发布与母版存档",
};

export type DeliveryDecision =
  | { ok: true; warnZh?: string }
  | { ok: false; reasonZh: string };

type DeliverySourceState = {
  /** 显式保留入口来源，方便两处 UI 共用同一函数且埋点不丢语义。 */
  surface: ManhuaDeliverySurface;
  /** 工厂可以是拼接成片，自由画布可以是单条已完成视频。 */
  hasDeliveryVideo: boolean;
};

export function isManhuaDeliveryUpscaleTarget(
  value: unknown,
): value is ManhuaDeliveryUpscaleTarget {
  return value === "2k" || value === "4k";
}

/** BGM 已经贴进最终音轨后，不再允许把这条混音成片送去超分。 */
export function canUpscaleNow(input: DeliverySourceState & {
  bgmMounted: boolean;
  target: unknown;
}): DeliveryDecision {
  if (!input.hasDeliveryVideo) {
    return { ok: false, reasonZh: "先准备好可交付视频再超分" };
  }
  if (!isManhuaDeliveryUpscaleTarget(input.target)) {
    return { ok: false, reasonZh: "交付超分只支持 2K 或 4K" };
  }
  if (input.bgmMounted) {
    return {
      ok: false,
      reasonZh: "这条已经贴过 BGM。正确顺序是视频→2K/4K 超分→贴 BGM；请改用贴装前母片",
    };
  }
  return { ok: true };
}

/**
 * 不打算超分时可直接贴 BGM；已经选择 2K/4K 但尚未拿到结果时只告警，
 * 由页面让用户确认是否跳过画质链，纯判据不触发任何远程动作。
 */
export function canMountBgmNow(input: DeliverySourceState & {
  wantsUpscale: boolean;
  upscaleCompleted: boolean;
  upscaleTarget?: unknown;
}): DeliveryDecision {
  if (!input.hasDeliveryVideo) {
    return { ok: false, reasonZh: "先准备好可交付视频再贴 BGM" };
  }
  if (input.wantsUpscale && !isManhuaDeliveryUpscaleTarget(input.upscaleTarget)) {
    return { ok: false, reasonZh: "请先选择 2K 或 4K 超分档" };
  }
  if (input.wantsUpscale && !input.upscaleCompleted) {
    return {
      ok: true,
      warnZh: "所选 2K/4K 超分尚未完成；建议先超分，再把 BGM 贴到最终画质母片",
    };
  }
  return { ok: true };
}

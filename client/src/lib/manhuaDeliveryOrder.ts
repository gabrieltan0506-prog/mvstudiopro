/**
 * 成片坞交付顺序判据。
 *
 * `bgm-scoring` skill 铁律三：**成片 → 超分 → 再贴 BGM，顺序不可逆**。
 * BGM 一旦混进画面，音轨就是「对白+音效+BGM」混死的一条，再也剥不出来；
 * 硬用频谱分离去剥会伤到对白。
 *
 * 一切「混进去就分不开」的工序（BGM、字幕烧录、水印）一律排在画质链最后。
 * 这条以前靠人守，现在写成判据 —— 顺序做反了不报错，只是成片废掉。
 */

/**
 * 对用户开放的超分档：**2K / 4K 两档**（用户 0824 确认）。
 *
 * 上游常量层仍保留 1080p（`wavespeedVideoUpscaleModels.ts`），
 * 服务端 `api/jobs.ts` 也明写「只支持 2K 或 4K」——这里与之一致。
 *
 * 注意别与 **Wan 3.0 的生成档**混了：那边是 480p/720p/1080p 三档，
 * 1080p 一直可选，默认 720p。生成档与超分档是两件事。
 */
export const MANHUA_DELIVERY_UPSCALE_TARGETS = ["2k", "4k"] as const;
export type ManhuaDeliveryUpscaleTarget = (typeof MANHUA_DELIVERY_UPSCALE_TARGETS)[number];

export const MANHUA_DELIVERY_UPSCALE_LABEL_ZH: Record<ManhuaDeliveryUpscaleTarget, string> = {
  "2k": "2K · 720p 源 2.67 倍放大，肉眼可见提升",
  "4k": "4K · 最高画质，对外物料与存档用",
};

export type ManhuaDeliveryStage = "assembled" | "upscaled" | "scored";

/**
 * 现在能不能超分。
 *
 * 已贴过 BGM 的片子**不许再超分** —— 不是技术上做不到，是超分会重新编码整条
 * 混死的音轨，而正确顺序本该先超分。放行等于让用户把废片做得更贵。
 */
export function canUpscaleNow(input: {
  hasAssembled: boolean;
  bgmMounted: boolean;
}): { ok: true } | { ok: false; reasonZh: string } {
  if (!input.hasAssembled) return { ok: false, reasonZh: "先拼出整片再超分" };
  if (input.bgmMounted) {
    return {
      ok: false,
      reasonZh: "这条已经贴过 BGM。正确顺序是成片→超分→贴 BGM；请用贴装前的母片超分",
    };
  }
  return { ok: true };
}

/**
 * 现在能不能贴 BGM。
 *
 * 打算超分却还没超的，先提示 —— 但**不硬拦**：
 * 用户可能就是不要超分。硬拦会把「我不超分」这条正路堵死。
 */
export function canMountBgmNow(input: {
  hasAssembled: boolean;
  upscaled: boolean;
  wantsUpscale: boolean;
}): { ok: true; warnZh?: string } | { ok: false; reasonZh: string } {
  if (!input.hasAssembled) return { ok: false, reasonZh: "先拼出整片再贴 BGM" };
  if (input.wantsUpscale && !input.upscaled) {
    return { ok: true, warnZh: "还没超分。贴了 BGM 再超分会重新编码混死的音轨，建议先超分" };
  }
  return { ok: true };
}

/** 超分计费秒数：最低按 5 秒，最长 600 秒 */
export function upscaleBilledSeconds(durationSec: number): number {
  const n = Math.ceil(Number(durationSec) || 0);
  if (!Number.isFinite(n)) return 5;
  return Math.min(600, Math.max(5, n));
}

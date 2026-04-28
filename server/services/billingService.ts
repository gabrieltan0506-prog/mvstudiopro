/**
 * 戰略智庫定價中樞
 * 統一管理所有 God-View 產品的積分定價、首購折扣、滿月促銷邏輯
 */

export const GODVIEW_PRICING = {
  /** 全景行業戰報（深度研報）— 首購 4000 / 後續 4900 */
  deep_report_first: 4000,
  deep_report_full: 4900,

  /** 戰略半月刊（單期）— 首購九折 720 / 後續 800 */
  magazine_single: 800,
  magazine_single_first: 720,   // 800 * 0.9

  /** 半年訂閱（12 期）— 首購九折 5400 / 後續 6000 */
  magazine_sub: 6000,
  magazine_sub_first: 5400,     // 6000 * 0.9

  /** 尊貴個性化大洗牌 — 首購九折 2700 / 後續 3000 */
  personalized: 3000,
  personalized_first: 2700,     // 3000 * 0.9

  /** 滿月老用戶雙本促銷 — 800 點換 2 期 */
  bundle_promo: 800,
} as const;

export type GodViewProductType =
  | "deep_report"
  | "magazine_single"
  | "magazine_sub"
  | "personalized";

/** localStorage key 對照表（前端首購狀態記錄） */
export const GODVIEW_FIRST_KEYS: Record<GodViewProductType, string> = {
  deep_report:     "mvs-godview-first-used",
  magazine_single: "mvs-magazine-first-used",
  magazine_sub:    "mvs-magsub-first-used",
  personalized:    "mvs-personalized-first-used",
};

/**
 * 根據產品類型與首購狀態計算實際扣費金額（後端使用）
 */
export function calcGodViewPrice(
  productType: GodViewProductType,
  isFirstTime: boolean,
  isBundlePromo = false,
): { price: number; label: string } {
  switch (productType) {
    case "deep_report":
      return {
        price: isFirstTime ? GODVIEW_PRICING.deep_report_first : GODVIEW_PRICING.deep_report_full,
        label: `AI上帝視角全景戰報（${isFirstTime ? "首次優惠" : "標準"}價）`,
      };

    case "magazine_single":
      if (isBundlePromo) {
        return { price: GODVIEW_PRICING.bundle_promo, label: "戰略半月刊·滿月老用戶雙本促銷" };
      }
      return {
        price: isFirstTime ? GODVIEW_PRICING.magazine_single_first : GODVIEW_PRICING.magazine_single,
        label: `戰略半月刊單期（${isFirstTime ? "首購九折" : "標準"}價）`,
      };

    case "magazine_sub":
      return {
        price: isFirstTime ? GODVIEW_PRICING.magazine_sub_first : GODVIEW_PRICING.magazine_sub,
        label: `戰略半月刊半年訂閱（12期·${isFirstTime ? "首購九折" : "尊貴陪伴"}）`,
      };

    case "personalized":
      return {
        price: isFirstTime ? GODVIEW_PRICING.personalized_first : GODVIEW_PRICING.personalized,
        label: `尊貴個性化大洗牌（${isFirstTime ? "首購九折" : "標準"}價）`,
      };
  }
}

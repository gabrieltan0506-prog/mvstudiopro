/**
 * 戰略智庫定價中樞
 * 統一管理所有 God-View 產品的積分定價、首購折扣、滿月促銷邏輯
 */

export const GODVIEW_PRICING = {
  /** 戰略半月刊（單期）— 首購九折 720 / 後續 800 */
  magazine_single: 800,
  magazine_single_first: 720,   // 800 * 0.9

  /** 半年訂閱（12 期）— 首購九折 5400 / 後續 6000 */
  magazine_sub: 6000,
  magazine_sub_first: 5400,     // 6000 * 0.9

  /** 尊享季度私人訂製 — 首購九折 2700 / 後續 3000 */
  personalized: 3000,
  personalized_first: 2700,     // 3000 * 0.9

  /** 滿月老用戶雙本促銷 — 800 點換 2 期 */
  bundle_promo: 800,
} as const;

export type GodViewProductType =
  | "magazine_single"
  | "magazine_sub"
  | "personalized";

/** localStorage key 對照表（前端首購狀態記錄） */
export const GODVIEW_FIRST_KEYS: Record<GodViewProductType, string> = {
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
    case "magazine_single":
      if (isBundlePromo) {
        return { price: GODVIEW_PRICING.bundle_promo, label: "战略半月刊·满月老用户双本促销" };
      }
      return {
        price: isFirstTime ? GODVIEW_PRICING.magazine_single_first : GODVIEW_PRICING.magazine_single,
        label: `战略半月刊单期（${isFirstTime ? "首购九折" : "标准"}价）`,
      };

    case "magazine_sub":
      return {
        price: isFirstTime ? GODVIEW_PRICING.magazine_sub_first : GODVIEW_PRICING.magazine_sub,
        label: `战略半月刊半年订阅（12期·${isFirstTime ? "首购九折" : "尊贵陪伴"}）`,
      };

    case "personalized":
      return {
        price: isFirstTime ? GODVIEW_PRICING.personalized_first : GODVIEW_PRICING.personalized,
        label: `尊享季度私人订制（${isFirstTime ? "首购九折" : "标准"}价）`,
      };
  }
}

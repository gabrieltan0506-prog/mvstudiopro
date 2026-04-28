/**
 * 战略智库定价中枢
 * 统一管理所有 God-View 产品的积分定价、首购折扣、满月促销逻辑
 */

export const GODVIEW_PRICING = {
  /** 战略半月刊（单期）— 首购九折 720 / 后续 800 */
  magazine_single: 800,
  magazine_single_first: 720,   // 800 * 0.9

  /** 半年订阅（12 期）— 首购九折 5400 / 后续 6000 */
  magazine_sub: 6000,
  magazine_sub_first: 5400,     // 6000 * 0.9

  /** 尊享季度私人订制 — 首购九折 2700 / 后续 3000 */
  personalized: 3000,
  personalized_first: 2700,     // 3000 * 0.9

  /** 满月老用户双本促销 — 800 点换 2 期 */
  bundle_promo: 800,
} as const;

export type GodViewProductType =
  | "magazine_single"
  | "magazine_sub"
  | "personalized";

/** localStorage key 对照表（前端首购状态记录） */
export const GODVIEW_FIRST_KEYS: Record<GodViewProductType, string> = {
  magazine_single: "mvs-magazine-first-used",
  magazine_sub:    "mvs-magsub-first-used",
  personalized:    "mvs-personalized-first-used",
};

/**
 * 根据产品类型与首购状态计算实际扣费金额（后端使用）
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

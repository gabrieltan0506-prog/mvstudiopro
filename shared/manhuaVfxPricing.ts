import { MANHUA_VFX_KINDS, MANHUA_VFX_PRESET_LABELS, type ManhuaVfxEffect } from "./manhuaVfx";

/** 用户确认的逐项标价；null 表示新增效果尚未核价，不是免费或默认价。此表不代表扣费或退款已执行。 */
export const MANHUA_VFX_CREDITS_PER_15_SECONDS: Record<ManhuaVfxEffect["kind"], number | null> = {
  sword_trail: 8, impact_burst: 8, particle_aura: 8, shield: 8, spirit: 8,
  fire_burst: 8, smoke_plume: 8, lightning: 8, shockwave: 8, speed_lines: 8,
  magic_circle: 8, image_overlay: 8, digital_rain: 8,
  liquid_mirror: 16, motion_ghost: 16, wall_fracture: 16, bullet_wave: 16, directed_blast: 16,
  bullet_time: 32,
  // 合并后新增六项没有逐项或类别计价合同；不得类推既有8/16/32档。
  mirror_corridor: null, floating_paper: null, cup_fracture: null,
  fruit_stall_fracture: null, city_fold: null, prop_scene: null,
};

export function manhuaVfxCreditLabel(kind: ManhuaVfxEffect["kind"]) {
  const credits = MANHUA_VFX_CREDITS_PER_15_SECONDS[kind];
  return credits == null ? "待确认标价" : `${credits}积分/15秒`;
}

/** 按整段原片时长计价，多层只取最高单价；超过30秒后的不足15秒尾段半价。 */
export function quoteManhuaVfxCredits(kinds: readonly ManhuaVfxEffect["kind"][], durationSec: number) {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || !kinds.length ||
      kinds.some(kind => !MANHUA_VFX_KINDS.includes(kind))) throw new Error("请先选择特效并读取有效原片时长");
  const unitCredits = Math.max(...kinds.map(kind => {
    const credits = MANHUA_VFX_CREDITS_PER_15_SECONDS[kind];
    if (credits == null) throw new Error(`${MANHUA_VFX_PRESET_LABELS[kind]}尚未核定标价，暂不提供此方案报价`);
    return credits;
  }));
  const units = durationSec <= 30 ? Math.ceil(durationSec / 15) : Math.floor(durationSec / 15) + (durationSec % 15 > 0 ? .5 : 0);
  const credits = units * unitCredits;
  if (!Number.isSafeInteger(credits)) throw new Error("特效时长超出计价范围");
  return { unitCredits, units, credits };
}

import { MANHUA_VFX_KINDS, type ManhuaVfxEffect } from "./manhuaVfx";

/** 用户确认的逐项标价；不代表扣费或退款已经执行。 */
export const MANHUA_VFX_CREDITS_PER_15_SECONDS: Record<ManhuaVfxEffect["kind"], number> = {
  sword_trail: 8, impact_burst: 8, particle_aura: 8, shield: 8, spirit: 8,
  fire_burst: 8, smoke_plume: 8, lightning: 8, shockwave: 8, speed_lines: 8,
  magic_circle: 8, image_overlay: 8, digital_rain: 8,
  liquid_mirror: 16, motion_ghost: 16, wall_fracture: 16, bullet_wave: 16, directed_blast: 16,
  bullet_time: 32,
};

/** 按整段原片时长计价，多层只取最高单价；超过30秒后的不足15秒尾段半价。 */
export function quoteManhuaVfxCredits(kinds: readonly ManhuaVfxEffect["kind"][], durationSec: number) {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || !kinds.length ||
      kinds.some(kind => !MANHUA_VFX_KINDS.includes(kind))) throw new Error("请先选择特效并读取有效原片时长");
  const unitCredits = Math.max(...kinds.map(kind => MANHUA_VFX_CREDITS_PER_15_SECONDS[kind]));
  const units = durationSec <= 30 ? Math.ceil(durationSec / 15) : Math.floor(durationSec / 15) + (durationSec % 15 > 0 ? .5 : 0);
  const credits = units * unitCredits;
  if (!Number.isSafeInteger(credits)) throw new Error("特效时长超出计价范围");
  return { unitCredits, units, credits };
}

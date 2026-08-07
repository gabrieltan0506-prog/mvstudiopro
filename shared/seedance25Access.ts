/**
 * Seedance 2.5（成片·加长）上线时间与可用性闸门。
 *
 * 用户 2026-08-05 明文口径：
 * - 对外宣称上线日，首页读秒倒计时；到点**自动**对用户开放，不必再发版。
 * - 上线后**仅正式付费会员**（Stripe plan pro/enterprise）可用；邀请码只加积分不改 plan → 仍为 free，不可用。
 * - 上线前只有 supervisor / admin 能走（小云雀通道仅对 supervisor 显示，用于内部验收）。
 *
 * 闸门是**纯时间判断**，不看上游通不通：到点就放行，直接打 EvoLink。所以上游未开放时
 * 必须靠推迟本文件的上线时刻来挡，否则会员到点选「成片·加长」会撞上游原始报错，
 * 而那句友好的「尚未开放」只在闸门关着时才抛，反被绕过。
 * 2026-08-07 用户明文：EvoLink 侧 Seedance 2.5 仍未开放，上线时刻由 8/8 推到 8/9。
 */

/** 上线时刻：2026-08-09 00:00 (UTC+8) */
export const SEEDANCE_25_LAUNCH_AT_ISO = "2026-08-09T00:00:00+08:00";
export const SEEDANCE_25_LAUNCH_AT_MS = Date.parse(SEEDANCE_25_LAUNCH_AT_ISO);

/** 对外文案（用户明文授权可写引擎名与日期）。日期一律引用下面两个 label，勿再硬写。 */
export const SEEDANCE_25_LAUNCH_DATE_LABEL_ZH = "8 月 9 日";
export const SEEDANCE_25_LAUNCH_DATE_LABEL_EN = "August 9";
export const SEEDANCE_25_COUNTDOWN_TITLE_ZH = "Seedance 2.5 上线倒计时";
export const SEEDANCE_25_COUNTDOWN_SUBTITLE_ZH = `成片·加长 · 单段最长 30 秒 · ${SEEDANCE_25_LAUNCH_DATE_LABEL_ZH}开放，正式会员可用`;
export const SEEDANCE_25_LAUNCHED_LABEL_ZH = "Seedance 2.5 已上线 · 成片·加长现已开放";

export const SEEDANCE_25_PAID_ONLY_LABEL_ZH =
  "成片·加长仅正式会员可用；邀请码用户请使用成片·快速";
export const SEEDANCE_25_BEFORE_LAUNCH_LABEL_ZH = `成片·加长将于 ${SEEDANCE_25_LAUNCH_DATE_LABEL_ZH}开放，敬请期待；在此之前请使用成片·快速`;

/** 是否已到上线时刻 */
export function isSeedance25Launched(now?: Date | number): boolean {
  const t = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.now();
  return Number.isFinite(SEEDANCE_25_LAUNCH_AT_MS) && t >= SEEDANCE_25_LAUNCH_AT_MS;
}

/** 付费会员判定：邀请码积分用户仍是 free，拿不到 2.5 */
export function canAccessSeedance25ByPlan(plan: string | null | undefined): boolean {
  const p = String(plan || "free").trim().toLowerCase();
  return p === "pro" || p === "enterprise";
}

/** supervisor / admin：上线前也可用（内部验收） */
export function isSeedance25InternalRole(role: string | null | undefined): boolean {
  const r = String(role || "").trim().toLowerCase();
  return r === "supervisor" || r === "admin";
}

export type Seedance25AccessInput = {
  plan?: string | null;
  role?: string | null;
  now?: Date | number;
};

export type Seedance25AccessResult = {
  allowed: boolean;
  /** 拒绝原因：未上线 / 非会员；allowed 时为 null */
  reason: "before_launch" | "paid_only" | null;
  message: string | null;
};

/**
 * 统一判定：supervisor/admin 随时可用；其余用户须「已上线 + 正式会员」。
 * 前端（选择器、生成前）与后端（受理请求）都用这一个，避免前端放开后端 403。
 */
export function resolveSeedance25Access(input: Seedance25AccessInput): Seedance25AccessResult {
  if (isSeedance25InternalRole(input.role)) {
    return { allowed: true, reason: null, message: null };
  }
  if (!isSeedance25Launched(input.now)) {
    return {
      allowed: false,
      reason: "before_launch",
      message: SEEDANCE_25_BEFORE_LAUNCH_LABEL_ZH,
    };
  }
  if (!canAccessSeedance25ByPlan(input.plan)) {
    return { allowed: false, reason: "paid_only", message: SEEDANCE_25_PAID_ONLY_LABEL_ZH };
  }
  return { allowed: true, reason: null, message: null };
}

/** 便捷布尔版（前端过滤选项用） */
export function canUseSeedance25(input: Seedance25AccessInput): boolean {
  return resolveSeedance25Access(input).allowed;
}

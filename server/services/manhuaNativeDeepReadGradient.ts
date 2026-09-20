/**
 * 读片梯度与单镜拒收线的**叶子模块**（不 import 任何本项目模块）。
 *
 * 🔴 为什么单独拆出来：`manhuaNativeDeepReadAttemptSelection.ts` 需要这几个值，
 * 而它与 `manhuaNativeDeepReadRunner.ts` **互相 import**。从 runner 静态 import
 * 会让 runner 的模块级 `defaultDeps` 被提前求值 —— 测试里只部分 mock `./gcs.js` 时
 * 直接抛「No "signGsUriV4ReadUrl" export is defined on the mock」，整份用例收集失败。
 * 值放在叶子模块，两边各自 import，循环就断了；runner 仍 re-export 保持调用方不变。
 */

/** 冻结用的深冻函数（与 runner 同款语义：契约值不许运行期被改）。 */
function deepFreezeGradient<T>(value: T): Readonly<T> {
  if (Array.isArray(value)) value.forEach((row) => deepFreezeGradient(row));
  return Object.freeze(value);
}

/**
 * 🔴 0920 用户令：「降檔重試 0.7--0.65x2--0.6x2，等於0.65與0.6各重試兩次」→ 共 5 发。
 * ⚠️ 只是**次数**变了，两个降档温度值仍是 0.65 / 0.6——段缓存指纹只取 `[1]` 与 `[last]`
 * 两个值，所以**不动已付费分片身份**；但本数组进冻结契约 SHA。
 */
export const NATIVE_DEEP_READ_RETRY_TEMPERATURES = deepFreezeGradient(
  [0.7, 0.65, 0.65, 0.6, 0.6] as const);

/**
 * 🔴 0920 用户令：「單一分片如果連讀五次都不通過，就升級成Gemini 3.1 pro來讀」
 * 「保留分片，不報錯」「直接從0.7--0.65--0.6」。
 */
export const NATIVE_DEEP_READ_ESCALATION_MODEL = "gemini-3.1-pro-preview" as const;
export const NATIVE_DEEP_READ_ESCALATION_TEMPERATURES = deepFreezeGradient(
  [0.7, 0.65, 0.6] as const);

/** 单条证据段硬上限（0920 用户令：30→60，只留一层）。 */
export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC = 60;
/** 门禁数值容差（0920 用户令：15%→20%）。 */
export const NATIVE_DEEP_READ_GATE_TOLERANCE_RATIO = 0.20;
/** 单镜拒收线 = 硬上限 × (1 + 容差) = 72 秒。 */
export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_REJECT_SEC =
  NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC * (1 + NATIVE_DEEP_READ_GATE_TOLERANCE_RATIO);

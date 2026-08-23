/**
 * 对白有效人声门禁（`2026Aug17/drama.md` §10 硬指标的代码化）。
 *
 * 原文九条里，直接决定成片能不能用的是这几条：
 *   · 每段完整台词的**最终有效人声不得短于 2.50 秒**；建议 2.80–3.60
 *   · **不得用尾部补静音、复制尾音或空白拉长达标**
 *   · 不得用固定 atrim 截断表演；只清真正的首尾空白
 *   · 1.75 秒的音频不允许进入 Seedance 或任何视频模型
 *   · 不足 2.50 秒或情绪不合格 → **立即停止，不自动付费重试**
 *
 * 最后一条是重点：这是**闸，不是重试器**。不合格就报出来等人决定，
 * 自动重合成等于用户没批准就又烧一次。
 *
 * ⚠️ 「有效人声」不是容器时长。补过静音的音频容器时长会达标而人声没变，
 * 所以判据取的是 `voicedSec`（去掉首尾静音后的实际发声时长），
 * 由调用方用 silencedetect/astats 量出来传进来 —— 不接受用总时长冒充。
 */

/** 供应商侧：Seedance 参考音频 2–30 秒 */
export const SEEDANCE_REF_AUDIO_MIN_SEC = 2;
export const SEEDANCE_REF_AUDIO_MAX_SEC = 30;

/** 本项目加严：有效人声下限 */
export const MANHUA_VOICE_MIN_SEC = 2.5;
/** 建议区间，低于此只提示不拦 */
export const MANHUA_VOICE_TARGET_MIN_SEC = 2.8;
export const MANHUA_VOICE_TARGET_MAX_SEC = 3.6;

export type ManhuaVoiceMeasurement = {
  /** 容器总时长（秒） */
  totalSec: number;
  /** 去掉首尾静音后的实际发声时长（秒）—— 判据看这个 */
  voicedSec: number;
};

export type ManhuaVoiceGateVerdict =
  | { ok: true; warnZh?: string }
  | { ok: false; reasonZh: string; actionZh: string };

/**
 * 判一段对白能不能进视频模型。
 *
 * **不合格一律 ok:false 并给出「下一步该做什么」**，
 * 因为原文要求的是「立即停止、报告原因和修改方案、取得授权后再打下一次」——
 * 只说「不合格」而不说怎么办，等于把判断推回给用户。
 */
export function checkManhuaDialogueVoice(
  m: ManhuaVoiceMeasurement,
): ManhuaVoiceGateVerdict {
  const total = Number(m.totalSec);
  const voiced = Number(m.voicedSec);
  if (!Number.isFinite(total) || !Number.isFinite(voiced) || voiced < 0 || total < 0) {
    return { ok: false, reasonZh: "时长测量无效", actionZh: "重新用 silencedetect 量一次再判" };
  }
  if (voiced > total + 0.05) {
    return {
      ok: false,
      reasonZh: `有效人声 ${voiced.toFixed(2)}s 超过总时长 ${total.toFixed(2)}s`,
      actionZh: "测量口径有误，检查是否把总时长当成了人声时长",
    };
  }
  if (voiced < MANHUA_VOICE_MIN_SEC) {
    return {
      ok: false,
      reasonZh: `有效人声仅 ${voiced.toFixed(2)}s，低于 ${MANHUA_VOICE_MIN_SEC}s 下限`,
      // 明禁垫静音：垫了容器时长达标而人声没变，等于骗过闸
      actionZh: "改写台词加字数或放慢语速后重合成；不得补静音、复制尾音或拉长空白达标。需授权后再发",
    };
  }
  if (total > SEEDANCE_REF_AUDIO_MAX_SEC) {
    return {
      ok: false,
      reasonZh: `总时长 ${total.toFixed(2)}s 超过参考音频 ${SEEDANCE_REF_AUDIO_MAX_SEC}s 上限`,
      actionZh: "拆句分段，不要用固定 atrim 截断表演",
    };
  }
  // 垫静音的典型形状：人声短、容器长
  const padded = total - voiced;
  if (voiced < MANHUA_VOICE_TARGET_MIN_SEC && padded > 1) {
    return {
      ok: false,
      reasonZh: `有效人声 ${voiced.toFixed(2)}s 但容器 ${total.toFixed(2)}s，疑似尾部补了静音`,
      actionZh: "按真实表演重出；补静音不算达标",
    };
  }
  if (voiced < MANHUA_VOICE_TARGET_MIN_SEC || voiced > MANHUA_VOICE_TARGET_MAX_SEC) {
    return {
      ok: true,
      warnZh: `有效人声 ${voiced.toFixed(2)}s 在建议区间 ${MANHUA_VOICE_TARGET_MIN_SEC}–${MANHUA_VOICE_TARGET_MAX_SEC}s 之外`,
    };
  }
  return { ok: true };
}

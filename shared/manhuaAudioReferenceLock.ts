/**
 * 参考音频·全集参考（软·可选）：整集级的背景音乐（BGM）与对白口音基准参考。
 *
 * 软参考约定（产品边界）：音频不做硬门禁、不挡出片；语音/配乐后期还能改。
 * 只有人物/场景/道具才硬锁，音频仅作「建议对齐」参考。
 *
 * 与 `manhuaCharacterVoiceLock`（按 @角色 挂音色）分工：
 * - 角色声线参考 = 单个角色的音色（Seedance i2v `audio_url`，多人同框最多 3 路）。
 * - 参考音频·全集参考 = 全集建议对齐的两件事：
 *   1) BGM 背景音乐参考（成片配乐阶段对齐；建议别逐段换曲风）。
 *   2) 对白口音基准（各角色对白口音建议统一，如「北方官话·沉稳」）。
 *
 * 口音基准音频仅在「本段没有任何 @角色 声线可挂」时，作为兜底 `audio_url` 参考，
 * 避免顶掉逐角色音色（角色声线优先）。BGM 不进 i2v 音频槽（i2v 不配乐），
 * 只作文本参考注入，供成片配乐/交付阶段对齐。
 */

export type ManhuaAudioReferenceLock = {
  /** 背景音乐参考（HTTPS 音频）；锁全集配乐风格 */
  bgmUrl?: string;
  /** BGM 风格说明（如「古风弦乐·紧张推进」） */
  bgmNoteZh?: string;
  /** 对白口音/音色基准参考（HTTPS 音频） */
  accentUrl?: string;
  /** 口音说明（如「北方官话·沉稳」／「温软吴语」） */
  accentNoteZh?: string;
  updatedAt: number;
};

const HTTPS_RE = /^https:\/\//i;

function cleanUrl(raw: unknown): string | undefined {
  const s = String(raw || "").trim();
  return HTTPS_RE.test(s) ? s : undefined;
}

function cleanNote(raw: unknown): string | undefined {
  const s = String(raw || "").trim().slice(0, 80);
  return s || undefined;
}

/**
 * 归一化；四项全空 → null（视为未设置）。
 */
export function normalizeManhuaAudioReferenceLock(
  raw: unknown,
): ManhuaAudioReferenceLock | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<ManhuaAudioReferenceLock>;
  const bgmUrl = cleanUrl(o.bgmUrl);
  const bgmNoteZh = cleanNote(o.bgmNoteZh);
  const accentUrl = cleanUrl(o.accentUrl);
  const accentNoteZh = cleanNote(o.accentNoteZh);
  if (!bgmUrl && !bgmNoteZh && !accentUrl && !accentNoteZh) return null;
  const updatedAt = Math.max(0, Math.floor(Number(o.updatedAt) || Date.now()));
  return {
    ...(bgmUrl ? { bgmUrl } : {}),
    ...(bgmNoteZh ? { bgmNoteZh } : {}),
    ...(accentUrl ? { accentUrl } : {}),
    ...(accentNoteZh ? { accentNoteZh } : {}),
    updatedAt,
  };
}

/** 口音基准音频 URL（供兜底 audio_url） */
export function resolveManhuaAccentAudioUrl(
  lock: ManhuaAudioReferenceLock | null | undefined,
): string | undefined {
  return lock?.accentUrl && HTTPS_RE.test(lock.accentUrl) ? lock.accentUrl : undefined;
}

/**
 * 成片 prompt 文本锁区块（供模型/配乐阶段对齐）。四项皆空则返回空串。
 */
export function formatManhuaAudioReferenceLockBlock(
  lock: ManhuaAudioReferenceLock | null | undefined,
): string {
  if (!lock) return "";
  const lines: string[] = [];
  const bgm = lock.bgmUrl || lock.bgmNoteZh;
  const accent = lock.accentUrl || lock.accentNoteZh;
  if (!bgm && !accent) return "";
  lines.push("【参考音频·全集参考（软·可选）】");
  if (bgm) {
    lines.push(
      `BGM 参考${lock.bgmUrl ? "已挂" : ""}：${
        lock.bgmNoteZh || "见参考音频"
      }（成片配乐建议对齐此参考，尽量别逐段换曲风；软参考，不挡出片）。`,
    );
  }
  if (accent) {
    lines.push(
      `对白口音基准${lock.accentUrl ? "已挂" : ""}：${
        lock.accentNoteZh || "见参考音频"
      }（各角色对白口音建议统一对齐；角色专属音色仍以角色声线参考为准；软参考，不挡出片）。`,
    );
  }
  return lines.join("\n");
}

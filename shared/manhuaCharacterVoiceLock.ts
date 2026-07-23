/**
 * 角色声线参考锁：从有声成片抠 mp3，挂到 @角色N，后续 Seedance 用 audio_url 参考音色。
 * 非永久 voice_id；需人手提取，跨段可能仍漂。
 */

export type ManhuaCharacterVoiceLock = {
  id: string;
  /** @角色N（画布资产号） */
  characterTag: string;
  /** wa_char_* / custom ref id（可选） */
  characterId?: string;
  labelZh: string;
  /** HTTPS mp3（参考音频） */
  audioUrl: string;
  sourceVideoUrl?: string;
  sourceClipId?: string;
  /** 秒：抠取起点 / 时长（可选，便于复现） */
  startSec?: number;
  durationSec?: number;
  createdAt: number;
};

const TAG_RE = /^@角色\d+$/;

export function makeManhuaCharacterVoiceLockId(): string {
  return `voice_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeManhuaCharacterVoiceLock(
  raw: unknown,
): ManhuaCharacterVoiceLock | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<ManhuaCharacterVoiceLock>;
  const characterTag = String(o.characterTag || "").trim();
  const audioUrl = String(o.audioUrl || "").trim();
  if (!TAG_RE.test(characterTag)) return null;
  if (!/^https:\/\//i.test(audioUrl)) return null;
  const id = String(o.id || "").trim() || makeManhuaCharacterVoiceLockId();
  const labelZh = String(o.labelZh || characterTag).trim().slice(0, 40) || characterTag;
  const characterId = String(o.characterId || "").trim().slice(0, 80) || undefined;
  const sourceVideoUrl = String(o.sourceVideoUrl || "").trim();
  const sourceClipId = String(o.sourceClipId || "").trim().slice(0, 120) || undefined;
  const startSec = Number(o.startSec);
  const durationSec = Number(o.durationSec);
  const createdAt = Math.max(0, Math.floor(Number(o.createdAt) || Date.now()));
  return {
    id,
    characterTag,
    characterId,
    labelZh,
    audioUrl,
    sourceVideoUrl: /^https:\/\//i.test(sourceVideoUrl) ? sourceVideoUrl : undefined,
    sourceClipId,
    startSec: Number.isFinite(startSec) && startSec >= 0 ? startSec : undefined,
    durationSec:
      Number.isFinite(durationSec) && durationSec > 0
        ? Math.min(15, durationSec)
        : undefined,
    createdAt,
  };
}

export function normalizeManhuaCharacterVoiceLocks(
  raw: unknown,
): ManhuaCharacterVoiceLock[] {
  if (!Array.isArray(raw)) return [];
  const out: ManhuaCharacterVoiceLock[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const lock = normalizeManhuaCharacterVoiceLock(item);
    if (!lock) continue;
    // 同角色只保留最新一条（后写覆盖）
    const key = lock.characterTag;
    if (seen.has(key)) {
      const idx = out.findIndex((x) => x.characterTag === key);
      if (idx >= 0) out[idx] = lock;
      continue;
    }
    seen.add(key);
    out.push(lock);
  }
  return out.slice(0, 12);
}

/** 从成片/导戏 prompt 里抽出出场 @角色N */
export function collectManhuaCharacterTagsFromPrompt(
  prompt: string | null | undefined,
): string[] {
  const raw = String(prompt || "");
  const tags = new Set<string>();
  const re = /@角色\d+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) tags.add(m[0]!);
  return Array.from(tags).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

/** 按出场角色挑参考音频（最多 3 段，Seedance 上限） */
export function pickManhuaVoiceAudioUrlsForPrompt(
  prompt: string | null | undefined,
  locks: ManhuaCharacterVoiceLock[] | null | undefined,
  opts?: { limit?: number },
): string[] {
  const limit = Math.max(1, Math.min(3, Math.floor(opts?.limit ?? 3)));
  const byTag = new Map(
    (locks || []).map((l) => [l.characterTag, l.audioUrl] as const),
  );
  const tags = collectManhuaCharacterTagsFromPrompt(prompt);
  const urls: string[] = [];
  for (const tag of tags) {
    const u = byTag.get(tag);
    if (u && !urls.includes(u)) urls.push(u);
    if (urls.length >= limit) break;
  }
  // 无 @ 时仍可用全部锁的前几条（弱兜底）
  if (!urls.length) {
    for (const l of locks || []) {
      if (!urls.includes(l.audioUrl)) urls.push(l.audioUrl);
      if (urls.length >= limit) break;
    }
  }
  return urls;
}

export function formatManhuaCharacterVoiceLockBlock(
  locks: ManhuaCharacterVoiceLock[] | null | undefined,
): string {
  const list = locks || [];
  if (!list.length) return "";
  return [
    "【角色声线参考·跨段锁】",
    "下列音频为已提取的角色声样；成片引擎作参考音色，非永久声线库。BGM 仍后期自叠。",
    ...list.map(
      (l) =>
        `${l.characterTag}=${l.labelZh}（参考音已挂；对白继续用 @ 锁身份）`,
    ),
  ].join("\n");
}

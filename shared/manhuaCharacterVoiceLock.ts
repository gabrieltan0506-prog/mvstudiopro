/**
 * 角色声线参考锁：从有声成片抠 mp3，挂到 @角色N，后续 Seedance 用 audio_url 参考音色。
 * 非永久 voice_id；需人手提取。
 *
 * 同集跨段硬门禁（产品边界）：
 * - 段 ≈ 15s；同集约 5–6 段
 * - 本段有对白的 @角色，若在同集更早段已出场 → 必须已挂声线，否则禁止出片
 * - 同集首次出场不强制；隔很多集偶发 1～2 次不在本门禁（只扫同集段）
 *
 * 多人同框挂载策略：
 * - 只挂「本段有对白」的角色声线
 * - 按对白时长加权排序，最多 3 条（引擎上限）
 * - 超限角色写入 deferred，prompt 注明勿串音
 */

import { parseManhuaClipDirectorCardSummary } from "./manhuaClipDirectorCard.js";

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

export type ManhuaVoiceExtractWindow = {
  startSec: number;
  durationSec: number;
  endSec: number;
  source: "cue" | "fallback";
  labelZh: string;
};

export type ManhuaVoicePickPlan = {
  audioUrls: string[];
  attached: Array<{
    characterTag: string;
    labelZh: string;
    audioUrl: string;
    weightSec: number;
  }>;
  /** 有对白或有锁但因上限未挂上的 @角色 */
  deferredTags: string[];
};

const TAG_RE = /^@角色\d+$/;
const SPEAKER_WIN_RE =
  /约\s*(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)s[\s\S]{0,400}?(?:说话人锁[：:]\s*(@角色\d+)|对白[^\n]*?(@角色\d+))/gi;

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

function clampExtractDuration(sec: number): number {
  if (!Number.isFinite(sec) || sec <= 0) return 8;
  return Math.min(15, Math.max(2, Math.round(sec * 10) / 10));
}

function clampExtractStart(sec: number): number {
  if (!Number.isFinite(sec) || sec < 0) return 0;
  return Math.min(600, Math.round(sec * 10) / 10);
}

/**
 * 按导戏秒轴给某 @角色 推抠声窗口（优先其首段对白秒位）。
 */
export function resolveManhuaVoiceExtractWindow(
  prompt: string | null | undefined,
  characterTag: string,
): ManhuaVoiceExtractWindow {
  const tag = String(characterTag || "").trim();
  const summary = parseManhuaClipDirectorCardSummary(prompt);
  const cueHit = summary.cueRows.find((r) => r.castTags.includes(tag));
  if (cueHit && cueHit.endSec > cueHit.startSec) {
    const startSec = clampExtractStart(cueHit.startSec);
    const rawDur = cueHit.endSec - cueHit.startSec;
    const durationSec = clampExtractDuration(rawDur);
    return {
      startSec,
      durationSec,
      endSec: Math.round((startSec + durationSec) * 10) / 10,
      source: "cue",
      labelZh: `${startSec}–${startSec + durationSec}s · ${cueHit.microOrActionZh || "对白"}`,
    };
  }

  const raw = String(prompt || "");
  SPEAKER_WIN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPEAKER_WIN_RE.exec(raw))) {
    const speaker = String(m[3] || m[4] || "").trim();
    if (speaker !== tag) continue;
    const startSec = clampExtractStart(Number(m[1]));
    const endSec = Number(m[2]);
    const durationSec = clampExtractDuration(
      Number.isFinite(endSec) ? endSec - startSec : 8,
    );
    return {
      startSec,
      durationSec,
      endSec: Math.round((startSec + durationSec) * 10) / 10,
      source: "cue",
      labelZh: `${startSec}–${startSec + durationSec}s · 导戏对白`,
    };
  }

  return {
    startSec: 0,
    durationSec: 8,
    endSec: 8,
    source: "fallback",
    labelZh: "0–8s · 默认窗（导戏无该角色秒位）",
  };
}

/** 各 @角色 在本段的对白权重（秒） */
export function measureManhuaDialogueWeightByTag(
  prompt: string | null | undefined,
): Map<string, number> {
  const weights = new Map<string, number>();
  const add = (tag: string, sec: number) => {
    if (!TAG_RE.test(tag) || !(sec > 0)) return;
    weights.set(tag, Math.round(((weights.get(tag) || 0) + sec) * 10) / 10);
  };
  const summary = parseManhuaClipDirectorCardSummary(prompt);
  for (const row of summary.cueRows) {
    const dur = Math.max(0, row.endSec - row.startSec);
    // 秒轴行里的 @角色 视为说话人候选；多标签时平分时长
    const speakers = row.castTags.filter((t) => TAG_RE.test(t));
    if (!speakers.length) continue;
    const share = dur / speakers.length;
    for (const t of speakers) add(t, share);
  }
  if (!weights.size) {
    const raw = String(prompt || "");
    SPEAKER_WIN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SPEAKER_WIN_RE.exec(raw))) {
      const speaker = String(m[3] || m[4] || "").trim();
      const start = Number(m[1]);
      const end = Number(m[2]);
      add(speaker, Number.isFinite(end - start) ? end - start : 2);
    }
  }
  return weights;
}

/**
 * 多人同框：只挂有对白权重的声线；按时长排序；最多 limit 条。
 */
export function planManhuaVoiceAudioForPrompt(
  prompt: string | null | undefined,
  locks: ManhuaCharacterVoiceLock[] | null | undefined,
  opts?: { limit?: number },
): ManhuaVoicePickPlan {
  const limit = Math.max(1, Math.min(3, Math.floor(opts?.limit ?? 3)));
  const lockList = locks || [];
  const byTag = new Map(lockList.map((l) => [l.characterTag, l] as const));
  const weights = measureManhuaDialogueWeightByTag(prompt);
  const speakingTags = Array.from(weights.keys()).sort((a, b) => {
    const dw = (weights.get(b) || 0) - (weights.get(a) || 0);
    if (dw !== 0) return dw;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  const attached: ManhuaVoicePickPlan["attached"] = [];
  const deferredTags: string[] = [];

  for (const tag of speakingTags) {
    const lock = byTag.get(tag);
    if (!lock) continue;
    if (attached.length < limit) {
      attached.push({
        characterTag: tag,
        labelZh: lock.labelZh,
        audioUrl: lock.audioUrl,
        weightSec: weights.get(tag) || 0,
      });
    } else {
      deferredTags.push(tag);
    }
  }

  // 无人人对白秒轴时：退回「有锁就挂，仍 cap 3」
  if (!attached.length && lockList.length) {
    for (const lock of lockList) {
      if (attached.length >= limit) {
        deferredTags.push(lock.characterTag);
        continue;
      }
      attached.push({
        characterTag: lock.characterTag,
        labelZh: lock.labelZh,
        audioUrl: lock.audioUrl,
        weightSec: 0,
      });
    }
  }

  return {
    audioUrls: attached.map((a) => a.audioUrl),
    attached,
    deferredTags: Array.from(new Set(deferredTags)),
  };
}

/** @deprecated 用 planManhuaVoiceAudioForPrompt；保留薄封装兼容旧调用 */
export function pickManhuaVoiceAudioUrlsForPrompt(
  prompt: string | null | undefined,
  locks: ManhuaCharacterVoiceLock[] | null | undefined,
  opts?: { limit?: number },
): string[] {
  return planManhuaVoiceAudioForPrompt(prompt, locks, opts).audioUrls;
}

export function formatManhuaCharacterVoiceLockBlock(
  locks: ManhuaCharacterVoiceLock[] | null | undefined,
  plan?: ManhuaVoicePickPlan | null,
): string {
  const list = locks || [];
  if (!list.length && !plan?.attached.length) return "";
  const attached = plan?.attached?.length
    ? plan.attached
    : list.map((l) => ({
        characterTag: l.characterTag,
        labelZh: l.labelZh,
        audioUrl: l.audioUrl,
        weightSec: 0,
      }));
  const lines = [
    "【角色声线参考·跨段锁】",
    "下列为已提取声样；成片作参考音色。同集跨段再出场且有对白者必须已挂，禁止靠模型另造。",
    "多人同框：只挂本段有对白的角色，按时长优先，最多 3 路；未挂角色禁止串用别人声线。",
    ...attached.map(
      (l) =>
        `${l.characterTag}=${l.labelZh}${
          l.weightSec > 0 ? `（对白约${l.weightSec}s）` : ""
        }（参考音已挂）`,
    ),
  ];
  if (plan?.deferredTags?.length) {
    lines.push(
      `未挂声线（超 3 路上限）：${plan.deferredTags.join("、")}——勿借用他人参考音。`,
    );
  }
  return lines.join("\n");
}

export type ManhuaEpisodeSegmentPromptRow = {
  localSegmentIndex: number;
  prompt: string;
};

export type ManhuaCrossSegmentVoiceGateResult = {
  ok: boolean;
  /** 本段有对白 + 同集更早段已出场 → 必须锁 */
  requiredTags: string[];
  missingTags: string[];
  messageZh: string;
};

/** 本段有对白权重的 @角色（无秒轴权重时退回「说「」行上的 @角色） */
export function listManhuaSpeakingTagsInPrompt(
  prompt: string | null | undefined,
): string[] {
  const weights = measureManhuaDialogueWeightByTag(prompt);
  const fromWeight = Array.from(weights.entries())
    .filter(([, w]) => w > 0)
    .map(([t]) => t);
  if (fromWeight.length) {
    return fromWeight.sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  }
  const raw = String(prompt || "");
  const tags = new Set<string>();
  const re = /@角色\d+[^\n]{0,40}说「[^」]+」/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const t = m[0]!.match(/@角色\d+/)?.[0];
    if (t) tags.add(t);
  }
  return Array.from(tags).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

/**
 * 同集跨段声线硬门禁。
 * required = 本段有对白 ∩ 同集更早段已出场（任意 @角色 提及）。
 * 缺 HTTPS 声线 → ok=false。
 */
export function evaluateManhuaCrossSegmentVoiceGate(input: {
  localSegmentIndex: number;
  currentPrompt: string;
  episodeSegmentPrompts: ManhuaEpisodeSegmentPromptRow[];
  voiceLocks?: ManhuaCharacterVoiceLock[] | null;
}): ManhuaCrossSegmentVoiceGateResult {
  const localSeg = Math.max(1, Math.floor(Number(input.localSegmentIndex) || 1));
  const speaking = listManhuaSpeakingTagsInPrompt(input.currentPrompt);
  if (!speaking.length) {
    return { ok: true, requiredTags: [], missingTags: [], messageZh: "" };
  }

  const earlierTags = new Set<string>();
  for (const row of input.episodeSegmentPrompts || []) {
    const idx = Math.max(1, Math.floor(Number(row.localSegmentIndex) || 0));
    if (idx < 1 || idx >= localSeg) continue;
    for (const t of collectManhuaCharacterTagsFromPrompt(row.prompt)) {
      earlierTags.add(t);
    }
  }

  const requiredTags = speaking.filter((t) => earlierTags.has(t));
  if (!requiredTags.length) {
    return { ok: true, requiredTags: [], missingTags: [], messageZh: "" };
  }

  const locked = new Set(
    (input.voiceLocks || [])
      .filter((l) => /^https:\/\//i.test(String(l.audioUrl || "")))
      .map((l) => l.characterTag),
  );
  const missingTags = requiredTags.filter((t) => !locked.has(t));
  if (!missingTags.length) {
    return {
      ok: true,
      requiredTags,
      missingTags: [],
      messageZh: "",
    };
  }

  return {
    ok: false,
    requiredTags,
    missingTags,
    messageZh: `第${localSeg}段：${missingTags.join("、")} 为本集跨段再出场且有对白，须先锁定声线参考后再出片（同集首次出场不强制）。`,
  };
}

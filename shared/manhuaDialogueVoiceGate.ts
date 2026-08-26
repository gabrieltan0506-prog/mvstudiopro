/**
 * 漫剧对白音频的人声门禁。
 *
 * 本模块只处理时长与非静音区间，不认识任何 TTS 供应商，也不做文件或网络 I/O。
 * 服务端必须先让 ffmpeg silencedetect 成功跑完，再把日志交给这里；门禁拒收的
 * 音频不得进入正式对象存储。
 */

export type ManhuaDialogueVoiceRegion = {
  start: number;
  end: number;
};

export type ManhuaDialogueVoiceGateEvidence = {
  durationSeconds: number;
  voicedSeconds: number;
  voicedRatio: number;
  voiceRegions: ManhuaDialogueVoiceRegion[];
};

export type ManhuaDialogueVoiceGateResult =
  | ({ accepted: true } & ManhuaDialogueVoiceGateEvidence)
  | ({
      accepted: false;
      reason:
        | "invalid_audio_duration"
        | "no_effective_voice"
        | "insufficient_effective_voice";
    } & ManhuaDialogueVoiceGateEvidence);

/** 低于这个绝对时长的非静音尖峰，不算有效对白。 */
export const MANHUA_DIALOGUE_MIN_VOICED_SECONDS = 0.18;
/** 长音频还要满足最低占比，避免只凭开头/结尾的瞬态噪声过门禁。 */
export const MANHUA_DIALOGUE_MIN_VOICED_RATIO = 0.05;

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 解析 ffmpeg `silencedetect` 的 stderr，反推出非静音区间。
 *
 * - 没有 silence 事件：整段视作非静音（ffmpeg 成功退出是调用方前置条件）。
 * - 只有 silence_start 没有 end：静音延续到文件结尾。
 * - 区间统一裁进真实容器时长，避免日志浮点误差把占比算到 100% 以上。
 */
export function parseManhuaDialogueVoiceRegions(
  silenceDetectLog: string,
  durationSeconds: number
): ManhuaDialogueVoiceRegion[] {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const events: Array<{ at: number; kind: "silence_start" | "silence_end" }> =
    [];
  for (const line of String(silenceDetectLog || "").split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*([0-9]+(?:\.[0-9]+)?)/);
    if (start) events.push({ at: Number(start[1]), kind: "silence_start" });
    const end = line.match(/silence_end:\s*([0-9]+(?:\.[0-9]+)?)/);
    if (end) events.push({ at: Number(end[1]), kind: "silence_end" });
  }
  events.sort((a, b) => a.at - b.at || (a.kind === "silence_start" ? -1 : 1));

  if (!events.length) return [{ start: 0, end: round(duration) }];

  const regions: ManhuaDialogueVoiceRegion[] = [];
  let cursor = 0;
  let inSilence = false;
  for (const event of events) {
    const at = clamp(event.at, 0, duration);
    if (event.kind === "silence_start") {
      if (!inSilence && at > cursor) regions.push({ start: cursor, end: at });
      inSilence = true;
      continue;
    }
    cursor = Math.max(cursor, at);
    inSilence = false;
  }
  if (!inSilence && cursor < duration)
    regions.push({ start: cursor, end: duration });

  return mergeManhuaDialogueVoiceRegions(regions, duration);
}

/** 合并、裁切区间，杜绝重叠区间把有效时长重复累计。 */
export function mergeManhuaDialogueVoiceRegions(
  regions: readonly ManhuaDialogueVoiceRegion[],
  durationSeconds: number
): ManhuaDialogueVoiceRegion[] {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const normalized = regions
    .map(region => ({
      start: clamp(Number(region.start), 0, duration),
      end: clamp(Number(region.end), 0, duration),
    }))
    .filter(
      region => Number.isFinite(region.start) && Number.isFinite(region.end)
    )
    .filter(region => region.end > region.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: ManhuaDialogueVoiceRegion[] = [];
  for (const region of normalized) {
    const previous = merged[merged.length - 1];
    if (!previous || region.start > previous.end) {
      merged.push({ start: region.start, end: region.end });
    } else {
      previous.end = Math.max(previous.end, region.end);
    }
  }
  return merged.map(region => ({
    start: round(region.start),
    end: round(region.end),
  }));
}

export function evaluateManhuaDialogueVoiceGate(params: {
  durationSeconds: number;
  voiceRegions: readonly ManhuaDialogueVoiceRegion[];
  minVoicedSeconds?: number;
  minVoicedRatio?: number;
}): ManhuaDialogueVoiceGateResult {
  const duration = Number(params.durationSeconds);
  const validDuration = Number.isFinite(duration) && duration > 0;
  const voiceRegions = validDuration
    ? mergeManhuaDialogueVoiceRegions(params.voiceRegions, duration)
    : [];
  const voicedSeconds = round(
    voiceRegions.reduce((sum, region) => sum + (region.end - region.start), 0)
  );
  const voicedRatio = validDuration
    ? round(clamp(voicedSeconds / duration, 0, 1))
    : 0;
  const evidence: ManhuaDialogueVoiceGateEvidence = {
    durationSeconds: validDuration ? round(duration) : 0,
    voicedSeconds,
    voicedRatio,
    voiceRegions,
  };
  if (!validDuration) {
    return { accepted: false, reason: "invalid_audio_duration", ...evidence };
  }
  if (!voiceRegions.length || voicedSeconds <= 0) {
    return { accepted: false, reason: "no_effective_voice", ...evidence };
  }

  const requestedMinSeconds = Number(params.minVoicedSeconds);
  const minSeconds = Number.isFinite(requestedMinSeconds)
    ? Math.max(0, requestedMinSeconds)
    : MANHUA_DIALOGUE_MIN_VOICED_SECONDS;
  const requestedMinRatio = Number(params.minVoicedRatio);
  const minRatio = Number.isFinite(requestedMinRatio)
    ? clamp(requestedMinRatio, 0, 1)
    : MANHUA_DIALOGUE_MIN_VOICED_RATIO;
  // 极短但全程有声的“嗯/啊”也能过；绝对阈值不能反过来杀掉合法短对白。
  const requiredSeconds = Math.min(minSeconds, duration * 0.8);
  if (voicedSeconds < requiredSeconds || voicedRatio < minRatio) {
    return {
      accepted: false,
      reason: "insufficient_effective_voice",
      ...evidence,
    };
  }
  return { accepted: true, ...evidence };
}

export function evaluateManhuaDialogueSilenceDetectLog(params: {
  silenceDetectLog: string;
  durationSeconds: number;
  minVoicedSeconds?: number;
  minVoicedRatio?: number;
}): ManhuaDialogueVoiceGateResult {
  return evaluateManhuaDialogueVoiceGate({
    durationSeconds: params.durationSeconds,
    voiceRegions: parseManhuaDialogueVoiceRegions(
      params.silenceDetectLog,
      params.durationSeconds
    ),
    minVoicedSeconds: params.minVoicedSeconds,
    minVoicedRatio: params.minVoicedRatio,
  });
}

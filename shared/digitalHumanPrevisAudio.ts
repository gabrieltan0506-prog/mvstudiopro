import { currentDigitalHumanAudio, type DigitalHumanDraft } from "./digitalHumanStudio";
import { manhuaPrevisAudioSchema, type ManhuaPrevisAudio } from "./manhuaPrevisAudio";
import type { ManhuaPrevisSpec } from "./manhuaPrevis";

export function buildDigitalHumanPrevisAudio(draft: DigitalHumanDraft, spec: Pick<ManhuaPrevisSpec, "durationSec" | "timeMap">): ManhuaPrevisAudio {
  const audio = currentDigitalHumanAudio(draft);
  if (!audio?.source || !audio.durationSec || draft.approvedAudioRequestId !== audio.request.billingRequestId)
    throw new Error("请先试听并采用当前完整旁白，再生成带声音的预演。");
  if (!audio.source.startsWith("gs://")) throw new Error("当前旁白尚未取得云端素材回执，请先保存音频。");
  if (spec.timeMap?.spans.some(span => span.rate !== 1)) throw new Error("完整旁白按原速播放，请先恢复正常速度再预演。");
  if (audio.durationSec > spec.durationSec + 1 / 48000) throw new Error("完整旁白长于预演，请增加预演时长，不能截断尾音。");
  return manhuaPrevisAudioSchema.parse({ version: 1, startSec: 0, durationSec: spec.durationSec,
    sourceKey: JSON.stringify({ requestId: audio.request.billingRequestId, source: audio.source, durationSec: audio.durationSec }),
    dialogueCount: 1, bgmCount: 0,
    clips: [{ audioUri: audio.source, sourceStartSec: 0, sourceEndSec: audio.durationSec,
      startSec: 0, volume: 1, fadeInSec: 0, fadeOutSec: 0 }],
  });
}

import { z } from "zod";
import { canvasAudioStudioSchema, canvasAudioCueInputKey, getSelectedAudioTake, type CanvasAudioStudio } from "./canvasAudioStudio";
import { applyCanvasAudioMixPlan, type CanvasAudioMixClip } from "./canvasAudioMixPlan";
import type { ManhuaPrevisSpec } from "./manhuaPrevis";

const sec = z.number().finite().min(0).max(3600);
export const previsAudioClipSchema = z.object({
  audioUri: z.string().max(4096).regex(/^gs:\/\/[^/]+\/.+/),
  sourceStartSec: sec, sourceEndSec: sec, startSec: sec,
  volume: z.number().finite().min(0).max(1),
  fadeInSec: z.number().finite().min(0).max(30), fadeOutSec: z.number().finite().min(0).max(30),
}).strict().superRefine((c, ctx) => {
  const length = c.sourceEndSec - c.sourceStartSec;
  if (length <= 0 || length > 30 || c.fadeInSec + c.fadeOutSec > length)
    ctx.addIssue({ code: "custom", message: "音轨裁段或淡入淡出时长无效" });
});
export const manhuaPrevisAudioSchema = z.object({
  version: z.literal(1), startSec: sec, durationSec: z.number().finite().positive().max(30),
  sourceKey: z.string().min(1).max(500000),
  dialogueCount: z.number().int().min(0).max(100), bgmCount: z.number().int().min(0).max(100),
  clips: z.array(previsAudioClipSchema).min(1).max(64),
}).strict().superRefine((v, ctx) => {
  if (v.clips.some(c => Math.round((c.startSec + c.sourceEndSec - c.sourceStartSec) * 48000) > Math.round(v.durationSec * 48000)))
    ctx.addIssue({ code: "custom", message: "音轨超出白模时长，不允许截断尾音" });
});
export type ManhuaPrevisAudio = z.infer<typeof manhuaPrevisAudioSchema>;

/** 从本段已采用音轨取明确秒窗，不调配音API，也不把整段的第0秒套到后半段。 */
export function buildManhuaPrevisAudio(studio: CanvasAudioStudio | undefined, spec: Pick<ManhuaPrevisSpec,"durationSec"|"timeMap">, startSec = 0, loopBgm = false): ManhuaPrevisAudio {
  if (spec.timeMap?.spans.some(s => s.rate !== 1)) throw new Error("对白/BGM按原秒位对齐；请先恢复正常速度，变速音画需重新编排后再试看。");
  if (!studio) throw new Error("本段尚未配置音轨，请在本页对白与BGM中采用已有声音后生成。");
  const source = canvasAudioStudioSchema.parse(studio);
  const stop = startSec + spec.durationSec;
  const cues = source.cues.filter(c => c.enabled && c.startSec < stop && c.endSec > startSec);
  if (!cues.length) throw new Error("当前白模秒窗没有已采用音轨，请在本页检查对白与BGM及起始秒。");
  const clips: CanvasAudioMixClip[] = [];
  const identities: unknown[] = [];
  for (const cue of cues) {
    const take = getSelectedAudioTake(cue);
    const label = cue.labelZh || cue.speakerZh || "音轨";
    if (!cue.approved || !take) throw new Error(`${label}尚未采用；本次未提交，不会略过声音生成无声片。`);
    if (take.inputKey !== canvasAudioCueInputKey(cue)) throw new Error(`${label}与已采用音频不一致，请在本页重新核对采用。`);
    if (cue.endSec <= cue.startSec || cue.startSec + take.durationSec > cue.endSec + .05) throw new Error(`${label}音频长于所设秒窗，请先调整，不能截句。`);
    if (cue.kind === "dialogue" && (cue.startSec < startSec || cue.startSec + take.durationSec > stop + 1 / 48000))
      throw new Error(`${label}跨过白模起止边界，请调整白模时长或音轨起始秒，不能截断对白。`);
    identities.push([cue.id, take.id, take.gcsUri, take.inputKey, take.durationSec, cue.startSec, cue.endSec, cue.volume, cue.fadeInSec, cue.fadeOutSec, cue.mix]);
    // 已采用take是裁切后的音频，源从0开始；对白只播一次，BGM循环须显式打开。
    let at = cue.startSec;
    const repeat = cue.kind === "bgm" && loopBgm;
    const overlap = repeat ? Math.min(.2, take.durationSec / 4) : 0;
    let count = 0;
    do {
      if (++count > 64) throw new Error("BGM循环片段过多，请选择更长的音乐片段。");
      const length = cue.kind === "dialogue" ? take.durationSec : Math.min(take.durationSec, cue.endSec - at);
      const base = { audioUri: take.gcsUri, sourceStartSec: 0, sourceEndSec: length, startSec: at, volume: cue.volume,
        fadeInSec: Math.min(at > cue.startSec ? overlap : cue.fadeInSec, length / 3),
        fadeOutSec: Math.min(repeat && at + length < cue.endSec ? overlap : cue.fadeOutSec, length / 3) };
      for (const part of applyCanvasAudioMixPlan(cue, base, cues)) {
        const end = part.startSec + part.sourceEndSec - part.sourceStartSec;
        const left = Math.max(part.startSec, startSec), right = Math.min(end, stop);
        if (right <= left) continue;
        clips.push({ ...part, sourceStartSec: part.sourceStartSec + left - part.startSec, sourceEndSec: part.sourceStartSec + right - part.startSec,
          startSec: left - startSec, fadeInSec: left === part.startSec ? Math.min(part.fadeInSec, (right-left)/3) : 0,
          fadeOutSec: right === end ? Math.min(part.fadeOutSec, (right-left)/3) : 0 });
      }
      if (!repeat || at + length >= Math.min(cue.endSec, stop)) break;
      at += take.durationSec - overlap;
    } while (at < Math.min(cue.endSec, stop));
  }
  const dialogue = cues.filter(c => c.kind === "dialogue").sort((a,b) => a.startSec-b.startSec);
  if (dialogue.some((c,i) => i > 0 && c.startSec < dialogue[i-1]!.startSec + getSelectedAudioTake(dialogue[i-1]!)!.durationSec - 1/48000))
    throw new Error("对白发生重叠，请先在本页调整逐句秒位。");
  return manhuaPrevisAudioSchema.parse({ version: 1, startSec, durationSec: spec.durationSec,
    sourceKey: JSON.stringify([startSec, spec.durationSec, loopBgm, identities]),
    dialogueCount: dialogue.length, bgmCount: cues.filter(c => c.kind === "bgm").length, clips });
}

/** 场景动画只复用已采用BGM；未采用或过期条目由原音轨合同明确拒绝。 */
export function buildManhuaStageBgmAudio(studio: CanvasAudioStudio | undefined, durationSec:number, startSec=0, loopBgm=false): ManhuaPrevisAudio | undefined {
  if(!studio)return undefined;
  const source=canvasAudioStudioSchema.parse(studio);
  const bgm=source.cues.filter(c=>c.kind==="bgm");
  if(!bgm.some(c=>c.enabled && c.startSec<startSec+durationSec && c.endSec>startSec))return undefined;
  return buildManhuaPrevisAudio({...source,cues:bgm},{durationSec},startSec,loopBgm);
}

import { z } from "zod";

/** 剧情音轨的持久契约：候选与采用分离，不借角色全局声线锁存声音状态。 */
const text = (max: number) => z.string().max(max);
const seconds = z.number().finite().min(0).max(3600);
const mediaUri = z.string().min(1).max(4096).refine(
  value => /^gs:\/\/[^/]+\/.+/.test(value), "音频缺少长期存储身份",
);
export const canvasAudioTakeSchema = z.object({
  id: text(120).min(1),
  gcsUri: mediaUri,
  previewUrl: z.string().max(8192).default(""),
  durationSec: z.number().finite().positive().max(3600),
  bytes: z.number().int().positive().optional(),
  requestId: text(120).optional(),
  createdAt: text(80),
  inputKey: text(16000),
});
export type CanvasAudioTake = z.infer<typeof canvasAudioTakeSchema>;
export const canvasAudioCueSchema = z.object({
  id: text(120).min(1),
  kind: z.enum(["dialogue", "bgm", "sfx"]),
  labelZh: text(200),
  shotZh: text(2000),
  startSec: seconds,
  endSec: seconds,
  speakerZh: text(120),
  voiceStateZh: text(120),
  textZh: text(4000),
  emotion: text(80),
  voice: text(80),
  source: z.object({
    gcsUri: mediaUri,
    previewUrl: z.string().max(8192),
    durationSec: z.number().finite().positive().max(3600),
    labelZh: text(200),
  }).optional(),
  mix: z.object({
    duckUnderDialogue: z.boolean(),
    duckVolume: z.number().finite().min(0).max(1),
    silenceWindows: z.array(z.object({ startSec: seconds, endSec: seconds }).refine(w => w.endSec > w.startSec, "留白结束须晚于开始")).max(20),
  }).optional(),
  sourceStartSec: seconds,
  sourceEndSec: seconds,
  volume: z.number().finite().min(0).max(1),
  fadeInSec: z.number().finite().min(0).max(30),
  fadeOutSec: z.number().finite().min(0).max(30),
  takes: z.array(canvasAudioTakeSchema).max(100),
  selectedTakeId: text(120).optional(),
  approved: z.boolean(),
  enabled: z.boolean().default(true),
});
export type CanvasAudioCue = z.infer<typeof canvasAudioCueSchema>;
const musicModel = z.enum(["suno-v5.5-beta", "suno-v6-mini", "suno-v6", "suno-v6-wild"]);
/** 本段配乐编辑草稿；付费确认不持久化，已有音频候选独立保留。 */
export const canvasMusicDraftSchema = z.object({
  prompt: text(16000),
  durationSec: seconds,
  model: musicModel,
  brief: z.object({
    model: musicModel, custom_mode: z.literal(true), instrumental: z.literal(true),
    style: text(16000), prompt: text(16000), title: text(1000), duration: seconds,
    negative_tags: text(2000), style_weight: z.number().finite(), weirdness_constraint: z.number().finite(),
  }).nullable(),
});
export type CanvasMusicDraft = z.infer<typeof canvasMusicDraftSchema>;
export const canvasAudioStudioSchema = z.object({
  schemaVersion: z.literal(1),
  cues: z.array(canvasAudioCueSchema).max(100),
  musicJobIds: z.array(text(120).min(1)).max(100),
  musicDraft: canvasMusicDraftSchema.optional(),
  previewTake: canvasAudioTakeSchema.optional(),
  pendingOperations: z.array(z.object({
    id: text(120).min(1),
    kind: z.enum(["dialogue", "bgm", "post_prod"]),
    cueId: text(120).optional(),
    inputKey: text(16000),
    createdAt: text(80).optional(),
    errorZh: text(1000).optional(),
  })).max(100),
}).superRefine((value, ctx) => {
  if (new Set(value.cues.map(cue => cue.id)).size !== value.cues.length) {
    ctx.addIssue({ code: "custom", path: ["cues"], message: "音轨片段编号重复" });
  }
  for (let index = 0; index < value.cues.length; index++) {
    const cue = value.cues[index]!;
    if (new Set(cue.takes.map(take => take.id)).size !== cue.takes.length) {
      ctx.addIssue({ code: "custom", path: ["cues", index, "takes"], message: "音频候选编号重复" });
    }
  }
});
export type CanvasAudioStudio = z.infer<typeof canvasAudioStudioSchema>;

export function emptyCanvasAudioStudio(): CanvasAudioStudio {
  return { schemaVersion: 1, cues: [], musicJobIds: [], pendingOperations: [] };
}
export function createCanvasAudioCue(kind: CanvasAudioCue["kind"], id: string): CanvasAudioCue {
  return {
    id, kind, labelZh: "", shotZh: "", startSec: kind === "dialogue" ? 1.5 : 0,
    endSec: 5, speakerZh: "", voiceStateZh: "", textZh: "", emotion: "", voice: "",
    sourceStartSec: 0, sourceEndSec: 5, volume: kind === "bgm" ? 0.25 : 1, fadeInSec: 0, fadeOutSec: 0,
    takes: [], approved: false, enabled: true,
  };
}
/** 音量与淡入淡出在合听/母轨应用；源音频裁切才需新的免费裁切产物。 */
export function canvasAudioCueInputKey(cue: CanvasAudioCue): string {
  return JSON.stringify(cue.kind === "dialogue"
    ? [cue.kind, cue.speakerZh, cue.voiceStateZh, cue.textZh, cue.emotion, cue.voice]
    : [cue.kind, cue.source?.gcsUri ?? "", cue.sourceStartSec, cue.sourceEndSec, "mix-v2"]);
}
/** 只延长当前对白窗口；不移动其他对白、不裁音频、不重新购买。 */
export function canvasDialogueWindowFit(cue: CanvasAudioCue, take: CanvasAudioTake, cues: CanvasAudioCue[], durationSec: number): { endSec: number; issue: string } {
  const endSec = Math.ceil((cue.startSec + take.durationSec) * 1000) / 1000;
  if (cue.kind !== "dialogue" || !Number.isFinite(endSec) || take.durationSec <= 0 || cue.startSec < 0)
    return { endSec, issue: "当前音频或时间窗无效" };
  if (take.inputKey !== canvasAudioCueInputKey(cue)) return { endSec, issue: "台词或音色已修改，请选择与当前内容一致的候选" };
  if (endSec > durationSec) return { endSec, issue: `需要延长本段至至少 ${endSec.toFixed(3)} 秒，请先调整镜头时长` };
  const collision = cues.find(other => other.id !== cue.id && other.enabled && other.kind === "dialogue" &&
    other.startSec < endSec && other.endSec > cue.startSec);
  if (collision) return { endSec, issue: `与${collision.speakerZh || collision.labelZh || "另一句对白"}（${collision.startSec}–${collision.endSec}秒）冲突，请先调整对白与镜头安排` };
  return { endSec, issue: "" };
}

export function getSelectedAudioTake(cue: CanvasAudioCue): CanvasAudioTake | undefined {
  return cue.takes.find(take => take.id === cue.selectedTakeId);
}
export function validateCanvasAudioCue(cue: CanvasAudioCue, durationSec = 30): string[] {
  const issues: string[] = [];
  if (!(cue.endSec > cue.startSec && cue.endSec <= durationSec)) issues.push("请填写片内有效起止秒，不能超出视频时长");
  if (!cue.shotZh.trim()) issues.push("请填写对应镜头或动作");
  if (cue.kind === "dialogue") {
    if (!cue.speakerZh.trim() || !cue.textZh.trim() || !cue.voice.trim()) issues.push("请填写说话角色、台词并选择音色");
  } else if (!cue.source || !(cue.sourceEndSec > cue.sourceStartSec && cue.sourceEndSec <= cue.source.durationSec)) {
    issues.push("请选择来源音频并填写实际时长内的裁切起止秒");
  }
  if (cue.mix?.silenceWindows.some(w => w.startSec < cue.startSec || w.endSec > cue.endSec)) issues.push("留白窗口须位于本条音轨的片内时间窗内");
  const take = getSelectedAudioTake(cue);
  if (!take) issues.push("请试听并采用一条音频候选");
  else {
    if (take.inputKey !== canvasAudioCueInputKey(cue)) issues.push("当前内容与采用音频不一致，请重新选择或生成");
    if (cue.startSec + take.durationSec > cue.endSec + 0.05) issues.push("音频长于当前时间窗，请调整时间窗或裁切，不会自动截断");
  }
  return issues;
}

/** 仅约束本次明确采用的片段；没有音轨编辑数据时完全保留旧出片逻辑。 */
export function compileCanvasAudioBindings(input: {
  studio?: CanvasAudioStudio;
  existingAudioUrls: readonly string[];
  durationSec: number;
}): { audioUrls: string[]; promptAppendix: string } {
  const base = Array.from(new Set(input.existingAudioUrls));
  if (!input.studio?.cues.length) return { audioUrls: base, promptAppendix: "" };
  const studio = canvasAudioStudioSchema.parse(input.studio);
  const cues = studio.cues.filter(cue => cue.enabled).sort((a, b) => a.startSec - b.startSec);
  if (!cues.length) return { audioUrls: base, promptAppendix: "" };
  for (const cue of cues) {
    const errors = validateCanvasAudioCue(cue, input.durationSec);
    if (!cue.approved) errors.unshift("尚未确认采用");
    if (errors.length) throw new Error(`${cue.labelZh || cue.speakerZh || "音轨片段"}：${errors.join("；")}`);
  }
  const dialogue = cues.filter(cue => cue.kind === "dialogue");
  for (let index = 1; index < dialogue.length; index++) {
    const previous = dialogue[index - 1]!;
    if (dialogue[index]!.startSec < previous.startSec + getSelectedAudioTake(previous)!.durationSec) {
      throw new Error("对白音频发生重叠，请先调整逐句起止秒");
    }
  }
  const audioUrls = Array.from(new Set([...base, ...cues.map(cue => getSelectedAudioTake(cue)!.gcsUri)]));
  if (audioUrls.length > 10) throw new Error(`本次有 ${audioUrls.length} 条参考音频，超过 10 条上限，请明确减少选用片段`);
  const rows = cues.map(cue => {
    const take = getSelectedAudioTake(cue)!;
    const tag = `@audio${audioUrls.indexOf(take.gcsUri) + 1}`;
    const window = `${cue.startSec.toFixed(3)}–${cue.endSec.toFixed(3)}秒`;
    return cue.kind === "dialogue"
      ? `${window}，${cue.shotZh}。${tag}仅对应${cue.speakerZh}${cue.voiceStateZh ? `（${cue.voiceStateZh}）` : ""}的对白{${cue.textZh}}；在${cue.startSec.toFixed(3)}秒开始对应音频，按该音频发音同步开口，音频结束即闭口，其他角色不说此句；不继承为其他声音状态。`
      : cue.kind === "sfx"
        ? `${window}，${cue.shotZh}。<音效：${tag}对应${cue.labelZh || cue.shotZh}，从${cue.startSec.toFixed(3)}秒触发，不作为对白或配乐，不提前虚构画面中未发生的事件。>`
      : `${window}，${cue.shotZh}。（从${cue.startSec.toFixed(3)}秒播放${tag}这条已裁好的音乐片段，音频结束或到${cue.endSec.toFixed(3)}秒停止；不循环、不跨段延长、不作为角色对白。）`;
  });
  return { audioUrls, promptAppendix: `【已确认的逐段声音时间表】\n${rows.join("\n")}\n对白、配乐按上述角色和时间窗分别使用；已给定音效按事件和时间窗使用，未提供的声音不冒充已制作。` };
}

/** 混音用料完整身份；不包含会过期的试听URL，也不触发重新购买单条音频。 */
export function canvasAudioMixSource(cues: readonly CanvasAudioCue[], durationSec: number): string {
  return JSON.stringify(cues.filter(cue => cue.approved && cue.enabled !== false).map(cue => {
    const row: unknown[] = [cue.id, canvasAudioCueInputKey(cue), cue.selectedTakeId, cue.startSec, cue.endSec, durationSec,
      cue.volume, cue.fadeInSec, cue.fadeOutSec];
    if (cue.mix) row.push(cue.mix);
    return row;
  }));
}
export function assertCanvasAudioMasterCurrent(master: { audioStudioSource?: string } | undefined, studio: CanvasAudioStudio | undefined, durationSec: number): void {
  if (master?.audioStudioSource && master.audioStudioSource !== canvasAudioMixSource(studio?.cues || [], durationSec)) throw new Error("本段声音或留白/避让配置已改变，预混母轨仍为旧版；请重新合听并预混，或明确移除母轨。本次未提交，旧音频保留。");
}

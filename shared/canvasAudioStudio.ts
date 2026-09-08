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
  kind: z.enum(["dialogue", "bgm"]),
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
export const canvasAudioStudioSchema = z.object({
  schemaVersion: z.literal(1),
  cues: z.array(canvasAudioCueSchema).max(100),
  musicJobIds: z.array(text(120).min(1)).max(100),
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
    sourceStartSec: 0, sourceEndSec: 5, volume: 1, fadeInSec: 0, fadeOutSec: 0,
    takes: [], approved: false, enabled: true,
  };
}
/** 时间与镜头变化不重新购买配音；BGM 裁切参数变化则对应新的确定性产物。 */
export function canvasAudioCueInputKey(cue: CanvasAudioCue): string {
  return JSON.stringify(cue.kind === "dialogue"
    ? [cue.kind, cue.speakerZh, cue.voiceStateZh, cue.textZh, cue.emotion, cue.voice]
    : [cue.kind, cue.source?.gcsUri ?? "", cue.sourceStartSec, cue.sourceEndSec,
      cue.volume, cue.fadeInSec, cue.fadeOutSec]);
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
    issues.push("请选择原曲并填写原曲范围内的裁切起止秒");
  }
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
      : `${window}，${cue.shotZh}。（从${cue.startSec.toFixed(3)}秒播放${tag}这条已裁好的音乐片段，音频结束或到${cue.endSec.toFixed(3)}秒停止；不循环、不跨段延长、不作为角色对白。）`;
  });
  return { audioUrls, promptAppendix: `【已确认的逐段声音时间表】\n${rows.join("\n")}\n对白、配乐按上述角色和时间窗分别使用；环境音与动作音效另行生成。` };
}

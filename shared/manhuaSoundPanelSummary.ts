import { canvasAudioCueSchema, canvasAudioCueInputKey } from "./canvasAudioStudio.js";

/**
 * 对白与配乐面板的「这一段有什么」摘要（纯函数）。
 *
 * 对照图 02 第三格：左=当前片段（第1段·逐句配音·分段配乐·时长 00:15）、
 * 中=角色配音(3)、右=背景音乐(2)，一个主操作「生成对白与配乐（当前片段）」。
 * 对照图 04 的 `mvs-sound-edit` 另加一条硬要求：**仅在真实独立音轨存在时显示多轨**，
 * 混合轨（预混母轨）不许伪装成多轨。
 *
 * 这里只统计与措辞，不碰生成、不碰采用。
 */
export type ManhuaSoundCueLike = {
  kind?: string;
  speakerZh?: string;
  textZh?: string;
  takes?: readonly unknown[];
  selectedTakeId?: string;
};

/** 采用必须对应真实、已确认且未失效的音频候选。 */
export function hasAdoptedManhuaAudio(cue: unknown): boolean {
  const parsed = canvasAudioCueSchema.safeParse(cue);
  if (!parsed.success) return false;
  const value = parsed.data;
  if (!value.enabled || !value.approved) return false;
  const take = value.takes.find((item) => item.id === value.selectedTakeId);
  return Boolean(take && take.inputKey === canvasAudioCueInputKey(value));
}

export type ManhuaSoundPanelSummary = {
  segmentIndex: number;
  durationSec: number;
  /** 对白 cue 条数 */
  dialogueCount: number;
  /** 去重后的说话人（角色配音 N） */
  speakerCount: number;
  speakersZh: string[];
  /** 已经选定采用版本的对白条数 */
  adoptedCount: number;
  bgmCount: number;
  sfxCount: number;
  /** 真实独立音轨存在（对白与配乐各自成轨）；只有预混母轨时为 false */
  hasRealMultitrack: boolean;
  /** 「第1段 · 15s · 角色配音 3 · 背景音乐 2」 */
  headlineZh: string;
  /** 轨道口径说明：没有独立轨时明说只有一条预混母轨 */
  trackNoteZh: string;
  /** 空态：这一段还没有任何声音任务 */
  emptyZh: string;
};

const fmtSec = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function buildManhuaSoundPanelSummary(input: {
  segmentIndex: number;
  durationSec: number;
  cues: readonly ManhuaSoundCueLike[];
  /** 已提交/已出的配乐任务数（与 cue 里的 bgm 分开计） */
  musicJobCount?: number;
  /** 一键预混母轨已经出好 —— 它是一条混合轨，不是多轨 */
  hasPremixMaster?: boolean;
}): ManhuaSoundPanelSummary {
  const segmentIndex = Math.max(1, Math.floor(input.segmentIndex) || 1);
  const durationSec = Math.max(0, Number(input.durationSec) || 0);
  const dialogue = input.cues.filter((cue) => cue.kind === "dialogue");
  const speakers: string[] = [];
  for (const cue of dialogue) {
    const name = String(cue.speakerZh || "").trim();
    if (name && !speakers.includes(name)) speakers.push(name);
  }
  const bgmCues = input.cues.filter((cue) => cue.kind === "bgm").length;
  const bgmCount = bgmCues + Math.max(0, Math.floor(Number(input.musicJobCount) || 0));
  const sfxCount = input.cues.filter((cue) => cue.kind === "sfx").length;
  const adoptedCount = dialogue.filter(hasAdoptedManhuaAudio).length;

  // 多轨的判据：对白与配乐各自真的有内容。只有预混母轨 ≠ 多轨。
  const hasRealMultitrack = adoptedCount > 0 && input.cues.some((cue) => cue.kind === "bgm" && hasAdoptedManhuaAudio(cue));

  const parts = [`第${segmentIndex}段`];
  if (durationSec > 0) parts.push(fmtSec(durationSec));
  parts.push(`角色配音 ${speakers.length}`);
  parts.push(`背景音乐 ${bgmCount}`);
  if (sfxCount) parts.push(`音效 ${sfxCount}`);

  return {
    segmentIndex,
    durationSec,
    dialogueCount: dialogue.length,
    speakerCount: speakers.length,
    speakersZh: speakers,
    adoptedCount,
    bgmCount,
    sfxCount,
    hasRealMultitrack,
    headlineZh: parts.join(" · "),
    trackNoteZh: hasRealMultitrack
      ? "对白与配乐各自成轨，可分别重出"
      : input.hasPremixMaster
        ? "目前只有一条预混母轨（对白+配乐已混在一起），不是多轨；要分别改得先各自出轨"
        : "",
    emptyZh:
      dialogue.length || bgmCount || sfxCount
        ? ""
        : "这一段还没有任何声音任务：先写对白或起一条配乐",
  };
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  compileManhuaDialogueTtsPlan,
  mergeManhuaDialogueTtsLinesByVoice,
} from "../../shared/manhuaDialogueTtsCompile.js";
import { qwenTtsCatalogVoiceCandidate } from "../../shared/qwenTtsVoiceCatalog.js";
import { buildQwenDialogueTtsRequestBody } from "./qwenDialogueTts.js";

const execFileAsync = promisify(execFile);

export const ZHAOGU_TIANMEN_ROLE_BY_TAG = {
  "@角色1": "沈曜",
  "@角色2": "玄璃",
  "@角色3": "烬司",
} as const;

/** 三个目录 ID 均为待探针候选，未验证前服务层会 fail-closed，绝不发付费请求。 */
export const ZHAOGU_TIANMEN_VOICE_BY_TAG = {
  "@角色1": qwenTtsCatalogVoiceCandidate("longnixiulian")!,
  "@角色2": qwenTtsCatalogVoiceCandidate("longyifenghe")!,
  "@角色3": qwenTtsCatalogVoiceCandidate("longyimuling")!,
} as const;

export type ManhuaDialoguePostProfile = {
  pitchSemitones: number;
  tempo: number;
  warmthDb: number;
  presenceDb: number;
  targetLufs: number;
};

export const ZHAOGU_TIANMEN_POST_PROFILE_BY_TAG: Record<string, ManhuaDialoguePostProfile> = {
  "@角色1": { pitchSemitones: -0.7, tempo: 0.97, warmthDb: 1.5, presenceDb: 0.5, targetLufs: -18 },
  "@角色2": { pitchSemitones: 1.2, tempo: 1.02, warmthDb: 0.4, presenceDb: 1.4, targetLufs: -19 },
  "@角色3": { pitchSemitones: -2.2, tempo: 0.94, warmthDb: 2.4, presenceDb: -0.6, targetLufs: -17 },
};

export function buildManhuaDialoguePostprocessArgs(params: {
  speakerTag: string;
  inputPath: string;
  outputPath: string;
  targetDurationSec: number;
}): string[] {
  const profile = ZHAOGU_TIANMEN_POST_PROFILE_BY_TAG[params.speakerTag];
  if (!profile) throw new Error("manhua_dialogue_post_profile_missing");
  if (!Number.isFinite(params.targetDurationSec) || params.targetDurationSec <= 0 || params.targetDurationSec > 60) {
    throw new Error("manhua_dialogue_target_duration_invalid");
  }
  const pitchRatio = 2 ** (profile.pitchSemitones / 12);
  const filters = [
    "aresample=48000",
    `asetrate=${(48_000 * pitchRatio).toFixed(3)}`,
    "aresample=48000",
    `atempo=${(1 / pitchRatio).toFixed(6)}`,
    `atempo=${profile.tempo.toFixed(3)}`,
    `equalizer=f=180:t=q:w=1:g=${profile.warmthDb.toFixed(2)}`,
    `equalizer=f=2800:t=q:w=1:g=${profile.presenceDb.toFixed(2)}`,
    `loudnorm=I=${profile.targetLufs}:TP=-1.5:LRA=7`,
    `apad=whole_dur=${params.targetDurationSec.toFixed(3)}`,
    `atrim=duration=${params.targetDurationSec.toFixed(3)}`,
  ].join(",");
  // 输入/输出路径作为独立 argv，用户台词从不进入命令或滤镜，禁止 shell 注入。
  return ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", params.inputPath,
    "-vn", "-af", filters, "-codec:a", "libmp3lame", "-q:a", "2", params.outputPath];
}

export async function postprocessManhuaDialogueAudio(params: Parameters<typeof buildManhuaDialoguePostprocessArgs>[0]) {
  await execFileAsync("ffmpeg", buildManhuaDialoguePostprocessArgs(params), {
    timeout: 60_000,
    maxBuffer: 512 * 1024,
  });
}

export function buildZhaoguTianmenDialogueServicePlan(prompt: string) {
  const voiceByTag = Object.fromEntries(Object.entries(ZHAOGU_TIANMEN_VOICE_BY_TAG)
    .map(([tag, candidate]) => [tag, candidate.voiceId]));
  const lines = compileManhuaDialogueTtsPlan(prompt, { voiceByTag });
  const groups = mergeManhuaDialogueTtsLinesByVoice(lines);
  return {
    readyForSynthesis: false as const,
    blockedReason: "catalog_voice_candidates_unprobed" as const,
    voiceByTag: ZHAOGU_TIANMEN_VOICE_BY_TAG,
    lines,
    groups: groups.map((group, index) => ({
      ...group,
      requestBody: buildQwenDialogueTtsRequestBody({ input: group.input, voice: group.voice, seed: index }),
    })),
  };
}

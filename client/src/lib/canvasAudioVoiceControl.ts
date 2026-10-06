import type { CanvasMusicDraft } from "@shared/canvasAudioStudio";
import type { CreativeVoiceProductionAction } from "@shared/creativeVoiceProduction";

export type CanvasAudioVoiceAction = Extract<CreativeVoiceProductionAction, { action: "bgm" | "audio" }>;
export type CanvasAudioVoiceResult = {
  status: "inspected" | "prepared" | "awaiting_user_confirmation" | "updated" | "handled";
  characters?:Array<{id:string;nameZh:string}>;
  cues?: Array<{ id:string; kind:string; labelZh:string; shotZh:string; textZh:string; speakerId?:string; speakerZh:string; voice:string; emotion:string; startSec:number; endSec:number; sourceStartSec:number; sourceEndSec:number; volume:number; fadeInSec:number; fadeOutSec:number; approved:boolean; selectedTakeId?:string; takes:Array<{id:string;durationSec:number;matches:boolean}> }>;
  sources?: Array<{id:string;label:string;durationSec?:number}>;
  resumableIds?: string[];
  voices?: Array<{id:string;label:string}>;
  clipId: string;
  draft: CanvasMusicDraft | null;
  musicJobIds: string[];
  pendingOperations: Array<{ id: string; kind: string }>;
  jobs: Array<{ jobId: string; status: string; titleZh: string; variants: Array<{ index: number; available: boolean; durationSec?: number }> }>;
  historyReadFailed: boolean;
};
export type CanvasAudioVoiceControl = (action: CanvasAudioVoiceAction, signal?: AbortSignal) => Promise<CanvasAudioVoiceResult>;
export type CanvasAudioVoiceControlRegistration = (clipId: string, control: CanvasAudioVoiceControl | null) => void;

/** 语音要求只追加；原分镜自动起草和已保存要求都保留。 */
export function canvasBgmVoicePrompt(storyPrompt: string, savedPrompt: string, question?: string): string {
  if (!storyPrompt.trim()) throw new Error("当前片段没有可用的分镜剧情，无法起草配乐要求。");
  let prompt = savedPrompt.includes(storyPrompt) ? savedPrompt : [
    storyPrompt,
    savedPrompt.trim() ? `已保存的配乐要求：\n${savedPrompt}` : "",
  ].filter(Boolean).join("\n\n");
  const extra = question?.trim() ? `本次用户补充：\n${question.trim()}` : "";
  if (extra && !prompt.includes(extra)) prompt += `\n\n${extra}`;
  return prompt;
}

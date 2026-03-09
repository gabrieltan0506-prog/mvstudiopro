import type { WorkflowTask } from "../types/workflow";

export interface VoiceStepInput {
  dialogueText: string;
  voicePrompt?: string;
  voice?: string;
}

export interface VoiceStepResult {
  voiceProvider: "openai";
  voiceModel: "gpt-4o-mini-tts";
  voiceVoice: string;
  voiceUrl: string;
  voiceIsFallback: boolean;
  voiceErrorMessage?: string;
}

export function applyVoiceResult(
  task: WorkflowTask,
  input: VoiceStepInput,
  result: VoiceStepResult
): WorkflowTask {
  return {
    ...task,
    outputs: {
      ...task.outputs,
      dialogueText: input.dialogueText,
      voicePrompt: input.voicePrompt || "",
      voiceProvider: result.voiceProvider,
      voiceModel: result.voiceModel,
      voiceVoice: result.voiceVoice,
      voiceUrl: result.voiceUrl,
      voiceIsFallback: result.voiceIsFallback,
      voiceErrorMessage: result.voiceErrorMessage,
    },
    updatedAt: Date.now(),
  };
}

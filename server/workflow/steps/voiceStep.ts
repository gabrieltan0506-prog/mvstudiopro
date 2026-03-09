import { generateVoiceWithOpenAI } from "../../models/openaiTTS.js";
import { buildVoicePrompt } from "../prompts/voicePrompt.js";

export async function voiceStep(input: {
  dialogueText: string;
  voicePrompt?: string;
  language?: string;
  style?: string;
}) {
  const voicePrompt = String(input.voicePrompt || "").trim() || buildVoicePrompt({
    dialogueText: input.dialogueText,
    language: input.language || "中文",
    style: input.style,
  });
  const result = await generateVoiceWithOpenAI({
    dialogueText: input.dialogueText,
    voicePrompt,
    voice: "nova",
  });
  return result.voiceUrl;
}

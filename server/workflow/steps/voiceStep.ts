import { generateVoiceWithOpenAI } from "../../models/openaiTTS";

export async function voiceStep(input: {
  dialogueText: string;
  voicePrompt?: string;
}) {
  const result = await generateVoiceWithOpenAI({
    dialogueText: input.dialogueText,
    voicePrompt: input.voicePrompt,
    voice: "nova",
  });
  return result.voiceUrl;
}

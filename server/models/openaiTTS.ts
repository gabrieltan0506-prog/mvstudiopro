import { put } from "@vercel/blob";
import { synthesizeVoiceAudio } from "./voiceSynthesis.js";

export async function generateVoiceWithOpenAI(input: {
  dialogueText: string;
  voicePrompt?: string;
  voice?: string;
  voiceType?: string;
  voiceStyle?: string;
}) {
  try {
    const synthesized = await synthesizeVoiceAudio(input);
    if (!synthesized.audioBuffer.length) {
      return {
        voiceUrl: "",
        provider: synthesized.provider,
        model: synthesized.model,
        voice: synthesized.voice,
        isFallback: true,
        errorMessage: synthesized.errorMessage,
      };
    }
    const blob = await put(
      `voices/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${synthesized.extension}`,
      synthesized.audioBuffer,
      {
        access: "public",
        contentType: synthesized.contentType,
      },
    );

    return {
      voiceUrl: blob.url,
      provider: synthesized.provider,
      model: synthesized.model,
      voice: synthesized.voice,
      isFallback: synthesized.isFallback,
      errorMessage: "",
    };
  } catch (error: any) {
    return {
      voiceUrl: "",
      provider: "vertex",
      model: String(process.env.VERTEX_TTS_MODEL || "gemini-2.5-flash-preview-tts"),
      voice: String(process.env.VERTEX_TTS_VOICE_FEMALE || "Kore"),
      isFallback: true,
      errorMessage: error?.message || String(error),
    };
  }
}

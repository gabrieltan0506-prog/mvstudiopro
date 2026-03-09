import { put } from "@vercel/blob";

export async function generateVoiceWithOpenAI(input: {
  dialogueText: string;
  voicePrompt?: string;
  voice?: string;
}) {
  const dialogueText = String(input.dialogueText || "").trim();
  const voicePrompt = String(input.voicePrompt || "").trim();
  const voice = String(input.voice || "nova").trim() || "nova";
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();

  if (!dialogueText) {
    return {
      voiceUrl: "",
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voice,
      isFallback: true,
      errorMessage: "dialogueText is required",
    };
  }

  if (!apiKey) {
    return {
      voiceUrl: "",
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voice,
      isFallback: true,
      errorMessage: "OPENAI_API_KEY is not configured",
    };
  }

  try {
    const body: Record<string, any> = {
      model: "gpt-4o-mini-tts",
      voice,
      input: dialogueText,
      format: "mp3",
    };
    if (voicePrompt) body.instructions = voicePrompt;

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = (await response.text()).slice(0, 600);
      return {
        voiceUrl: "",
        provider: "openai",
        model: "gpt-4o-mini-tts",
        voice,
        isFallback: true,
        errorMessage: `openai_tts_failed:${response.status}:${err}`,
      };
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    if (!audioBuffer.length) {
      return {
        voiceUrl: "",
        provider: "openai",
        model: "gpt-4o-mini-tts",
        voice,
        isFallback: true,
        errorMessage: "openai_tts_empty_audio",
      };
    }

    const blob = await put(`voices/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`, audioBuffer, {
      access: "public",
      contentType: "audio/mpeg",
    });

    return {
      voiceUrl: blob.url,
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voice,
      isFallback: false,
      errorMessage: "",
    };
  } catch (error: any) {
    return {
      voiceUrl: "",
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voice,
      isFallback: true,
      errorMessage: error?.message || String(error),
    };
  }
}

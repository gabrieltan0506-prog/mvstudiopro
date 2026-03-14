import { put } from "@vercel/blob";

function mapVoiceTypeToMiniMaxVoice(voiceType: string) {
  const normalized = String(voiceType || "").trim().toLowerCase();
  if (normalized === "male") return "Chinese (Mandarin)_Reliable_Executive";
  if (normalized === "cartoon") return "Chinese (Mandarin)_News_Anchor";
  return "Chinese (Mandarin)_News_Anchor";
}

function buildMiniMaxVoiceConfig(input: { voiceType?: string; voiceStyle?: string }) {
  const voiceType = String(input.voiceType || "female").trim() || "female";
  const voiceStyle = String(input.voiceStyle || "").trim().toLowerCase();
  const speed =
    voiceStyle === "energetic" ? 1.08 :
    voiceStyle === "warm" ? 0.98 :
    voiceStyle === "calm" ? 0.92 :
    voiceStyle === "cinematic" ? 0.95 :
    1;
  const pitch =
    voiceType === "male" ? -1 :
    voiceType === "cartoon" ? 2 :
    0;
  return {
    voiceId: mapVoiceTypeToMiniMaxVoice(voiceType),
    speed,
    pitch,
    vol: 1,
  };
}

export async function generateVoiceWithOpenAI(input: {
  dialogueText: string;
  voicePrompt?: string;
  voice?: string;
  voiceType?: string;
  voiceStyle?: string;
}) {
  const dialogueText = String(input.dialogueText || "").trim();
  const voicePrompt = String(input.voicePrompt || "").trim();
  const openAiVoice = String(input.voice || "nova").trim() || "nova";
  const miniMaxApiKey = String(process.env.MINIMAX_API_KEY || "").trim();
  const miniMaxBase = String(process.env.MINIMAX_API_BASE || "https://api.minimax.io").trim() || "https://api.minimax.io";
  const openAiApiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const miniMaxVoice = buildMiniMaxVoiceConfig({ voiceType: input.voiceType, voiceStyle: input.voiceStyle });

  if (!dialogueText) {
    return {
      voiceUrl: "",
      provider: miniMaxApiKey ? "minimax" : "openai",
      model: miniMaxApiKey ? "speech-02-turbo" : "gpt-4o-mini-tts",
      voice: miniMaxApiKey ? miniMaxVoice.voiceId : openAiVoice,
      isFallback: true,
      errorMessage: "dialogueText is required",
    };
  }

  if (!miniMaxApiKey && !openAiApiKey) {
    return {
      voiceUrl: "",
      provider: "minimax",
      model: "speech-02-turbo",
      voice: miniMaxVoice.voiceId,
      isFallback: true,
      errorMessage: "MINIMAX_API_KEY or OPENAI_API_KEY is not configured",
    };
  }

  try {
    if (miniMaxApiKey) {
      const response = await fetch(`${miniMaxBase.replace(/\/$/, "")}/v1/t2a_v2`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${miniMaxApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "speech-02-turbo",
          text: dialogueText,
          stream: false,
          language_boost: "Chinese",
          output_format: "hex",
          voice_setting: {
            voice_id: miniMaxVoice.voiceId,
            speed: miniMaxVoice.speed,
            vol: miniMaxVoice.vol,
            pitch: miniMaxVoice.pitch,
          },
          audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: "mp3",
            channel: 1,
          },
          pronunciation_dict: voicePrompt ? { tone: [voicePrompt.slice(0, 180)] } : undefined,
        }),
      });
      const json = await response.json().catch(() => null);
      const audioHex = String(json?.data?.audio || "").trim();
      const statusCode = Number(json?.base_resp?.status_code ?? -1);
      if (!response.ok || statusCode !== 0 || !audioHex) {
        return {
          voiceUrl: "",
          provider: "minimax",
          model: "speech-02-turbo",
          voice: miniMaxVoice.voiceId,
          isFallback: true,
          errorMessage: `minimax_tts_failed:${response.status}:${String(json?.base_resp?.status_msg || json?.message || "missing_audio")}`,
        };
      }

      const audioBuffer = Buffer.from(audioHex, "hex");
      if (!audioBuffer.length) {
        return {
          voiceUrl: "",
          provider: "minimax",
          model: "speech-02-turbo",
          voice: miniMaxVoice.voiceId,
          isFallback: true,
          errorMessage: "minimax_tts_empty_audio",
        };
      }

      const blob = await put(`voices/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`, audioBuffer, {
        access: "public",
        contentType: "audio/mpeg",
      });

      return {
        voiceUrl: blob.url,
        provider: "minimax",
        model: "speech-02-turbo",
        voice: miniMaxVoice.voiceId,
        isFallback: false,
        errorMessage: "",
      };
    }

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: openAiVoice,
        input: dialogueText,
        format: "mp3",
        instructions: voicePrompt || undefined,
      }),
    });

    if (!response.ok) {
      const err = (await response.text()).slice(0, 600);
      return {
        voiceUrl: "",
        provider: "openai",
        model: "gpt-4o-mini-tts",
        voice: openAiVoice,
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
        voice: openAiVoice,
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
      voice: openAiVoice,
      isFallback: false,
      errorMessage: "",
    };
  } catch (error: any) {
    return {
      voiceUrl: "",
      provider: miniMaxApiKey ? "minimax" : "openai",
      model: miniMaxApiKey ? "speech-02-turbo" : "gpt-4o-mini-tts",
      voice: miniMaxApiKey ? miniMaxVoice.voiceId : openAiVoice,
      isFallback: true,
      errorMessage: error?.message || String(error),
    };
  }
}

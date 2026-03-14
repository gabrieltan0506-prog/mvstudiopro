import crypto from "node:crypto";

function s(v: unknown) {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

function jparse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function createSignedJwt(assertion: { clientEmail: string; privateKey: string }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: assertion.clientEmail,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  sign.end();
  const signature = sign.sign(assertion.privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

function buildWaveFileFromPcm(input: { pcm: Buffer; sampleRate: number; channels?: number; bitsPerSample?: number }) {
  const channels = Math.max(1, Number(input.channels || 1) || 1);
  const bitsPerSample = Math.max(8, Number(input.bitsPerSample || 16) || 16);
  const byteRate = input.sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize = input.pcm.length;
  const out = Buffer.alloc(44 + dataSize);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + dataSize, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(input.sampleRate, 24);
  out.writeUInt32LE(byteRate, 28);
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(bitsPerSample, 34);
  out.write("data", 36);
  out.writeUInt32LE(dataSize, 40);
  input.pcm.copy(out, 44);
  return out;
}

function mapMiniMaxVoice(voiceType: string) {
  const normalized = s(voiceType).trim().toLowerCase();
  if (normalized === "male") return "Chinese (Mandarin)_Reliable_Executive";
  if (normalized === "cartoon") return "Chinese (Mandarin)_News_Anchor";
  return "Chinese (Mandarin)_News_Anchor";
}

function buildMiniMaxVoiceConfig(input: { voiceType?: string; voiceStyle?: string }) {
  const voiceType = s(input.voiceType || "female").trim() || "female";
  const voiceStyle = s(input.voiceStyle).trim().toLowerCase();
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
    voiceId: mapMiniMaxVoice(voiceType),
    speed,
    pitch,
    vol: 1,
  };
}

function mapVertexVoice(input: { voiceType?: string }) {
  const voiceType = s(input.voiceType || "female").trim().toLowerCase();
  if (voiceType === "male") return s(process.env.VERTEX_TTS_VOICE_MALE || "Charon").trim() || "Charon";
  if (voiceType === "cartoon") return s(process.env.VERTEX_TTS_VOICE_CARTOON || "Puck").trim() || "Puck";
  return s(process.env.VERTEX_TTS_VOICE_FEMALE || "Kore").trim() || "Kore";
}

function hasVertexTtsEnv() {
  return Boolean(s(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON).trim() && s(process.env.VERTEX_PROJECT_ID).trim());
}

async function getVertexAccessToken() {
  const raw = s(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON).trim();
  if (!raw) throw new Error("missing_env_GOOGLE_APPLICATION_CREDENTIALS_JSON");
  const serviceAccount = jparse(raw);
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error("invalid_GOOGLE_APPLICATION_CREDENTIALS_JSON");
  }

  const assertion = createSignedJwt({
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key,
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  const json = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !json?.access_token) {
    throw new Error(`vertex_token_failed:${tokenRes.status}:${s(json?.error_description || json?.error || "missing_access_token")}`);
  }
  return String(json.access_token);
}

export type VoiceSynthesisInput = {
  dialogueText: string;
  voicePrompt?: string;
  voice?: string;
  voiceType?: string;
  voiceStyle?: string;
};

export type VoiceSynthesisResult = {
  provider: "vertex" | "minimax" | "openai";
  model: string;
  voice: string;
  audioBuffer: Buffer;
  contentType: string;
  extension: string;
  isFallback: boolean;
  errorMessage: string;
};

function emptyResult(input: Partial<VoiceSynthesisResult> & Pick<VoiceSynthesisResult, "provider" | "model" | "voice">): VoiceSynthesisResult {
  return {
    provider: input.provider,
    model: input.model,
    voice: input.voice,
    audioBuffer: Buffer.alloc(0),
    contentType: input.contentType || "audio/mpeg",
    extension: input.extension || "mp3",
    isFallback: true,
    errorMessage: input.errorMessage || "",
  };
}

async function tryVertexTts(input: VoiceSynthesisInput): Promise<VoiceSynthesisResult> {
  const projectId = s(process.env.VERTEX_PROJECT_ID).trim();
  const location = s(process.env.VERTEX_TTS_LOCATION || process.env.VERTEX_GEMINI_LOCATION || "global").trim() || "global";
  const model = s(process.env.VERTEX_TTS_MODEL || "gemini-2.5-flash-preview-tts").trim() || "gemini-2.5-flash-preview-tts";
  const voiceName = mapVertexVoice({ voiceType: input.voiceType });
  const baseUrl = location === "global" ? "https://aiplatform.googleapis.com" : `https://${location}-aiplatform.googleapis.com`;
  const systemParts = [
    "You are a text-to-speech model.",
    "Speak only the user-provided dialogue without adding any extra words.",
    "Preserve the original language of the dialogue.",
  ];
  if (s(input.voicePrompt).trim()) {
    systemParts.push(`Style instructions: ${s(input.voicePrompt).trim().slice(0, 400)}`);
  }

  try {
    const accessToken = await getVertexAccessToken();
    const response = await fetch(`${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemParts.join(" ") }] },
        contents: [{ role: "user", parts: [{ text: s(input.dialogueText).trim() }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      }),
    });
    const json = await response.json().catch(() => null);
    const inlineData = json?.candidates?.[0]?.content?.parts?.find((part: any) => part?.inlineData?.data)?.inlineData;
    const pcmBase64 = s(inlineData?.data).trim();
    const rawMime = s(inlineData?.mimeType || "audio/L16;rate=24000").trim() || "audio/L16;rate=24000";
    const sampleRateMatch = rawMime.match(/rate=(\d+)/i);
    const sampleRate = Number(sampleRateMatch?.[1] || 24000) || 24000;
    if (!response.ok || !pcmBase64) {
      return emptyResult({
        provider: "vertex",
        model,
        voice: voiceName,
        contentType: "audio/wav",
        extension: "wav",
        errorMessage: `vertex_tts_failed:${response.status}:${s(json?.error?.message || json?.message || "missing_audio")}`,
      });
    }
    const pcmBuffer = Buffer.from(pcmBase64, "base64");
    if (!pcmBuffer.length) {
      return emptyResult({
        provider: "vertex",
        model,
        voice: voiceName,
        contentType: "audio/wav",
        extension: "wav",
        errorMessage: "vertex_tts_empty_audio",
      });
    }
    return {
      provider: "vertex",
      model,
      voice: voiceName,
      audioBuffer: buildWaveFileFromPcm({ pcm: pcmBuffer, sampleRate }),
      contentType: "audio/wav",
      extension: "wav",
      isFallback: false,
      errorMessage: "",
    };
  } catch (error: any) {
    return emptyResult({
      provider: "vertex",
      model,
      voice: voiceName,
      contentType: "audio/wav",
      extension: "wav",
      errorMessage: error?.message || String(error),
    });
  }
}

async function tryMiniMaxTts(input: VoiceSynthesisInput): Promise<VoiceSynthesisResult> {
  const apiKey = s(process.env.MINIMAX_API_KEY).trim();
  const baseUrl = s(process.env.MINIMAX_API_BASE || "https://api.minimax.io").trim() || "https://api.minimax.io";
  const voiceConfig = buildMiniMaxVoiceConfig({ voiceType: input.voiceType, voiceStyle: input.voiceStyle });
  if (!apiKey) {
    return emptyResult({
      provider: "minimax",
      model: "speech-02-turbo",
      voice: voiceConfig.voiceId,
      errorMessage: "missing_env_MINIMAX_API_KEY",
    });
  }
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/t2a_v2`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "speech-02-turbo",
        text: s(input.dialogueText).trim(),
        stream: false,
        language_boost: "Chinese",
        output_format: "hex",
        voice_setting: {
          voice_id: voiceConfig.voiceId,
          speed: voiceConfig.speed,
          vol: voiceConfig.vol,
          pitch: voiceConfig.pitch,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: "mp3",
          channel: 1,
        },
        pronunciation_dict: s(input.voicePrompt).trim() ? { tone: [s(input.voicePrompt).trim().slice(0, 180)] } : undefined,
      }),
    });
    const json = await response.json().catch(() => null);
    const audioHex = s(json?.data?.audio).trim();
    const statusCode = Number(json?.base_resp?.status_code ?? -1);
    if (!response.ok || statusCode !== 0 || !audioHex) {
      return emptyResult({
        provider: "minimax",
        model: "speech-02-turbo",
        voice: voiceConfig.voiceId,
        errorMessage: `minimax_tts_failed:${response.status}:${s(json?.base_resp?.status_msg || json?.message || "missing_audio")}`,
      });
    }
    const audioBuffer = Buffer.from(audioHex, "hex");
    if (!audioBuffer.length) {
      return emptyResult({
        provider: "minimax",
        model: "speech-02-turbo",
        voice: voiceConfig.voiceId,
        errorMessage: "minimax_tts_empty_audio",
      });
    }
    return {
      provider: "minimax",
      model: "speech-02-turbo",
      voice: voiceConfig.voiceId,
      audioBuffer,
      contentType: "audio/mpeg",
      extension: "mp3",
      isFallback: false,
      errorMessage: "",
    };
  } catch (error: any) {
    return emptyResult({
      provider: "minimax",
      model: "speech-02-turbo",
      voice: voiceConfig.voiceId,
      errorMessage: error?.message || String(error),
    });
  }
}

async function tryOpenAiTts(input: VoiceSynthesisInput): Promise<VoiceSynthesisResult> {
  const apiKey = s(process.env.OPENAI_API_KEY).trim();
  const voice = s(input.voice || "nova").trim() || "nova";
  if (!apiKey) {
    return emptyResult({
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voice,
      errorMessage: "missing_env_OPENAI_API_KEY",
    });
  }
  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice,
        input: s(input.dialogueText).trim(),
        format: "mp3",
        instructions: s(input.voicePrompt).trim() || undefined,
      }),
    });
    if (!response.ok) {
      const err = (await response.text()).slice(0, 600);
      return emptyResult({
        provider: "openai",
        model: "gpt-4o-mini-tts",
        voice,
        errorMessage: `openai_tts_failed:${response.status}:${err}`,
      });
    }
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    if (!audioBuffer.length) {
      return emptyResult({
        provider: "openai",
        model: "gpt-4o-mini-tts",
        voice,
        errorMessage: "openai_tts_empty_audio",
      });
    }
    return {
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voice,
      audioBuffer,
      contentType: "audio/mpeg",
      extension: "mp3",
      isFallback: false,
      errorMessage: "",
    };
  } catch (error: any) {
    return emptyResult({
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voice,
      errorMessage: error?.message || String(error),
    });
  }
}

export async function synthesizeVoiceAudio(input: VoiceSynthesisInput): Promise<VoiceSynthesisResult> {
  const dialogueText = s(input.dialogueText).trim();
  const openAiVoice = s(input.voice || "nova").trim() || "nova";
  const defaultVertexModel = s(process.env.VERTEX_TTS_MODEL || "gemini-2.5-flash-preview-tts").trim() || "gemini-2.5-flash-preview-tts";
  const defaultVertexVoice = mapVertexVoice({ voiceType: input.voiceType });
  const defaultMiniMaxVoice = buildMiniMaxVoiceConfig({ voiceType: input.voiceType, voiceStyle: input.voiceStyle }).voiceId;
  if (!dialogueText) {
    return emptyResult({
      provider: hasVertexTtsEnv() ? "vertex" : s(process.env.MINIMAX_API_KEY).trim() ? "minimax" : "openai",
      model: hasVertexTtsEnv() ? defaultVertexModel : s(process.env.MINIMAX_API_KEY).trim() ? "speech-02-turbo" : "gpt-4o-mini-tts",
      voice: hasVertexTtsEnv() ? defaultVertexVoice : s(process.env.MINIMAX_API_KEY).trim() ? defaultMiniMaxVoice : openAiVoice,
      errorMessage: "dialogueText is required",
    });
  }

  const errors: string[] = [];
  if (hasVertexTtsEnv()) {
    const vertexResult = await tryVertexTts(input);
    if (vertexResult.audioBuffer.length) return vertexResult;
    if (vertexResult.errorMessage) errors.push(vertexResult.errorMessage);
  }

  if (s(process.env.MINIMAX_API_KEY).trim()) {
    const miniMaxResult = await tryMiniMaxTts(input);
    if (miniMaxResult.audioBuffer.length) return miniMaxResult;
    if (miniMaxResult.errorMessage) errors.push(miniMaxResult.errorMessage);
  }

  if (s(process.env.OPENAI_API_KEY).trim()) {
    const openAiResult = await tryOpenAiTts(input);
    if (openAiResult.audioBuffer.length) return openAiResult;
    if (openAiResult.errorMessage) errors.push(openAiResult.errorMessage);
  }

  return emptyResult({
    provider: hasVertexTtsEnv() ? "vertex" : s(process.env.MINIMAX_API_KEY).trim() ? "minimax" : "openai",
    model: hasVertexTtsEnv() ? defaultVertexModel : s(process.env.MINIMAX_API_KEY).trim() ? "speech-02-turbo" : "gpt-4o-mini-tts",
    voice: hasVertexTtsEnv() ? defaultVertexVoice : s(process.env.MINIMAX_API_KEY).trim() ? defaultMiniMaxVoice : openAiVoice,
    errorMessage: errors.length ? errors.join(" | ") : "VERTEX_TTS, MINIMAX_API_KEY or OPENAI_API_KEY is not configured",
  });
}

/**
 * 对白配音：Qwen-Audio-3.0-TTS-Plus（经 OpenRouter /audio/speech）。
 *
 * 字段纪律（用户拍板，2026-08-12）：只传 model/input/voice/response_format/seed 五个
 * 标准字段；百炼专属的 instruction/rate/pitch/language_hints/sample_rate/volume/
 * enable_ssml/hot_fix 一概不传。情绪与音效靠 input 内联标签（[sad]/[whispers]/[gasp]…），
 * 控制标签影响后续文本直到下一个标签；音效标签只在当前位置插入声音。
 *
 * 产物 mp3 上传 GCS，回 7 天签名 URL（与抠声参考音同一条存储链），
 * 可直接挂 characterVoiceLocks.audioUrl / 视频引擎 audio_url。
 */
import {
  signGsUriV4ReadUrl,
  uploadBufferToGcs,
} from "./gcs.js";

const OPENROUTER_TTS_ENDPOINT = "https://openrouter.ai/api/v1/audio/speech";
export const QWEN_DIALOGUE_TTS_MODEL = "qwen/qwen-audio-3.0-tts-plus";

/** Plus 当前可用系统音色；专属复刻音色 id 也走同一个 voice 字段（白名单外直接透传） */
export const QWEN_TTS_SYSTEM_VOICES = [
  { id: "longanlingxin", labelZh: "灵心 · 温暖共情女声" },
  { id: "longanlufeng", labelZh: "鹿峰 · 明亮开朗男声" },
] as const;

export type QwenDialogueTtsInput = {
  /** 待合成文本，情绪/音效标签内联其中 */
  input: string;
  /** 系统音色 id 或专属复刻音色 id */
  voice: string;
  /** 固定则可复现 */
  seed?: number;
};

export type QwenDialogueTtsResult = {
  audioUrl: string;
  gcsUri: string;
  bytes: number;
  voice: string;
  generationId: string;
};

export type QwenDialogueTtsRequestBody = {
  model: typeof QWEN_DIALOGUE_TTS_MODEL;
  input: string;
  voice: string;
  response_format: "mp3";
  seed: number;
};

/** OpenRouter 此端点只允许这五个字段；角色后制参数绝不混入上游请求。 */
export function buildQwenDialogueTtsRequestBody(
  params: QwenDialogueTtsInput,
): QwenDialogueTtsRequestBody {
  const input = String(params.input || "").trim();
  if (!input) throw new Error("对白文本为空");
  return {
    model: QWEN_DIALOGUE_TTS_MODEL,
    input: input.slice(0, 4000),
    voice: String(params.voice || "").trim() || QWEN_TTS_SYSTEM_VOICES[0].id,
    response_format: "mp3",
    seed: Number.isFinite(params.seed) ? Math.floor(Number(params.seed)) : 0,
  };
}

/**
 * 合成一段对白 mp3 并落 GCS。
 * 注意：错误文案不携带任何带签名的 URL 或密钥（execFile 教训同款纪律）。
 */
export async function synthesizeQwenDialogue(
  params: QwenDialogueTtsInput,
): Promise<QwenDialogueTtsResult> {
  const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY 未配置");
  const body = buildQwenDialogueTtsRequestBody(params);
  const voice = body.voice;

  const response = await fetch(OPENROUTER_TTS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://www.mvstudiopro.com",
      "X-OpenRouter-Title": "MVStudioPro",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`对白配音上游失败 HTTP ${response.status}：${errText}`);
  }

  const generationId = response.headers.get("x-generation-id") || "";
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw new Error("对白配音上游返回空音频");

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 8);
  const { gcsUri } = await uploadBufferToGcs({
    objectName: `manhua-dialogue-tts/${stamp}/${voice}-${rand}.mp3`,
    buffer: audio,
    contentType: "audio/mpeg",
  });
  const audioUrl = signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);

  return { audioUrl, gcsUri, bytes: audio.length, voice, generationId };
}

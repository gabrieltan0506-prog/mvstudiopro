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
/** 百炼档模型名不带网关前缀；它在两区 Token Plan 白名单内（0824 实测） */
export const QWEN_DIALOGUE_TTS_MODEL_BAILIAN = "qwen-audio-3.0-tts-plus";

/**
 * 百炼 Token Plan 直连 TTS（0824 接线）。
 *
 * 为什么值得切：`qwen-audio-3.0-tts-plus` 在北京/新加坡两区套餐白名单内，
 * 套餐额度**已付费且不用即归零**；而现在走的 OpenRouter 每一次都扣充值余额。
 *
 * **音色 id 两边同一套**（知识库 597 席全表）：`qwen-audio-3.0-tts-plus-{后缀}`，
 * OpenRouter 只是白名单展示得少，id 本身直接透传即可，不需要映射。
 *
 * ⚠️ 唯一的真差异是**情绪机制**：
 *   OpenRouter — 内联 `[sad]` / `[whispers]` 英文方括号标签
 *   百炼      — `input.instruction` 中文指令；**英文方括号标签会被 cosyvoice 引擎 411 拒**
 * 所以带内联标签的文本自动留在 OpenRouter，其余走套餐。
 *
 * 启用：设 `TTS_PREFER_BAILIAN_PLAN=1`（默认关，先小批验证音色与情绪再全量）。
 */
const BAILIAN_TTS_PATH = "/api/v1/services/audio/tts/SpeechSynthesizer";

/** 内联情绪/音效标签检测：百炼 cosyvoice 对英文方括号标签会 411 */
export function hasInlineTtsTags(text: string): boolean {
  return /\[[a-zA-Z_]+\]/.test(String(text || ""));
}

/** 这一条能不能走百炼套餐：开关开 + 套餐 key 在 + 文本无内联标签 */
export function canUseBailianPlanTts(params: { input: string }): boolean {
  if (String(process.env.TTS_PREFER_BAILIAN_PLAN || "").trim() !== "1") return false;
  if (!String(process.env.WAN_PLAN_API_KEY || "").trim()) return false;
  return !hasInlineTtsTags(params.input);
}

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
  const body = buildQwenDialogueTtsRequestBody(params);
  const voice = body.voice;

  // 套餐优先：开关开 + 套餐 key 在 + 文本无内联情绪标签
  if (canUseBailianPlanTts({ input: body.input })) {
    try {
      return await synthesizeViaBailianPlan(body, voice);
    } catch (err) {
      // 套餐失败不阻断交付，回落 OpenRouter；错误只记类型不带 URL/密钥
      console.warn(
        `[qwenDialogueTts] 百炼套餐失败，回落 OpenRouter：${String((err as Error)?.message || "").slice(0, 120)}`,
      );
    }
  }

  const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY 未配置");

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


/**
 * 百炼直连合成：请求体与返回格式都与 OpenRouter 不同——
 * input 是对象而非字符串，返回的是 OSS 直链（带 expires）而非二进制，
 * 所以必须先拉回再转存 GCS，不能把带时效的上游链交给下游。
 */
async function synthesizeViaBailianPlan(
  body: QwenDialogueTtsRequestBody,
  originalVoice: string,
): Promise<QwenDialogueTtsResult> {
  const key = String(process.env.WAN_PLAN_API_KEY || "").trim();
  const base = String(process.env.WAN_PLAN_BASE || "").trim().replace(/\/$/, "");
  if (!key || !base) throw new Error("百炼套餐未配置");

  const res = await fetch(`${base}${BAILIAN_TTS_PATH}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: QWEN_DIALOGUE_TTS_MODEL_BAILIAN,
      input: { text: body.input, voice: body.voice },
    }),
  });
  if (!res.ok) {
    const errText = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`百炼 TTS HTTP ${res.status}：${errText}`);
  }
  const json = (await res.json()) as { output?: { audio?: { url?: string } } };
  const upstreamUrl = String(json.output?.audio?.url || "").trim();
  if (!upstreamUrl) throw new Error("百炼 TTS 返回空音频地址");

  // 上游链带 expires，必须立刻转存
  const audioRes = await fetch(upstreamUrl);
  if (!audioRes.ok) throw new Error(`百炼 TTS 取音频失败 HTTP ${audioRes.status}`);
  const audio = Buffer.from(await audioRes.arrayBuffer());
  if (!audio.length) throw new Error("百炼 TTS 音频为空");

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 8);
  const { gcsUri } = await uploadBufferToGcs({
    objectName: `manhua-dialogue-tts/${stamp}/${originalVoice}-${rand}.mp3`,
    buffer: audio,
    contentType: "audio/mpeg",
  });
  return {
    audioUrl: signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600),
    gcsUri,
    bytes: audio.length,
    voice: originalVoice,
    generationId: "bailian-plan",
  };
}

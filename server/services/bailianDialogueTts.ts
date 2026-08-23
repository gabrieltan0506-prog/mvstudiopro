/**
 * 对白配音 · 百炼直连（新加坡套餐优先 → 北京套餐 fallback）。
 *
 * 与既有的 `qwenDialogueTts.ts`（走 OpenRouter）并存而非替换：
 * OpenRouter 那条只收五个标准字段，**情绪靠内联方括号标签**；
 * 百炼直连能用 `input.instruction` 中文指令，且吃套餐额度不扣充值余额。
 *
 * ⚠️ 两条通路的情绪写法**互斥，不能混**：
 *   OpenRouter  → `[angry]` `[whispers]` 内联标签
 *   百炼直连    → `input.instruction` 中文指令；
 *                 **英文方括号标签会 411**（cosyvoice 引擎直接拒），
 *                 写进 text 里不只是不生效，是整单失败。
 *
 * 路由（用户 0824 定）：
 *   ① DASHSCOPE_SG_PLAN_KEY  + token-plan.ap-southeast-1.maas.aliyuncs.com
 *   ② WAN_PLAN_API_KEY       + token-plan.cn-beijing.maas.aliyuncs.com
 * key 与 base **必须配对**：套餐 key 打工作空间域是 401 InvalidApiKey（0823 实测）。
 */
export const BAILIAN_TTS_PATH = "/api/v1/services/audio/tts/SpeechSynthesizer";
export const BAILIAN_TTS_MODEL = "qwen-audio-3.0-tts-plus";

/** 597 席音色的 voice 参数必带完整前缀；系统音色另有 longanhuan_v3.6 式短名 */
export const BAILIAN_TTS_VOICE_PREFIX = `${BAILIAN_TTS_MODEL}-`;

export type BailianTtsRegion = "singapore" | "beijing";

export type BailianTtsCredential = {
  region: BailianTtsRegion;
  apiKey: string;
  endpoint: string;
};

/**
 * 按优先级列出可用凭证。**新加坡在前**（用户 0823 定：配音一律走新加坡）。
 *
 * 只返回配齐了 key 的区；一个都没有时返回空数组，由调用方明确失败——
 * 不静默回落到按量通道（那会扣充值余额，而计划报的是套餐）。
 */
export function listBailianTtsCredentials(): BailianTtsCredential[] {
  const out: BailianTtsCredential[] = [];
  const sgKey = String(process.env.DASHSCOPE_SG_PLAN_KEY || "").trim();
  if (sgKey) {
    const sgBase = String(
      process.env.DASHSCOPE_SG_PLAN_BASE || "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
    )
      .trim()
      .replace(/\/$/, "");
    out.push({ region: "singapore", apiKey: sgKey, endpoint: `${sgBase}${BAILIAN_TTS_PATH}` });
  }
  const bjKey = String(process.env.WAN_PLAN_API_KEY || "").trim();
  if (bjKey) {
    const bjBase = String(
      process.env.WAN_PLAN_BASE || "https://token-plan.cn-beijing.maas.aliyuncs.com",
    )
      .trim()
      .replace(/\/$/, "");
    out.push({ region: "beijing", apiKey: bjKey, endpoint: `${bjBase}${BAILIAN_TTS_PATH}` });
  }
  return out;
}

/**
 * 方括号情绪标签检测。
 *
 * 百炼这条通路上它不是「不生效」而是 **411 整单失败**，
 * 所以在发请求之前拦下来，并告诉调用方改用 instruction。
 */
export function assertNoBracketEmotionTags(text: string): void {
  const hit = String(text || "").match(/\[[a-zA-Z][a-zA-Z\s_-]{1,30}\]/);
  if (hit) {
    throw new Error(
      `百炼直连不收英文方括号情绪标签（会 411），检测到 ${hit[0]}；情绪请改走 instruction 中文指令`,
    );
  }
}

/** voice 参数补全：597 席要带完整模型前缀，系统短名（含 _v）原样透传 */
export function normalizeBailianTtsVoice(voice: string): string {
  const v = String(voice || "").trim();
  if (!v) throw new Error("对白配音缺少 voice");
  if (v.startsWith(BAILIAN_TTS_VOICE_PREFIX)) return v;
  // longanhuan_v3.6 这类系统音色是独立命名，不加前缀
  if (/_v\d/.test(v)) return v;
  return `${BAILIAN_TTS_VOICE_PREFIX}${v}`;
}

export type BailianTtsRequest = {
  text: string;
  voice: string;
  /** 情绪与语气的中文指令，例如「压低声音，带着颤抖」 */
  instructionZh?: string;
};

export function buildBailianTtsBody(req: BailianTtsRequest): Record<string, unknown> {
  const text = String(req.text || "").trim();
  if (!text) throw new Error("对白配音缺少文本");
  assertNoBracketEmotionTags(text);
  const instruction = String(req.instructionZh || "").trim();
  if (instruction) assertNoBracketEmotionTags(instruction);
  return {
    model: BAILIAN_TTS_MODEL,
    input: {
      text,
      voice: normalizeBailianTtsVoice(req.voice),
      ...(instruction ? { instruction } : {}),
    },
  };
}

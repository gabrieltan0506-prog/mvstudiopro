/**
 * 官方生图密钥池（两把并行 + 互为兜底）
 *
 * 环境变量：
 * - `OPENAI_IMAGE_API_KEY_ASSET`：设定图专用（人物 / 场景 / 道具）
 * - `OPENAI_IMAGE_API_KEY_KEYART`：静帧与成片首帧专用
 * - `OPENAI_IMAGE_API_KEY` / `OPENAI_API_KEY`：未分道时的共用钥（两把都没配即退回原行为）
 *
 * 本道那把打不通（鉴权失效 / 限流 / 上游 5xx / 超时）就立刻换另一道的钥重试一次；
 * 内容审核、提示词过长这类改钥也没用的错误不换。
 */
import {
  OPENAI_IMAGE_LANE_DEFAULT,
  type OpenAiImageLane,
} from "../../shared/openaiImageLane.js";

export type OpenAiImageKeySlot = {
  /** 日志用：只写来源变量名，不写密钥本体 */
  slot: string;
  key: string;
};

function isValidOpenAiSkKey(raw: string): boolean {
  // 官方密钥以 sk- 开头；过滤占位伪值（中文、[set]、空串等）
  return /^sk-[A-Za-z0-9]/.test(raw);
}

function readSlot(name: string): OpenAiImageKeySlot | null {
  const raw = String(process.env[name] || "").trim();
  if (!isValidOpenAiSkKey(raw)) return null;
  return { slot: name, key: raw };
}

const LANE_ENV: Record<OpenAiImageLane, string> = {
  asset: "OPENAI_IMAGE_API_KEY_ASSET",
  keyart: "OPENAI_IMAGE_API_KEY_KEYART",
};

const SHARED_ENV = ["OPENAI_IMAGE_API_KEY", "OPENAI_API_KEY"] as const;

/**
 * 返回按顺序尝试的密钥链：本道专钥 → 共用钥 → 另一道专钥（借用）。
 * 同一把密钥只出现一次，避免只配了一把时白跑第二遍。
 */
export function resolveOpenAiImageKeyChain(lane?: OpenAiImageLane | null): OpenAiImageKeySlot[] {
  const active = lane ?? OPENAI_IMAGE_LANE_DEFAULT;
  const other: OpenAiImageLane = active === "asset" ? "keyart" : "asset";
  const candidates = [
    readSlot(LANE_ENV[active]),
    ...SHARED_ENV.map((name) => readSlot(name)),
    readSlot(LANE_ENV[other]),
  ];
  const chain: OpenAiImageKeySlot[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (!c || seen.has(c.key)) continue;
    seen.add(c.key);
    chain.push(c);
  }
  return chain;
}

/** 兼容旧调用：取本道第一把可用密钥。 */
export function resolveOpenAiImageKey(lane?: OpenAiImageLane | null): string {
  return resolveOpenAiImageKeyChain(lane)[0]?.key || "";
}

const KEY_FATAL_RE =
  /moderation|content[_ -]?polic|safety system|prompt too long|invalid[_ -]?prompt|image_generation_user_error/i;

/** 这把钥打不通、换另一把还有戏吗？审核 / 提示词类错误换钥无用。 */
export function shouldRetryOpenAiImageWithOtherKey(message: string): boolean {
  const msg = String(message || "");
  if (!msg) return false;
  if (KEY_FATAL_RE.test(msg)) return false;
  return true;
}

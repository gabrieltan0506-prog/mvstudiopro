/**
 * 道具实物形制联网核对
 *
 * 用户 2026-07-29 明文：器物形制不许 Agent 凭常识编（画错要退款），
 * 须以参考图或联网检索为准。这里走既有联网通道查一句可核对的外形描述；
 * 查不到就返回空串，让提示词少一句，绝不给模型一个错形状。
 *
 * 进程内缓存：同一件器物一天内只查一次，避免每次补图都烧一遍检索。
 */
import {
  MANHUA_PROP_SHAPE_LOOKUP_MAX,
  normalizeManhuaPropShapeHintZh,
} from "../../shared/manhuaPropShapeHint.js";
import { callGemini35FlashCopywriting } from "./gemini35FlashRuntime.js";

const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_MAX = 500;

const cache = new Map<string, { hintZh: string; at: number }>();

const SYSTEM_INSTRUCTION = [
  "你是古代器物考据员。用户给出中国古装剧里的道具名，你联网核对该器物的**实物外形**，只回一句中文。",
  "只写看得见的形状与材质：整体轮廓、长宽厚比例、弯直、端头收放、常见材质与表面质感。",
  "禁止写用途、象征、剧情作用、朝代考据、人物归属；禁止提到文字、刻字、题名。",
  "把握不足、名字是编造的、或检索不到可靠实物时，只回 UNKNOWN 四个字母，不要猜。",
  "不要用「可能 / 大概 / 据说」这类语气；不确定就回 UNKNOWN。",
].join("\n");

function readCache(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.hintZh;
}

function writeCache(key: string, hintZh: string): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { hintZh, at: Date.now() });
}

/**
 * 查一件道具的实物形制。返回已清洗的一句话；查不到 / 不可靠 → 空串。
 */
export async function lookupManhuaPropShapeHintZh(nameZh: string): Promise<string> {
  const name = String(nameZh || "").trim().slice(0, 40);
  if (!name) return "";
  const cached = readCache(name);
  if (cached !== null) return cached;

  let hintZh = "";
  try {
    const raw = await callGemini35FlashCopywriting({
      taskSystemInstruction: SYSTEM_INSTRUCTION,
      userText: `道具名：${name}\n请只回一句实物外形描述，或 UNKNOWN。`,
      responseMimeType: "text/plain",
      maxOutputTokens: 220,
      temperature: 0.2,
    });
    hintZh = normalizeManhuaPropShapeHintZh(raw);
  } catch (e: unknown) {
    // 检索挂了不该挡住出图：当作查不到，提示词少这一行
    console.warn(
      "[manhuaPropShapeLookup]",
      name,
      e instanceof Error ? e.message.slice(0, 160) : String(e),
    );
    hintZh = "";
  }
  writeCache(name, hintZh);
  return hintZh;
}

/**
 * 批量查（补图前一次问齐）。返回 `道具名 → 形制句`，查不到的键直接不出现。
 */
export async function lookupManhuaPropShapeHintsZh(
  namesZh: string[],
): Promise<Record<string, string>> {
  const names = Array.from(
    new Set((namesZh || []).map((n) => String(n || "").trim()).filter(Boolean)),
  ).slice(0, MANHUA_PROP_SHAPE_LOOKUP_MAX);
  const out: Record<string, string> = {};
  const results = await Promise.all(
    names.map(async (n) => ({ n, hintZh: await lookupManhuaPropShapeHintZh(n) })),
  );
  for (const { n, hintZh } of results) {
    if (hintZh) out[n] = hintZh;
  }
  return out;
}

/** 测试用：清掉进程内缓存。 */
export function __clearManhuaPropShapeCacheForTest(): void {
  cache.clear();
}

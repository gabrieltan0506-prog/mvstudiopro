/**
 * 知识卡成稿档派生（用户 0910 拍板）：
 * 提炼只做一次、以「完整版」长稿为真源；「精华版」从长稿按需派生，两档到最后阶段仍可切换，不设页数上限。
 * 派生是纯文本压缩，交给便宜的大模型（DeepSeek V4 Flash：EvoLink `deepseek-v4-flash` 优先 → 新加坡 Qwen3.8 token plan → OpenRouter `deepseek/deepseek-v4-flash-0731`；
 * 约 $0.09/M 进、$0.18/M 出），23 万字长稿派生一次约 3 美分。与读档链同序（0910 用户令：EvoLink 与新加坡任一失效都可落 OpenRouter）。
 */
import { countMarkdownSections, mergeDistilledMarkdownChunks } from "./knowledgeCardDistill.js";
import { touchKnowledgeCardDistillActivity } from "./knowledgeCardDistillActivity.js";

/** 网关顺序：EvoLink（direct.evolink.ai，DeepSeek）→ 新加坡 Qwen3.8 token plan → OpenRouter（DeepSeek）兜底 */
export const KNOWLEDGE_CARD_DERIVE_MODEL_EVOLINK = String(process.env.KNOWLEDGE_CARD_DERIVE_MODEL_EVOLINK || "deepseek-v4-flash").trim();
export const KNOWLEDGE_CARD_DERIVE_MODEL_OPENROUTER = String(process.env.KNOWLEDGE_CARD_DERIVE_MODEL_OPENROUTER || "deepseek/deepseek-v4-flash-0731").trim();
export const KNOWLEDGE_CARD_DERIVE_MODEL_DASHSCOPE_SG = String(process.env.KNOWLEDGE_CARD_DERIVE_MODEL_DASHSCOPE_SG || "qwen3.8-max").trim();
const EVOLINK_DIRECT_CHAT_URL = String(process.env.EVOLINK_DIRECT_CHAT_URL || "https://direct.evolink.ai/v1/chat/completions").trim();
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DASHSCOPE_SG_PLAN_CHAT_URL = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions";
/** 每批最多喂多少字（DeepSeek 上下文 100 万 token，8 万字一批留足输出与推理余量） */
const DERIVE_BATCH_MAX_CHARS = Math.max(20_000, Number(process.env.KNOWLEDGE_CARD_DERIVE_BATCH_CHARS) || 80_000);
const DERIVE_TIMEOUT_MS = Math.max(120_000, Number(process.env.KNOWLEDGE_CARD_DERIVE_TIMEOUT_MS) || 15 * 60_000);

type DeriveGateway = { name: "evolink" | "dashscope_sg" | "openrouter"; url: string; key: string; model: string };
function deriveGateways(): DeriveGateway[] {
  const out: DeriveGateway[] = [];
  const evo = String(process.env.EVOLINK_API_KEY || "").trim();
  if (evo) out.push({ name: "evolink", url: EVOLINK_DIRECT_CHAT_URL, key: evo, model: KNOWLEDGE_CARD_DERIVE_MODEL_EVOLINK });
  const sg = String(process.env.DASHSCOPE_SG_PLAN_KEY || "").trim();
  if (sg) out.push({ name: "dashscope_sg", url: DASHSCOPE_SG_PLAN_CHAT_URL, key: sg, model: KNOWLEDGE_CARD_DERIVE_MODEL_DASHSCOPE_SG });
  const or = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (or) out.push({ name: "openrouter", url: OPENROUTER_CHAT_URL, key: or, model: KNOWLEDGE_CARD_DERIVE_MODEL_OPENROUTER });
  return out;
}

export function isKnowledgeCardDeriveReady(): boolean {
  return deriveGateways().length > 0;
}

/** 精华版目标节数：完整版节数的约 1/6，最少 12，最多 120（36 页上下） */
export function compactTargetSections(fullSections: number): number {
  return Math.max(12, Math.min(120, Math.round(fullSections / 6)));
}

export function splitMarkdownSections(md: string): { head: string; sections: string[] } {
  const parts = md.split(/^(?=##\s)/m);
  const head = parts[0]?.startsWith("## ") ? "" : parts[0] || "";
  const sections = parts.filter((p) => p.startsWith("## "));
  return { head, sections };
}

/** 按字数把小节切成批，不拆小节 */
export function batchSections(sections: string[], maxChars = DERIVE_BATCH_MAX_CHARS): string[][] {
  const batches: string[][] = [];
  let cur: string[] = [];
  let curChars = 0;
  for (const s of sections) {
    if (cur.length && curChars + s.length > maxChars) {
      batches.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(s);
    curChars += s.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

function buildDeriveSystem(keep: number, given: number): string {
  return [
    "你是知识卡片主编。下面是一本书的完整版提炼稿的一部分，由若干「## 标题」小节组成，每节含「图：」示意说明、要点列表与表格。",
    `请从这 ${given} 节里挑出最能代表全书主线、对读者最有用的 ${keep} 节，**原样保留**每节的「## 标题」「图：」「要点」「表格」四件套格式，不要改写成散文。`,
    "允许把两节强相关的内容合并成一节（标题可重拟），但合并后仍要保留图示说明、要点与表格。",
    "去掉重复、只有细节没有结论的节。不要输出任何前言、说明或总结，只输出 Markdown 小节。",
    `严格控制在 ${keep} 节以内。`,
  ].join("\n");
}

async function chatOnce(gw: DeriveGateway, params: { system: string; user: string; maxTokens: number; abortSignal?: AbortSignal }): Promise<string> {
  const res = await fetch(gw.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gw.key}`,
      "Content-Type": "application/json",
      ...(gw.name === "openrouter" ? { "HTTP-Referer": "https://mvstudiopro.com", "X-Title": "mvstudiopro knowledge card" } : {}),
    },
    body: JSON.stringify({
      model: gw.model,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
      temperature: 0.2,
      max_tokens: params.maxTokens,
      // 0910 用户令：思考一律打开、不准关闭，档位 high（新加坡 compatible-mode 只认 enable_thinking）
      ...(gw.name === "evolink"
        ? { thinking: { type: "enabled" }, reasoning_effort: "high" }
        : gw.name === "dashscope_sg"
          ? { enable_thinking: true }
          : { reasoning: { effort: "high" } }),
    }),
    signal: params.abortSignal ?? AbortSignal.timeout(DERIVE_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`derive_upstream_failed:${gw.name}:${res.status}:${text.slice(0, 200)}`);
  let json: { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`derive_bad_json:${gw.name}:${text.slice(0, 120)}`);
  }
  const content = json.choices?.[0]?.message?.content;
  const out = typeof content === "string" ? content.trim() : "";
  if (!out) throw new Error(`精华版派生：${gw.name} 没有返回内容`);
  if (json.choices?.[0]?.finish_reason === "length") throw new Error(`精华版派生：${gw.name} 输出被截断，请缩小批次`);
  return out;
}

/** 按网关链调用：一家坏了（HTTP 错 / 空内容 / 截断）换下一家 */
async function deriveChat(params: { system: string; user: string; model?: string; maxTokens: number; abortSignal?: AbortSignal }): Promise<string> {
  const gateways = deriveGateways();
  if (!gateways.length) throw new Error("精华版派生未配置（EVOLINK_API_KEY / OPENROUTER_API_KEY）");
  let lastError: Error | null = null;
  for (let i = 0; i < gateways.length; i++) {
    const gw = gateways[i]!;
    touchKnowledgeCardDistillActivity();
    try {
      return await chatOnce(gw, params);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < gateways.length - 1) console.warn(`[knowledgeCardLevelDerive] ${gw.name} 失败 → 改走 ${gateways[i + 1]!.name}：${lastError.message.slice(0, 160)}`);
    }
  }
  throw lastError || new Error("精华版派生失败");
}

export type DeriveProgress = { doneBatches: number; totalBatches: number; pass: number };

/**
 * 长稿 → 精华版：按批挑节压缩，一批一次模型调用；批数多时再做一轮全局挑选。
 * 任何一批输出坏了（节数为 0 或远超要求）整次失败，不把半成品当成稿。
 */
export async function deriveKnowledgeCardCompact(params: {
  fullMarkdown: string;
  targetSections?: number;
  model?: string;
  onProgress?: (p: DeriveProgress) => void | Promise<void>;
  chat?: typeof deriveChat;
}): Promise<{ markdown: string; sections: number; targetSections: number; passes: number }> {
  const chat = params.chat || deriveChat;
  const model = params.model;
  const { head, sections } = splitMarkdownSections(params.fullMarkdown);
  if (!sections.length) throw new Error("完整版稿子里没有「## 」小节，无法派生精华版");
  const target = Math.max(3, Math.floor(params.targetSections || compactTargetSections(sections.length)));
  if (sections.length <= target) {
    return { markdown: params.fullMarkdown.trim(), sections: sections.length, targetSections: target, passes: 0 };
  }
  let current = sections;
  let passes = 0;
  while (current.length > target && passes < 3) {
    passes += 1;
    const batches = batchSections(current);
    const outputs: string[] = [];
    for (let i = 0; i < batches.length; i++) {
      await params.onProgress?.({ doneBatches: i, totalBatches: batches.length, pass: passes });
      const batch = batches[i]!;
      const keep = Math.max(2, Math.ceil((target * batch.length) / current.length));
      const raw = await chat({
        system: buildDeriveSystem(keep, batch.length),
        user: batch.join("\n\n"),
        model,
        maxTokens: Math.min(120_000, Math.max(8_000, Math.ceil(batch.join("").length / 2))),
      });
      const got = countMarkdownSections(raw);
      if (got < 1 || got > keep * 2 + 2) {
        throw new Error(`精华版派生第 ${passes} 轮第 ${i + 1}/${batches.length} 批输出异常（要 ${keep} 节，回 ${got} 节）`);
      }
      outputs.push(raw);
    }
    await params.onProgress?.({ doneBatches: batches.length, totalBatches: batches.length, pass: passes });
    const merged = mergeDistilledMarkdownChunks(outputs);
    const next = splitMarkdownSections(merged).sections;
    if (next.length >= current.length) throw new Error("精华版派生没有压缩效果，已停止");
    current = next;
  }
  const markdown = [head.trim(), current.join("\n\n")].filter(Boolean).join("\n\n");
  return { markdown, sections: current.length, targetSections: target, passes };
}

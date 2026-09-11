/**
 * 知识卡成稿档派生（用户 0910 拍板）：
 * 提炼只做一次、以「完整版」长稿为真源；「精华版」从长稿按需派生，两档到最后阶段仍可切换，不设页数上限。
 * 派生是纯文本压缩，链序与读档链同一份定义（0911：选中的档两家供应商 → 另一档两家 → 最后才 Qwen3.8）；
 * 约 $0.09/M 进、$0.18/M 出），23 万字长稿派生一次约 3 美分。与读档链同序（0910 用户令：EvoLink 与新加坡任一失效都可落 OpenRouter）。
 */
import { countMarkdownSections, mergeDistilledMarkdownChunks } from "./knowledgeCardDistill.js";
import { touchKnowledgeCardDistillActivity } from "./knowledgeCardDistillActivity.js";
import {
  KNOWLEDGE_CARD_DEEPSEEK_FIRST_ORDER,
  KNOWLEDGE_CARD_GLM_FIRST_ORDER,
  openRouterProviderLockForTier,
  type KnowledgeCardTier,
} from "./knowledgeCardGatewayOrder.js";
import { GLM_53_FLASH_EVOLINK_MODEL, GLM_53_FLASH_OPENROUTER_MODEL } from "./glmModels.js";
import { isSseResponse, readGlmSseStream } from "./sseChatStream.js";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL_GLM,
  resolveKnowledgeCardDistillModel,
} from "../../shared/knowledgeCardDistillModels.js";

/** 0911 用户令：降档第一手 GLM 5.3 Flash（两家供应商），Qwen 3.8 退到最后 */
// 派生跟着读档档位走同一个模型（该档是 Flash：能读图的那个），不换成纯文本的 GLM 5.3
export const KNOWLEDGE_CARD_DERIVE_MODEL_GLM_EVOLINK = String(process.env.KNOWLEDGE_CARD_DERIVE_MODEL_GLM_EVOLINK || GLM_53_FLASH_EVOLINK_MODEL).trim();
export const KNOWLEDGE_CARD_DERIVE_MODEL_GLM_OPENROUTER = String(process.env.KNOWLEDGE_CARD_DERIVE_MODEL_GLM_OPENROUTER || GLM_53_FLASH_OPENROUTER_MODEL).trim();

/** 网关顺序（0911：同模型先换供应商）：EvoLink(DeepSeek) → OpenRouter(DeepSeek) → 新加坡(Qwen) → OpenRouter(Qwen) */
export const KNOWLEDGE_CARD_DERIVE_MODEL_EVOLINK = String(process.env.KNOWLEDGE_CARD_DERIVE_MODEL_EVOLINK || "deepseek-v4.1-flash").trim();
export const KNOWLEDGE_CARD_DERIVE_MODEL_OPENROUTER = String(process.env.KNOWLEDGE_CARD_DERIVE_MODEL_OPENROUTER || "deepseek/deepseek-v4.1-flash").trim();
export const KNOWLEDGE_CARD_DERIVE_MODEL_DASHSCOPE_SG = String(process.env.KNOWLEDGE_CARD_DERIVE_MODEL_DASHSCOPE_SG || "qwen3.8-max").trim();
const EVOLINK_DIRECT_CHAT_URL = String(process.env.EVOLINK_DIRECT_CHAT_URL || "https://direct.evolink.ai/v1/chat/completions").trim();
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DASHSCOPE_SG_PLAN_CHAT_URL = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions";
/** 每批最多喂多少字（DeepSeek 上下文 100 万 token，8 万字一批留足输出与推理余量） */
const DERIVE_BATCH_MAX_CHARS = Math.max(20_000, Number(process.env.KNOWLEDGE_CARD_DERIVE_BATCH_CHARS) || 80_000);
const DERIVE_TIMEOUT_MS = Math.max(120_000, Number(process.env.KNOWLEDGE_CARD_DERIVE_TIMEOUT_MS) || 15 * 60_000);

type DeriveGateway = {
  name: "evolink" | "dashscope_sg" | "openrouter";
  /** 该跳的模型档：参数契约按 (name, tier) 定，不靠 model 名前缀猜（环境别名会破坏判断） */
  tier: KnowledgeCardTier;
  url: string;
  key: string;
  model: string;
};
function deriveGateways(model?: string): DeriveGateway[] {
  const evo = String(process.env.EVOLINK_API_KEY || "").trim();
  const sg = String(process.env.DASHSCOPE_SG_PLAN_KEY || "").trim();
  const or = String(process.env.OPENROUTER_API_KEY || "").trim();
  // 终审第五条：派生与主链共用同一份顺序；receipt 选了哪档，派生就从哪档起跳
  const order =
    resolveKnowledgeCardDistillModel(model) === KNOWLEDGE_CARD_DISTILL_MODEL_GLM
      ? KNOWLEDGE_CARD_GLM_FIRST_ORDER
      : KNOWLEDGE_CARD_DEEPSEEK_FIRST_ORDER;
  const out: DeriveGateway[] = [];
  for (const step of order) {
    if (step.gateway === "evolink" && evo) {
      out.push({
        name: "evolink",
        tier: step.tier,
        url: EVOLINK_DIRECT_CHAT_URL,
        key: evo,
        model:
          step.tier === "qwen"
            ? KNOWLEDGE_CARD_DERIVE_MODEL_DASHSCOPE_SG
            : step.tier === "glm"
              ? KNOWLEDGE_CARD_DERIVE_MODEL_GLM_EVOLINK
              : KNOWLEDGE_CARD_DERIVE_MODEL_EVOLINK,
      });
    } else if (step.gateway === "dashscope_sg" && sg) {
      out.push({ name: "dashscope_sg", tier: step.tier, url: DASHSCOPE_SG_PLAN_CHAT_URL, key: sg, model: KNOWLEDGE_CARD_DERIVE_MODEL_DASHSCOPE_SG });
    } else if (step.gateway === "openrouter" && or) {
      out.push({
        name: "openrouter",
        tier: step.tier,
        url: OPENROUTER_CHAT_URL,
        key: or,
        model:
          step.tier === "qwen"
            ? "qwen/qwen3.8-max"
            : step.tier === "glm"
              ? KNOWLEDGE_CARD_DERIVE_MODEL_GLM_OPENROUTER
              : KNOWLEDGE_CARD_DERIVE_MODEL_OPENROUTER,
      });
    }
  }
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
  // 一批可达 15 分钟，超过卡死阈值：在途也按分钟 touch 心跳
  const inflightBeat = setInterval(() => touchKnowledgeCardDistillActivity(), 60_000);
  try {
    return await chatOnceInner(gw, params);
  } finally {
    clearInterval(inflightBeat);
  }
}

async function chatOnceInner(gw: DeriveGateway, params: { system: string; user: string; maxTokens: number; abortSignal?: AbortSignal }): Promise<string> {
  // 参数契约按 (name, tier) 定（终审 P2）：EvoLink 的 Qwen 末跳必须走 EvoLink-Qwen 契约
  // （enable_thinking / high→medium / max_completion_tokens，对照 knowledgeCardDistill 的 evolink-qwen 分支），
  // 不能只换模型名、参数还发 DeepSeek 那套
  const qwenTier = gw.tier === "qwen";
  const outputTokens =
    gw.tier === "deepseek"
      ? Math.min(params.maxTokens * 2, 384_000)
      : Math.min(params.maxTokens, qwenTier ? 32_768 : 131_072);
  // 注意：两条共享顺序里都没有 evolink:qwen 跳，这个分支只在环境变量改序时可达；
  // 保留是为了契约完整（EvoLink Qwen 的参数与其它跳不同），不是活路径
  const generationOptions: Record<string, unknown> =
    gw.name === "evolink" && qwenTier
      ? {
          enable_thinking: true,
          // EvoLink Qwen 档位只认 low|medium|xhigh：0909 拍板 high 映射 medium
          reasoning_effort: "medium",
          max_completion_tokens: outputTokens,
        }
      : {
          max_tokens: outputTokens,
          // 0910 用户令：思考一律打开、档位 high（新加坡 compatible-mode 只认 enable_thinking）
          ...(gw.name === "evolink"
            ? gw.tier === "glm"
              // EvoLink GLM 5.3：恒开思考关不掉，档位只有 low/high/max 真正生效，不发 thinking 开关
              ? { reasoning_effort: "high" }
              : { thinking: { type: "enabled" }, reasoning_effort: "high" }
            : gw.name === "dashscope_sg"
              ? { enable_thinking: true }
              : { reasoning: { effort: "high" } }),
        };
  // OpenRouter 的 DeepSeek / GLM 跳各锁各的自营，不落到转售方（0911 用户令）
  if (gw.name === "openrouter") {
    const providerLock = openRouterProviderLockForTier(gw.tier);
    if (providerLock) generationOptions.provider = providerLock;
  }
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
      // 0911 用户令：全链流式（首字节太久会被 Cloudflare 524 / undici 300 秒掐断）
      stream: true,
      stream_options: { include_usage: true },
      ...generationOptions,
    }),
    signal: params.abortSignal ?? AbortSignal.timeout(DERIVE_TIMEOUT_MS),
  });
  // 上游忽略 stream 时按普通 JSON 读，不能只看「我发了 stream:true」
  const text = isSseResponse(res) && res.body
    ? await readGlmSseStream(res.body, undefined, { strictCompletion: true })
    : await res.text();
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
  // 终审第五条：model（来自服务端 receipt）决定链序，不再丢弃
  const gateways = deriveGateways(params.model);
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

/** 仅测试用：暴露链构造（不带凭证真值，只反映顺序与模型选择） */
export const __testDeriveGateways = deriveGateways;

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

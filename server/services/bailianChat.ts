/**
 * GLM-5.3 主力 + Qwen3.8-Max 兜底的三档聊天通道(2026-08-25 用户拍板改线)。
 * 顺序:OpenRouter GLM-5.3 → 百炼 Qwen3.8-Max 兜底 → EvoLink Qwen3.8-Max 兜底。
 *
 * 🔴 百炼已整体退出本链(0829 用户令「现在不用百炼了」):枚举成员、BAILIAN_GLM_MODEL、
 *    bailianBase/isBailianChatConfigured 全部删除,不再保留任何百炼死代码。
 *    (文件名 bailianChat.ts 是历史遗留,链上跑的是 OpenRouter;改名是独立一刀。)
 * ⚠️ EvoLink 的 GLM-5.3 尚未上线——0825 Fly 内实测 /v1/models 只有 glm-5.2,
 *    请求 glm-5.3 返回 404 model_not_found("This error is permanent")。
 *    EvoLink 上线 5.3 后在 OpenRouter 之后加档即可,勿用 glm-5.2 冒充。
 *
 * OpenRouter 实测(0825 Fly 内): z-ai/glm-5.3 HTTP 200,provider=Z.AI;
 * 注意它是 reasoning 模型,过小的 max_tokens 会被思考 token 吃光导致空 content——
 * 本链已有 empty_content 判定兜底,调用方仍应给足 max_tokens。
 *
 * 兜底两档(0825 二次拍板):新加坡 Token Plan Qwen3.8-Max(套餐额度,已付费不用即归零,
 * 先耗套餐) → EvoLink Qwen3.8-Max(保交付不保同型)。
 * ⚠️ SG 套餐端点必须用 token-plan.ap-southeast-1 专用地址配 DASHSCOPE_SG_PLAN_KEY;
 *    不能用 DASHSCOPE_SG_BASE(业务空间地址配套餐钥匙会 401,#1307 工作树实录)。
 * 至此整条链不再有任何百炼按量档。
 */
import type { ManhuaNativeProviderErrorReceipt } from "../../shared/manhuaNativeModelReceipt.js";
import {
  errorWithNativeProviderReceipt,
  formatNativeProviderErrorZh,
  nativeProviderReceiptFromError,
  parseNativeProviderErrorReceipt,
} from "./manhuaNativeProviderReceipt.js";

/** 现行四档；百炼档 0829 已整体删除（用户令：现在不用百炼了）。 */
export type GlmGatewayName =
  /** GLM-5.3 主档（0829 晚用户拍板改线：EvoLink 优先，OpenRouter 兜底）。 */
  | "evolink_glm"
  | "openrouter"
  | "plan_sg_qwen"
  | "evolink_qwen";

/** OpenRouter 档模型 id。 */
export const OPENROUTER_GLM_MODEL = "z-ai/glm-5.3";
/**
 * 🔒 OpenRouter 上必须钉死的原生 provider slug（0829 账单实证后立）。
 *
 * `z-ai/glm-5.3` 在 OpenRouter 上有 **16 家 provider 在供**（Z.AI 原生 / Fireworks /
 * Together / DeepInfra / Parasail / Cloudflare / Novita …）。不钉＝每发抽一次签。
 * 0829 实测三发的账单证据：
 *   - Z.AI 原生：79,797 in / 27,630 out / $0.233 / finish=stop  ✅
 *   - Fireworks：70,391 in / **110,030** out / $0.583 / 无结束态 ❌（撞我方 15 分钟顶）
 *   - Fireworks：89,472 in /  15,165 out / $0.00  / 无结束态 ❌（被 pkill 打断）
 * 16 家单价几乎一致（$1.4/M in、$4.4/M out），**贵的 2.5 倍全是多想出来的思考 token**。
 * 同一模型换 host 行为就不同——知识库既有判例（minimax 原厂 vs parasail）。
 */
export const OPENROUTER_GLM_PROVIDER_SLUG = "z-ai/fp8";
/**
 * EvoLink 档模型 id（与 OpenRouter 不同名，不能互相拼接得到）。
 * 0829 晚 Fly 内实测 `GET /v1/models`：api.evolink.ai 与 direct.evolink.ai 均已列出
 * `glm-5.3` 与 `glm-5.3-flash`——0825 记的「EvoLink 只有 glm-5.2，5.3 永久 404」已过期。
 */
export const EVOLINK_GLM_MODEL = "glm-5.3";
/**
 * 「仍然是 GLM-5.3」的网关集合（单一真源）。`glm_only` 用它筛选，
 * 调用方也用它断言「产出确实来自 GLM 而不是 Qwen 兜底」——两处判据不许各写一遍。
 */
/**
 * EvoLink GLM 档的思考档位建议值（可调，用户拍板前按此落地）。
 * 官方默认 "max"＝顶格烧思考；本链是「去重＋结构化」整理活，不是开放推理，
 * "high" 足够且省。改这个值＝改成本与产出口径，改前先说一声。
 */
export const EVOLINK_GLM_DEFAULT_REASONING_EFFORT = "high";
/**
 * OpenRouter 侧 GLM 思考档位建议值（与 EvoLink 档同口径，两档产出才可比）。
 * OpenRouter 的 reasoning 参数形态是嵌套 `reasoning:{effort}`，与 EvoLink 的
 * 顶层 `reasoning_effort` 字符串**不是同一个键**，不要互抄。
 */
export const OPENROUTER_GLM_DEFAULT_REASONING_EFFORT = "high" as const;
/**
 * 🔒 本链**链级**默认采样温度（0829 晚用户拍板 0.8）。
 *
 * 用户点破的洞：「如果 temp 不显式传入，就会默认是 1」——**「不传」不是中立，是 1.0**。
 * 本链对每一次调用都硬写 `response_format:{type:"json_object"}`，
 * 即六个调用方（整形 / 系列聚合 / 提示词增强 / routers 一处 / 两个探针脚本）
 * **全是结构化输出任务**，没有一个是自由创作——1.0 对它们一律偏高。
 * 因此默认收在链级，而不是各调用方各贴一张：判据只留一处，漏传也不会掉回 1.0。
 * 调用方仍可显式覆盖。
 */
export const GLM_CHAIN_DEFAULT_TEMPERATURE = 0.8;
/**
 * 剩余预算低于这个数就**跳过该档**（不是兜底时长）。
 * 语义必须是「跳过阈值」：整集结构化输入约 21.7 万 token，60 秒内不可能返回，
 * 强行发出去只会必然 network_error——多一次外呼、多一段等待、trace 还被污染。
 */
export const GLM_CHAIN_MIN_GATEWAY_MS = 60_000;
export const GLM_MODEL_GATEWAYS: ReadonlySet<GlmGatewayName> = new Set<GlmGatewayName>([
  "evolink_glm",
  "openrouter",
]);
/** 末档兜底:GLM 全线不可用时换 Qwen3.8-Max(Wan official 百炼直连 → EvoLink,与扩写链同 id) */
export const GLM_CHAIN_FALLBACK_MODEL = "qwen3.8-max";

export type BailianChatResponse = {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: string | null }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  model?: string;
  /** 上游实际供应商，例如 OpenRouter 返回的 Z.AI。 */
  provider?: string;
  requestId?: string;
};

export type GlmGatewayUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
};

export type GlmGatewayTraceEntry = {
  gateway: GlmGatewayName;
  model: string;
  outcome: "ok" | "http_error" | "invalid_json" | "truncated" | "incomplete" | "empty_content" | "content_invalid" | "network_error" | "skipped_not_configured"
    /** 整链预算已耗尽，该档未发出（0830 新增，配合 deadlineAtMs）。 */
    | "skipped_budget_exhausted";
  detail?: string;
  providerError?: ManhuaNativeProviderErrorReceipt;
};

export type GlmChatSuccess = BailianChatResponse & {
  /** 实际交卷网关 */
  gateway: GlmGatewayName;
  /**
   * 实际交卷模型 id。0829 改线后同一条链上有两个不同的 GLM-5.3 id
   * （EvoLink `glm-5.3` vs OpenRouter `z-ai/glm-5.3`），回执必须记真值，
   * 不许再由调用方拿常量硬写——那会让账本上出现「记的模型不是跑的模型」。
   */
  model: string;
  /** 本次调用的全部真实外呼轨迹(含之前失败的网关) */
  gatewayTrace: GlmGatewayTraceEntry[];
};

/** 三网关全灭:携带完整外呼轨迹供遥测记真账 */
export class GlmGatewayError extends Error {
  readonly code = "glm_gateway_all_failed";
  constructor(
    message: string,
    readonly gatewayTrace: GlmGatewayTraceEntry[],
    /** 已发生的全部上游用量；业务 JSON 不合格或 finish_reason 异常也不能归零。 */
    readonly usage: GlmGatewayUsage = emptyGlmGatewayUsage(),
  ) {
    super(message);
    this.name = "GlmGatewayError";
  }
}

export type GlmParams = {
  system: string;
  user: string;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  /**
   * 默认保留全链（GLM 两档 + Qwen 两档兜底）；模型锁定业务用 `glm_only`——
   * 只在 GLM-5.3 的两档之间降级，绝不静默换成 Qwen（换模型＝换产出口径）。
   * `openrouter_only` 是 0829 改线前的旧名，语义等同 `glm_only`，保留给存量调用方。
   */
  gatewayPolicy?: "fallback" | "glm_only" | "openrouter_only";
  /** 调用方墙钟；默认 240 秒，长结构任务可显式放宽。**这是每一档的上限**。 */
  timeoutMs?: number;
  /**
   * 🔒 **整条链的绝对截止时刻**（epoch ms）。给了它，每一档的实际墙钟取
   * `min(timeoutMs, deadlineAtMs - now)`，且剩余时间不足时**直接跳过该档**。
   *
   * 为什么必须做成参数而不是在调用方算：调用方算出来的是**一个固定数字**，
   * 而 `invokeOneGlmGateway` 在 for 循环里对同一个 params 对象**每档重读一次**
   * `timeoutMs`——params 不变，两档就各拿满上限，「逐档扣减」根本不会发生。
   * 0830 实锤：聚合链曾按「调用前算一次差值」实现，chainStartedAt 与减法在同一个
   * 同步块里、中间无 await，差值恒为 0，改动是**空改**，行为与改前逐字相同。
   */
  deadlineAtMs?: number;
  /** 思考档位。OpenRouter 档发 `reasoning:{effort}`，EvoLink GLM 档发顶层 `reasoning_effort`。 */
  reasoningEffort?: "low" | "medium" | "high" | "max";
  /**
   * 采样温度（0829 晚用户拍板，整形链用 0.8）。
   * ⚠️ 省略**不等于**不发：省略时链路会补上链级默认 GLM_CHAIN_DEFAULT_TEMPERATURE，
   * 因为「不发这个键」就是落到供应商默认 1.0，而本链全是结构化输出任务。
   * **四档（含两个 Qwen 兜底档）一律显式发温度**，调用方可显式覆盖。
   * 用户原话：「temp=0.2 会太死板，改成 0.8 差不多」——整形要合并同指镜头、
   * 取信息更全的描述，是有判断力的活，压太低只会照抄不敢取舍。
   */
  temperature?: number;
  /** 要求 OpenRouter 只路由给完整支持所传参数的供应商。 */
  requireParameters?: boolean;
  /** 为 true 时只接受 finish_reason=stop，缺失或其他值一律拒绝。 */
  requireFinishReasonStop?: boolean;
  /** 防止异常响应整体进入内存；省略时使用 4 MiB。 */
  maxResponseBytes?: number;
  /** 业务验真钩子:抛错=该网关响应不可用,继续降级(复审 P1-1) */
  validateContent?: (content: string) => void;
};

function emptyGlmGatewayUsage(): GlmGatewayUsage {
  return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 };
}

function responseGlmGatewayUsage(response: BailianChatResponse): GlmGatewayUsage {
  return {
    inputTokens: Math.max(0, Number(response.usage?.prompt_tokens) || 0),
    outputTokens: Math.max(0, Number(response.usage?.completion_tokens) || 0),
    reasoningTokens: Math.max(
      0,
      Number(response.usage?.completion_tokens_details?.reasoning_tokens) || 0,
    ),
    costUsd: Math.max(0, Number(response.usage?.cost) || 0),
  };
}

function addGlmGatewayUsage(
  left: GlmGatewayUsage,
  right: GlmGatewayUsage,
): GlmGatewayUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    costUsd: left.costUsd + right.costUsd,
  };
}

type GlmGatewayAttemptError = Error & { glmGatewayUsage?: GlmGatewayUsage };

export async function invokeGlmJsonChatWithGatewayFallback(params: GlmParams): Promise<GlmChatSuccess> {
  const trace: GlmGatewayTraceEntry[] = [];
  let accumulatedUsage = emptyGlmGatewayUsage();
  const configuredGateways: Array<{
    name: GlmGatewayName;
    model: string;
    ready: boolean;
    url: string;
    key: string;
  }> = [
    {
      // 主档:EvoLink GLM-5.3(0829 晚用户拍板改线,原话「GLM5.3 改用 evolink 优先,
      // fallback 再走 open router」)。上线状态当日 Fly 内 /v1/models 实测确认。
      name: "evolink_glm",
      model: EVOLINK_GLM_MODEL,
      ready: Boolean(String(process.env.EVOLINK_API_KEY || "").trim()),
      url: "https://api.evolink.ai/v1/chat/completions",
      key: String(process.env.EVOLINK_API_KEY || "").trim(),
    },
    {
      // 兜底一(同模型):EvoLink 不通才走 OpenRouter,仍是 GLM-5.3,产出口径不变
      name: "openrouter",
      model: OPENROUTER_GLM_MODEL,
      ready: Boolean(String(process.env.OPENROUTER_API_KEY || "").trim()),
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: String(process.env.OPENROUTER_API_KEY || "").trim(),
    },
    {
      // 兜底二(换模型):GLM 两档都不可用才换 Qwen;新加坡 Token Plan 套餐额度(已付费,不用即归零)
      // 端点写死 token-plan 专用域——配 DASHSCOPE_SG_BASE 会 401,不给配错的机会
      name: "plan_sg_qwen",
      model: GLM_CHAIN_FALLBACK_MODEL,
      ready: Boolean(String(process.env.DASHSCOPE_SG_PLAN_KEY || "").trim()),
      url: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
      key: String(process.env.DASHSCOPE_SG_PLAN_KEY || "").trim(),
    },
    {
      // 兜底三:SG 套餐也不通才走 EvoLink Qwen,保交付不保同型
      name: "evolink_qwen",
      model: GLM_CHAIN_FALLBACK_MODEL,
      ready: Boolean(String(process.env.EVOLINK_API_KEY || "").trim()),
      url: "https://api.evolink.ai/v1/chat/completions",
      key: String(process.env.EVOLINK_API_KEY || "").trim(),
    },
  ];
  // 🔒 按网关名筛选，不用 slice 下标——0829 改线把 EvoLink GLM 插到第一位，
  // 旧的 slice(0,1) 会在改序后静默选错一档（下标依赖是改序时最容易漏的雷）。
  const glmOnly = params.gatewayPolicy === "glm_only"
    || params.gatewayPolicy === "openrouter_only";
  const gateways = glmOnly
    ? configuredGateways.filter((g) => GLM_MODEL_GATEWAYS.has(g.name))
    : configuredGateways;
  for (const g of gateways) {
    if (!g.ready) {
      trace.push({ gateway: g.name, model: g.model, outcome: "skipped_not_configured" });
      continue;
    }
    // 预算耗尽就跳过，别发一个注定超时的调用白等（还会把 trace 污染成「两档都失败」）。
    if (Number.isFinite(Number(params.deadlineAtMs))) {
      const remainMs = Number(params.deadlineAtMs) - Date.now();
      if (remainMs < GLM_CHAIN_MIN_GATEWAY_MS) {
        trace.push({ gateway: g.name, model: g.model, outcome: "skipped_budget_exhausted" });
        continue;
      }
    }
    if (params.abortSignal?.aborted) {
      throw new GlmGatewayError("GLM 调用已被硬截止取消", trace, accumulatedUsage);
    }
    try {
      const res = await invokeOneGlmGateway(params, g.url, g.key, g.model, g.name);
      accumulatedUsage = addGlmGatewayUsage(accumulatedUsage, responseGlmGatewayUsage(res));
      const content = res.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content.trim() : "";
      if (!text) {
        trace.push({ gateway: g.name, model: g.model, outcome: "empty_content" });
        continue;
      }
      if (params.validateContent) {
        try {
          params.validateContent(text);
        } catch (ve) {
          trace.push({
            gateway: g.name,
            model: g.model,
            outcome: "content_invalid",
            detail: (ve instanceof Error ? ve.message : String(ve)).slice(0, 120),
          });
          continue;
        }
      }
      trace.push({ gateway: g.name, model: g.model, outcome: "ok" });
      // provider 保留上游真实值（例如 Z.AI）；内部通道身份单独放 gateway。
      return { ...res, gateway: g.name, model: g.model, gatewayTrace: trace };
    } catch (e) {
      const attemptUsage = (e as GlmGatewayAttemptError).glmGatewayUsage;
      if (attemptUsage) {
        accumulatedUsage = addGlmGatewayUsage(accumulatedUsage, attemptUsage);
      }
      const msg = e instanceof Error ? e.message : String(e);
      const outcome: GlmGatewayTraceEntry["outcome"] = /HTTP \d+/.test(msg)
        ? "http_error"
        : /截断/.test(msg)
          ? "truncated"
          : /未正常结束/.test(msg)
            ? "incomplete"
          : /非 JSON/.test(msg)
            ? "invalid_json"
            : "network_error";
      trace.push({ gateway: g.name, model: g.model, outcome, detail: msg.slice(0, 120) });
      const providerError = nativeProviderReceiptFromError(e);
      if (providerError) trace[trace.length - 1]!.providerError = providerError;
      console.warn(`[glmGatewayFallback] ${g.name}: ${msg.slice(0, 200)}`);
    }
  }
  throw new GlmGatewayError(
    glmOnly
      ? `GLM-5.3 两档(EvoLink→OpenRouter)全部失败：${trace.map((t) => `${t.gateway}=${t.outcome}`).join(",") || "通道未配置"}`
      : `GLM 兜底全链失败(含 Qwen 末档)：${trace.map((t) => `${t.gateway}=${t.outcome}`).join(",") || "无可用网关"}`,
    trace,
    accumulatedUsage,
  );
}

async function invokeOneGlmGateway(
  params: GlmParams,
  url: string,
  key: string,
  model: string,
  // 默认值仅为兼容旧签名；链上四档全部显式传名，勿依赖这个默认。
  gateway: GlmGatewayTraceEntry["gateway"] = "openrouter",
): Promise<BailianChatResponse> {
  // 不设硬上限（0829 用户令「不要设定硬超时，跑出结果为止」）：整集结构化输入是六段卡约 21.7 万 tok，
  // 旧的 15 分钟硬顶在 900,005ms 处把调用掐断（openrouter=network_error），
  // 而 0827 定的口径本就是「单次 30 分钟等待、绝不自动重提」——15 分钟传不进去。
  // 全部产出（含被门禁标记的版本）进 GLM 后输入更大，上限必须留够。
  // 每档实际墙钟 = min(本档上限, 整链剩余预算)。deadlineAtMs 缺省时退回旧行为。
  const perGatewayMs = Math.floor(Number(params.timeoutMs) || 240_000);
  const remainMs = Number.isFinite(Number(params.deadlineAtMs))
    ? Number(params.deadlineAtMs) - Date.now()
    : Number.POSITIVE_INFINITY;
  const timeoutMs = Math.max(1_000, Math.min(perGatewayMs, remainMs));
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = params.abortSignal ? AbortSignal.any([params.abortSignal, timeoutSignal]) : timeoutSignal;
  const budget = Math.max(8_192, Math.min(131_072, Math.floor(Number(params.maxTokens) || 65_536)));
  const body: Record<string, unknown> = {
    model,
    response_format: { type: "json_object" },
    // 永远显式发温度：省略这个键＝落到供应商默认 1.0，而本链全是结构化输出任务。
    temperature: Number.isFinite(Number(params.temperature))
      ? Number(params.temperature)
      : GLM_CHAIN_DEFAULT_TEMPERATURE,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
  };
  if (gateway === "evolink_glm") {
    // EvoLink GLM-5.3 走 OpenAI 兼容端点 POST /v1/chat/completions（官方文档 0829 核实）。
    // 不选 /v1/messages 的三条理由：①它没有 response_format，本链产物必须是 JSON；
    // ②它的正文在 content[] 的 text 块里、思考在 thinking 块里，要另写取文逻辑；
    // ③它对 glm-5.3 只有 thinking.type 开关（且 5.3 关不掉），没有 reasoning_effort 分级。
    //
    // 🔒 reasoning_effort 必须显式传：官方默认是 "max"，而 glm-5.3 强制思考，
    // 思考 token 与正文共吃同一个 max_tokens（上限 131,072）。不传＝顶格烧思考，
    // 且踩知识库那笔血账——HTTP 200 + finish_reason="length" + content 为空。
    // 取值域 minimal|none|low|medium|high|xhigh|max。
    body.max_tokens = budget;
    body.reasoning_effort = params.reasoningEffort === "max" ? "max"
      : params.reasoningEffort === "low" ? "low"
      : params.reasoningEffort === "medium" ? "medium"
      : EVOLINK_GLM_DEFAULT_REASONING_EFFORT;
    // ⚠️ 不发 provider.require_parameters（OpenRouter 专属键）。
    // temperature 由公共体统一发（链级默认 0.8），两档同参，不在这里另发。
  } else if (gateway === "evolink_qwen") {
    // EvoLink Qwen 档位 low|medium|xhigh(无 max);与扩写链同口径开顶档,
    // 且用 max_completion_tokens(传 max_tokens 会被静默忽略)
    body.enable_thinking = true;
    body.reasoning_effort = "xhigh";
    body.max_completion_tokens = budget;
  } else if (gateway === "plan_sg_qwen") {
    // DashScope compatible-mode Qwen(含新加坡 Token Plan):只认 enable_thinking
    // (不认 reasoning_effort),预算走 max_tokens——七审第4条:换档时这条分支键漏改过
    body.enable_thinking = true;
    body.max_tokens = budget;
  } else {
    body.max_tokens = budget;
    // 🔒 思考档位必须显式传：GLM-5.3 强制思考，思考与正文共吃同一个 max_tokens。
    // 0829 实证不传的后果——同一件整形活 Fireworks 烧到 110,030/131,072（84% 天花板），
    // 而 Z.AI 原生 27,630 就 stop。差的八万 token 全是没人要的思考。
    body.reasoning = { effort: params.reasoningEffort || OPENROUTER_GLM_DEFAULT_REASONING_EFFORT };
    // 🔒 provider 钉死原生 Z.AI 且禁止回落：16 家 host 行为不一，抽签＝不可复现。
    // require_parameters 与 order 必须合并进同一个 provider 对象（分开写后一个会覆盖前一个）。
    body.provider = {
      order: [OPENROUTER_GLM_PROVIDER_SLUG],
      allow_fallbacks: false,
      ...(params.requireParameters ? { require_parameters: true } : {}),
    };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const responseHeader = (name: string): string =>
    typeof res.headers?.get === "function" ? String(res.headers.get(name) || "") : "";
  const providerRequestId = String(
    responseHeader("x-request-id")
    || responseHeader("request-id")
    || responseHeader("x-openrouter-request-id")
    || "",
  ).trim() || undefined;
  const maxResponseBytes = Math.max(
    1_024,
    Math.min(16 * 1024 * 1024, Math.floor(Number(params.maxResponseBytes) || 4 * 1024 * 1024)),
  );
  if (Buffer.byteLength(raw) > maxResponseBytes) {
    throw new Error("GLM 链响应超过处理上限");
  }
  if (!res.ok) {
    const providerError = parseNativeProviderErrorReceipt({
      httpStatus: res.status,
      responseText: raw,
      requestId: providerRequestId,
    });
    throw errorWithNativeProviderReceipt(
      formatNativeProviderErrorZh(`GLM 网关 ${gateway}`, providerError),
      providerError,
    );
  }
  let json: BailianChatResponse;
  try {
    json = JSON.parse(raw) as BailianChatResponse;
  } catch {
    throw new Error(`GLM 链非 JSON 响应：${raw.slice(0, 120)}`);
  }
  const finishReason = String(json.choices?.[0]?.finish_reason || "");
  const usage = responseGlmGatewayUsage(json);
  const failWithUsage = (message: string): never => {
    throw Object.assign(new Error(message), { glmGatewayUsage: usage }) as GlmGatewayAttemptError;
  };
  if (finishReason === "length") failWithUsage("GLM 链输出被截断（预算耗尽）");
  if (params.requireFinishReasonStop && finishReason !== "stop") {
    failWithUsage(`GLM 链未正常结束（${finishReason || "missing"}）`);
  }
  return {
    ...json,
    requestId: providerRequestId,
  };
}

import { createHash } from "node:crypto";
import type { NovelGenerationSettings } from "../../shared/novelWorkspace";
import {
  extractFirstChoicePlainText,
  type InvokeResult,
} from "../_core/llm";
import {
  getEvolinkApiKey,
  getOpenRouterChatHeaders,
  OPENROUTER_CHAT_COMPLETIONS_URL,
  EVOLINK_CHAT_COMPLETIONS_URL,
} from "./gpt56CopywritingGateway";
import { getOpenRouterApiKey } from "./openrouterGptImage2";
import { MANHUA_ADVISOR_HOPS } from "./openrouterDeepSeekV41Flash";
import {
  OPENROUTER_GLM_PROVIDER_LOCK,
  OPENROUTER_DEEPSEEK_PROVIDER_LOCK,
} from "./glmModels";
import {
  readGlmSseStream,
  assertSseContentSafety,
  GLM_STREAM_IDLE_TIMEOUT_MS,
} from "./sseChatStream";
import {
  buildNovelizationPrompt,
  novelAdaptationSchema,
  inspectFragmentedDialogue,
  NATURAL_DIALOGUE_RULES,
  type ManhuaNovelAdaptation,
} from "../../shared/manhuaNovelAdaptation";
import type { ManhuaNovelExcerpt } from "../../shared/manhuaNovelSource";

export type NovelRouteAttempt = {
  attempt: number;
  requestId: string;
  model: string;
  gateway: "openrouter" | "evolink";
};
export type NovelRouteEvent =
  | { phase: "input"; route: NovelRouteAttempt; request: Record<string, unknown> }
  | { phase: "response"; route: NovelRouteAttempt; status: number; contentType: string; raw: string; receivedBytes: number }
  | { phase: "failure"; route: NovelRouteAttempt; message: string; status?: number; receivedBytes: number; willFallback: boolean }
  | { phase: "selected"; route: NovelRouteAttempt };

export type NovelStageCall = (
  prompt: string,
  json: boolean,
  requestId: string,
  trace?: { modelPreference?: "auto" | "glm" | "deepseek"; onBytes?: (bytes:number)=>Promise<void>; onRaw?: (raw:string)=>Promise<void>; onRouteEvent?: (event: NovelRouteEvent) => Promise<void> }
) => Promise<{ text: string; model: string; settings?: NovelGenerationSettings; route?: NovelRouteAttempt }>;

async function persistNovelTrace(write: (() => Promise<void>) | undefined) {
  if (!write) return;
  try { await write(); } catch {
    throw Object.assign(new Error("创作记录保存失败，停止本次生成"), { code: "NOVEL_EVIDENCE_WRITE_FAILED" });
  }
}

/** 拒绝帧前已有正文、推理或工具输出时，不能把中途错误当成未生成。 */
function streamHasOutput(raw: string): boolean {
  return raw.split(/\r?\n/).some(line => {
    if (!line.trim().startsWith("data:")) return false;
    const data = line.trim().slice(5).trim();
    if (!data || data === "[DONE]") return false;
    try {
      const frame = JSON.parse(data);
      return (frame.choices || []).some((choice: { delta?: Record<string, unknown>; message?: Record<string, unknown> }) =>
        [choice.delta, choice.message].some(value => value &&
          ["content", "reasoning", "reasoning_content", "reasoning_details", "tool_calls", "refusal"].some(key => {
            const output = value[key];
            return typeof output === "string" ? output.length > 0 : Array.isArray(output) ? output.length > 0 : Boolean(output);
          })));
    } catch {
      // 无法核对的数据帧属于未决响应，不能据此重复调用。
      return true;
    }
  });
}

/** 复用原模型、参数、供应商锁和 SSE；同模型先试完可用通道，不以未决超时重投。 */
export const callNovelStage: NovelStageCall = async (
  prompt,
  json,
  requestId,
  trace
) => {
  const openRouterKey = getOpenRouterApiKey(),
    evolinkKey = getEvolinkApiKey();
  const preference = trace?.modelPreference || "auto";
  const modelTargets = preference === "auto" ? MANHUA_ADVISOR_HOPS
    : preference === "glm" ? MANHUA_ADVISOR_HOPS.slice(0, 2) : MANHUA_ADVISOR_HOPS.slice(2);
  const targets = modelTargets.filter(target => target.gateway === "auto" ? Boolean(openRouterKey) : Boolean(evolinkKey));
  if (!openRouterKey && !evolinkKey) throw new Error("创作模型尚未连接");
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index],
      isOpenRouter = target.gateway === "auto",
      glm = target.modelName.includes("glm");
    const controller = new AbortController();
    const route: NovelRouteAttempt = { attempt: index + 1, requestId: `${requestId}:${index}`, model: target.modelName, gateway: isOpenRouter ? "openrouter" : "evolink" };
    const request = {
      model: target.modelName,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      max_tokens: 32768,
      ...(isOpenRouter
        ? { provider: glm ? OPENROUTER_GLM_PROVIDER_LOCK : OPENROUTER_DEEPSEEK_PROVIDER_LOCK,
          reasoning: glm ? { effort: "high" } : { enabled: true, effort: "high" } }
        : glm ? { reasoning_effort: "high" } : { thinking: { type: "enabled" } }),
      ...(json ? { response_format: { type: "json_object" } } : {}),
    };
    const emit = (event: NovelRouteEvent) => persistNovelTrace(trace?.onRouteEvent ? () => trace.onRouteEvent!(event) : undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let responseStatus: number | undefined;
    let contentType = "";
    let receivedBytes = 0;
    let explicitRejection = false;
    let rawBody = "";
    const rawChunks: Buffer[] = [];
    let responseRecorded = false;
    const recordResponse = async () => {
      if (responseRecorded || responseStatus == null) return;
      responseRecorded = true;
      await emit({ phase: "response", route, status: responseStatus, contentType,
        raw: rawBody || Buffer.concat(rawChunks).toString("utf8"), receivedBytes });
    };
    try {
      await emit({ phase: "input", route, request });
      // 只限制等响应头；成功流由原 reader 按真实字节续期。
      timer = setTimeout(() => controller.abort(new Error("模型连接超时")), GLM_STREAM_IDLE_TIMEOUT_MS);
      const response = await fetch(
        isOpenRouter
          ? OPENROUTER_CHAT_COMPLETIONS_URL
          : EVOLINK_CHAT_COMPLETIONS_URL,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${isOpenRouter ? openRouterKey : evolinkKey}`,
            ...(isOpenRouter ? getOpenRouterChatHeaders() : {}),
            "x-request-id": route.requestId,
          },
          body: JSON.stringify(request),
        }
      );
      responseStatus = response.status;
      contentType = response.headers.get("content-type") || "";
      if (!response.ok) {
        rawBody = await response.text();
        receivedBytes = Buffer.byteLength(rawBody);
        explicitRejection = true;
        throw Object.assign(new Error(`创作模型HTTP ${response.status}`), {
          status: response.status,
        });
      }
      if (
        !response.body ||
        !contentType.includes("text/event-stream")
      ) {
        rawBody = await response.text();
        receivedBytes = Buffer.byteLength(rawBody);
        // 非 SSE 响应可能是认证或内容拒绝，不能推断为拥塞。
        throw new Error("创作模型返回格式异常，旧稿保留");
      }
      clearTimeout(timer);
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, output) {
          rawChunks.push(Buffer.from(chunk));
          receivedBytes += chunk.byteLength;
          output.enqueue(chunk);
        },
      }));
      const raw = await readGlmSseStream(body, 2 * 1024 * 1024, {
        strictCompletion: true,
        onComplete: trace?.onRaw ? raw => persistNovelTrace(() => trace.onRaw!(raw)) : undefined,
        onBytes: trace?.onBytes ? bytes => persistNovelTrace(() => trace.onBytes!(bytes)) : undefined,
        onErrorFrame(error) {
          explicitRejection = true;
          const code = Number(error.code ?? error.status);
          throw Object.assign(new Error("创作模型流返回错误，旧稿保留"), {
            status: Number.isInteger(code) && code >= 400 && code <= 599 ? code : 400,
          });
        },
      });
      const result = JSON.parse(raw) as InvokeResult;
      assertSseContentSafety(result.choices?.[0]?.finish_reason);
      if (result.choices?.[0]?.finish_reason !== "stop")
        throw new Error("创作结果未完整结束，旧稿保留");
      const text = extractFirstChoicePlainText(result).trim();
      if (!text) throw new Error("创作结果为空，旧稿保留");
      await recordResponse();
      await emit({ phase: "selected", route });
      return { text, model: result.model || target.modelName, settings: { reasoning: isOpenRouter || glm ? "high" : "enabled", maxTokens: 32768 }, route };
    } catch (error) {
      controller.abort();
      await recordResponse();
      const failure = error as { code?: string; status?: number; message?: string };
      // 408/504、网络断开、缺结束帧没有未执行证明；只认明确的拥塞/可重试拒绝。
      const willFallback = failure.code !== "NOVEL_EVIDENCE_WRITE_FAILED" && explicitRejection &&
        [409, 425, 429, 500, 502, 503, 529].includes(Number(failure.status)) &&
        !streamHasOutput(rawBody || Buffer.concat(rawChunks).toString("utf8")) && index + 1 < targets.length;
      await emit({ phase: "failure", route, message: failure.message || "创作模型调用失败", status: failure.status, receivedBytes, willFallback });
      if (willFallback) continue;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("创作模型暂时繁忙，旧稿保留");
};

export async function runManhuaNovelAdaptation(
  input: {
    source: ManhuaNovelExcerpt;
    topic: string;
    brief: string;
    template: string;
    episodeCount: number;
    requestId: string;
    scriptPrompt: (novel: ManhuaNovelAdaptation) => string;
  },
  call: NovelStageCall = callNovelStage
) {
  if (!input.template.trim()) throw new Error("请先选择故事模板");
  const novelPrompt = buildNovelizationPrompt(input);
  let first = await call(novelPrompt, true, `${input.requestId}:novel`);
  let data: unknown;
  try {
    data = JSON.parse(first.text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("小说返回格式不完整，旧稿保留");
  }
  let novel = novelAdaptationSchema.parse({
    ...(data as object),
    model: first.model,
    sourceSha256: createHash("sha256").update(input.source.text).digest("hex"),
    templateSha256: createHash("sha256").update(input.template).digest("hex"),
  });
  if (inspectFragmentedDialogue(novel.text).fragmented) {
    first = await call(
      novelPrompt +
        "\n【集中修订】下稿几乎全为五字以内碎句。保持事件、人物和模板，重写完整有目的的对话回合，不添加无意义字词凑长度；返回同样JSON。\n" +
        JSON.stringify(novel),
      true,
      `${input.requestId}:novel-repair`
    );
    let repaired: unknown;
    try {
      repaired = JSON.parse(
        first.text.replace(/^```(?:json)?\s*|\s*```$/g, "")
      );
    } catch {
      throw new Error("小说修订格式不完整，旧稿保留");
    }
    novel = novelAdaptationSchema.parse({
      ...(repaired as object),
      model: first.model,
      sourceSha256: novel.sourceSha256,
      templateSha256: novel.templateSha256,
    });
    if (inspectFragmentedDialogue(novel.text).fragmented)
      throw new Error("小说对白修订仍未通过，旧稿保留，本次未扣点");
  }
  const scriptPrompt =
    input.scriptPrompt(novel) +
    "\n\n【对白质量复核】\n" +
    NATURAL_DIALOGUE_RULES;
  let second = await call(scriptPrompt, false, `${input.requestId}:script`);
  if (inspectFragmentedDialogue(second.text).fragmented) {
    second = await call(
      scriptPrompt +
        "\n【集中修订】下稿几乎全是碎句。保留完整分集结构、时长、事件和表演，按模板改好自然对话；不要动标明锁定的旧段。返回完整修订稿。\n" +
        JSON.stringify(second.text),
      false,
      `${input.requestId}:script-repair`
    );
    if (inspectFragmentedDialogue(second.text).fragmented)
      throw new Error("剧情对白修订仍未通过，旧稿保留，本次未扣点");
  }
  return { markdown: second.text, novel, scriptModel: second.model };
}

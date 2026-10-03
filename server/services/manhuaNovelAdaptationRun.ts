import { createHash } from "node:crypto";
import {
  extractFirstChoicePlainText,
  isRetryableOpenAiGatewayError,
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
  isSseIncompleteStreamError,
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

export type NovelStageCall = (
  prompt: string,
  json: boolean,
  requestId: string
) => Promise<{ text: string; model: string }>;

/** Reuse the existing model IDs, keys, provider locks and SSE parser. No fixed total generation deadline. */
export const callNovelStage: NovelStageCall = async (
  prompt,
  json,
  requestId
) => {
  const openRouterKey = getOpenRouterApiKey(),
    evolinkKey = getEvolinkApiKey();
  // Congestion switches model immediately; alternate gateway is used when that key is the available connection.
  const targets = [
    openRouterKey ? MANHUA_ADVISOR_HOPS[0] : MANHUA_ADVISOR_HOPS[1],
    openRouterKey ? MANHUA_ADVISOR_HOPS[2] : MANHUA_ADVISOR_HOPS[3],
  ];
  if (!openRouterKey && !evolinkKey) throw new Error("创作模型尚未连接");
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index],
      isOpenRouter = target.gateway === "auto",
      glm = index === 0;
    const controller = new AbortController();
    // Only waits for headers; after headers, the shared reader renews its idle timer on actual bytes.
    const timer = setTimeout(
      () => controller.abort(new Error("模型连接超时")),
      GLM_STREAM_IDLE_TIMEOUT_MS
    );
    try {
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
            "x-request-id": `${requestId}:${index}`,
          },
          body: JSON.stringify({
            model: target.modelName,
            messages: [{ role: "user", content: prompt }],
            stream: true,
            max_tokens: 32768,
            ...(isOpenRouter
              ? {
                  provider: glm
                    ? OPENROUTER_GLM_PROVIDER_LOCK
                    : OPENROUTER_DEEPSEEK_PROVIDER_LOCK,
                  reasoning: glm ? { effort: "high" } : { enabled: false },
                }
              : glm
                ? { reasoning_effort: "high" }
                : { thinking: { type: "disabled" } }),
            ...(json ? { response_format: { type: "json_object" } } : {}),
          }),
        }
      );
      clearTimeout(timer);
      if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(new Error(`创作模型HTTP ${response.status}`), {
          status: response.status,
        });
      }
      if (
        !response.body ||
        !response.headers.get("content-type")?.includes("text/event-stream")
      ) {
        await response.body?.cancel();
        // An unexpected JSON/HTML body may contain an auth/refusal error; it is not evidence of congestion.
        throw new Error("创作模型返回格式异常，旧稿保留");
      }
      const raw = await readGlmSseStream(response.body, 2 * 1024 * 1024, {
        strictCompletion: true,
        onErrorFrame(error) {
          // HTTP 200 can carry a real 401/403/refusal in SSE. Only explicit transient statuses may change model.
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
      return { text, model: target.modelName };
    } catch (error) {
      controller.abort();
      if (
        index === 0 &&
        (isRetryableOpenAiGatewayError(error) ||
          isSseIncompleteStreamError(error) ||
          /无数据|超时/.test(String((error as Error).message)))
      )
        continue;
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

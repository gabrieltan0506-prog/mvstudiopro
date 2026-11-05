import { KNOWLEDGE_TEMPLATE_SELECTION_MARKER } from "../../shared/knowledgePublicationTemplates";
import { createHash } from "node:crypto";
import { getOpenRouterApiKey } from "./openrouterGptImage2";
import { getEvolinkApiKey } from "./gpt56CopywritingGateway";
import { signGsUriV4ReadUrl } from "./gcs";
import { readGlmSseStream } from "./sseChatStream";
import { OPENROUTER_DEEPSEEK_PROVIDER_LOCK } from "./glmModels";
import { knowledgeReviewSchema } from "../../shared/knowledgePublication";
import { knowledgeReadingMarkdown } from "../../shared/knowledgePublicationLayout";

export const KNOWLEDGE_PUBLICATION_MODEL = "deepseek/deepseek-v4.1-flash-1017";
export const KNOWLEDGE_PUBLICATION_EVOLINK_MODEL = "deepseek-v4.1-flash-1017";
export const KNOWLEDGE_PUBLICATION_VERTEX_MODEL = "gemini-3.8-flash";
export const KNOWLEDGE_PUBLICATION_ROUTE_VERSION = "knowledge-1017-structured-v2";
export type KnowledgeModelRequest = {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: string; parts: ({ text: string } | { fileData: { mimeType: string; fileUri: string } })[] }[];
  generationConfig: { temperature: number; maxOutputTokens: number; responseMimeType: string };
};
export type KnowledgeRouteEvidence = {
  prefix: string;
  read: (key: string) => Promise<any>;
  save: (key: string, data: unknown) => Promise<void>;
};
export type KnowledgeRoute = "openrouter" | "evolink" | "vertex";
const digest = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");

const real = {
  key: (route: KnowledgeRoute) => route === "openrouter" ? getOpenRouterApiKey() : getEvolinkApiKey(),
  sign: (uri: string) => signGsUriV4ReadUrl(uri, 3600),
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  // 用户确认：仅在两条DeepSeek通道均有明确失败回执后使用。
  vertex: (async (request: KnowledgeModelRequest) => {
    const { postVertexNativeDeepRead } = await import("./manhuaNativeDeepReadRunner");
    return postVertexNativeDeepRead(request, undefined, undefined, KNOWLEDGE_PUBLICATION_VERTEX_MODEL);
  }) as undefined | ((request: KnowledgeModelRequest) => Promise<{ status: number; text: string }>),
};

/** 完整原稿合同验证后才采用该跳；修订后的版式内容成为唯一确认正文。 */
function validateAnswer(content: string, request: KnowledgeModelRequest) {
  const parsed = JSON.parse(content);
  const inputs = request.contents.flatMap(c => c.parts).flatMap(p => {
    if (!("text" in p)) return [];
    try { return [JSON.parse(p.text)]; } catch { return []; }
  });
  const source = inputs.find(p => p.source);
  if (source) {
    const review = knowledgeReviewSchema.parse(parsed);
    if (review.sourceDigest !== source.sourceDigest || review.pages.length !== source.source.pages.length ||
        review.pages.some((p, i) => p.id !== source.source.pages[i].id))
      throw new Error("图文页编号与本批原稿不符");
    for (const page of review.pages) {
      if (!page.reading) throw new Error("模型没有输出自动表格图文结构");
      if (request.systemInstruction.parts.some(p => p.text.includes(KNOWLEDGE_TEMPLATE_SELECTION_MARKER)) && (!page.reading.templateId || !page.reading.templateReason))
        throw new Error("未取得本页自动选版结果与理由");
      page.body = knowledgeReadingMarkdown(page.reading);
      if (page.body.length > 12000) throw new Error("本页结构化正文超出容量，未截断采用");
    }
    return review;
  }
  const input = inputs.find(p => p.sourceDigest);
  if (!input || parsed.sourceDigest !== input.sourceDigest || !Array.isArray(parsed.findings))
    throw new Error("一致性核对未返回完整合同");
  return parsed;
}

export async function invokeKnowledgePublicationRoutes(
  request: KnowledgeModelRequest,
  evidence: KnowledgeRouteEvidence,
  overrides: Partial<typeof real> = {},
): Promise<{ status: number; text: string }> {
  const deps = { ...real, ...overrides };
  const requestDigest = digest([KNOWLEDGE_PUBLICATION_ROUTE_VERSION, request]);
  const traces: { route: KnowledgeRoute; state: string; model: string; status?: number }[] = [];
  const images = request.contents.flatMap(c => c.parts).flatMap(p => "fileData" in p ? [p.fileData.fileUri] : []);
  for (const route of ["openrouter", "evolink", "vertex"] as const) {
    const key = `${evidence.prefix}/route-${route}.json`;
    let receipt = await evidence.read(key);
    if (receipt && receipt.requestDigest !== requestDigest)
      throw new Error("模型输入版本变化，不能复用旧路由回执");
    if (receipt?.state === "pending" || receipt?.state === "unknown") {
      const received = await evidence.read(`${evidence.prefix}/${route}-response.json`);
      if (!received) throw new Error(`${route}请求回执尚未闭合，保留原任务，不重复提交或切换通道`);
      receipt = { ...receipt, state: "received", response: received };
      await evidence.save(key, receipt);
    }
    const model = route === "openrouter" ? KNOWLEDGE_PUBLICATION_MODEL :
      route === "evolink" ? KNOWLEDGE_PUBLICATION_EVOLINK_MODEL : KNOWLEDGE_PUBLICATION_VERTEX_MODEL;
    if (!receipt) {
      if (route === "vertex" && !deps.vertex) {
        await evidence.save(key, { requestDigest, route, model, state: "unavailable", reason: "Vertex兜底模型尚未确认" });
        throw new Error("OpenRouter与EvoLink均失败，Vertex兜底模型尚未确认；原稿及回执已保留");
      }
      const apiKey = route === "vertex" ? "" : deps.key(route);
      if (route !== "vertex" && !apiKey) {
        receipt = { requestDigest, route, model, state: "failed", reason: "通道未配置", sent: false };
        await evidence.save(key, receipt);
      } else {
        const messages = [
          { role: "system", content: request.systemInstruction.parts.map(p => p.text).join("\n") },
          ...request.contents.map(c => ({ role: c.role, content: c.parts.map(p => "text" in p ?
            { type: "text", text: p.text } : { type: "image_url", image_url: { url: deps.sign(p.fileData.fileUri), detail: "high" } }) })),
        ];
        const body = {
          model, messages, max_tokens: request.generationConfig.maxOutputTokens,
          stream: true, stream_options: { include_usage: true }, response_format: { type: "json_object" },
          ...(route === "openrouter" ? { provider: OPENROUTER_DEEPSEEK_PROVIDER_LOCK, reasoning: { effort: "high" } } :
            { thinking: { type: "enabled" }, reasoning_effort: "high" }),
        };
        // 只存无凭证的模型输入；私有配图签名只在服务端即时请求中使用。
        const storedBody = { ...body, messages: messages.map(m => ({ ...m, content: typeof m.content === "string" ? m.content :
          m.content.map(p => p.type === "image_url" ? { type: "image_url", image_url: { url: "[服务端即时签名]", detail: "high" } } : p) })) };
        await evidence.save(key, { requestDigest, route, model, state: "pending", startedAt: new Date().toISOString(), request: route === "vertex" ? request : storedBody, imageSources: images });
        let status: number | undefined;
        try {
          if (route === "vertex") {
            const response = await deps.vertex!(request);
            status = response.status;
            receipt = { requestDigest, route, model, state: "received", response, imageSources: images };
          } else {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 120000);
            let response: Response;
            try {
              response = await deps.fetch(route === "openrouter" ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.evolink.ai/v1/chat/completions", {
                method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify(body), signal: controller.signal,
              });
            } finally { clearTimeout(timer); }
            status = response.status;
            let text: string;
            if (response.ok && (response.headers.get("content-type") || "").includes("text/event-stream")) {
              let heartbeat = 0;
              if (!response.body) throw new Error("上游流为空");
              text = await readGlmSseStream(response.body, 8 * 1024 * 1024, {
                strictCompletion: true,
                onComplete: async raw => evidence.save(`${evidence.prefix}/${route}-response.json`, { status, text: raw.split(apiKey).join("[REDACTED]") }),
                onBytes: async () => {
                  if (Date.now() - heartbeat > 15000) {
                    await evidence.save(`${evidence.prefix}/${route}-heartbeat.json`, { at: new Date().toISOString(), requestDigest });
                    heartbeat = Date.now();
                  }
                },
              });
            } else text = await response.text();
            receipt = { requestDigest, route, model, state: "received", response: { status, text: text.split(apiKey).join("[REDACTED]") }, imageSources: images };
          }
          await evidence.save(key, receipt);
        } catch {
          const completedStream = await evidence.read(`${evidence.prefix}/${route}-response.json`);
          if (completedStream) {
            // 结束帧明确说明输出截断时已有永久回执，可按失败处理；不能把断流猜成同一种情况。
            receipt = { requestDigest, route, model, state: "received", response: completedStream, imageSources: images };
            await evidence.save(key, receipt);
          } else {
            // 中断后是否计费未知，不能冒充“明确失败”继续偷偷重购。
            await evidence.save(key, { requestDigest, route, model, state: "unknown", status, reason: "传输或回执保存未闭合", imageSources: images });
            throw new Error(`${route}传输或回执尚未闭合，未重复提交，原稿已保留`);
          }
        }
      }
    }
    if (receipt.state === "failed" || receipt.state === "unavailable") {
      traces.push({ route, model, state: "failed", status: receipt.response?.status });
      continue;
    }
    let normalized: { status: number; text: string };
    try {
      const response = receipt.response;
      if (!(response.status >= 200 && response.status < 300)) throw new Error(`HTTP ${response.status}`);
      const envelope = JSON.parse(response.text);
      let answer: unknown;
      let output: Record<string, unknown>;
      if (route === "vertex") {
        if (envelope.modelVersion !== KNOWLEDGE_PUBLICATION_VERTEX_MODEL || envelope.candidates?.[0]?.finishReason !== "STOP") throw new Error("Vertex版本不符或未完整结束");
        answer = validateAnswer(envelope.candidates[0].content.parts.filter((p: any) => !p.thought && typeof p.text === "string").map((p: any) => p.text).join(""), request);
        output = { ...envelope, candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(answer) }] } }] };
      } else {
        const choice = envelope.choices?.[0];
        if (choice?.finish_reason !== "stop" || envelope.model !== model) throw new Error("实际模型版本不符或输出未完整结束");
        answer = validateAnswer(choice.message.content, request);
        output = {
          modelVersion: envelope.model, usageMetadata: envelope.usage,
          candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(answer) }] } }],
        };
      }
      traces.push({ route, model: String(output.modelVersion), state: "succeeded", status: response.status });
      normalized = { status: 200, text: JSON.stringify({ ...output, gateway: route, gatewayTrace: traces,
        inputEvidence: { imageSources: images, imageInputCount: images.length, requestDigest, imageTokenReporting: "provider_specific" } }) };
    } catch (error) {
      // HTTP错误、版本不符或完整响应校验失败均有原始回执，不以成功掩盖缺页。
      receipt = { ...receipt, state: "failed", reason: error instanceof Error ? error.message : "输出合同不符" };
      await evidence.save(key, receipt);
      traces.push({ route, model, state: "failed", status: receipt.response?.status });
      continue;
    }
    // 保存失败不能当成模型失败去买下一跳；已收到的原始回执可直接复用。
    await evidence.save(`${evidence.prefix}/accepted.json`, { requestDigest, normalized, traces });
    return normalized;
  }
  throw new Error("图文整理的所有已配置通道均失败，原稿与各跳回执已保存");
}

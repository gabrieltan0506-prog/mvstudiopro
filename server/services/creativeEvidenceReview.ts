import { buildLyricReviewContext } from "../../shared/lyricCraftReview";
import { createHash } from "node:crypto";
import { invokeLLM, extractFirstChoicePlainText } from "../_core/llm";
import { uploadBufferToGcsIfAbsent, downloadGcsObject, getGcsBucketName } from "./gcs";
import { MANHUA_ADVISOR_HOPS, manhuaAdvisorReasoningEffort, MANHUA_ADVISOR_MAX_OUTPUT_TOKENS } from "./openrouterDeepSeekV41Flash";
import { CREATIVE_EVIDENCE_REVIEW_INSTRUCTIONS, parseCreativeEvidenceReview, type CreativeEvidenceReviewInput } from "../../shared/creativeEvidenceReview";

const real = {
  invoke: invokeLLM, upload: uploadBufferToGcsIfAbsent, bucket: getGcsBucketName,
  read: async (objectName: string) => {
    try { return JSON.parse((await downloadGcsObject({ gcsUri: `gs://${getGcsBucketName()}/${objectName}` })).buffer.toString()); }
    catch (e) { if (e instanceof Error && e.message.startsWith("gcs_download_failed:404:")) return null; throw Error("审阅回执读取失败，未重复调用"); }
  },
  sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
};
/** 产品顾问与歌曲研究复用同一审阅服务；只在Fly持有凭证，完整证据先存后调用。 */
export async function reviewCreativeEvidence(userId: number | `research:${string}`, input: CreativeEvidenceReviewInput, deps = real) {
  if (!((typeof userId === "number" && Number.isSafeInteger(userId) && userId > 0) || (typeof userId === "string" && /^research:[a-z0-9-]+$/.test(userId))) || !input.sourceTaskId.trim()) throw Error("缺少审阅身份");
  const lyricCraft = buildLyricReviewContext(input.candidate);
  const reviewInput = lyricCraft ? { ...input, lyricCraft } : input;
  const serialized = JSON.stringify(reviewInput);
  if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) throw Error("完整审阅证据超过容量，未截断或提交");
  const inputSha256 = createHash("sha256").update(serialized).update(CREATIVE_EVIDENCE_REVIEW_INSTRUCTIONS).digest("hex");
  const prefix = `creative-evidence-review/${userId}/${inputSha256}`;
  const persist = async (name: string, value: unknown) => {
    const buffer = Buffer.from(JSON.stringify(value));
    return deps.upload({ objectName: `${prefix}/${name}.json`, buffer, contentType: "application/json" });
  };
  const started = await persist("request", { input: reviewInput, inputSha256, instruction: CREATIVE_EVIDENCE_REVIEW_INSTRUCTIONS, hops: MANHUA_ADVISOR_HOPS });
  if (!started.created) {
    let existing = await deps.read(`${prefix}/result.json`);
    if (!existing) {
      // 解析合同修正后只恢复已存原回包，不重投已有模型任务。
      for (let index = 0; index < MANHUA_ADVISOR_HOPS.length; index++) {
        const decoded = await deps.read(`${prefix}/attempt-${index + 1}-decoded.json`);
        if (!decoded) continue;
        const raw = await deps.read(`${prefix}/attempt-${index + 1}-raw.json`);
        if (raw?.choices?.[0]?.finish_reason !== "stop") throw Error("审阅原回包未完整结束，未重复调用");
        const review = parseCreativeEvidenceReview(decoded, reviewInput);
        existing = { ...review, reviewId: prefix, inputSha256, model: raw.model || MANHUA_ADVISOR_HOPS[index].modelName };
        await persist("result", existing);
        break;
      }
    }
    if (!existing) throw Error("审阅已有提交且尚无终态结果，请恢复原回执，未重复调用");
    if (existing.inputSha256 !== inputSha256) throw Error("审阅回执身份冲突");
    return parseCreativeEvidenceReview(existing, reviewInput);
  }
  for (let index = 0; index < MANHUA_ADVISOR_HOPS.length; index++) {
    const hop = MANHUA_ADVISOR_HOPS[index];
    let response: Awaited<ReturnType<typeof invokeLLM>>;
    try {
      response = await deps.invoke({
        provider: "openai", modelName: hop.modelName, openAiGateway: hop.gateway,
        reasoningEffort: manhuaAdvisorReasoningEffort(hop.modelName),
        max_tokens: MANHUA_ADVISOR_MAX_OUTPUT_TOKENS,
        abortSignal: AbortSignal.timeout(180000),
        response_format: { type: "json_object" },
        openRouterProviderPreferences: { require_parameters: true },
        messages: [
          { role: "system", content: CREATIVE_EVIDENCE_REVIEW_INSTRUCTIONS },
          { role: "user", content: serialized },
        ],
      });
    } catch (error) {
      const e = error as { status?: number; statusCode?: number; name?: string };
      const status = e.status ?? e.statusCode;
      await persist(`attempt-${index + 1}-error`, { model: hop.modelName, gateway: hop.gateway, status, name: e.name, usage: null });
      if (index === MANHUA_ADVISOR_HOPS.length - 1) throw Error("创作顾问审阅服务未返回结果，原回执保留");
      if (status === 429 || status === 503) await deps.sleep(18000);
      continue;
    }
    // 存储或解析失败不再换模型，避免把已有回包重复付费。
    await persist(`attempt-${index + 1}-raw`, response);
    if (response.choices?.[0]?.finish_reason !== "stop") throw Error("审阅回答未完整结束，原始结果保留");
    const decoded = JSON.parse(extractFirstChoicePlainText(response));
    await persist(`attempt-${index + 1}-decoded`, decoded);
    const review = parseCreativeEvidenceReview(decoded, reviewInput);
    const result = { ...review, reviewId: prefix, inputSha256, model: response.model || hop.modelName };
    await persist("result", result);
    return result;
  }
  throw Error("创作顾问未执行审阅");
}

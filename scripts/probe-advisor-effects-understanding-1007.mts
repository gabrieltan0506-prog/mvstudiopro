/** User-authorized semantic probe; one native advisor hop, no workflow execution. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { buildManhuaCreativeAdvisorLlmMessages, parseAskJson } from "../server/services/platformSkillQa";
import { manhuaCreativeAdvisorContextSchema } from "../shared/manhuaCreativeAdvisor";
import { invokeLLM, extractFirstChoicePlainText } from "../server/_core/llm";
import { MANHUA_ADVISOR_HOPS, MANHUA_ADVISOR_MAX_OUTPUT_TOKENS, manhuaAdvisorReasoningEffort } from "../server/services/openrouterDeepSeekV41Flash";
import { uploadBufferToGcs, downloadGcsObject } from "../server/services/gcs";

const [runId, mode = "prepare", scenario = "preview"] = process.argv.slice(2);
assert(/^[a-zA-Z0-9-]+$/.test(runId || ""));
assert(["prepare", "invoke"].includes(mode));
assert(["preview", "layers"].includes(scenario));
const question = scenario === "layers" ? "同一段原片要在一个候选里同时有第1到3秒的剑气、第3到5秒的护盾。这需要分别点两次渲染吗？我应该怎样保存与提交，是否要先采用一个再渲染另一个？只按工作台实际能力简洁解释，不替我执行。" : "我在新增的特效工作台，想给当前原片加剑气和护盾，把剑气设在第1到3秒，从画面左下移到右上。我想先预览再决定是否渲染、采用。请根据目前真正已接入的功能解释：能否在预览时调整时间和走位、展开看、与原片比较？预览能看到完整特效吗？能自动跟踪人物、正确遮挡吗？刷新后方案和候选怎样保留？请不要替我提交或生成，也不要把示意图当真实结果；不知道的明确说明。";
const context = manhuaCreativeAdvisorContextSchema.parse({ seriesTitle: "特效顾问隔离测试", episodeIndex: 1, episodeTitle: "守桥", stage: "edit", videoModel: "seedance-2.0-mini", writerConfirmed: true, episodeBody: "主角守在石桥上，挥剑挡住逼近的敌人。", assetSummary: "当前已有一段5秒原片；没有提供视频画面或音轨。", shotSummary: "片段1：挥剑后举起护盾。", blockers: [], history: [] });
const messages = buildManhuaCreativeAdvisorLlmMessages({ question, rawQuestion: question, context });
const hop = MANHUA_ADVISOR_HOPS[0];
const request = { provider: "openai" as const, modelName: hop.modelName, openAiGateway: hop.gateway, max_tokens: MANHUA_ADVISOR_MAX_OUTPUT_TOKENS, response_format: { type: "json_object" as const }, openRouterProviderPreferences: { require_parameters: true }, reasoningEffort: manhuaAdvisorReasoningEffort(hop.modelName), messages };
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
if (mode === "prepare") {
  await writeFile(`/tmp/${runId}-request.json`, JSON.stringify({ boundary: "Native prompt and route; synthetic project; no UI acceptance or actions", context, question, request }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ mode, model: hop.modelName, messagesChars: JSON.stringify(messages).length, max_tokens: request.max_tokens, reasoningEffort: request.reasoningEffort }));
} else {
  assert(process.env.FLY_MACHINE_ID === "d892541f602228", "Only selected Fly app process; never local credentials");
  const dir = `/tmp/${runId}-evidence`;
  await mkdir(dir, { recursive: false });
  const prefix = `post-prod/isolated-pr1675/advisor-understanding/${runId}`;
  const receipts: Array<{ name: string; bytes: number; sha256: string; gcsUri: string }> = [];
  const save = async (name: string, data: Buffer) => {
    await writeFile(`${dir}/${name}`, data, { flag: "wx" });
    const stored = await uploadBufferToGcs({ objectName: `${prefix}/${name}`, buffer: data, contentType: name.endsWith(".json") ? "application/json" : "text/plain" });
    const read = await downloadGcsObject({ gcsUri: stored.gcsUri });
    assert.equal(hash(read.buffer), hash(data));
    receipts.push({ name, bytes: data.length, sha256: hash(data), gcsUri: stored.gcsUri });
  };
  await save("intent.json", Buffer.from(JSON.stringify({ at: new Date().toISOString(), runId, context, question, request, boundary: "Synthetic read-only semantic probe; one model call; no user quota changes, no jobs or media" })));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!url.pathname.endsWith("/chat/completions")) return originalFetch(input, init);
    assert.equal(++calls, 1, "Refuse second paid request, retry or fallback");
    assert.equal(typeof init?.body, "string");
    await save("provider-request.json", Buffer.from(String(init!.body)));
    const response = await originalFetch(input, init);
    // Persist full SSE/JSON bytes BEFORE the native transport parses or consumes them.
    await save("provider-response.raw.txt", Buffer.from(await response.clone().arrayBuffer()));
    await save("provider-route.json", Buffer.from(JSON.stringify({ host: url.host, path: url.pathname, status: response.status, contentType: response.headers.get("content-type") })));
    return response;
  };
  try {
    const response = await invokeLLM({ ...request, abortSignal: AbortSignal.timeout(180_000), onContentDelta: () => {} });
    await save("response.parsed.json", Buffer.from(JSON.stringify(response)));
    const answer = parseAskJson(extractFirstChoicePlainText(response));
    await save("answer.normalized.json", Buffer.from(JSON.stringify(answer)));
    await save("receipts.json", Buffer.from(JSON.stringify({ runId, calls, receipts })));
    console.log(JSON.stringify({ runId, calls, answer, usage: response.usage, receipts }));
  } catch (error) {
    await save("failure.json", Buffer.from(JSON.stringify({ runId, calls, error: error instanceof Error ? error.message : String(error), receipts })));
    throw error;
  } finally { globalThis.fetch = originalFetch; }
}

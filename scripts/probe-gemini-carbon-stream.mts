/**
 * 探针：确认 Gemini 4 Carbon 的流式调用（有心跳就等、创建失败重新创建）在三条通道上是否可用、思考是否真的开启。
 * 走正式的调用层 callGeminiCarbonChannel（与产品同一份代码）；每条通道发一条很短的推理题，费用可忽略。
 * 只在工作机运行，凭证不出 Fly；原始流与还原回包按调用层口径永久存 GCS gemini-carbon/probe-stream/…；
 * live.json 只写状态、耗时、分段数与用量，不写正文、密钥与地址。终态 stage = diagnosed | failed。
 *
 * request.json 的 config（都可省略）：{ "channels": ["vertex","gemini_api","evolink"], "createRetries": 0 }
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertWorkerProbeLease } from "../server/services/workerProbeLease";
import { callGeminiCarbonChannel, createGeminiCarbonGcsSaver, geminiCarbonEvidencePrefix, GeminiCarbonChannelError } from "../server/services/geminiCarbonCall";
import { GEMINI_CARBON_CHANNELS, type GeminiCarbonChannel } from "../shared/geminiCarbon";
import { resolveGeminiModel } from "../shared/geminiModelConfig";

if (process.env.FLY_PROCESS_GROUP !== "rig") throw Error("只能在工作机执行");
const configPath = process.argv[2];
if (!configPath) throw Error("缺少配置文件路径");
const dir = dirname(configPath);
const live = (stage: string, summary: Record<string, unknown> = {}) =>
  writeFile(join(dir, "live.json"), JSON.stringify({ at: new Date().toISOString(), stage, summary }));
const failAndExit = async (error: unknown) => {
  const reason = (error instanceof Error ? error.message : String(error)).replace(/(https?|gs):\/\/\S+/g, "[地址]").slice(0, 200);
  console.error(`错误：${reason}`);
  await live("failed", { reason }).catch(() => undefined);
  process.exit(1);
};
process.on("uncaughtException", error => { void failAndExit(error); });
process.on("unhandledRejection", error => { void failAndExit(error); });

await assertWorkerProbeLease();
const config = JSON.parse(await readFile(configPath, "utf8")) as { channels?: string[]; createRetries?: number };
const channels = (config.channels?.length ? config.channels : ["vertex", "gemini_api", "evolink"])
  .filter((c): c is GeminiCarbonChannel => (GEMINI_CARBON_CHANNELS as readonly string[]).includes(c));
// 探针里缺省不重新创建：每条通道最多等一个创建期，避免某通道无回应时探针拖很久。
process.env.GEMINI_CARBON_CREATE_RETRIES = String(Number.isInteger(config.createRetries) ? config.createRetries : 0);
const model = resolveGeminiModel("geminiCarbon", process.env);
const prefix = geminiCarbonEvidencePrefix("probe-stream");
const results: Record<string, unknown> = {};
await live("running", { model, channels });

for (const channel of channels) {
  const save = createGeminiCarbonGcsSaver(`${prefix}/${channel}`);
  const started = Date.now();
  try {
    const result = await callGeminiCarbonChannel(
      channel,
      {
        model,
        parts: [{ text: "一个水池有甲乙两根进水管，甲单独注满要 6 小时，乙单独注满要 9 小时。两管同时开，多久注满？先推理，再用一句话给出答案。" }],
        generationConfig: { maxOutputTokens: 4096 },
      },
      { save, slug: "ping" },
    );
    const payload = result.payload as { streamChunks?: number; candidates?: Array<{ content?: { parts?: Array<{ thought?: boolean; text?: string }> } }> };
    const thoughtChars = (payload?.candidates?.[0]?.content?.parts ?? []).filter(p => p?.thought === true).reduce((n, p) => n + String(p?.text ?? "").length, 0);
    results[channel] = {
      ok: true, status: result.status, ms: result.elapsedMs, firstDataMs: result.firstDataMs, segments: result.segments, streamChunks: payload?.streamChunks ?? 1, answerChars: result.text.length,
      thoughtSummaryChars: thoughtChars, finish: result.finishReason, usage: result.usage,
    };
  } catch (error) {
    results[channel] = error instanceof GeminiCarbonChannelError
      ? { ok: false, kind: error.kind, status: error.status, reason: error.reasonZh.replace(/(https?|gs):\/\/\S+/g, "[地址]").slice(0, 160), ms: Date.now() - started }
      : { ok: false, kind: "unknown", reason: String(error instanceof Error ? error.message : error).replace(/(https?|gs):\/\/\S+/g, "[地址]").slice(0, 160), ms: Date.now() - started };
  }
  await live("running", { model, channels, results });
}
await writeFile(join(dir, "carbon-stream.json"), JSON.stringify({ model, results }, null, 2));
await live("diagnosed", { model, results });
console.log(JSON.stringify({ model, results }));
process.exit(0);

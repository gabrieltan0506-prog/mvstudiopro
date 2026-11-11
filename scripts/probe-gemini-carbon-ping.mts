/**
 * 探针：确认 Gemini 4 Carbon 在三条通道（Vertex、EvoLink、Gemini API）是否可调。
 * 每条通道只发一次极短的文字请求（回复「OK」，输出上限 16），费用可忽略；另读各通道的模型列表找准确的模型标识。
 * 只在工作机运行，凭证不出 Fly；live.json 只写状态码、模型名与用量，不写密钥与地址。
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getVertexAuthHeaders, getVertexProjectId, baseUrlForVertex } from "../server/services/vertexMedia";
import { assertWorkerProbeLease } from "../server/services/workerProbeLease";

if (process.env.FLY_PROCESS_GROUP !== "rig") throw Error("只能在工作机执行");
await assertWorkerProbeLease();
const dir = dirname(process.argv[2]);
const config = JSON.parse(await readFile(process.argv[2], "utf8")) as { candidates?: string[] };
const candidates = config.candidates?.length ? config.candidates : ["gemini-4-carbon", "gemini-4-carbon-preview"];
const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "只回复两个字母：OK" }] }], generationConfig: { maxOutputTokens: 16, temperature: 0 } });
const brief = (payload: any) => ({
  text: String(payload?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("") || "").slice(0, 20),
  finish: payload?.candidates?.[0]?.finishReason, usage: payload?.usageMetadata ? { in: payload.usageMetadata.promptTokenCount, out: payload.usageMetadata.candidatesTokenCount, thoughts: payload.usageMetadata.thoughtsTokenCount, total: payload.usageMetadata.totalTokenCount } : undefined,
  modelVersion: payload?.modelVersion, error: payload?.error ? { code: payload.error.code, status: payload.error.status, message: String(payload.error.message || "").replace(/(?:https?|gs):\/\/\S+/g, "[地址]").slice(0, 160) } : undefined,
});
const call = async (url: string, headers: Record<string, string>) => {
  const started = Date.now();
  try {
    const response = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(90_000) });
    return { status: response.status, ms: Date.now() - started, ...brief(await response.json().catch(() => null)) };
  } catch (error) { return { status: 0, ms: Date.now() - started, error: { message: String(error instanceof Error ? error.message : error).slice(0, 160) } }; }
};
const list = async (url: string, headers: Record<string, string>, pick: (payload: any) => string[]) => {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    const names = pick(await response.json().catch(() => null)).filter(name => /gemini-4|carbon|argon/i.test(name));
    return { status: response.status, gemini4: Array.from(new Set(names)).slice(0, 20) };
  } catch (error) { return { status: 0, error: String(error instanceof Error ? error.message : error).slice(0, 120) }; }
};
const result: Record<string, unknown> = { candidates };
const location = String(process.env.VERTEX_GEMINI_LOCATION || "global").trim() || "global";
const vertexHeaders = (await getVertexAuthHeaders()) as Record<string, string>;
const evolinkBase = String(process.env.EVOLINK_DIRECT_BASE_URL || "https://direct.evolink.ai").replace(/\/$/, "");
const evolinkKey = String(process.env.EVOLINK_API_KEY || "").trim();
const geminiKey = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
result.configured = { vertex: Boolean(vertexHeaders.Authorization), evolink: Boolean(evolinkKey), geminiApi: Boolean(geminiKey), vertexLocation: location };
result.models = {
  geminiApi: geminiKey ? await list("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { "x-goog-api-key": geminiKey }, p => (p?.models || []).map((m: any) => String(m?.name || "").replace(/^models\//, ""))) : "未配置",
  evolink: evolinkKey ? await list(`${evolinkBase}/v1/models`, { Authorization: `Bearer ${evolinkKey}` }, p => (p?.data || []).map((m: any) => String(m?.id || ""))) : "未配置",
};
const pings: Record<string, unknown> = {};
for (const model of candidates) {
  pings[model] = {
    vertex: await call(`${baseUrlForVertex(location)}/v1/projects/${encodeURIComponent(getVertexProjectId())}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`, vertexHeaders),
    evolink: evolinkKey ? await call(`${evolinkBase}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { Authorization: `Bearer ${evolinkKey}` }) : "未配置",
    geminiApi: geminiKey ? await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": geminiKey }) : "未配置",
  };
}
result.pings = pings;
await writeFile(join(dir, "carbon-ping.json"), JSON.stringify(result, null, 2));
await writeFile(join(dir, "live.json"), JSON.stringify({ at: new Date().toISOString(), stage: "diagnosed", summary: result }));
console.log(JSON.stringify(result));

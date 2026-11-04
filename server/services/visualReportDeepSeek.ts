import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { backupManhuaGlmEvidence } from "./manhuaGlmEvidenceBackup";
import { uploadBufferToGcs } from "./gcs";
import { OPENROUTER_DEEPSEEK_V41_FLASH_1017_MODEL } from "./openrouterDeepSeekV41Flash";
import { parseVisualReportJson, VisualReportAttemptsError, type VisualReportLlmResult, type VisualReportAttemptTrace } from "./visualReportLlm";

export const VISUAL_REPORT_MODEL = OPENROUTER_DEEPSEEK_V41_FLASH_1017_MODEL;
/** 趋势图固定1017单次请求；失败交回原任务退款，不自动换模型或重投。 */
export async function runVisualReportDeepSeek(params: {
  evidenceIdentity?: { userId: number; requestId: string };
  reportContract: Parameters<typeof parseVisualReportJson>[1];
  systemPrompt: string; userPrompt: string; maxTokens: number; abortSignal?: AbortSignal;
}): Promise<VisualReportLlmResult> {
  const attempts: VisualReportAttemptTrace[] = [];
  const key = String(process.env.OPENROUTER_API_KEY || "").trim();
  try {
    if (!key) throw new Error("趋势分析通道暂不可用");
    params.abortSignal?.throwIfAborted();
    const trace = { attempt: 1, engine: "openrouter_deepseek" as const, modelName: VISUAL_REPORT_MODEL,
      gatewayTrace: [{ gateway: "openrouter", model: VISUAL_REPORT_MODEL, outcome: "started" }] };
    const evidenceId = randomUUID();
    const prefix = `platform-trend-evidence/${params.evidenceIdentity?.userId ?? "internal"}/${evidenceId}`;
    const persist = async (name: string, value: unknown) => {
      const buffer = Buffer.from(JSON.stringify(value).split(key).join("[REDACTED]"));
      const objectName = `${prefix}/${name}.json`;
      const digest = { objectName, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
      try {
        const saved = await uploadBufferToGcs({ objectName, buffer, contentType: "application/json", signal: AbortSignal.timeout(120_000) });
        return { ...digest, gcsUri: saved.gcsUri };
      } catch {
        // 只允许真实持久卷兜底；rig的临时/data目录不能冒充永久证据。
        const mounts = await readFile("/proc/self/mountinfo", "utf8");
        if (!mounts.split("\n").some(row => row.split(" ")[4] === "/data")) throw Error("趋势分析证据保存失败");
        await backupManhuaGlmEvidence(objectName, buffer, "/data/growth/platform-trend-evidence");
        return { ...digest, storage: "website_data" };
      }
    };
    const request = { model: VISUAL_REPORT_MODEL, messages: [{ role: "system", content: params.systemPrompt }, { role: "user", content: params.userPrompt }],
      temperature: 0.8, reasoning: { effort: "high" }, max_tokens: Math.min(65536, Math.max(32768, params.maxTokens)), response_format: { type: "json_object" } };
    await persist("request", { identity: params.evidenceIdentity, evidenceId, request });
    params.abortSignal?.throwIfAborted();
    attempts.push(trace);
    const signal = params.abortSignal ? AbortSignal.any([params.abortSignal, AbortSignal.timeout(240_000)]) : AbortSignal.timeout(240_000);
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal,
      body: JSON.stringify(request),
    });
    // 上游错误正文可能包含内部信息，不返回给界面或打印凭证。
    const responseText = await response.text();
    const rawReceipt = await persist("response.raw", { status: response.status, body: responseText });
    if (!response.ok) throw new Error(`趋势分析通道 HTTP ${response.status}`);
    const body = JSON.parse(responseText);
    const choice = body.choices?.[0];
    if (choice?.finish_reason !== "stop") throw new Error(choice?.finish_reason === "length" ? "趋势分析输出被截断" : "趋势分析未完整结束");
    if (body.model !== VISUAL_REPORT_MODEL) throw new Error("趋势分析模型版本与请求不一致");
    const { parsed, rawBody } = parseVisualReportJson(choice?.message?.content, params.reportContract);
    await persist("response.parsed", { rawReceipt, parsed });
    trace.gatewayTrace[0].outcome = "ok";
    return { parsed, rawBody, engine: "openrouter_deepseek", modelName: VISUAL_REPORT_MODEL, attempt: 1,
      finishReason: "stop", promptTokens: body.usage?.prompt_tokens ?? null, completionTokens: body.usage?.completion_tokens ?? null,
      upstreamModel: body.model, upstreamProvider: body.provider ?? null, gateway: "openrouter", gatewayAttemptsPerformed: 1,
      gatewayTraceSummary: `1:openrouter=ok` };
  } catch (error) {
    if (attempts[0]?.gatewayTrace) attempts[0].gatewayTrace[0].outcome = "failed";
    const message = error instanceof Error ? error.message : String(error);
    throw new VisualReportAttemptsError(key ? message.split(key).join("[REDACTED]") : message, attempts, Boolean(params.abortSignal?.aborted));
  }
}

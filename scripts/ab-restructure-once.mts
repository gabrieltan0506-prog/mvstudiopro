/**
 * GLM-5.3 vs Qwen3.8-Max(SG) 同输入对比：把 8 份已付费产出整理成整集卡。
 *
 * 输入是 raw 证据（8 发 = 6 通过 + 2 被门禁标记），不是 parsed（只有 6 段通过版）。
 * 用户令：所有产出都进 GLM，被标记的也算——「模型每次跑结果不一样，合格不等于更好」。
 * 两个模型用**逐字相同**的提示词，否则对比无效。
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  buildNativeDeepReadGlmStructuringPrompt,
} from "../server/services/manhuaNativeDeepReadRunner.js";
import { invokeGlmJsonChatWithGatewayFallback } from "../server/services/bailianChat.js";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcsIfAbsent,
} from "../server/services/gcs.js";

if (process.env.FLY_APP_NAME !== "mvstudiopro") {
  // 与其余付费探针同一道闸：这两个脚本直连 GLM/Qwen 真花钱，不许在本机跑。
  throw new Error("本脚本只允许在 Fly 容器内运行");
}


const RUN = "probe_douyin_20260829134509";
const RAW_PREFIX = `manhua-template-learn/segment-evidence-raw/tpl_native_${RUN}_ep001/`;
const OUT_PREFIX = `manhua-template-learn/probes/${RUN}/`;
const DURATION_SEC = 1692;
const SEGMENTS = [
  { startSec: 0, endSec: 300 },
  { startSec: 300, endSec: 600 },
  { startSec: 600, endSec: 900 },
  { startSec: 900, endSec: 1200 },
  { startSec: 1200, endSec: 1500 },
  { startSec: 1500, endSec: 1692 },
];
const bucket = getGcsBucketName();
const log = (m: string) => console.info(`[ab] ${new Date().toISOString().slice(11, 19)} ${m}`);

/** raw 信封 → 模型 JSON（与既有探针 extractModelJsonFromRawEvidence 同口径）。 */
function cardFromRaw(payload: unknown): Record<string, unknown> {
  const stored = payload as { responseText?: unknown };
  const envelope = JSON.parse(String(stored?.responseText || "")) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  const text = (envelope.candidates?.[0]?.content?.parts || [])
    .filter((p) => !p.thought)
    .map((p) => String(p.text || ""))
    .join("");
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("原始响应正文不是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

function countsOf(card: Record<string, unknown>) {
  const audioResolution = Array.isArray(card.audioResolution) ? card.audioResolution : [];
  const tracks = audioResolution.flatMap((row) => {
    const a = (row as { analysis?: { audioTrack?: unknown[] } }).analysis;
    return Array.isArray(a?.audioTrack) ? a!.audioTrack! : [];
  });
  const shots = Array.isArray(card.shots) ? card.shots as Array<Record<string, unknown>> : [];
  const overlong = shots.filter((s) => Number(s.endSec) - Number(s.startSec) > 30).length;
  return {
    shots: shots.length,
    广告镜: shots.filter((s) => s.evidenceRole === "non_story_ad").length,
    超30秒镜: overlong,
    subtitles: Array.isArray(card.subtitles) ? card.subtitles.length : 0,
    audioResolution: audioResolution.length,
    音轨段: tracks.length,
    excludedAdRanges: Array.isArray(card.excludedAdRanges) ? card.excludedAdRanges.length : 0,
    有五维: Boolean(card.classification),
  };
}

async function main() {
  log("读 8 份 raw 产出");
  const names = (await listGcsObjectNamesByPrefix({
    prefix: RAW_PREFIX, literalPrefix: true, maxResults: 200,
  })).sort();
  log(`GCS 命中 ${names.length} 个对象`);

  const rows: Array<{ seg: number; attempt: number; card: Record<string, unknown> }> = [];
  const parseFailures: string[] = [];
  for (const name of names) {
    const m = /\/seg(\d+)\/attempt(\d+)-/.exec(name);
    if (!m) continue;
    const seg = Number(m[1]);
    const attempt = Number(m[2]);
    try {
      const dl = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${name}` });
      rows.push({ seg, attempt, card: cardFromRaw(JSON.parse(dl.buffer.toString("utf8"))) });
    } catch (e) {
      parseFailures.push(`seg${seg}/attempt${attempt}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  rows.sort((a, b) => a.seg - b.seg || a.attempt - b.attempt);

  // 同段有多发时，attempt 较小的那份就是被门禁标记的版本。
  const maxAttempt = new Map<number, number>();
  for (const r of rows) maxAttempt.set(r.seg, Math.max(maxAttempt.get(r.seg) || 0, r.attempt));
  const rawSegments = rows.map((r) => {
    const marked = r.attempt < (maxAttempt.get(r.seg) || 1);
    return {
      ...r.card,
      attemptNumber: r.attempt,
      ...(marked ? { gateMarked: true, gateMarkedZh: `第${r.seg + 1}段第${r.attempt}发被门禁标记` } : {}),
    };
  });
  const markedCount = rawSegments.filter((r) => (r as { gateMarked?: boolean }).gateMarked).length;
  log(`实际喂入 ${rawSegments.length} 份（其中被标记 ${markedCount} 份）· 解析失败 ${parseFailures.length}`);
  for (const f of parseFailures) log(`  解析失败：${f}`);

  const prompt = buildNativeDeepReadGlmStructuringPrompt({
    episodeIndex: 1,
    durationSec: DURATION_SEC,
    segments: SEGMENTS,
    hasAudio: true,
    rawSegments,
  });
  await writeFile("/tmp/prompt-system.txt", prompt.system, "utf8");
  await writeFile("/tmp/prompt-user.txt", prompt.user, "utf8");
  const promptBytes = Buffer.byteLength(prompt.system + prompt.user, "utf8");
  const promptSha = createHash("sha256").update(prompt.system + prompt.user).digest("hex").slice(0, 16);
  log(`提示词 ${promptBytes} 字节 · sha ${promptSha}（两个模型用同一份）`);

  const results: Record<string, unknown> = {};
  const heartbeat = (tag: string) => {
    const t0 = Date.now();
    return setInterval(() => log(`${tag} 已等待 ${Math.round((Date.now() - t0) / 1000)} 秒`), 30_000);
  };

  // ── GLM-5.3（OpenRouter），不设硬超时 ──
  log("发起 GLM-5.3");
  const glmTimer = heartbeat("GLM");
  const glmStart = Date.now();
  try {
    const res = await invokeGlmJsonChatWithGatewayFallback({
      system: prompt.system,
      user: prompt.user,
      maxTokens: 131_072,
      gatewayPolicy: "openrouter_only",
      timeoutMs: 6 * 60 * 60_000,
      requireParameters: true,
      requireFinishReasonStop: true,
    });
    const sec = Math.round((Date.now() - glmStart) / 1000);
    const content = String(res.choices?.[0]?.message?.content || "");
    const card = JSON.parse(content) as Record<string, unknown>;
    await uploadBufferToGcsIfAbsent({
      bucket, objectName: `${OUT_PREFIX}glm-restructured.json`, contentType: "application/json",
      buffer: Buffer.from(JSON.stringify(card, null, 2), "utf8"),
    });
    results.glm = {
      耗时秒: sec,
      输入tokens: res.usage?.prompt_tokens ?? null,
      输出tokens: res.usage?.completion_tokens ?? null,
      思考tokens: res.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      costUsd: res.usage?.cost ?? null,
      finish: res.choices?.[0]?.finish_reason ?? null,
      ...countsOf(card),
    };
    log(`GLM 完成 ${sec} 秒`);
  } catch (e) {
    results.glm = {
      耗时秒: Math.round((Date.now() - glmStart) / 1000),
      失败全文: e instanceof Error ? e.message : String(e),
      trace: (e as { gatewayTrace?: unknown }).gatewayTrace ?? null,
      usage: (e as { usage?: unknown }).usage ?? null,
    };
    log(`GLM 失败：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearInterval(glmTimer);
  }

  // ── Qwen3.8-Max（新加坡 Token Plan 套餐），不设硬超时 ──
  log("发起 Qwen3.8-Max(SG)");
  const qwenTimer = heartbeat("Qwen");
  const qwenStart = Date.now();
  try {
    const key = String(process.env.DASHSCOPE_SG_PLAN_KEY || "").trim();
    if (!key) throw new Error("DASHSCOPE_SG_PLAN_KEY 未配置");
    const r = await fetch(
      "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3.8-max",
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          max_tokens: 131_072,
          response_format: { type: "json_object" },
        }),
      },
    );
    const text = await r.text();
    const sec = Math.round((Date.now() - qwenStart) / 1000);
    if (!r.ok) throw new Error(`HTTP ${r.status}：${text.slice(0, 500)}`);
    const payload = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = String(payload.choices?.[0]?.message?.content || "");
    const card = JSON.parse(content) as Record<string, unknown>;
    await uploadBufferToGcsIfAbsent({
      bucket, objectName: `${OUT_PREFIX}qwen-restructured.json`, contentType: "application/json",
      buffer: Buffer.from(JSON.stringify(card, null, 2), "utf8"),
    });
    results.qwen = {
      耗时秒: sec,
      输入tokens: payload.usage?.prompt_tokens ?? null,
      输出tokens: payload.usage?.completion_tokens ?? null,
      finish: payload.choices?.[0]?.finish_reason ?? null,
      ...countsOf(card),
    };
    log(`Qwen 完成 ${sec} 秒`);
  } catch (e) {
    results.qwen = {
      耗时秒: Math.round((Date.now() - qwenStart) / 1000),
      失败全文: e instanceof Error ? e.message : String(e),
    };
    log(`Qwen 失败：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearInterval(qwenTimer);
  }

  const summary = {
    runId: RUN,
    输入份数: rawSegments.length,
    其中被标记: markedCount,
    解析失败: parseFailures,
    提示词字节: promptBytes,
    提示词sha: promptSha,
    ...results,
  };
  await uploadBufferToGcsIfAbsent({
    bucket, objectName: `${OUT_PREFIX}ab-compare.json`, contentType: "application/json",
    buffer: Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, "utf8"),
  });
  console.info("=== AB 对比结论 ===");
  console.info(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(`[ab] 致命失败：${e instanceof Error ? e.stack || e.message : String(e)}`);
  process.exitCode = 1;
});

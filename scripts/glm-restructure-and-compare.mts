/**
 * GLM 整形单发 + 与输入 8 份 raw 的确定性对账（0829 晚用户令）。
 *
 * 为什么不重跑整集：段证据缓存指纹不含 GLM 提示词，改整形提示词**不作废** Gemini 段证据。
 * 所以只花 GLM 那一发的钱，就能验证「新提示词 + EvoLink 主档 + temp 0.8」的真实产出。
 *
 * 对账全部是纯算术，不问模型（机器能测的不要问模型）：
 *   被吞掉的区间 / 凭空多出来的区间 / 重叠 / 标记版独有镜头有没有被采纳。
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  buildNativeDeepReadGlmStructuringPrompt,
  NATIVE_DEEP_READ_GLM_STRUCTURING_TEMPERATURE,
  NATIVE_DEEP_READ_GLM_STRUCTURING_REASONING_EFFORT,
} from "../server/services/manhuaNativeDeepReadRunner.js";
import { invokeGlmJsonChatWithGatewayFallback } from "../server/services/bailianChat.js";

/** Qwen 对照：同一份提示词、同温度、同 max_tokens，只换模型与端点。走新加坡 Token Plan 套餐。 */
const QWEN_URL = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions";
async function invokeQwenStreaming(params: {
  system: string; user: string; maxTokens: number; temperature: number;
  onBeat: (chars: number) => void;
}) {
  const key = String(process.env.DASHSCOPE_SG_PLAN_KEY || "").trim();
  if (!key) throw new Error("DASHSCOPE_SG_PLAN_KEY 未配置");
  const res = await fetch(QWEN_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen3.8-max",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      // Qwen 思维链是独立额度（上限 262,144），不吃 max_tokens；thinking_budget
      // 官方两页取值范围自相矛盾（1–32768 vs 262144），未核准前不填数字。
      enable_thinking: true,
      // 必须流式：undici headersTimeout 写死 300 秒，与 AbortSignal 是两套计时器。
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Qwen HTTP ${res.status} · ${(await res.text()).slice(0, 400)}`);
  }
  let content = "", finishReason = "", buffer = "", lastBeat = Date.now();
  let usage: Record<string, unknown> = {};
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const handle = (line: string) => {
    const t = line.trim();
    if (!t.startsWith("data:")) return;
    const p = t.slice(5).trim();
    if (!p || p === "[DONE]") return;
    try {
      const c = JSON.parse(p) as {
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
        usage?: Record<string, unknown>;
      };
      const d = c.choices?.[0]?.delta?.content;
      if (typeof d === "string") content += d;
      const fr = c.choices?.[0]?.finish_reason;
      if (fr) finishReason = String(fr);
      if (c.usage) usage = c.usage;
    } catch { /* 半包留给下一轮 */ }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) handle(line);
      if (Date.now() - lastBeat > 30_000) { lastBeat = Date.now(); params.onBeat(content.length); }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handle(buffer);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { choices: [{ message: { content }, finish_reason: finishReason }], usage };
}
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcsIfAbsent,
} from "../server/services/gcs.js";

if (process.env.FLY_APP_NAME !== "mvstudiopro") throw new Error("只允许在 Fly 容器内运行");

/** run id 由命令行给：--run=tpl_native_probe_douyin_YYYYMMDDHHMMSS_ep001 */
const RUN = String(
  process.argv.find((a) => a.startsWith("--run="))?.slice("--run=".length) || "",
).trim();
if (!RUN) throw new Error("缺少 --run=（段证据 raw 前缀里的 tpl_native_<seriesKey>_ep001）");
/** 整形模型：--model=glm（默认）或 --model=qwen，两边喂同一份提示词做对照 */
const MODEL = process.argv.includes("--model=qwen") ? "qwen" : "glm";
/** 整集真实时长与分段由命令行给，避免写死某一集 */
const DURATION_SEC = Math.round(Number(
  process.argv.find((a) => a.startsWith("--duration="))?.slice("--duration=".length) || 0,
));
if (!DURATION_SEC) throw new Error("缺少 --duration=<整集秒数>");
/**
 * 只取**过关版**（0830 用户拍板，覆盖 v11「全收进 GLM」）：
 *   segment-evidence/     = 过了门禁的最终版，一段一份
 *   segment-evidence-raw/ = 全部尝试，含被标记的废版
 * 用户看过本轮实际质量后判定：被标记那些（40–201 秒巨镜）太差，喂进去只会污染整形。
 * 要回到全收口径，把这里换回 -raw 即可。
 */
const RAW_PREFIX = `manhua-template-learn/segment-evidence/${RUN}/`;
const OUT_PREFIX = `manhua-template-learn/probes/${MODEL}-restructure-${Date.now()}/`;
/** 分段按生产切法从时长推出，与探针一致，不写死某一集 */
const SEGMENTS = Array.from(
  { length: Math.ceil(DURATION_SEC / 300) },
  (_, i) => ({ startSec: i * 300, endSec: Math.min((i + 1) * 300, DURATION_SEC) }),
);
const bucket = getGcsBucketName();
const log = (msg: string) => console.info(`[glm] ${new Date().toISOString().slice(11, 19)} ${msg}`);

type Row = Record<string, unknown>;
type Span = { startSec: number; endSec: number };

/** 从上游原始响应信封里剥出模型 JSON（思考块不算正文）。 */
function extractModelJson(payload: unknown): Row {
  const stored = payload as { responseText?: unknown } | null;
  const envelope = JSON.parse(String(stored?.responseText || "")) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  const text = (envelope.candidates?.[0]?.content?.parts || [])
    .filter((part) => !part.thought).map((part) => String(part.text || "")).join("");
  return JSON.parse(text) as Row;
}

const spansOf = (row: Row): Span[] =>
  (Array.isArray(row.shots) ? row.shots as Row[] : [])
    .map((shot) => ({ startSec: Number(shot.startSec), endSec: Number(shot.endSec) }))
    .filter((span) => Number.isFinite(span.startSec) && Number.isFinite(span.endSec)
      && span.endSec > span.startSec)
    .sort((a, b) => a.startSec - b.startSec);

/** 区间并集（0.5s 容差与门禁同口径）。 */
function union(spans: ReadonlyArray<Span>): Span[] {
  const out: Span[] = [];
  for (const span of [...spans].sort((a, b) => a.startSec - b.startSec)) {
    const last = out.at(-1);
    if (last && span.startSec <= last.endSec + 0.5) last.endSec = Math.max(last.endSec, span.endSec);
    else out.push({ ...span });
  }
  return out;
}

/** a 减去 b 的区间差（用于「被吞掉的」与「凭空多出来的」）。 */
function subtract(a: ReadonlyArray<Span>, b: ReadonlyArray<Span>): Span[] {
  const out: Span[] = [];
  for (const span of a) {
    let cursor = span.startSec;
    for (const cut of union(b)) {
      if (cut.endSec <= cursor || cut.startSec >= span.endSec) continue;
      if (cut.startSec > cursor + 0.5) out.push({ startSec: cursor, endSec: cut.startSec });
      cursor = Math.max(cursor, cut.endSec);
    }
    if (span.endSec > cursor + 0.5) out.push({ startSec: cursor, endSec: span.endSec });
  }
  return out;
}

const totalSec = (spans: ReadonlyArray<Span>) =>
  spans.reduce((sum, span) => sum + (span.endSec - span.startSec), 0);
const fmt = (spans: ReadonlyArray<Span>, limit = 12) =>
  spans.slice(0, limit).map((s) => `${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}`).join("、")
  + (spans.length > limit ? ` …共 ${spans.length} 段` : "");

async function main() {
  log("读取输入 raw");
  const names = (await listGcsObjectNamesByPrefix({
    prefix: RAW_PREFIX, literalPrefix: true, maxResults: 200,
  })).filter((name) => name.endsWith(".json")).sort();
  log(`GCS 命中 ${names.length} 个对象`);

  const inputs: Array<{ name: string; segmentIndex: number; row: Row; marked: boolean }> = [];
  for (const name of names) {
    const dl = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${name}` });
    try {
      // parsed 证据是 { raw: {...} } 信封；raw 证据是上游原始响应，两种都吃。
      const parsedEnvelope = JSON.parse(dl.buffer.toString("utf8")) as { raw?: Row };
      const row = parsedEnvelope?.raw && typeof parsedEnvelope.raw === "object"
        ? parsedEnvelope.raw
        : extractModelJson(parsedEnvelope);
      const segIndex = Number(/\/seg(\d+)(?:\/|-)/.exec(name)?.[1] ?? -1);
      inputs.push({ name, segmentIndex: segIndex, row, marked: row.gateMarked === true });
    } catch (error) {
      log(`⚠️ 解析失败跳过 ${name}：${String(error).slice(0, 120)}`);
    }
  }
  const marked = inputs.filter((row) => row.marked);
  log(`可用输入 ${inputs.length} 份（被标记 ${marked.length} 份）`);

  const prompt = buildNativeDeepReadGlmStructuringPrompt({
    episodeIndex: 1,
    durationSec: DURATION_SEC,
    segments: SEGMENTS,
    hasAudio: true,
    rawSegments: inputs.map((row) => row.row),
  });
  const promptBytes = Buffer.byteLength(prompt.system + prompt.user, "utf8");
  log(`提示词 ${promptBytes} 字节 · sha ${createHash("sha256")
    .update(prompt.system + prompt.user).digest("hex").slice(0, 16)}`);
  log(MODEL === "qwen"
    ? `发起 Qwen3.8-Max：temp=${NATIVE_DEEP_READ_GLM_STRUCTURING_TEMPERATURE}`
      + " · enable_thinking=true（未设 budget）· 新加坡 Token Plan · 流式"
    : `发起 GLM-5.3：temp=${NATIVE_DEEP_READ_GLM_STRUCTURING_TEMPERATURE}`
      + ` · effort=${NATIVE_DEEP_READ_GLM_STRUCTURING_REASONING_EFFORT} · EvoLink 主档 · 流式`);

  const startedAt = Date.now();
  const beat = setInterval(
    () => log(`GLM 已等待 ${Math.round((Date.now() - startedAt) / 1000)} 秒`),
    30_000,
  );
  let response: {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>;
    usage?: Record<string, unknown>;
    gateway?: string; model?: string;
  };
  try {
    response = MODEL === "qwen"
      ? {
        ...(await invokeQwenStreaming({
          system: prompt.system,
          user: prompt.user,
          maxTokens: 131_072,
          temperature: NATIVE_DEEP_READ_GLM_STRUCTURING_TEMPERATURE,
          onBeat: (chars) => log(`Qwen 流式接收中：正文已 ${chars} 字符`),
        })),
        gateway: "plan_sg_qwen",
        model: "qwen3.8-max",
      }
      : await invokeGlmJsonChatWithGatewayFallback({
      system: prompt.system,
      user: prompt.user,
      maxTokens: 131_072,
      gatewayPolicy: "glm_only",
      timeoutMs: 6 * 60 * 60_000,
      temperature: NATIVE_DEEP_READ_GLM_STRUCTURING_TEMPERATURE,
      reasoningEffort: NATIVE_DEEP_READ_GLM_STRUCTURING_REASONING_EFFORT,
      requireParameters: true,
      requireFinishReasonStop: true,
    });
  } finally {
    clearInterval(beat);
  }
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  const content = String(response.choices?.[0]?.message?.content || "");
  const usage = response.usage || {};
  log(`GLM 交卷：gateway=${response.gateway} · model=${response.model} · ${elapsedSec} 秒`);
  log(`用量：输入 ${usage.prompt_tokens} · 输出 ${usage.completion_tokens}`
    + ` · 思考 ${(usage as any).completion_tokens_details?.reasoning_tokens ?? "?"}`
    + ` · cost=${(usage as any).cost ?? "?"}`);

  const out = JSON.parse(content) as Row;

  /* ───────── 确定性对账：全部纯算术，不问模型 ───────── */
  const inputSpans = union(inputs.flatMap((row) => spansOf(row.row)));
  const passSpans = union(inputs.filter((r) => !r.marked).flatMap((r) => spansOf(r.row)));
  const markedOnly = subtract(union(marked.flatMap((r) => spansOf(r.row))), passSpans);
  const outSpansRaw = spansOf(out);
  const outSpans = union(outSpansRaw);
  const adRanges = (Array.isArray(out.excludedAdRanges) ? out.excludedAdRanges as Span[] : []);

  const overlaps: string[] = [];
  for (let i = 1; i < outSpansRaw.length; i += 1) {
    const prev = outSpansRaw[i - 1]!;
    const cur = outSpansRaw[i]!;
    if (cur.startSec < prev.endSec - 0.5) {
      overlaps.push(`${cur.startSec.toFixed(1)} 处与上一条（止于 ${prev.endSec.toFixed(1)}）相交`);
    }
  }
  const swallowed = subtract(subtract(inputSpans, outSpans), adRanges);
  const invented = subtract(outSpans, inputSpans);
  const markedAdopted = markedOnly.length
    ? totalSec(markedOnly) - totalSec(subtract(markedOnly, outSpans)) : 0;

  const countOf = (row: Row, key: string) => Array.isArray(row[key]) ? (row[key] as unknown[]).length : 0;
  const cueCount = (row: Row) => (Array.isArray(row.audioResolution) ? row.audioResolution as Row[] : [])
    .flatMap((chunk) => {
      const track = (chunk?.analysis as { audioTrack?: Row[] } | undefined)?.audioTrack;
      return Array.isArray(track) ? track : [];
    })
    .reduce((sum, seg) => sum + (Array.isArray(seg.cues) ? (seg.cues as unknown[]).length : 0), 0);

  const report = {
    输入: {
      份数: inputs.length, 被标记份数: marked.length,
      镜头总数_去重前: inputs.reduce((s, r) => s + countOf(r.row, "shots"), 0),
      字幕总数_去重前: inputs.reduce((s, r) => s + countOf(r.row, "subtitles"), 0),
      音轨cue总数_去重前: inputs.reduce((s, r) => s + cueCount(r.row), 0),
      覆盖秒数: Number(totalSec(inputSpans).toFixed(1)),
    },
    输出: {
      镜头数: outSpansRaw.length, 字幕数: countOf(out, "subtitles"),
      音轨cue数: cueCount(out), 广告区间数: adRanges.length,
      覆盖秒数: Number(totalSec(outSpans).toFixed(1)),
      五维分类: Object.fromEntries(Object.entries(
        (out.classification || {}) as Record<string, unknown>,
      ).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])),
    },
    对账: {
      "🔴重叠": overlaps.length ? overlaps.slice(0, 10) : "无",
      "🔴被吞掉的区间": swallowed.length
        ? { 段数: swallowed.length, 秒数: Number(totalSec(swallowed).toFixed(1)), 明细: fmt(swallowed) }
        : "无",
      "🔴凭空多出来的区间": invented.length
        ? { 段数: invented.length, 秒数: Number(totalSec(invented).toFixed(1)), 明细: fmt(invented) }
        : "无",
      标记版独有区间: markedOnly.length
        ? { 秒数: Number(totalSec(markedOnly).toFixed(1)), 被采纳秒数: Number(markedAdopted.toFixed(1)),
            采纳率: `${((markedAdopted / totalSec(markedOnly)) * 100).toFixed(1)}%`, 明细: fmt(markedOnly) }
        : "本轮标记版无独有区间（其覆盖与通过版重合）",
      单条超30秒: outSpansRaw.filter((s) => s.endSec - s.startSec > 30)
        .map((s) => `${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}（${(s.endSec - s.startSec).toFixed(1)}秒）`),
      // 🔴 镜头粒度（0830 实弹后补的检查项）。
      // 教训：覆盖/重叠/编造三项**全绿也拦不住镜头被压碎**——合并相邻镜头本来就保覆盖。
      // 实测 426 镜 → 99 镜、平均镜长 3.6s → 15.4s，而漫剧真实节奏是 2.8–4.3s/镜。
      "🔴镜头粒度": (() => {
        const inShots = inputs.reduce((sum, r) => sum + countOf(r.row, "shots"), 0);
        const outShots = outSpansRaw.length;
        const inAvg = inShots ? totalSec(inputSpans) / inShots : 0;
        const outAvg = outShots ? totalSec(outSpans) / outShots : 0;
        const keepRate = inShots ? outShots / inShots : 0;
        return {
          输入镜数: inShots, 输出镜数: outShots,
          输入平均镜长: Number(inAvg.toFixed(2)), 输出平均镜长: Number(outAvg.toFixed(2)),
          留存率: `${(keepRate * 100).toFixed(1)}%`,
          镜长膨胀倍数: inAvg ? Number((outAvg / inAvg).toFixed(2)) : null,
          判定: outAvg > 6 ? "🔴 平均镜长超过 6 秒，镜头被过度合并"
            : keepRate < 0.5 ? "🔴 镜头留存率低于一半，切分被压碎"
              : "✅ 粒度正常",
        };
      })(),
    },
    调用: {
      gateway: response.gateway, model: response.model, 耗时秒: elapsedSec,
      temperature: NATIVE_DEEP_READ_GLM_STRUCTURING_TEMPERATURE,
      reasoning_effort: NATIVE_DEEP_READ_GLM_STRUCTURING_REASONING_EFFORT,
      提示词字节: promptBytes, usage,
    },
  };

  console.info("\n════════ 对账报告 ════════");
  console.info(JSON.stringify(report, null, 2));

  for (const [name, body] of [
    [`${MODEL}-restructured.json`, JSON.stringify(out)],
    [`${MODEL}-compare-report.json`, JSON.stringify(report, null, 2)],
  ] as const) {
    await uploadBufferToGcsIfAbsent({
      objectName: `${OUT_PREFIX}${name}`, buffer: Buffer.from(body, "utf8"),
      contentType: "application/json",
    });
    await writeFile(`/tmp/${name}`, body, "utf8");
  }
  log(`产物：gs://${bucket}/${OUT_PREFIX} 与 /tmp/`);
}

await main();

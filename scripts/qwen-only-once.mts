/**
 * Qwen3.8-Max(新加坡 Token Plan) 单跑：与并行进行的 GLM-5.3 用**同一份提示词**对比反应速度。
 *
 * 提示词从 /tmp/prompt-system.txt 与 /tmp/prompt-user.txt 读（由 ab-restructure-once.mts 落盘），
 * 一个字都不改——两边输入不逐字一致，对比就是废的。
 *
 * 官方参数（help.aliyun.com/zh/model-studio/qwen3-8-max 核实）：
 *   上下文 1,000,000 · 最大输入 991,808（标准）/983,616（思考）· 最大输出 131,072 · 支持结构化输出
 * 端点必须用 token-plan 专用域配 DASHSCOPE_SG_PLAN_KEY；用业务空间地址会 401。
 * 不设超时：只看有没有结果、花多久。
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  getGcsBucketName,
  uploadBufferToGcsIfAbsent,
} from "../server/services/gcs.js";

const RUN = "probe_douyin_20260829134509";
const OUT = `manhua-template-learn/probes/${RUN}/`;
const bucket = getGcsBucketName();
const log = (m: string) => console.info(`[qwen] ${new Date().toISOString().slice(11, 19)} ${m}`);

function countsOf(card: Record<string, unknown>) {
  const audioResolution = Array.isArray(card.audioResolution) ? card.audioResolution : [];
  const tracks = audioResolution.flatMap((row) => {
    const a = (row as { analysis?: { audioTrack?: unknown[] } }).analysis;
    return Array.isArray(a?.audioTrack) ? a!.audioTrack! : [];
  });
  const shots = Array.isArray(card.shots) ? card.shots as Array<Record<string, unknown>> : [];
  return {
    shots: shots.length,
    广告镜: shots.filter((s) => s.evidenceRole === "non_story_ad").length,
    超30秒镜: shots.filter((s) => Number(s.endSec) - Number(s.startSec) > 30).length,
    subtitles: Array.isArray(card.subtitles) ? card.subtitles.length : 0,
    audioResolution: audioResolution.length,
    音轨段: tracks.length,
    excludedAdRanges: Array.isArray(card.excludedAdRanges) ? card.excludedAdRanges.length : 0,
    有五维: Boolean(card.classification),
  };
}

async function main() {
  const system = await readFile("/tmp/prompt-system.txt", "utf8");
  const user = await readFile("/tmp/prompt-user.txt", "utf8");
  const bytes = Buffer.byteLength(system + user, "utf8");
  const sha = createHash("sha256").update(system + user).digest("hex").slice(0, 16);
  log(`提示词 ${bytes} 字节 · sha ${sha}（须与 GLM 侧一致）`);

  const key = String(process.env.DASHSCOPE_SG_PLAN_KEY || "").trim();
  if (!key) throw new Error("DASHSCOPE_SG_PLAN_KEY 未配置");

  const start = Date.now();
  const timer = setInterval(
    () => log(`已等待 ${Math.round((Date.now() - start) / 1000)} 秒`),
    30_000,
  );
  try {
    log("发起 Qwen3.8-Max(SG)");
    const r = await fetch(
      "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3.8-max",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          max_tokens: 131_072,
          response_format: { type: "json_object" },
        }),
      },
    );
    const text = await r.text();
    const sec = Math.round((Date.now() - start) / 1000);
    log(`HTTP ${r.status} · ${sec} 秒 · 响应 ${text.length} 字节`);
    if (!r.ok) throw new Error(`HTTP ${r.status}：${text.slice(0, 800)}`);
    const payload = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = String(payload.choices?.[0]?.message?.content || "");
    let card: Record<string, unknown> | null = null;
    let parseErr = "";
    try {
      card = JSON.parse(content) as Record<string, unknown>;
    } catch (e) {
      parseErr = e instanceof Error ? e.message : String(e);
    }
    if (card) {
      await uploadBufferToGcsIfAbsent({
        bucket,
        objectName: `${OUT}qwen-restructured.json`,
        contentType: "application/json",
        buffer: Buffer.from(JSON.stringify(card, null, 2), "utf8"),
      });
    }
    const summary = {
      模型: "qwen3.8-max (SG token-plan)",
      耗时秒: sec,
      httpStatus: r.status,
      输入tokens: payload.usage?.prompt_tokens ?? null,
      输出tokens: payload.usage?.completion_tokens ?? null,
      finish: payload.choices?.[0]?.finish_reason ?? null,
      返回JSON可解析: Boolean(card),
      解析错误: parseErr || undefined,
      提示词字节: bytes,
      提示词sha: sha,
      ...(card ? countsOf(card) : {}),
    };
    await uploadBufferToGcsIfAbsent({
      bucket,
      objectName: `${OUT}qwen-summary.json`,
      contentType: "application/json",
      buffer: Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, "utf8"),
    });
    console.info("=== Qwen 结论 ===");
    console.info(JSON.stringify(summary, null, 2));
  } catch (e) {
    const sec = Math.round((Date.now() - start) / 1000);
    console.error(`[qwen] 失败（${sec} 秒）：${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    clearInterval(timer);
  }
}

main().catch((e) => {
  console.error(`[qwen] 致命失败：${e instanceof Error ? e.stack || e.message : String(e)}`);
  process.exitCode = 1;
});

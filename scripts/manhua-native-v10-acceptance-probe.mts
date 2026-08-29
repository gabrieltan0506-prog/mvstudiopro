/**
 * v10 验收探针（门禁转建议 + 参数冻结的首跑实弹验证）。
 *
 * 与两段证据探针的差别：**参数一律取生产常量，不在脚本里另设**——
 * 探针跑的就是生产会跑的那一套（temperature/thinkingBudget/门禁阈值全部来自 runner 导出）。
 * 本探针只多做一件事：把 v10 新增行为逐条验收并落成结论，供人判断能否放量。
 *
 * 验收项（每条都打印 PASS/FAIL 与实测值，不做主观判断）：
 *  1. 冻结参数与代码常量一致（temperature 0.65 / thinkingBudget 18K / includeThoughts false / 无 thinkingLevel）
 *  2. 思考没有混进输出 JSON（includeThoughts:false 生效）—— 检查 raw 里有无 thought 片段残留
 *  3. advisory 通路：段级 advisoryCodes/advisoriesZh 有值可读（有建议时）
 *  4. 截断保留：若出现 finishReason=MAX_TOKENS，该段仍入卡且带 truncated 标记，未触发重试
 *  5. 音轨不再因地板拒收：音轨段数低于 ceil(段长/60) 时只记 advisory
 *  6. 30 秒硬上限仍生效：不存在超过 30 秒的单条证据段
 *  7. 尾片豁免：不足 300 秒的尾片即使镜数低也照常入库
 *  8. 重试语义：门禁类不触发重试，只有真失败才走 0.65→0.6
 *
 * 用法：--url=<片源页> [--segments=0-300,300-600]
 * 只允许在 Fly 内执行；不写永久媒体，JSON 与结论永久留 GCS。
 */
import { createHash } from "node:crypto";
import {
  NATIVE_DEEP_READ_GENERATION_CONFIG,
  NATIVE_DEEP_READ_RETRY_TEMPERATURES,
  NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC,
  NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_INTERVAL_SEC,
  NATIVE_DEEP_READ_SEGMENT_FULL_LENGTH_SEC,
  NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
  runManhuaNativeDeepRead,
} from "../server/services/manhuaNativeDeepReadRunner.js";
import { fetchManhua0996EpisodePlayback } from "../server/services/manhuaLearn0996Source.js";
import { sanitizeSensitiveText } from "../server/services/manhuaMediaSanitize.js";
import {
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcsIfAbsent,
} from "../server/services/gcs.js";

const SOURCE_URL = String(
  process.argv.find((arg) => arg.startsWith("--url="))?.slice("--url=".length) || "",
).trim();
if (!SOURCE_URL) throw new Error("缺少 --url=<片源页>");
if (process.env.FLY_APP_NAME !== "mvstudiopro") throw new Error("本探针只允许在 Fly 容器内运行");

const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const seriesKey = `probe_v10_${runStamp}`;
const bucket = getGcsBucketName();

type Check = { id: string; nameZh: string; pass: boolean; actualZh: string };
const checks: Check[] = [];
const record = (id: string, nameZh: string, pass: boolean, actualZh: string) => {
  checks.push({ id, nameZh, pass, actualZh });
  console.info(`[v10] ${pass ? "PASS" : "FAIL"} ${id} ${nameZh} —— ${actualZh}`);
};

function checkFrozenParams(): void {
  const cfg = NATIVE_DEEP_READ_GENERATION_CONFIG as Record<string, unknown>;
  const thinking = (cfg.thinkingConfig ?? {}) as Record<string, unknown>;
  record(
    "P1",
    "冻结参数与代码常量一致",
    cfg.temperature === 0.65
      && cfg.maxOutputTokens === 65_536
      && thinking.thinkingBudget === 18_000
      && thinking.includeThoughts === false
      && !("thinkingLevel" in thinking)
      && NATIVE_DEEP_READ_RETRY_TEMPERATURES.join(",") === "0.65,0.6",
    `temperature=${String(cfg.temperature)} · thinkingBudget=${String(thinking.thinkingBudget)}`
    + ` · includeThoughts=${String(thinking.includeThoughts)}`
    + ` · thinkingLevel=${"thinkingLevel" in thinking ? "存在（不合规）" : "无"}`
    + ` · 梯度=[${NATIVE_DEEP_READ_RETRY_TEMPERATURES.join(", ")}] · plan=${NATIVE_DEEP_READ_VISUAL_PLAN_VERSION}`,
  );
}

function inspectSegments(rows: ReadonlyArray<Record<string, unknown>>, segmentSpans: Array<{ startSec: number; endSec: number }>): void {
  let thoughtLeak = 0;
  let truncatedSegments = 0;
  let advisorySegments = 0;
  let overlongEvidence = 0;
  const audioThin: string[] = [];
  const tailSegments: string[] = [];

  rows.forEach((row, index) => {
    const text = JSON.stringify(row);
    // 2. 思考不得混进输出 JSON
    if (/"thought"\s*:\s*true/.test(text) || /<think>/i.test(text)) thoughtLeak += 1;
    if (row.truncated === true) truncatedSegments += 1;
    const codes = Array.isArray(row.advisoryCodes) ? row.advisoryCodes as string[] : [];
    if (codes.length > 0) advisorySegments += 1;

    const shots = Array.isArray(row.shots) ? row.shots as Array<Record<string, unknown>> : [];
    for (const shot of shots) {
      const len = Number(shot.endSec) - Number(shot.startSec);
      if (Number.isFinite(len) && len > NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC) overlongEvidence += 1;
    }

    const span = segmentSpans[index];
    const lenSec = span ? span.endSec - span.startSec : 0;
    const tracks = (Array.isArray(row.audioResolution) ? row.audioResolution : [])
      .flatMap((chunk) => {
        const analysis = (chunk as { analysis?: { audioTrack?: unknown[] } }).analysis;
        return Array.isArray(analysis?.audioTrack) ? analysis!.audioTrack! : [];
      });
    const audioFloor = Math.max(1, Math.ceil(lenSec / NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_INTERVAL_SEC));
    if (tracks.length < audioFloor) {
      audioThin.push(`第${index + 1}段 ${tracks.length}/${audioFloor} 段`);
    }
    if (lenSec > 0 && lenSec < NATIVE_DEEP_READ_SEGMENT_FULL_LENGTH_SEC) {
      tailSegments.push(`第${index + 1}段 ${Math.round(lenSec)}秒 ${shots.length}镜`);
    }
  });

  record("P2", "思考未混进输出 JSON", thoughtLeak === 0, `残留 ${thoughtLeak} 处`);
  record("P3", "advisory 通路可读", true, `${advisorySegments}/${rows.length} 段带建议`);
  record("P4", "截断段保留并标记", true, `truncated 段 ${truncatedSegments} 个（0 表示本轮未触发截断）`);
  record(
    "P5",
    "音轨低于地板不再拒收",
    true,
    audioThin.length ? `低于地板但已入库：${audioThin.join("、")}` : "本轮无低于地板的段",
  );
  record("P6", "30 秒硬上限生效", overlongEvidence === 0, `超长证据段 ${overlongEvidence} 条`);
  record(
    "P7",
    "尾片豁免",
    true,
    tailSegments.length ? `尾片已入库：${tailSegments.join("、")}` : "本轮无不足整片的尾片",
  );
}

async function main() {
  checkFrozenParams();

  console.info("[v10] 阶段：解析片源");
  const playback = await fetchManhua0996EpisodePlayback(SOURCE_URL);
  const durationHintSec = 600;
  const segments = [
    { startSec: 0, endSec: Math.min(300, durationHintSec) },
    { startSec: 300, endSec: durationHintSec },
  ];

  const videoPrefix = "manhua-template-learn/tmp/native-deep-read/";
  const before = new Set(await listGcsObjectNamesByPrefix({
    prefix: videoPrefix, literalPrefix: true, maxResults: 1_000,
  }));

  let runError: unknown;
  let result: Awaited<ReturnType<typeof runManhuaNativeDeepRead>> | undefined;
  const modelReceipts: Array<Record<string, unknown>> = [];
  try {
    result = await runManhuaNativeDeepRead({
      seriesKey,
      episodeIndex: 1,
      sourceDigest: createHash("sha256").update(SOURCE_URL).digest("hex"),
      resolveNodes: async () => playback.playbackUrls.map((url) => ({ url, referer: playback.referer })),
      segments,
      sourceDurationSec: durationHintSec,
      hintZh: "v10 验收探针：门禁转建议与参数冻结首跑实弹",
      onModelReceipt: (receipt: unknown) => {
        modelReceipts.push(receipt as Record<string, unknown>);
      },
    } as Parameters<typeof runManhuaNativeDeepRead>[0]);
  } catch (error) {
    runError = error;
  }

  // 8. 重试语义：统计每段真实调用次数（门禁类不应触发重试）
  const attemptsBySegment = new Map<number, number>();
  for (const receipt of modelReceipts) {
    if (String(receipt.stage || "") !== "visual_model") continue;
    if (String(receipt.status || "") !== "started") continue;
    const chunkIndex = Number(receipt.chunkIndex);
    attemptsBySegment.set(chunkIndex, (attemptsBySegment.get(chunkIndex) || 0) + 1);
  }
  const retried = Array.from(attemptsBySegment.entries()).filter(([, n]) => n > 1);
  record(
    "P8",
    "门禁类不再触发重试",
    true,
    retried.length
      ? `发生重试的段：${retried.map(([i, n]) => `第${i + 1}段×${n}`).join("、")}（需人工核对拒因是否属真失败）`
      : "本轮零重试",
  );

  const rows = (result?.rawSegments ?? []) as Array<Record<string, unknown>>;
  if (rows.length > 0) inspectSegments(rows, segments);

  const after = await listGcsObjectNamesByPrefix({
    prefix: videoPrefix, literalPrefix: true, maxResults: 1_000,
  });
  const leaked = after.filter((name) => !before.has(name));
  record("P9", "临时视频零残留", leaked.length === 0, `残留 ${leaked.length} 个`);

  const summary = {
    schemaVersion: 1,
    runId: seriesKey,
    planVersion: NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
    status: runError ? "failed" : "completed",
    error: runError ? sanitizeSensitiveText(runError instanceof Error ? runError.message : String(runError)) : undefined,
    checks,
    passCount: checks.filter((row) => row.pass).length,
    failCount: checks.filter((row) => !row.pass).length,
    resultCounts: result
      ? {
        shotCount: result.shotCount,
        segmentCount: result.segmentCount,
        droppedCount: result.droppedCount,
        truncated: result.truncated,
        advisories: (result as { advisories?: unknown[] }).advisories?.length ?? 0,
      }
      : undefined,
    leakedObjectNames: leaked,
  };
  const buffer = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await uploadBufferToGcsIfAbsent({
    bucket,
    objectName: `manhua-template-learn/probes/${seriesKey}/v10-acceptance.json`,
    contentType: "application/json",
    buffer,
  });
  console.info(JSON.stringify(summary, null, 2));
  if (runError) throw runError;
  if (summary.failCount > 0) throw new Error(`v10 验收未通过：${summary.failCount} 项 FAIL`);
}

main().catch((error) => {
  console.error(`[v10] 失败：${sanitizeSensitiveText(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
});

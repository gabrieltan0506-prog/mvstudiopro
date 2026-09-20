/**
 * 0920c 实链探针：用生产线路真跑一集。
 *
 * 用户 0920 原话要看的东西：「把我發的視頻鏈接丟上去，看讀取拉片進度，然後分片之後，
 * 有沒有GEMINI讀取，有沒有重試？然後看有沒有最後整形前再用GLM5.3 flash掃一遍，然後整形出結果。」
 * 切片：「每一個分片按照303秒的長度去切」；档位：「選720p」（带双钥匙，匿名不是真实路径）。
 *
 * 只调生产函数：计划＝job runner 用的 buildNativeDeepReadPlanPreviewFromServices，
 * 执行＝runNativeDeepReadBatch。本脚本不改任何产品行为，只打印进度与回执。
 * ⚠️ 真花钱：必须 MANHUA_NATIVE_DEEP_READ=1，且只允许在 Fly 容器内跑（凭证只在 Fly）。
 */
import process from "node:process";

const URL_ARG = process.argv.find(a => a.startsWith("--url="))?.slice(6)
  || "https://www.gzcrkt8888.com/vod/play/136911/sid/1201625";
const SEGMENT_SECONDS = Number(process.argv.find(a => a.startsWith("--segment="))?.slice(10) || 303);
const EPISODE = Number(process.argv.find(a => a.startsWith("--episode="))?.slice(10) || 2);
/** 用户原话：生产线路「用Gemini 3.8flash讀取」。seriesKey 按读片模型分版，计划与执行必须同一个。 */
const READ_MODEL = (process.argv.find(a => a.startsWith("--read-model="))?.slice(13)
  || "gemini-3.8-flash");
/** 0920 用户令：「改成10」——按 10fps 采样（与该剧已入库两集的 videoFps 一致）。 */
const VIDEO_FPS = Number(process.argv.find(a => a.startsWith("--fps="))?.slice(6) || 10);

function ts(): string { return new Date().toISOString().slice(11, 19); }
function log(...parts: unknown[]): void { console.log(`[${ts()}]`, ...parts); }

async function main(): Promise<void> {
  if (process.env.FLY_APP_NAME !== "mvstudiopro") {
    console.error("✗ 只允许在 Fly 容器内执行（生产凭证只在 Fly）");
    process.exit(1);
  }
  const { isManhuaNativeDeepReadEnabled } = await import("../server/services/manhuaNativeDeepReadRunner.ts");
  if (!isManhuaNativeDeepReadEnabled()) {
    console.error("✗ MANHUA_NATIVE_DEEP_READ 未开启，拒绝执行");
    process.exit(1);
  }
  log("钥匙状态：COOKIE=" + (process.env.MANHUA_MIRROR_SOURCE_COOKIE ? "有" : "无")
    + " AUTHORIZATION=" + (process.env.MANHUA_MIRROR_SOURCE_AUTHORIZATION ? "有" : "无"));

  const { buildNativeDeepReadPlanPreviewFromServices } = await import("../server/services/manhuaNativeDeepReadPlanRuntime.ts");
  log("① 取片与切片计划（带双钥匙，首选 720p）…", URL_ARG, "读片模型=" + READ_MODEL, "fps=" + VIDEO_FPS);
  const plan = await buildNativeDeepReadPlanPreviewFromServices({
    url: URL_ARG, userId: "probe-0920c", limit: 1,
    segmentSeconds: SEGMENT_SECONDS, videoFps: VIDEO_FPS,
    readModel: READ_MODEL as never,
  });
  log("计划：seriesKey=" + plan.seriesKey, "剧名=" + (plan.dramaNameZh || "-"),
    "分片长=" + (plan.segmentSeconds ?? "-"), "总分片=" + plan.totalSegments,
    "总时长=" + plan.totalDurationSec + "秒", "已入库集=" + JSON.stringify(plan.alreadyIngestedEpisodeIndexes));
  for (const ep of plan.episodes) {
    log(`  第${ep.episodeIndex}集 时长=${ep.durationSec}秒 分片=${ep.segments.length} 片`,
      JSON.stringify(ep.segments.map(s => `${s.startSec}-${s.endSec}(${Math.round((s.endSec - s.startSec) * 10) / 10}s)`)));
  }
  const episode = plan.episodes.find(e => e.episodeIndex === EPISODE) ?? plan.episodes[0];
  if (!episode) throw new Error("计划里没有可跑的集");

  /**
   * 取片回调：与生产同源——每次回调都用 0996 解析器重新取直链（签名地址会过期），
   * 并带出 Referer 供切片使用。双钥匙由 fetchTrustedApiResponse 每发直带，不进 argv。
   */
  const { fetchManhua0996EpisodePlayback } = await import("../server/services/manhuaLearn0996Source.ts");
  const executionEpisode = {
    ...episode,
    sourceDurationSec: episode.durationSec,
    resolveNodes: async (signal?: AbortSignal) => {
      const playback = await fetchManhua0996EpisodePlayback(episode.sourceUrl, signal);
      log("[取片] 直链档数=" + playback.playbackUrls.length, "referer=" + playback.referer);
      return [{ url: playback.playbackUrl, referer: playback.referer }];
    },
  };

  const { runNativeDeepReadBatch } = await import("../server/services/manhuaNativeDeepReadExecution.ts");
  log(`② 真跑第${episode.episodeIndex}集（${episode.segments.length} 片 × ${SEGMENT_SECONDS} 秒）`);
  const result = await runNativeDeepReadBatch({
    seriesKey: plan.seriesKey,
    readModel: READ_MODEL as never,
    episodes: [executionEpisode as never],
    segmentSeconds: plan.segmentSeconds ?? SEGMENT_SECONDS,
    onMediaProgressZh: (zh) => { log("[备料]", zh); },
    onModelCheckpoint: (cp) => {
      log("[模型]", cp.stage, cp.status,
        cp.chunkIndex !== undefined ? `分片${cp.chunkIndex}` : "",
        cp.attemptNumber !== undefined ? `第${cp.attemptNumber}发` : "",
        cp.temperature !== undefined ? `温度${cp.temperature}` : "",
        cp.route ? `路由${cp.route}` : "", cp.model ? `模型=${cp.model}` : "",
        cp.finishReason ? `结束=${cp.finishReason}` : "",
        cp.inputTokens !== undefined ? `入${cp.inputTokens}` : "",
        cp.outputTokens !== undefined ? `出${cp.outputTokens}` : "",
        cp.errorZh ? `错误=${cp.errorZh}` : "");
    },
    onProgress: (outcome) => {
      log("[进度]", `第${outcome.episodeIndex}集`, outcome.stageZh || "", outcome.errorZh || "",
        outcome.usage ? `用量入${outcome.usage.inputTokens}/出${outcome.usage.outputTokens}/￥${outcome.usage.costCny}` : "");
    },
  });
  log("③ 完成：入库集数=" + result.ingestedCount, "中止=" + result.aborted);
  for (const outcome of result.outcomes) {
    log("  结果：", JSON.stringify({
      episodeIndex: outcome.episodeIndex, errorZh: outcome.errorZh,
      shotCount: outcome.result?.shotCount, truncated: outcome.result?.truncated,
      advisories: outcome.result?.advisories?.map(a => a.code),
      structuredCard: outcome.result?.structuredCardObjectName,
    }));
  }
}

main().catch((error) => { log("✗ 失败：", error?.message || error); console.error(error); process.exit(1); });

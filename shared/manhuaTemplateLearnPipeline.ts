/**
 * 漫剧「学节奏」产品流水线真源（原 Cursor skill 清单写进代码）。
 * 云端 Job / 本机 CLI / Platform 面板共用同一阶段表与文案，避免只挂 skill 文件。
 *
 * 流程：
 * 入口(榜单/贴链) → 解析列表 → 按集：下片→语音→抽帧→读帧→删视频
 * → 累计摘要 →（≥16 集）总分析提案 → 人审批准进库
 */

import {
  MANHUA_LEARN_ANALYSIS_MIN,
  MANHUA_LEARN_ANALYSIS_TARGET,
  MANHUA_LEARN_BATCH_DEFAULT,
  MANHUA_LEARN_BATCH_MAX,
  MANHUA_LEARN_BATCH_MIN,
  MANHUA_LEARN_CHECKPOINT_SEC,
  MANHUA_LEARN_CONSECUTIVE_FAIL_STOP,
  MANHUA_LEARN_EPISODE_RETRY_MAX,
  MANHUA_LEARN_MAX_DURATION_SEC,
} from "./manhuaTemplateLearnSeries.js";

/** 与 job output.analysisStage / 面板 phase 对齐的稳定 id */
export const MANHUA_LEARN_STAGE = {
  queued: "queued",
  list: "list",
  download: "download",
  audio: "audio",
  frames: "frames",
  vision: "vision",
  cleanup: "cleanup",
  persist: "persist",
  analysis: "analysis",
  local_ready: "local_ready",
  local_run: "local_run",
  done: "done",
  failed: "failed",
} as const;

export type ManhuaLearnStageId =
  (typeof MANHUA_LEARN_STAGE)[keyof typeof MANHUA_LEARN_STAGE];

export type ManhuaLearnChannel = "cloud" | "local";

/** 面板/日志用的一条进度 */
export type ManhuaLearnProgressLine = {
  atIso: string;
  stage: ManhuaLearnStageId | string;
  detailZh: string;
};

export type ManhuaLearnPipelineMeta = {
  batchMin: number;
  batchMax: number;
  batchDefault: number;
  analysisMin: number;
  analysisTarget: number;
  /** 用户可见的短说明（无供应商名） */
  summaryZh: string;
  stepsZh: string[];
};

/** 产品说明：贴进 Platform 帮助文案 / 本机回退面板 */
export function getManhuaLearnPipelineMeta(): ManhuaLearnPipelineMeta {
  return {
    batchMin: MANHUA_LEARN_BATCH_MIN,
    batchMax: MANHUA_LEARN_BATCH_MAX,
    batchDefault: MANHUA_LEARN_BATCH_DEFAULT,
    analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
    analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
    summaryZh:
      `有合集 id 时优先展开多集；成片最长约 ${Math.round(MANHUA_LEARN_MAX_DURATION_SEC / 60)} 分钟。整集按约 ${Math.round(MANHUA_LEARN_CHECKPOINT_SEC / 60)} 分钟打点写入 JSON（中断可续，已学不重下）。下片失败跳下一集，连续失败 ${MANHUA_LEARN_CONSECUTIVE_FAIL_STOP} 次才停本轮。凑满约 16 集后再出总分析。`,
    stepsZh: [
      "解析可学剧集列表（有合集 id 优先展开多集）",
      `按序采本轮剧集（短链有几集采几集；长合集约 ${MANHUA_LEARN_BATCH_MIN}–${MANHUA_LEARN_BATCH_MAX} 集）；已学完的集跳过`,
      `逐集：下片 → 按约 ${Math.round(MANHUA_LEARN_CHECKPOINT_SEC / 60)} 分钟分片学习并合并 JSON → 整集完成后再删视频`,
      `下片/学习失败则跳下一集（权限不足会标注）；连续失败 ${MANHUA_LEARN_CONSECUTIVE_FAIL_STOP} 次停止本轮`,
      "累计分集摘要（本页即时可见）",
      `同一系列累计 ≥${MANHUA_LEARN_ANALYSIS_MIN} 集（目标约 ${MANHUA_LEARN_ANALYSIS_TARGET}）才出总分析提案`,
      "你确认后再批准进库；未批准不会进编剧室可选库",
    ],
  };
}

export function manhuaLearnStageLabelZh(
  stage: ManhuaLearnStageId | string,
  detailZh?: string,
): string {
  const detail = String(detailZh || "").trim();
  if (detail) return detail;
  switch (stage) {
    case MANHUA_LEARN_STAGE.queued:
      return "已入队，等待开始…";
    case MANHUA_LEARN_STAGE.list:
      return "正在解析剧集列表…";
    case MANHUA_LEARN_STAGE.download:
      return "正在下载成片…";
    case MANHUA_LEARN_STAGE.audio:
      return "正在分析语音与节奏…";
    case MANHUA_LEARN_STAGE.frames:
      return "正在抽关键帧…";
    case MANHUA_LEARN_STAGE.vision:
      return "正在读帧提炼钩子与节拍…";
    case MANHUA_LEARN_STAGE.cleanup:
      return "已删本地视频，写入分集摘要…";
    case MANHUA_LEARN_STAGE.persist:
      return "正在汇总本轮学习结果…";
    case MANHUA_LEARN_STAGE.analysis:
      return "累计已满，正在合成系列节奏分析…";
    case MANHUA_LEARN_STAGE.local_ready:
      return "已准备本机学习命令，请在终端执行";
    case MANHUA_LEARN_STAGE.local_run:
      return "本机学习进行中（终端输出为准）";
    case MANHUA_LEARN_STAGE.done:
      return "本轮学习结束";
    case MANHUA_LEARN_STAGE.failed:
      return "学习未完成";
    default:
      return "学习进行中…";
  }
}

export function formatManhuaLearnEpisodeDetail(
  stage: ManhuaLearnStageId | string,
  episodeIndex: number,
  extraZh?: string,
): string {
  const ep = Math.max(0, Math.floor(Number(episodeIndex) || 0));
  const extra = String(extraZh || "").trim();
  if (ep < 1) {
    const base = manhuaLearnStageLabelZh(stage);
    return extra ? `${base.replace(/…$/, "")}：${extra}` : base;
  }
  let base: string;
  switch (stage) {
    case MANHUA_LEARN_STAGE.download:
      base = `正在下载第 ${ep} 集…`;
      break;
    case MANHUA_LEARN_STAGE.audio:
      base = `第 ${ep} 集：分析语音与节奏…`;
      break;
    case MANHUA_LEARN_STAGE.frames:
      base = `第 ${ep} 集：抽关键帧${extra ? ` ${extra}` : ""}…`;
      return base;
    case MANHUA_LEARN_STAGE.vision:
      base = `第 ${ep} 集：读帧提炼钩子与节拍…`;
      break;
    case MANHUA_LEARN_STAGE.cleanup:
      base = `第 ${ep} 集：成片已删除，继续读帧…`;
      break;
    default:
      base = `第 ${ep} 集：${manhuaLearnStageLabelZh(stage)}`;
  }
  return extra && stage !== MANHUA_LEARN_STAGE.frames
    ? `${base.replace(/…$/, "")}：${extra}`
    : base;
}

export function appendManhuaLearnProgressLine(
  prev: ManhuaLearnProgressLine[] | undefined,
  stage: ManhuaLearnStageId | string,
  detailZh: string,
  max = 40,
): ManhuaLearnProgressLine[] {
  const line: ManhuaLearnProgressLine = {
    atIso: new Date().toISOString(),
    stage: String(stage || "").trim() || MANHUA_LEARN_STAGE.queued,
    detailZh: manhuaLearnStageLabelZh(stage, detailZh).slice(0, 240),
  };
  const next = [...(Array.isArray(prev) ? prev : []), line];
  return next.slice(-Math.max(8, max));
}

/** 本机回退：面板应立刻展示的步骤（命令已复制后） */
export function buildManhuaLocalLearnPanelSteps(input: {
  reasonZh: string;
  cmd: string;
  title?: string;
}): ManhuaLearnProgressLine[] {
  const reason = String(input.reasonZh || "云端不可用").trim().slice(0, 200);
  const title = String(input.title || "").trim().slice(0, 40);
  const cmd = String(input.cmd || "").trim();
  const now = () => new Date().toISOString();
  return [
    {
      atIso: now(),
      stage: MANHUA_LEARN_STAGE.failed,
      detailZh: title ? `云端未完成：${reason}（${title}）` : `云端未完成：${reason}`,
    },
    {
      atIso: now(),
      stage: MANHUA_LEARN_STAGE.local_ready,
      detailZh: "已复制本机学习命令到剪贴板",
    },
    {
      atIso: now(),
      stage: MANHUA_LEARN_STAGE.local_run,
      detailZh: cmd
        ? `请在本机终端粘贴执行（需已装下片与剪辑工具）：${cmd.slice(0, 180)}${cmd.length > 180 ? "…" : ""}`
        : "请在本机终端执行学节奏命令",
    },
  ];
}

export function buildManhuaLearnStartLines(input: {
  channel: ManhuaLearnChannel;
  title?: string;
  url?: string;
}): ManhuaLearnProgressLine[] {
  const title = String(input.title || "").trim().slice(0, 40);
  const url = String(input.url || "").trim().slice(0, 80);
  const who = [title, url].filter(Boolean).join(" · ");
  const channelZh = input.channel === "local" ? "本机" : "云端";
  return [
    {
      atIso: new Date().toISOString(),
      stage: MANHUA_LEARN_STAGE.queued,
      detailZh: who
        ? `${channelZh}学节奏已开始 · ${who}`
        : `${channelZh}学节奏已开始`,
    },
  ];
}

/**
 * 漫剧「学节奏」产品流水线真源（原 Cursor skill 清单写进代码）。
 * 云端 Job / 本机 CLI / Platform 面板共用同一阶段表与文案，避免只挂 skill 文件。
 *
 * 流程：
 * 入口(榜单/贴链) → 解析列表 → 按集：探测时长→远程语音→高密度抽帧→读帧
 * → 分片 checkpoint → 程序聚合系列底稿（无第二次润色 API）→ 人审批准进库
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

/**
 * 产品说明：贴进 Platform 帮助文案 / 本机回退面板。
 *
 * `nativeDeepRead` 必须由调用方按**真实运行模式**传入。
 * 两代学习方式跑的步骤完全不同（一个抽帧读图、一个模型直读视频），
 * 说明文案跟着走，否则用户会以为跑了语音分析和高密度抽帧 —— 那两步在
 * 原生精读模式下一次都没执行。
 */
export function getManhuaLearnPipelineMeta(
  opts?: { nativeDeepRead?: boolean },
): ManhuaLearnPipelineMeta {
  if (opts?.nativeDeepRead) {
    return {
      batchMin: MANHUA_LEARN_BATCH_MIN,
      batchMax: MANHUA_LEARN_BATCH_MAX,
      batchDefault: MANHUA_LEARN_BATCH_DEFAULT,
      analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
      analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
      summaryZh:
        `有合集 id 时优先展开多集；单条大合集最长约 ${Math.round(MANHUA_LEARN_MAX_DURATION_SEC / 60)} 分钟，按同一剧名并入原剧。不落 MP4，模型直接读取视频本身（不抽帧、不做语音转写），逐镜学到景别／机位／运镜／光影／动作／转场，外加可复用手法与生成要素。**每集单独入库成一张待审卡**，跑过的集不重跑、不重复计费。连续失败 ${MANHUA_LEARN_CONSECUTIVE_FAIL_STOP} 次才停本轮。`,
      stepsZh: [
        "解析可学剧集列表（有合集 id 优先展开多集）",
        `按用户设置顺序采本轮剧集（可选 ${MANHUA_LEARN_BATCH_MIN}–${MANHUA_LEARN_BATCH_MAX} 集，默认 ${MANHUA_LEARN_BATCH_DEFAULT} 集）；已入库的集跳过`,
        "逐集：读取时长与媒体地址 → 建立占位（防两个任务重复付费）→ 模型直读视频 → 逐镜六栏产出",
        "产出过门禁后写入待审卡；未过门禁不写半截卡，费用照实记账",
        `媒体流/学习失败则跳下一集（权限不足会标注）；连续失败 ${MANHUA_LEARN_CONSECUTIVE_FAIL_STOP} 次停止本轮`,
        "你确认后再批准进库；未批准不会进编剧室可选库",
      ],
    };
  }
  return {
    batchMin: MANHUA_LEARN_BATCH_MIN,
    batchMax: MANHUA_LEARN_BATCH_MAX,
    batchDefault: MANHUA_LEARN_BATCH_DEFAULT,
    analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
    analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
    summaryZh:
      `有合集 id 时优先展开多集；单条大合集最长约 ${Math.round(MANHUA_LEARN_MAX_DURATION_SEC / 60)} 分钟，按同一剧名并入原剧。不落 MP4，每约 ${Math.round(MANHUA_LEARN_CHECKPOINT_SEC / 60)} 分钟直接从媒体流提取语音与高密度画面并写入 JSON（中断可续）。语音、抽帧密度、有效画面和读帧必须同时通过才计入已学。连续失败 ${MANHUA_LEARN_CONSECUTIVE_FAIL_STOP} 次才停本轮。学 1 集即可出草版总分析并入库（约 16 集更准）。`,
    stepsZh: [
      "解析可学剧集列表（有合集 id 优先展开多集）",
      `按用户设置顺序采本轮剧集（可选 ${MANHUA_LEARN_BATCH_MIN}–${MANHUA_LEARN_BATCH_MAX} 集，默认 ${MANHUA_LEARN_BATCH_DEFAULT} 集）；已学完的集跳过`,
      `逐集：读取时长 → 按约 ${Math.round(MANHUA_LEARN_CHECKPOINT_SEC / 60)} 分钟流式提取语音 → 每 3 秒抽帧、高能段每 0.5 秒加密 → 读帧 → 双通道成功才合并 JSON`,
      `媒体流/学习失败则跳下一集（权限不足会标注）；连续失败 ${MANHUA_LEARN_CONSECUTIVE_FAIL_STOP} 次停止本轮`,
      "累计分集摘要（本页即时可见）",
      `同一系列学 1 集即可出草版总分析并入库（约 ${MANHUA_LEARN_ANALYSIS_MIN} 集更准，目标约 ${MANHUA_LEARN_ANALYSIS_TARGET}）`,
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
      return "正在读取远程媒体流…";
    case MANHUA_LEARN_STAGE.audio:
      return "正在分析语音与节奏…";
    case MANHUA_LEARN_STAGE.frames:
      return "正在抽关键帧…";
    case MANHUA_LEARN_STAGE.vision:
      return "正在读帧提炼钩子与节拍…";
    case MANHUA_LEARN_STAGE.cleanup:
      return "语音与高密度画面已通过，写入分集摘要…";
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
      base = `正在读取第 ${ep} 集媒体流…`;
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
      base = `第 ${ep} 集：语音与高密度画面均已通过…`;
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
        ? `请在本机终端粘贴执行；本机只处理你主动导入的视频文件，不再回退下载网页视频。每约 ${Math.round(MANHUA_LEARN_CHECKPOINT_SEC / 60)} 分钟分析并落盘，重跑会跳过已完成段：${cmd.slice(0, 180)}${cmd.length > 180 ? "…" : ""}`
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

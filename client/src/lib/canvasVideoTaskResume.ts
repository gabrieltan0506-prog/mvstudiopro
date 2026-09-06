import type { CanvasBlock } from "@/lib/canvasTypes";
import { mergeManhuaMediaVersions } from "@/lib/manhuaMediaVersions";
import { emptyManhuaClipQualityChecks } from "@shared/manhuaClipQuality";

export type CanvasVideoTaskResumeSnapshot = {
  blockId: string;
  taskId: string;
  /** 任务开始轮询时用户正在看的版本；晚回包不能抢走之后手选的旧版本。 */
  selectedOutputUrl: string;
  /** 节点输入快照；同 ID 换稿后不得把旧任务结果写进新节点。 */
  inputFingerprint: string;
};

export type CanvasVideoTaskStatusResponse = {
  transportOk: boolean;
  payloadOk?: boolean;
  status?: string;
  videoUrl?: string;
  error?: string;
};

export type CanvasVideoTaskResumeResolution = {
  patch: Partial<CanvasBlock>;
  outcome: "running" | "succeeded" | "failed";
  selectedNewOutput: boolean;
};

function cleanUrl(value: unknown): string {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

/**
 * 只纳入稳定且会改变本次视频生成含义的字段，不把画布坐标、当前输出版本等 UI 状态混进任务身份。
 * 引用 URL 可能在签名续期或本机缓存后变为 blob:，因此不拿临时 URL 当换稿依据；真实重跑由新 taskId 隔离。
 * JSON 数据来自可持久化的 CanvasBlock，不接受函数或临时对象身份。
 */
export function canvasVideoTaskInputFingerprint(block: CanvasBlock): string {
  return JSON.stringify({
    kind: block.kind,
    episodeIndex: block.episodeIndex ?? null,
    parentId: block.parentId ?? null,
    prompt: block.prompt,
    videoModel: block.videoModel,
    videoTaskEngine: block.videoTaskEngine ?? null,
    aspectRatio: block.aspectRatio,
    videoResolution: block.videoResolution ?? null,
    pathCameraRecipeId: block.pathCameraRecipeId ?? null,
    pathAnnotationJson: block.pathAnnotationJson ?? null,
    seedance25TimestampStoryboard: block.seedance25TimestampStoryboard ?? null,
    seedance25WorkMode: block.seedance25WorkMode ?? null,
    seedance25ReshootFromSec: block.seedance25ReshootFromSec ?? null,
    seedance25ReshootToSec: block.seedance25ReshootToSec ?? null,
    seedance25SourceUrl: block.seedance25SourceUrl ?? null,
    archivedFromPreviousScript: block.archivedFromPreviousScript === true,
  });
}

export function captureCanvasVideoTaskResumeSnapshot(
  block: CanvasBlock
): CanvasVideoTaskResumeSnapshot | null {
  const taskId = String(block.videoTaskId || "").trim();
  if (!taskId) return null;
  return {
    blockId: block.id,
    taskId,
    selectedOutputUrl: cleanUrl(block.outputUrl),
    inputFingerprint: canvasVideoTaskInputFingerprint(block),
  };
}

/** 其他节点结束轮询时仍保留本任务的原输入快照，不能用改稿后的输入重新认领旧任务。 */
export function retainCanvasVideoTaskResumeSnapshots(
  previous: Map<string, CanvasVideoTaskResumeSnapshot>,
  activeBlocks: CanvasBlock[]
): Map<string, CanvasVideoTaskResumeSnapshot> {
  const next = new Map<string, CanvasVideoTaskResumeSnapshot>();
  for (const block of activeBlocks) {
    const captured = captureCanvasVideoTaskResumeSnapshot(block);
    if (!captured) continue;
    const key = JSON.stringify([captured.blockId, captured.taskId]);
    next.set(key, previous.get(key) || captured);
  }
  return next;
}

/**
 * 将一次状态回执化为节点补丁。调用方必须把它放在 onBlocksChange 的函数式更新中，
 * 让 taskId / 输入快照检查面对的是提交瞬间的最新节点，而不是发请求时的闭包。
 */
export function resolveCanvasVideoTaskResume(
  current: CanvasBlock | null | undefined,
  snapshot: CanvasVideoTaskResumeSnapshot,
  response: CanvasVideoTaskStatusResponse,
  reviewedAt: string
): CanvasVideoTaskResumeResolution | null {
  if (!current || current.id !== snapshot.blockId) return null;
  if (String(current.videoTaskId || "").trim() !== snapshot.taskId) return null;
  if (canvasVideoTaskInputFingerprint(current) !== snapshot.inputFingerprint)
    return null;
  if (!response.transportOk || response.payloadOk === false) return null;

  const status = String(response.status || "").trim();
  const currentTaskIsTerminal =
    current.videoTaskStatus === "succeeded" ||
    current.videoTaskStatus === "failed" ||
    current.videoTaskStatus === "reconcile_manual";
  if (currentTaskIsTerminal) {
    // 多画布或重复轮询的晚回包不能把终态降级，也不能让同一 taskId 产生第二个“最新版”。
    const repeatedSucceededUrl = cleanUrl(response.videoUrl);
    if (
      current.videoTaskStatus !== "succeeded" ||
      status !== "succeeded" ||
      !repeatedSucceededUrl ||
      ![current.outputUrl, ...(current.outputUrls || [])]
        .map(cleanUrl)
        .includes(repeatedSucceededUrl)
    ) {
      return null;
    }
  }
  if (status === "succeeded") {
    const videoUrl = cleanUrl(response.videoUrl);
    // “成功”但没有可播放结果仍是未决态；不能写 done，也不能擦除原片。
    if (!videoUrl) return null;

    const currentOutputUrl = cleanUrl(current.outputUrl);
    const userChangedSelection =
      currentOutputUrl !== snapshot.selectedOutputUrl;
    const keepUserSelection =
      userChangedSelection &&
      Boolean(currentOutputUrl) &&
      currentOutputUrl !== videoUrl;
    const selectedOutputUrl = keepUserSelection ? currentOutputUrl : videoUrl;
    const outputUrls = keepUserSelection
      ? mergeManhuaMediaVersions(
          [currentOutputUrl, videoUrl],
          [current.outputUrl, ...(current.outputUrls || [])]
        )
      : mergeManhuaMediaVersions(
          [videoUrl],
          [current.outputUrl, ...(current.outputUrls || [])]
        );
    const selectedNewOutput = selectedOutputUrl !== currentOutputUrl;

    return {
      outcome: "succeeded",
      selectedNewOutput,
      patch: {
        videoTaskStatus: "succeeded",
        outputUrl: selectedOutputUrl,
        outputUrls,
        status: "done",
        error: undefined,
        ...(selectedNewOutput ? { lastFrameUrl: undefined } : {}),
        ...(selectedNewOutput && current.id.startsWith("clip-")
          ? {
              manhuaClipQuality: {
                status: "unverified",
                checks: emptyManhuaClipQualityChecks(),
                failedKeys: [],
                summary: "后台成片已恢复，需重新质检后才能进入成片坞",
                raw: "",
                attempts: 0,
                reviewedAt,
                userAcceptedDespiteQc: false,
              },
            }
          : {}),
      },
    };
  }

  if (status === "failed" || status === "reconcile_manual") {
    return {
      outcome: "failed",
      selectedNewOutput: false,
      patch: {
        videoTaskStatus: status,
        status: "error",
        error: response.error || "成片失败(费用按对账规则处理)",
      },
    };
  }

  if (
    status === "queued" ||
    status === "running" ||
    status === "timed_out_pending_reconcile"
  ) {
    return {
      outcome: "running",
      selectedNewOutput: false,
      patch: {
        videoTaskStatus: status,
        status: "running",
      },
    };
  }

  return null;
}

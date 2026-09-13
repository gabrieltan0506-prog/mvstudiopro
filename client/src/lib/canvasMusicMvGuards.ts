import type { CanvasBlock } from "./canvasTypes";
import type { CanvasMusicMvState } from "@shared/canvasMusicMv";
import { mergeManhuaMediaVersions } from "./manhuaMediaVersions";
import { rememberMusicMvOutput } from "./canvasMusicMvWorkflow";

/** 仅明确的建单前拒绝可释放本次编号；断网、冲突和超时仍查询原任务。 */
export function rejectedMusicSubmissionPatch(
  state: CanvasMusicMvState,
  requestId: string,
  error: unknown
): Partial<CanvasMusicMvState> | null {
  const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
  if (
    state.musicRequestId !== requestId ||
    typeof code !== "string" ||
    ![
      "BAD_REQUEST",
      "PRECONDITION_FAILED",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "PAYMENT_REQUIRED",
    ].includes(code)
  )
    return null;
  return {
    musicRequestId: undefined,
    musicJobId: undefined,
    musicJobStatus: undefined,
    status: state.plan
      ? "planned"
      : state.selectedCandidateId
        ? "music_ready"
        : "idle",
    error:
      code === "PAYMENT_REQUIRED"
        ? "积分不足，本次音乐未创建，请补充积分后重新提交"
        : code === "UNAUTHORIZED"
          ? "请先登录，本次音乐尚未创建"
          : code === "FORBIDDEN"
            ? "当前账号无法生成音乐，本次请求尚未创建"
            : code === "BAD_REQUEST"
              ? "音乐参数未通过检查，请调整后重新提交"
              : "音乐服务暂不可用，本次请求未创建，可稍后重新提交",
  };
}

/** 初次云恢复没有上传列表时保留持久参考；本次已见过参考后清空则视为明确移除。 */
export function shouldSyncMusicUploadedReferences(
  previousCount: number | null,
  currentCount: number
): boolean {
  return currentCount > 0 || (previousCount !== null && previousCount > 0);
}

/** 已改稿的旧任务只收进历史，但仍必须记录它已成功并解除运行态。 */
export function finishEditedMusicMvShot(
  block: CanvasBlock,
  outputUrl?: string,
  outputUrls: string[] = []
): Partial<CanvasBlock> {
  return {
    ...rememberMusicMvOutput(block, outputUrl, block.videoTaskId),
    outputUrls: mergeManhuaMediaVersions(
      outputUrls.length ? outputUrls : [outputUrl],
      block.outputUrls || []
    ),
    videoTaskStatus: "succeeded",
    status: block.outputUrl ? "done" : "idle",
    error: undefined,
  };
}

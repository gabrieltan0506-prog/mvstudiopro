import { describe, expect, it } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import {
  finishEditedMusicMvShot,
  rejectedMusicSubmissionPatch,
  shouldSyncMusicUploadedReferences,
} from "./canvasMusicMvGuards";
import type { CanvasMusicMvState } from "@shared/canvasMusicMv";

describe("MV 三个恢复断点", () => {
  it("明确拒绝释放当前编号，网络未知及其他任务回包保留原编号", () => {
    const state: CanvasMusicMvState = {
      status: "music_running",
      candidates: [],
      musicRequestId: "request-1",
      musicJobId: "bgm-one",
      musicJobStatus: "queued",
    };
    for (const code of [
      "BAD_REQUEST",
      "PRECONDITION_FAILED",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "PAYMENT_REQUIRED",
    ]) {
      const next: CanvasMusicMvState = {
        ...state,
        ...rejectedMusicSubmissionPatch(state, "request-1", { data: { code } }),
      };
      expect(next.musicRequestId).toBeUndefined();
      expect(next.status).toBe("idle");
    }
    expect(
      rejectedMusicSubmissionPatch(state, "request-1", new Error("network"))
    ).toBeNull();
    expect(
      rejectedMusicSubmissionPatch(state, "request-1", {
        data: { code: "CONFLICT" },
      })
    ).toBeNull();
    expect(
      rejectedMusicSubmissionPatch(state, "request-other", {
        data: { code: "BAD_REQUEST" },
      })
    ).toBeNull();
  });
  it("云恢复空上传列表保留参考，移除末张与显式清空则同步", () => {
    expect(shouldSyncMusicUploadedReferences(null, 0)).toBe(false);
    expect(shouldSyncMusicUploadedReferences(0, 0)).toBe(false);
    expect(shouldSyncMusicUploadedReferences(0, 1)).toBe(true);
    expect(shouldSyncMusicUploadedReferences(1, 0)).toBe(true);
  });
  it("改稿后成功回包解除running，不覆盖新稿、所选结果，并保存任务对应历史", () => {
    const block = {
      ...defaultCanvasBlock("video", 0, 0),
      prompt: "用户已改的新稿",
      status: "running" as const,
      videoTaskId: "cv_old",
      musicMvShot: {
        planRequestId: "11111111-1111-4111-8111-111111111111",
        audioId: "song",
        shotId: "s1",
        startSec: 0,
        endSec: 5,
        referenceImages: [],
      },
    };
    const next: ReturnType<typeof defaultCanvasBlock> = {
      ...block,
      ...finishEditedMusicMvShot(block, "https://test.invalid/old.mp4"),
    };
    expect(next.status).toBe("idle");
    expect(next.videoTaskStatus).toBe("succeeded");
    expect(next.prompt).toBe(block.prompt);
    expect(next.outputUrl).toBeUndefined();
    expect(next.musicMvShot?.outputs).toEqual([
      { taskId: "cv_old", url: "https://test.invalid/old.mp4" },
    ]);
    const selected = {
      ...block,
      outputUrl: "https://test.invalid/selected.mp4",
    };
    const retained = {
      ...selected,
      ...finishEditedMusicMvShot(selected, "https://test.invalid/old.mp4"),
    };
    expect(retained.status).toBe("done");
    expect(retained.outputUrl).toBe(selected.outputUrl);
  });
});

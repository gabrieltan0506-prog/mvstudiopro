import { describe, expect, it } from "vitest";
import type { CanvasBlock } from "@/lib/canvasTypes";
import {
  emptyManhuaClipQualityChecks,
  type ManhuaClipQualityReport,
} from "@shared/manhuaClipQuality";
import {
  captureCanvasVideoTaskResumeSnapshot,
  retainCanvasVideoTaskResumeSnapshots,
  resolveCanvasVideoTaskResume,
  type CanvasVideoTaskStatusResponse,
} from "./canvasVideoTaskResume";

const NOW = "2026-09-05T12:00:00.000Z";

function quality(
  status: ManhuaClipQualityReport["status"] = "passed"
): ManhuaClipQualityReport {
  return {
    status,
    checks: emptyManhuaClipQualityChecks(),
    failedKeys: [],
    summary: "旧片已通过",
    raw: "旧报告",
    attempts: 1,
    reviewedAt: "2026-09-05T10:00:00.000Z",
    userAcceptedDespiteQc: true,
  };
}

function block(patch: Partial<CanvasBlock> = {}): CanvasBlock {
  return {
    id: "clip-e01-g01",
    kind: "video",
    x: 0,
    y: 0,
    width: 420,
    height: 360,
    prompt: "原始第一镜",
    textModel: "kimi-k3",
    imageModel: "gpt-image-2",
    videoModel: "wan-3.0",
    aspectRatio: "9:16",
    imageMode: "generate",
    imageBatchCount: 1,
    uploadedAssets: [],
    outputUrls: [],
    status: "running",
    episodeIndex: 1,
    videoTaskId: "task-old",
    videoTaskEngine: "wan-wavespeed",
    videoTaskStatus: "running",
    ...patch,
  };
}

function applyResponse(
  current: CanvasBlock,
  original: CanvasBlock,
  response: CanvasVideoTaskStatusResponse
): CanvasBlock | null {
  const snapshot = captureCanvasVideoTaskResumeSnapshot(original);
  if (!snapshot) throw new Error("测试任务必须有 taskId");
  const resolution = resolveCanvasVideoTaskResume(
    current,
    snapshot,
    response,
    NOW
  );
  return resolution ? { ...current, ...resolution.patch } : null;
}

describe("canvasVideoTaskResume", () => {
  it("其他任务结束触发轮询重建时，不给同ID换稿后的旧任务重新盖章", () => {
    const original = block();
    const other = block({ id: "clip-e02-g01", videoTaskId: "task-other" });
    const first = retainCanvasVideoTaskResumeSnapshots(new Map(), [
      original,
      other,
    ]);
    const changed = { ...original, prompt: "用户已改新稿" };
    const next = retainCanvasVideoTaskResumeSnapshots(first, [changed]);
    const snapshot = Array.from(next.values())[0];
    expect(next.size).toBe(1);
    expect(snapshot).toBe(
      first.get(JSON.stringify([original.id, original.videoTaskId]))
    );
    expect(
      resolveCanvasVideoTaskResume(
        changed,
        snapshot,
        {
          transportOk: true,
          status: "succeeded",
          videoUrl: "https://media.example/old-result.mp4",
        },
        NOW
      )
    ).toBeNull();
    const rerun = { ...changed, videoTaskId: "task-new" };
    const restarted = Array.from(
      retainCanvasVideoTaskResumeSnapshots(next, [rerun]).values()
    )[0];
    expect(restarted.taskId).toBe("task-new");
    expect(
      resolveCanvasVideoTaskResume(
        rerun,
        restarted,
        {
          transportOk: true,
          status: "succeeded",
          videoUrl: "https://media.example/new-result.mp4",
        },
        NOW
      )?.patch.outputUrl
    ).toBe("https://media.example/new-result.mp4");
  });
  it("新成功片成为当前版，合并旧当前版与完整历史，并明确标记未质检", () => {
    const original = block({
      outputUrl: "https://media.example/old-current.mp4",
      outputUrls: [
        "https://media.example/old-current.mp4",
        "https://media.example/older.mp4",
      ],
      manhuaClipQuality: quality(),
      lastFrameUrl: "https://media.example/old-last-frame.jpg",
    });
    const next = applyResponse(original, original, {
      transportOk: true,
      payloadOk: true,
      status: "succeeded",
      videoUrl: "https://media.example/new.mp4",
    });

    expect(next).toMatchObject({
      outputUrl: "https://media.example/new.mp4",
      outputUrls: [
        "https://media.example/new.mp4",
        "https://media.example/old-current.mp4",
        "https://media.example/older.mp4",
      ],
      videoTaskStatus: "succeeded",
      status: "done",
      manhuaClipQuality: {
        status: "unverified",
        summary: "后台成片已恢复，需重新质检后才能进入成片坞",
        reviewedAt: NOW,
        userAcceptedDespiteQc: false,
      },
      lastFrameUrl: undefined,
    });
  });

  it("同任务同 URL 重复回包保留刚完成的新质检，不会再次清空", () => {
    const original = block({ outputUrl: "https://media.example/old.mp4" });
    const current = block({
      outputUrl: "https://media.example/new.mp4",
      outputUrls: [
        "https://media.example/new.mp4",
        "https://media.example/old.mp4",
      ],
      videoTaskStatus: "succeeded",
      status: "done",
      manhuaClipQuality: quality(),
      lastFrameUrl: "https://media.example/new-last-frame.jpg",
    });
    const next = applyResponse(current, original, {
      transportOk: true,
      status: "succeeded",
      videoUrl: "https://media.example/new.mp4",
    });

    expect(next?.manhuaClipQuality).toEqual(current.manhuaClipQuality);
    expect(next?.lastFrameUrl).toBe(current.lastFrameUrl);
    expect(next?.outputUrls).toEqual([
      "https://media.example/new.mp4",
      "https://media.example/old.mp4",
    ]);
  });

  it("已成功任务不接受晚到 running/failed 降级，也不接受同 taskId 第二个结果 URL", () => {
    const original = block({ outputUrl: "https://media.example/old.mp4" });
    const current = block({
      outputUrl: "https://media.example/new.mp4",
      outputUrls: [
        "https://media.example/new.mp4",
        "https://media.example/old.mp4",
      ],
      videoTaskStatus: "succeeded",
      status: "done",
      manhuaClipQuality: quality("unverified"),
    });

    expect(
      applyResponse(current, original, { transportOk: true, status: "running" })
    ).toBeNull();
    expect(
      applyResponse(current, original, {
        transportOk: true,
        status: "failed",
        error: "迟到失败",
      })
    ).toBeNull();
    expect(
      applyResponse(current, original, {
        transportOk: true,
        status: "succeeded",
        videoUrl: "https://media.example/unexpected-second.mp4",
      })
    ).toBeNull();
  });

  it("签名续期或本机 blob 展示 URL 变化不伪装成换稿", () => {
    const original = block({
      refImageUrl:
        "https://storage.googleapis.com/test/keyart.jpg?X-Goog-Signature=old",
      refVideoUrl:
        "https://storage.googleapis.com/test/source.mp4?X-Goog-Signature=old",
    });
    const current = {
      ...original,
      refImageUrl: "blob:https://app.example/keyart-cache",
      refVideoUrl:
        "https://storage.googleapis.com/test/source.mp4?X-Goog-Signature=renewed",
    };
    const next = applyResponse(current, original, {
      transportOk: true,
      status: "succeeded",
      videoUrl: "https://media.example/result.mp4",
    });

    expect(next?.outputUrl).toBe("https://media.example/result.mp4");
  });

  it("用户在等待时切回旧版本，晚到新片只进入历史，不抢当前选择或旧片质检", () => {
    const original = block({
      outputUrl: "https://media.example/version-a.mp4",
      outputUrls: [
        "https://media.example/version-a.mp4",
        "https://media.example/version-b.mp4",
      ],
    });
    const current = {
      ...original,
      outputUrl: "https://media.example/version-b.mp4",
      manhuaClipQuality: quality(),
    };
    const next = applyResponse(current, original, {
      transportOk: true,
      status: "succeeded",
      videoUrl: "https://media.example/version-c.mp4",
    });

    expect(next?.outputUrl).toBe("https://media.example/version-b.mp4");
    expect(next?.outputUrls).toEqual([
      "https://media.example/version-b.mp4",
      "https://media.example/version-c.mp4",
      "https://media.example/version-a.mp4",
    ]);
    expect(next?.manhuaClipQuality).toEqual(current.manhuaClipQuality);
  });

  it("旧 taskId 晚回、同 ID 换稿、归档身份变化都拒绝写入", () => {
    const original = block();
    const success: CanvasVideoTaskStatusResponse = {
      transportOk: true,
      status: "succeeded",
      videoUrl: "https://media.example/late.mp4",
    };

    expect(
      applyResponse(block({ videoTaskId: "task-new" }), original, success)
    ).toBeNull();
    expect(
      applyResponse(
        block({ prompt: "同 ID 已换成第二版剧本" }),
        original,
        success
      )
    ).toBeNull();
    expect(
      applyResponse(
        block({ archivedFromPreviousScript: true }),
        original,
        success
      )
    ).toBeNull();
  });

  it("HTTP 失败、业务失败或 succeeded 空结果均保持未决，不得写 done", () => {
    const original = block({
      outputUrl: "https://media.example/original.mp4",
      outputUrls: ["https://media.example/original.mp4"],
    });

    expect(
      applyResponse(original, original, {
        transportOk: false,
        status: "succeeded",
        videoUrl: "https://media.example/untrusted.mp4",
      })
    ).toBeNull();
    expect(
      applyResponse(original, original, {
        transportOk: true,
        payloadOk: false,
        status: "succeeded",
        videoUrl: "https://media.example/untrusted.mp4",
      })
    ).toBeNull();
    expect(
      applyResponse(original, original, {
        transportOk: true,
        status: "succeeded",
        videoUrl: " ",
      })
    ).toBeNull();
  });

  it("失败只更新任务状态与错误，原片、历史版本和质检均保留", () => {
    const original = block({
      outputUrl: "https://media.example/original.mp4",
      outputUrls: [
        "https://media.example/original.mp4",
        "https://media.example/v0.mp4",
      ],
      manhuaClipQuality: quality(),
    });
    const next = applyResponse(original, original, {
      transportOk: true,
      status: "failed",
      error: "上游生成失败",
    });

    expect(next).toMatchObject({
      videoTaskStatus: "failed",
      status: "error",
      error: "上游生成失败",
      outputUrl: original.outputUrl,
      outputUrls: original.outputUrls,
      manhuaClipQuality: original.manhuaClipQuality,
    });
  });

  it("对账等待态继续轮询且不触碰原片", () => {
    const original = block({
      outputUrl: "https://media.example/original.mp4",
      outputUrls: ["https://media.example/original.mp4"],
    });
    const next = applyResponse(original, original, {
      transportOk: true,
      status: "timed_out_pending_reconcile",
    });

    expect(next).toMatchObject({
      videoTaskStatus: "timed_out_pending_reconcile",
      status: "running",
      outputUrl: original.outputUrl,
      outputUrls: original.outputUrls,
    });
  });
});

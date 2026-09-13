import { describe, expect, it } from "vitest";
import { defaultCanvasBlock, type CanvasBlock } from "@/lib/canvasTypes";
import { buildLocalCloudDraftSnapshot, cloudDraftBlocksToCanvas, serializeCloudDraftForUpload } from "./manhuaCloudDraftSync";
import { parseManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import {
  emptyManhuaClipQualityChecks,
  type ManhuaClipQualityReport,
} from "@shared/manhuaClipQuality";
import {
  canvasVideoTaskInputFingerprint,
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


describe("MV 在途改稿后刷新恢复", () => {
  function pendingMv(): CanvasBlock {
    const submitted: CanvasBlock = { ...defaultCanvasBlock("video", 0, 0), id: "mvshot-persisted", prompt: "原镜头动作", status: "running",
      videoTaskId: "original-task", videoTaskEngine: "seedance-2.0-mini", videoTaskStatus: "running",
      musicMvShot: { planRequestId: "00000000-0000-4000-8000-000000000001", audioId: "song", shotId: "shot-1", startSec: 0, endSec: 6, referenceImages: [] } };
    submitted.musicMvShot = { ...submitted.musicMvShot!, activeTask: { taskId: "original-task", inputFingerprint: canvasVideoTaskInputFingerprint(submitted) } };
    return submitted;
  }
  function roundtrip(source: CanvasBlock): CanvasBlock {
    const cloud = buildLocalCloudDraftSnapshot({ writerSession: {}, blocks: [source], edges: [] });
    return cloudDraftBlocksToCanvas(parseManhuaCloudDraftPayload(serializeCloudDraftForUpload(cloud))!.canvas.blocks)[0];
  }
  it("改稿→云往返→旧成功仅存历史，原任务收终态但不冒充新稿", () => {
    const submitted = pendingMv();
    const restored = roundtrip({ ...submitted, prompt: "完全不同的新动作" });
    const snapshot = captureCanvasVideoTaskResumeSnapshot(restored)!;
    expect(snapshot.inputFingerprint).toBe(submitted.musicMvShot!.activeTask!.inputFingerprint);
    expect(snapshot.inputFingerprint).not.toBe(canvasVideoTaskInputFingerprint(restored));
    const result = resolveCanvasVideoTaskResume(restored, snapshot, { transportOk: true, payloadOk: true, status: "succeeded", videoUrl: "https://test.invalid/old-task-result.mp4" }, NOW)!;
    const resolved = { ...restored, ...result.patch };
    expect(result.selectedNewOutput).toBe(false);
    expect(resolved.prompt).toBe("完全不同的新动作");
    expect(resolved.outputUrl).toBeUndefined();
    expect(resolved.outputUrls).toContain("https://test.invalid/old-task-result.mp4");
    expect(resolved.musicMvShot?.outputs).toContainEqual({ taskId: "original-task", url: "https://test.invalid/old-task-result.mp4" });
    expect(resolved.videoTaskStatus).toBe("succeeded");
    expect(resolved.status).not.toBe("running");
  });
  it("未改稿跨刷新仍正常选择完成结果，输出登记不改变输入指纹", () => {
    const restored = roundtrip(pendingMv());
    const snapshot = captureCanvasVideoTaskResumeSnapshot(restored)!;
    expect(canvasVideoTaskInputFingerprint(restored)).toBe(snapshot.inputFingerprint);
    const result = resolveCanvasVideoTaskResume(restored, snapshot, { transportOk: true, payloadOk: true, status: "succeeded", videoUrl: "https://test.invalid/result.mp4" }, NOW)!;
    expect(result.selectedNewOutput).toBe(true);
    expect(result.patch.outputUrl).toBe("https://test.invalid/result.mp4");
    expect(result.patch.status).toBe("done");
    expect(canvasVideoTaskInputFingerprint({ ...restored, ...result.patch })).toBe(snapshot.inputFingerprint);
  });
  it("改稿后旧任务失败或对账终态也结束轮询，保留新稿与旧输出", () => {
    for (const status of ["failed", "reconcile_manual"]) {
      const restored = roundtrip({ ...pendingMv(), prompt: "新版", outputUrl: "https://test.invalid/accepted.mp4", outputUrls: ["https://test.invalid/accepted.mp4"] });
      const snapshot = captureCanvasVideoTaskResumeSnapshot(restored)!;
      const result = resolveCanvasVideoTaskResume(restored, snapshot, { transportOk: true, payloadOk: true, status, error: "原任务失败" }, NOW)!;
      const resolved = { ...restored, ...result.patch };
      expect(resolved.videoTaskStatus).toBe(status);
      expect(resolved.status).toBe("error");
      expect(resolved.prompt).toBe("新版");
      expect(resolved.outputUrl).toBe("https://test.invalid/accepted.mp4");
    }
  });
  it("任务号先到、持久指纹后到时升级恢复身份，不沿用未知内存推断", () => {
    const submitted = pendingMv();
    const early = { ...submitted, musicMvShot: { ...submitted.musicMvShot!, activeTask: undefined } };
    const initial = retainCanvasVideoTaskResumeSnapshots(new Map(), [early]);
    const upgraded = retainCanvasVideoTaskResumeSnapshots(initial, [{ ...submitted, prompt: "已改稿" }]);
    const snapshot = Array.from(upgraded.values())[0];
    expect(snapshot.inputFingerprint).toBe(submitted.musicMvShot!.activeTask!.inputFingerprint);
    expect(snapshot.selectedOutputUrl).toBe("");
  });
  it("缺少持久提交指纹的旧MV任务只恢复历史，不默认认领当前稿", () => {
    const source = pendingMv(); source.musicMvShot = { ...source.musicMvShot!, activeTask: undefined };
    const snapshot = captureCanvasVideoTaskResumeSnapshot(source)!;
    const result = resolveCanvasVideoTaskResume(source, snapshot, { transportOk: true, payloadOk: true, status: "succeeded", videoUrl: "https://test.invalid/unknown-original.mp4" }, NOW)!;
    expect(result.selectedNewOutput).toBe(false);
    expect(result.patch.outputUrl).toBeUndefined();
    expect(result.patch.videoTaskStatus).toBe("succeeded");
  });
});

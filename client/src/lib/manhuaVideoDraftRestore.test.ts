import { describe, expect, it, vi } from "vitest";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";
import {
  blocksForCloudDraftSync,
  buildLocalCloudDraftSnapshot,
  cloudDraftBlocksToCanvas,
  mergeHydratedCanvasBlocks,
  serializeCloudDraftForUpload,
  slimBlocksForLocalPersist,
  tryLoadLocalCanvas,
  trySaveLocalCanvas,
  persistManhuaDraftLocally,
  MANHUA_CLOUD_DRAFT_LOCAL_AT_KEY,
} from "./manhuaCloudDraftSync";
import { parseManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import { MANHUA_WRITER_SESSION_LS_KEY } from "@shared/manhuaWriterSession";
import {
  emptyManhuaClipQualityChecks,
  manhuaClipQualityAllowsAssemble,
} from "@shared/manhuaClipQuality";
import { refreshManhuaDraftSignedUrls } from "../../../server/services/manhuaDraftUrlRefresh";
import {
  collectManhuaClipDockItems,
  manhuaClipDockItemAllowsAssemble,
} from "./manhuaProjectExport";

const original = "https://cdn.example/original.mp4";
const edited = "https://cdn.example/edited.mp4";
function clip(patch: Partial<CanvasBlock> = {}): CanvasBlock {
  return {
    ...defaultCanvasBlock("video", 0, 0),
    id: "clip-e01-g01-a",
    episodeIndex: 1,
    videoModel: "seedance-2.5",
    status: "error",
    outputUrl: original,
    outputUrls: [
      original,
      ...Array.from(
        { length: 12 },
        (_, i) => `https://cdn.example/old-${i}.mp4`
      ),
    ],
    seedance25WorkMode: "video_edit",
    refVideoUrl: original,
    seedance25RefVideoUrls: [original],
    seedance25TimestampStoryboard: "0-10 | 保留橙红旧眼罩",
    videoTaskId: "test-edit-task",
    videoTaskEngine: "seedance",
    videoTaskStatus: "failed",
    error: "编辑失败，原片仍保留",
    lastFrameUrl: "https://cdn.example/last.png",
    manhuaClipQuality: {
      status: "failed",
      checks: emptyManhuaClipQualityChecks(),
      failedKeys: ["CHARACTER_MATCH"],
      summary: "人物不符",
      raw: "完整质检原文",
      attempts: 1,
      reviewedAt: "2026-09-05T00:00:00Z",
    },
    ...patch,
  };
}
function roundTrip(blocks: CanvasBlock[]) {
  const snapshot = buildLocalCloudDraftSnapshot({
    writerSession: {},
    blocks,
    edges: [],
  });
  const json = serializeCloudDraftForUpload(snapshot)!;
  return cloudDraftBlocksToCanvas(
    parseManhuaCloudDraftPayload(json)!.canvas.blocks
  );
}

describe("片段视频真实保存/解析/恢复链（无上游调用）", () => {
  it.each([
    [MANHUA_WRITER_SESSION_LS_KEY, "writerOk"],
    ["mv-manhua-factory-character-prefs-v1", "prefsOk"],
  ] as const)("%s 写入失败也不能推进草稿修订时间", (failedKey, resultKey) => {
    const previousAt = "2026-09-04T00:00:00Z";
    const saved = new Map<string, string>([
      [failedKey, "old-record"],
      [MANHUA_CLOUD_DRAFT_LOCAL_AT_KEY, previousAt],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === failedKey) throw new Error("QuotaExceededError");
        saved.set(key, value);
      },
    });
    try {
      const result = persistManhuaDraftLocally({
        writerSession: {},
        blocks: [clip()],
        edges: [],
        factoryPrefs: {},
        clientUpdatedAt: "2026-09-05T00:00:00Z",
      });
      expect(result[resultKey]).toBe(false);
      expect(result.canvasOk).toBe(true);
      expect(result.atOk).toBe(false);
      expect(saved.get(failedKey)).toBe("old-record");
      expect(saved.get(MANHUA_CLOUD_DRAFT_LOCAL_AT_KEY)).toBe(previousAt);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("画布写失败不推进整份草稿修订时间，旧媒体记录不变", () => {
    const saved = new Map<string, string>([
      ["mv-freeform-canvas-v1", "old-video-record"],
      [MANHUA_CLOUD_DRAFT_LOCAL_AT_KEY, "2026-09-04T00:00:00Z"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === "mv-freeform-canvas-v1")
          throw new Error("QuotaExceededError");
        saved.set(key, value);
      },
    });
    try {
      const result = persistManhuaDraftLocally({
        writerSession: {},
        blocks: [clip()],
        edges: [],
        clientUpdatedAt: "2026-09-05T00:00:00Z",
      });
      expect(result.canvasOk).toBe(false);
      expect(result.atOk).toBe(false);
      expect(saved.get("mv-freeform-canvas-v1")).toBe("old-video-record");
      expect(saved.get(MANHUA_CLOUD_DRAFT_LOCAL_AT_KEY)).toBe(
        "2026-09-04T00:00:00Z"
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("媒体缓存晚回只替换未改节点，同ID的新版本/删除/换剧都不会覆盖", () => {
    const old = clip();
    const image = {
      ...defaultCanvasBlock("image", 0, 0),
      id: "keyart-e01-a",
      outputUrl: "https://cdn.example/key.jpg",
    };
    const after = { ...image, outputUrl: "blob:test-cache" };
    const newClip = { ...old, outputUrl: edited };
    const snapshot = [old, image];
    const result = mergeHydratedCanvasBlocks([newClip, image], snapshot, [
      old,
      after,
    ]);
    expect(result[0]).toBe(newClip);
    expect(result[1]).toBe(after);
    expect(mergeHydratedCanvasBlocks([], snapshot, [old, after])).toEqual([]);
    const otherProject = [{ ...old }, { ...image }];
    expect(
      mergeHydratedCanvasBlocks(otherProject, snapshot, [old, after])
    ).toBe(otherProject);
  });
  it("本机刷新保留原片、全部13个历史地址和失败编辑状态，不冒充成功", () => {
    const source = clip();
    let stored = "";
    expect(
      trySaveLocalCanvas([source], [], {
        setItem(_k, v) {
          stored = v;
        },
      })
    ).toBe(true);
    const result = tryLoadLocalCanvas({
      getItem() {
        return stored;
      },
    })!.blocks[0];
    expect(result.outputUrl).toBe(original);
    expect(result.outputUrls).toEqual(source.outputUrls);
    expect(result.status).toBe("error");
    expect(result.refVideoUrl).toBe(original);
    expect(result.seedance25WorkMode).toBe("video_edit");
    expect(result.videoTaskId).toBe("test-edit-task");
  });

  it("云端保存三次清洗后保留质检、编辑状态、末帧，不因丢报告而放行", () => {
    const source = clip();
    const [result] = roundTrip(roundTrip([source]));
    expect(result.outputUrl).toBe(original);
    expect(result.outputUrls).toEqual(source.outputUrls);
    expect(result.status).toBe("error");
    expect(result.seedance25WorkMode).toBe("video_edit");
    expect(result.refVideoUrl).toBe(original);
    expect(result.seedance25RefVideoUrls).toEqual([original]);
    expect(result.seedance25TimestampStoryboard).toBe(
      source.seedance25TimestampStoryboard
    );
    expect(result.lastFrameUrl).toBe(source.lastFrameUrl);
    expect(result.manhuaClipQuality).toEqual(source.manhuaClipQuality);
    expect(
      manhuaClipQualityAllowsAssemble({
        outputUrl: result.outputUrl,
        quality: result.manhuaClipQuality,
      })
    ).toBe(false);
  });

  it("残缺或自相矛盾的QC不会清成undefined后放行，完整原文不截断", () => {
    const source = clip();
    for (const broken of [
      { status: "failed", raw: "保留" },
      { ...source.manhuaClipQuality, status: "passed" },
    ]) {
      const [restored] = roundTrip([
        clip({ manhuaClipQuality: broken as CanvasBlock["manhuaClipQuality"] }),
      ]);
      expect(restored.manhuaClipQuality?.status).toBe("unverified");
      expect(
        manhuaClipQualityAllowsAssemble({
          outputUrl: restored.outputUrl,
          quality: restored.manhuaClipQuality,
        })
      ).toBe(false);
    }
    const raw = "完整原文".repeat(10000);
    const [restored] = roundTrip([
      clip({
        videoResolution: "1080p",
        manhuaRetake: { variable: "lighting", attempt: 3, maxAttempts: 3 },
        manhuaClipQuality: { ...source.manhuaClipQuality!, raw },
      }),
    ]);
    expect(restored.manhuaClipQuality?.raw).toBe(raw);
    expect(restored.manhuaRetake?.attempt).toBe(3);
    expect(restored.videoResolution).toBe("1080p");
  });

  it("归档原片和整集历史身份不丢，恢复后仍是归档而非新稿输入", () => {
    const source = clip({
      id: "final-e01-archived",
      archivedFromPreviousScript: true,
      manhuaFinalVersions: [
        {
          origin: "burn_subtitle",
          url: original,
          jobId: "test-subtitle",
          gcsUri: "gs://test-bucket/post-prod/u1/a.mp4",
          createdAt: 12,
        },
      ],
    });
    const [result] = roundTrip([source]);
    expect(result.archivedFromPreviousScript).toBe(true);
    expect(result.manhuaFinalVersions).toEqual(source.manhuaFinalVersions);
    expect(result.outputUrls).toEqual(source.outputUrls);
  });

  it("实际成片坞读取恢复的当前版，历史/归档/失败编辑不冒充可合成片", () => {
    const checks = emptyManhuaClipQualityChecks();
    for (const key of Object.keys(checks) as (keyof typeof checks)[])
      checks[key] = true;
    const source = clip({
      status: "done",
      outputUrl: edited,
      manhuaClipQuality: {
        ...clip().manhuaClipQuality!,
        status: "passed",
        checks,
        failedKeys: [],
      },
    });
    const items = collectManhuaClipDockItems(roundTrip([source]));
    expect(items).toHaveLength(1);
    expect(items[0].outputUrl).toBe(edited);
    expect(manhuaClipDockItemAllowsAssemble(items[0])).toBe(true);
    expect(collectManhuaClipDockItems(roundTrip([clip()]))).toEqual([]);
    expect(
      collectManhuaClipDockItems(
        roundTrip([clip({ status: "done", archivedFromPreviousScript: true })])
      )
    ).toEqual([]);
    expect(
      collectManhuaClipDockItems(
        roundTrip([clip({ status: "error", outputUrl: undefined })])
      )
    ).toEqual([]);
    const failed = collectManhuaClipDockItems(
      roundTrip([clip({ status: "done" })])
    );
    expect(failed[0].outputUrl).toBe(original);
    expect(manhuaClipDockItemAllowsAssemble(failed[0])).toBe(false);
  });

  it("容量降级仍保留片段全部地址，存不下返回false且不覆盖旧记录", () => {
    const source = clip();
    let attempt = 0;
    let stored = "old";
    expect(
      trySaveLocalCanvas([source], [], {
        setItem(_k, v) {
          if (++attempt === 1) throw new Error("QuotaExceededError");
          stored = v;
        },
      })
    ).toBe(true);
    expect(JSON.parse(stored).blocks[0].outputUrls).toEqual(source.outputUrls);
    const previous = stored;
    expect(
      trySaveLocalCanvas([clip({ outputUrl: edited })], [], {
        setItem() {
          throw new Error("QuotaExceededError");
        },
      })
    ).toBe(false);
    expect(stored).toBe(previous);
  });

  it("本桶已有签名视频经服务端续签后，当前/历史/编辑源保持同一新地址", () => {
    const old =
      "https://storage.googleapis.com/test-bucket/video/u1/clip.mp4?X-Goog-Signature=test-expired";
    const source = clip({
      outputUrl: old,
      outputUrls: [old],
      refVideoUrl: old,
      seedance25RefVideoUrls: [old],
    });
    const payload = buildLocalCloudDraftSnapshot({
      writerSession: {},
      blocks: [source],
      edges: [],
    });
    const refreshed = refreshManhuaDraftSignedUrls(payload, {
      bucketName: "test-bucket",
      sign: () => edited,
    });
    const [result] = cloudDraftBlocksToCanvas(
      parseManhuaCloudDraftPayload(JSON.stringify(refreshed.payload))!.canvas
        .blocks
    );
    expect(result.outputUrl).toBe(edited);
    expect(result.outputUrls).toEqual([edited]);
    expect(result.refVideoUrl).toBe(edited);
    expect(result.seedance25RefVideoUrls).toEqual([edited]);
    expect(result.videoTaskId).toBe(source.videoTaskId);
  });

  it("无源blob/data不会伪装为恢复成功，也不会拿旧历史冒充当前选片", () => {
    const source = clip({
      status: "done",
      outputUrl: "blob:test-new",
      outputUrls: ["blob:test-new", original, "data:video/mp4;base64,AA=="],
    });
    const [local] = slimBlocksForLocalPersist([source]);
    expect(local.outputUrl).toBeUndefined();
    expect(local.outputUrls).toEqual([original]);
    expect(local.status).not.toBe("done");
    const [cloud] = roundTrip([source]);
    expect(cloud.outputUrl).toBeUndefined();
    expect(cloud.outputUrls).toEqual([original]);
    expect(cloud.status).not.toBe("done");
    expect(JSON.stringify(blocksForCloudDraftSync([source]))).not.toContain(
      "blob:test-new"
    );
  });

  it("401个带视频的节点不静默截到400，超大快照整体拒绝而非吞版本", () => {
    const nodes = Array.from({ length: 401 }, (_, i) =>
      clip({ id: `clip-e01-g${i}-a`, outputUrls: [original] })
    );
    expect(roundTrip(nodes)).toHaveLength(401);
    const payload = buildLocalCloudDraftSnapshot({
      writerSession: {},
      blocks: [clip({ outputUrls: [original.repeat(150000)] })],
      edges: [],
    });
    expect(serializeCloudDraftForUpload(payload)).toBeNull();
  });
});

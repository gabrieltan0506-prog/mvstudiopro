import { describe, expect, it } from "vitest";
import {
  buildLocalCloudDraftSnapshot,
  chooseManhuaDraftHydrate,
  cloudDraftBlocksToCanvas,
  serializeCloudDraftForUpload,
  slimBlocksForLocalPersist,
  trySaveLocalCanvas,
  uploadManhuaCloudDraftViaGcsDirect,
} from "./manhuaCloudDraftSync";
import { buildManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import { buildManhuaWriterSession } from "@shared/manhuaWriterSession";
import { MANHUA_FACTORY_DEFAULT_VIDEO_MODEL } from "@shared/manhuaScriptWorkbench";
import { defaultCanvasBlock, type CanvasBlock } from "@/lib/canvasTypes";
import { stripManhuaFactoryCanvasArtifacts } from "./canvasDramaStudio";

describe("manhuaCloudDraftSync dual-path", () => {
  it("换剧归档的整集引用经本机、配额降级和云同步仍保留", () => {
    const source = {
      ...defaultCanvasBlock("video", 0, 0), id: "final-e01",
      outputUrl: "https://cdn.example/final-current.mp4",
      outputUrls: ["https://cdn.example/final-current.mp4", "https://cdn.example/final-original.mp4"],
    };
    const archived = stripManhuaFactoryCanvasArtifacts([source], []).blocks;
    expect(archived[0]?.id).toBe("final-e01-archived");
    expect(slimBlocksForLocalPersist(archived)[0]?.outputUrls).toEqual(source.outputUrls);
    let firstAttempt = true;
    let saved = "";
    expect(trySaveLocalCanvas(archived, [], { setItem(_key, value) {
      if (firstAttempt) { firstAttempt = false; throw new Error("QuotaExceededError"); }
      saved = value;
    } })).toBe(true);
    expect(JSON.parse(saved).blocks[0].outputUrls).toEqual(source.outputUrls);
    const cloud = buildManhuaCloudDraftPayload({ clientUpdatedAt: "2026-09-05T00:00:00Z", writerSession: {}, blocks: archived, edges: [] });
    expect(cloud.canvas.blocks[0]?.outputUrl).toBe(source.outputUrl);
    expect(cloud.canvas.blocks[0]?.archivedFromPreviousScript).toBe(true);
  });

  it("prefers cloud when timestamps equal or newer", () => {
    const cloud = buildManhuaCloudDraftPayload({
      clientUpdatedAt: "2026-07-20T10:00:00.000Z",
      writerSession: { topic: "云端题材", writerPack: null },
      blocks: [],
      edges: [],
    });
    const choice = chooseManhuaDraftHydrate({
      cloud,
      localWriter: buildManhuaWriterSession({ topic: "本机题材" }),
      localCanvas: { blocks: [], edges: [] },
      localPrefs: {},
      localClientUpdatedAt: "2026-07-20T10:00:00.000Z",
    });
    expect(choice.source).toBe("cloud");
    if (choice.source === "cloud") expect(choice.draft.writerSession.topic).toBe("云端题材");
  });

  it("uses local when cloud missing (本机权限可用时仍可恢复)", () => {
    const choice = chooseManhuaDraftHydrate({
      cloud: null,
      localWriter: buildManhuaWriterSession({ topic: "仅本机", episodeCount: 3 }),
      localCanvas: { blocks: [], edges: [] },
      localPrefs: { topic: "仅本机" },
      localClientUpdatedAt: "2026-07-20T09:00:00.000Z",
    });
    expect(choice.source).toBe("local");
  });

  it("uses cloud when local unreadable (本机权限未开)", () => {
    const cloud = buildManhuaCloudDraftPayload({
      clientUpdatedAt: "2026-07-20T11:00:00.000Z",
      writerSession: { topic: "只靠云端" },
      blocks: [
        {
          id: "keyart-e01-s01",
          kind: "image",
          x: 0,
          y: 0,
          width: 400,
          height: 360,
          prompt: "静帧",
          outputUrl: "https://cdn.example/k.jpg",
        },
      ],
      edges: [],
    });
    const choice = chooseManhuaDraftHydrate({
      cloud,
      localWriter: null,
      localCanvas: null,
      localPrefs: null,
      localClientUpdatedAt: null,
    });
    expect(choice.source).toBe("cloud");
    if (choice.source === "cloud") {
      const blocks = cloudDraftBlocksToCanvas(choice.draft.canvas.blocks);
      expect(blocks[0]?.outputUrl).toContain("k.jpg");
    }
  });

  it("serializes upload payload within size gate", () => {
    const payload = buildLocalCloudDraftSnapshot({
      writerSession: { topic: "t" },
      blocks: [],
      edges: [],
    });
    expect(serializeCloudDraftForUpload(payload)).toContain("mv-manhua-cloud-draft-v1");
  });

  /**
   * 恢复时若不把节点/会话的引擎带回来，mini 会按 fast 跑（界面印 28 积分/段、实扣 172），
   * 2.5 的段长会从 30s 掉回 15s——两边都是恢复即变价变结构。
   */
  it("restores clip engine from the writer session, not a hardcoded fast", () => {
    const clipBlock = {
      id: "clip-e01-s01",
      kind: "video" as const,
      x: 0,
      y: 0,
      width: 400,
      height: 360,
      prompt: "成片",
    };
    const restoreWith = (videoModel?: string) =>
      cloudDraftBlocksToCanvas(
        buildManhuaCloudDraftPayload({
          clientUpdatedAt: "2026-08-09T00:00:00.000Z",
          writerSession: { topic: "t", videoModel },
          blocks: [clipBlock],
          edges: [],
        }).canvas.blocks,
        { videoModel },
      );

    expect(restoreWith("seedance-2.0-mini")[0]?.videoModel).toBe("seedance-2.0-mini");
    expect(restoreWith("seedance-2.5")[0]?.videoModel).toBe("seedance-2.5");
    expect(restoreWith("minimax-hailuo-3")[0]?.videoModel).toBe("minimax-hailuo-3");
    // 节点和会话都没有引擎 = 默认档改 mini 之前存的旧稿，继续回退 fast 保持原语义，
    // 否则一次恢复就把用户原本的 fast 静默迁成 mini（段表与单段价都会变）
    expect(restoreWith(undefined)[0]?.videoModel).toBe("seedance-2.0-fast");
  });

  it("有任一节点盖过引擎 = 新格式草稿，缺章节点走新默认 mini 而非旧稿 fast", () => {
    const mk = (id: string, videoModel?: string) => ({
      id,
      kind: "video" as const,
      x: 0,
      y: 0,
      width: 400,
      height: 360,
      prompt: "成片",
      ...(videoModel ? { videoModel } : {}),
    });
    const restored = cloudDraftBlocksToCanvas(
      buildManhuaCloudDraftPayload({
        clientUpdatedAt: "2026-08-09T00:00:00.000Z",
        writerSession: { topic: "t" },
        blocks: [mk("clip-e01-s01", "seedance-2.5"), mk("clip-e01-s02")],
        edges: [],
      }).canvas.blocks,
      {},
    );
    expect(restored.find((b) => b.id === "clip-e01-s01")?.videoModel).toBe("seedance-2.5");
    expect(restored.find((b) => b.id === "clip-e01-s02")?.videoModel).toBe(
      MANHUA_FACTORY_DEFAULT_VIDEO_MODEL,
    );
  });

  it("节点自带的引擎优先于会话，旧草稿才靠会话猜", () => {
    const clipBlock = {
      id: "clip-e01-s01",
      kind: "video" as const,
      x: 0,
      y: 0,
      width: 400,
      height: 360,
      prompt: "成片",
      videoModel: "seedance-2.5",
    };
    const payload = buildManhuaCloudDraftPayload({
      clientUpdatedAt: "2026-08-09T00:00:00.000Z",
      writerSession: { topic: "t" },
      blocks: [clipBlock],
      edges: [],
    });
    // 会话没选引擎（自动预选不落盘）也不该把 2.5 节点拽成兜底档
    expect(payload.canvas.blocks[0]?.videoModel).toBe("seedance-2.5");
    expect(cloudDraftBlocksToCanvas(payload.canvas.blocks)[0]?.videoModel).toBe("seedance-2.5");
  });

  it("本机同时保留片段与整集的当前版本和历史", () => {
    const slim = slimBlocksForLocalPersist([
      {
        id: "clip-e01-s01",
        kind: "video",
        x: 0,
        y: 0,
        width: 400,
        height: 360,
        prompt: "成片",
        outputUrl: "https://cdn.example/a.mp4",
        outputUrls: ["https://cdn.example/a.mp4"],
        status: "done",
        textModel: "gpt-5.6-sol",
        imageModel: "gpt-image-2",
        videoModel: "gemini-omni-flash",
        aspectRatio: "9:16",
        imageMode: "generate",
        imageBatchCount: 1,
        uploadedAssets: [],
      } as CanvasBlock,
      {
        id: "keyart-e01-s01",
        kind: "image",
        x: 0,
        y: 0,
        width: 400,
        height: 360,
        prompt: "静帧",
        outputUrl: "https://cdn.example/k.jpg",
        outputUrls: ["https://cdn.example/k.jpg"],
        status: "done",
        textModel: "gpt-5.6-sol",
        imageModel: "gpt-image-2",
        videoModel: "gemini-omni-flash",
        aspectRatio: "9:16",
        imageMode: "generate",
        imageBatchCount: 1,
        uploadedAssets: [],
      } as CanvasBlock,
      {
        id: "final-e01",
        kind: "video",
        x: 0,
        y: 0,
        width: 400,
        height: 360,
        prompt: "整集成片",
        outputUrl: "https://signed.example/burned.mp4",
        outputUrls: [
          "https://signed.example/burned.mp4",
          "https://cdn.example/original.mp4",
        ],
        status: "done",
        textModel: "gpt-5.6-sol",
        imageModel: "gpt-image-2",
        videoModel: "gemini-omni-flash",
        aspectRatio: "9:16",
        imageMode: "generate",
        imageBatchCount: 1,
        uploadedAssets: [],
      } as CanvasBlock,
    ]);
    expect(slim[0]?.outputUrl).toBe("https://cdn.example/a.mp4");
    expect(slim[1]?.outputUrl).toContain("k.jpg");
    expect(slim[2]?.outputUrl).toBe("https://signed.example/burned.mp4");
    expect(slim[2]?.outputUrls).toHaveLength(2);
  });

  it("restores final video and clip trim from a cloud canvas snapshot", () => {
    const restored = cloudDraftBlocksToCanvas([
      {
        id: "final-e01",
        kind: "video",
        x: 0,
        y: 0,
        width: 400,
        height: 360,
        prompt: "整集成片",
        status: "done",
        outputUrl: "https://signed.example/burned.mp4",
        outputUrls: [
          "https://signed.example/burned.mp4",
          "https://cdn.example/original.mp4",
        ],
      },
      {
        id: "clip-e01-s01",
        kind: "video",
        x: 0,
        y: 0,
        width: 400,
        height: 360,
        prompt: "段成片",
        manhuaEditTrim: {
          sourceDurationSec: 15,
          inSec: 0,
          outSec: 12,
          shotPieces: [
            { shotIndex: 1, trimInSec: 0.5, trimOutSec: 4, durationSec: 3.5 },
          ],
        },
      },
    ]);
    expect(restored[0]?.outputUrl).toBe("https://signed.example/burned.mp4");
    expect(restored[1]?.manhuaEditTrim?.sourceDurationSec).toBe(15);
    expect(restored[1]?.manhuaEditTrim?.shotPieces?.[0]?.trimInSec).toBe(0.5);
  });

  it("does not silently discard final video versions when localStorage quota fallback runs", () => {
    const versions = Array.from(
      { length: 12 },
      (_, index) => `https://cdn.example/final-v${index + 1}.mp4`,
    );
    const writes: string[] = [];
    const storage = {
      setItem(_key: string, value: string) {
        if (!writes.length) {
          writes.push("first-attempt");
          throw new Error("QuotaExceededError");
        }
        writes.push(value);
      },
    };
    expect(
      trySaveLocalCanvas(
        [
          {
            ...defaultCanvasBlock("video", 0, 0),
            id: "final-e01",
            kind: "video",
            x: 0,
            y: 0,
            width: 400,
            height: 360,
            prompt: "整集成片",
            outputUrl: versions[0],
            outputUrls: versions,
          },
        ],
        [],
        storage,
      ),
    ).toBe(true);
    const saved = JSON.parse(writes[1] || "{}") as { blocks?: CanvasBlock[] };
    expect(saved.blocks?.[0]?.outputUrls).toHaveLength(12);

    expect(
      trySaveLocalCanvas([], [], {
        setItem() {
          throw new Error("QuotaExceededError");
        },
      }),
    ).toBe(false);
  });

  it("maps empty-JSON fetch errors to a soft direct-upload failure", async () => {
    const payload = buildManhuaCloudDraftPayload({
      clientUpdatedAt: "2026-07-24T00:00:00.000Z",
      writerSession: { topic: "x" },
      blocks: [],
      edges: [],
    });
    const out = await uploadManhuaCloudDraftViaGcsDirect({
      userId: 1,
      payload,
      prepare: async () => {
        throw new Error(
          "Failed to execute 'json' on 'Response': Unexpected end of JSON input",
        );
      },
      commit: async () => ({}),
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/备用通道|响应异常/);
      expect(out.error).not.toMatch(/Unexpected end of JSON/);
    }
  });
});

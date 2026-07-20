import { describe, expect, it } from "vitest";
import {
  buildLocalCloudDraftSnapshot,
  chooseManhuaDraftHydrate,
  cloudDraftBlocksToCanvas,
  serializeCloudDraftForUpload,
  slimBlocksForLocalPersist,
} from "./manhuaCloudDraftSync";
import { buildManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import type { CanvasBlock } from "@/lib/canvasTypes";

describe("manhuaCloudDraftSync dual-path", () => {
  it("prefers cloud when timestamps equal or newer", () => {
    const cloud = buildManhuaCloudDraftPayload({
      clientUpdatedAt: "2026-07-20T10:00:00.000Z",
      writerSession: { topic: "云端题材", writerPack: null },
      blocks: [],
      edges: [],
    });
    const choice = chooseManhuaDraftHydrate({
      cloud,
      localWriter: { format: "mv-manhua-writer-session-v1", topic: "本机题材" } as never,
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
      localWriter: {
        format: "mv-manhua-writer-session-v1",
        topic: "仅本机",
        brief: "",
        episodeCount: 3,
        focusEpisode: 1,
        writerPack: null,
        writerConfirmed: false,
        directorUnlocked: false,
        projectBible: null,
        manhuaUiMode: "workbench",
        assetsSkipped: false,
        workflowPhase: "outline",
      },
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

  it("slims local canvas by dropping video outputs", () => {
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
    ]);
    expect(slim[0]?.outputUrl).toBeUndefined();
    expect(slim[1]?.outputUrl).toContain("k.jpg");
  });
});

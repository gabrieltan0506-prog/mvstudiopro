import { describe, expect, it } from "vitest";
import {
  parseManhuaCloudDraftPayload,
  sanitizeManhuaCloudDraftBlock,
  serializeManhuaCloudDraftPayload,
  type ManhuaCloudDraftPayload,
} from "./manhuaCloudDraft";
import { MANHUA_MEDIA_HISTORY_MAX, capManhuaMediaHistory } from "./manhuaMediaHistoryCap";

/**
 * 复审 P0-1 / P1-3 回归:永久图链与长排队任务字段必须扛过
 * build → serialize → parse 全程,否则云备份/ZIP 悄悄丢生成图、换机丢任务。
 */
describe("manhuaCloudDraft · 稳定图链与任务字段往返", () => {
  const stableUrl = "/api/canvas-media/generated/canvas-gpt-image2/173_ab.png";

  it("图片节点 12 条历史经 sanitize → serialize → parse 全保留（不再截到 8）", () => {
    const urls = Array.from({ length: 12 }, (_, i) => `/api/canvas-media/generated/x/${i}.png`);
    const out = sanitizeManhuaCloudDraftBlock({
      id: "keyart-e01-01",
      kind: "image",
      x: 0, y: 0, width: 420, height: 360,
      prompt: "p",
      outputUrl: urls[0],
      outputUrls: urls,
    });
    expect(out?.outputUrls).toEqual(urls);
    const payload = {
      format: "mv-manhua-cloud-draft-v1",
      clientUpdatedAt: new Date(1).toISOString(),
      writerSession: {},
      canvas: { blocks: [out!], edges: [] },
    } as unknown as ManhuaCloudDraftPayload;
    const parsed = parseManhuaCloudDraftPayload(serializeManhuaCloudDraftPayload(payload));
    expect(parsed?.canvas.blocks[0]?.outputUrls).toHaveLength(12);
  });

  it("历史超过上限时截到常量 30 且保住当前选中图", () => {
    expect(MANHUA_MEDIA_HISTORY_MAX).toBe(30);
    const urls = Array.from({ length: 40 }, (_, i) => `/api/canvas-media/generated/x/${i}.png`);
    const selected = urls[35]!;
    const out = sanitizeManhuaCloudDraftBlock({
      id: "keyart-e01-02",
      kind: "image",
      x: 0, y: 0, width: 420, height: 360,
      prompt: "p",
      outputUrl: selected,
      outputUrls: urls,
    });
    expect(out?.outputUrls).toHaveLength(30);
    expect(out?.outputUrls?.[0]).toBe(urls[0]);
    expect(out?.outputUrls).toContain(selected);
    expect(out?.outputUrl).toBe(selected);
    expect(capManhuaMediaHistory(urls, selected)).toHaveLength(30);
    expect(capManhuaMediaHistory(["a", "a", "b"], "b")).toEqual(["a", "b"]);
  });

  it("sanitize 保留 /api/canvas-media/ 产物与 videoTask 三字段", () => {
    const out = sanitizeManhuaCloudDraftBlock({
      id: "keyart-e01-01",
      kind: "image",
      x: 0, y: 0, width: 420, height: 360,
      prompt: "p",
      outputUrl: stableUrl,
      outputUrls: [stableUrl],
      editMaskUrl: stableUrl,
      lastFrameUrl: stableUrl,
      videoTaskId: "cv_abc",
      videoTaskEngine: "wan-3.0",
      videoTaskStatus: "running",
    });
    expect(out?.outputUrl).toBe(stableUrl);
    expect(out?.outputUrls).toContain(stableUrl);
    expect(out?.videoTaskId).toBe("cv_abc");
    expect(out?.videoTaskEngine).toBe("wan-3.0");
    expect(out?.videoTaskStatus).toBe("running");
    // 三审 P1-1:遮罩与末帧续拍锚同样必须存活
    expect(out?.editMaskUrl).toBe(stableUrl);
    expect(out?.lastFrameUrl).toBe(stableUrl);
  });

  it("视频段的段级白模/母轨/登记成片扛过 sanitize，坏项丢弃", () => {
    const out = sanitizeManhuaCloudDraftBlock({
      id: "clip-e01-g02",
      kind: "video",
      x: 0, y: 0, width: 420, height: 360,
      prompt: "【第2段·30s】",
      outputUrl: "https://storage.googleapis.com/b/uploads/u1/c.mp4",
      manhuaSegmentRefs: {
        previs: { url: "https://x.test/previs.mp4?sig=1", gcsUri: "gs://b/uploads/u1/previs.mp4", fileName: "白模.mp4", updatedAt: "2026-09-09T00:00:00Z" },
        master: { url: "expired", gcsUri: "gs://b/uploads/u1/master.wav", updatedAt: "2026-09-09T00:00:00Z" },
        registered: { url: "blob:local" },
      },
    });
    expect(out?.manhuaSegmentRefs?.previs).toMatchObject({ gcsUri: "gs://b/uploads/u1/previs.mp4", fileName: "白模.mp4" });
    expect(out?.manhuaSegmentRefs?.master).toMatchObject({ url: "", gcsUri: "gs://b/uploads/u1/master.wav" });
    expect(out?.manhuaSegmentRefs?.registered).toBeUndefined();
    expect(sanitizeManhuaCloudDraftBlock({ id: "clip-e01-g03", kind: "video", prompt: "p" })?.manhuaSegmentRefs).toBeUndefined();
  });

  it("serialize → parse 全程往返不丢字段", () => {
    const payload = {
      format: "mv-manhua-cloud-draft-v1",
      clientUpdatedAt: new Date(0).toISOString(),
      writerSession: {} as ManhuaCloudDraftPayload["writerSession"],
      canvas: {
        blocks: [
          sanitizeManhuaCloudDraftBlock({
            id: "clip-e01-s02",
            kind: "video",
            x: 0, y: 0, width: 420, height: 360,
            prompt: "p",
            refImageUrl: stableUrl,
            lastFrameUrl: stableUrl,
            videoTaskId: "cv_xyz",
            videoTaskEngine: "wan-3.0",
            videoTaskStatus: "running",
          })!,
        ],
        edges: [],
      },
      factoryPrefs: null,
    } as ManhuaCloudDraftPayload;
    const restored = parseManhuaCloudDraftPayload(
      JSON.parse(serializeManhuaCloudDraftPayload(payload)),
    );
    const blk = restored?.canvas.blocks[0];
    expect(blk?.refImageUrl).toBe(stableUrl);
    // 四审建议:serialize→parse 全程也要断言续拍锚存活(视频节点 sanitize 分支)
    expect(blk?.lastFrameUrl).toBe(stableUrl);
    expect(blk?.videoTaskId).toBe("cv_xyz");
    expect(blk?.videoTaskStatus).toBe("running");
  });

  it("final 成片版本与烧字 GCS 身份可跨 serialize → parse 恢复", () => {
    const payload = {
      format: "mv-manhua-cloud-draft-v1",
      clientUpdatedAt: new Date(0).toISOString(),
      writerSession: {} as ManhuaCloudDraftPayload["writerSession"],
      canvas: {
        blocks: [
          sanitizeManhuaCloudDraftBlock({
            id: "final-e02",
            kind: "video",
            x: 0,
            y: 0,
            width: 420,
            height: 360,
            prompt: "第2集整集成片",
            outputUrl: "https://signed.example/burned.mp4",
            outputUrls: [
              "https://signed.example/burned.mp4",
              "https://cdn.example/original.mp4",
            ],
            manhuaFinalPostProd: {
              action: "burn_subtitle",
              jobId: "pp-final-2",
              sourceUrl: "https://cdn.example/original.mp4",
              status: "succeeded",
              resultGcsUri: "gs://bucket/post-prod/u2/burned.mp4",
              resultUrl: "https://signed.example/burned.mp4",
              updatedAt: 30,
            },
          })!,
        ],
        edges: [],
      },
      factoryPrefs: null,
    } as ManhuaCloudDraftPayload;
    const restored = parseManhuaCloudDraftPayload(
      JSON.parse(serializeManhuaCloudDraftPayload(payload)),
    );
    expect(restored?.canvas.blocks[0]?.outputUrls).toHaveLength(2);
    expect(restored?.canvas.blocks[0]?.manhuaFinalPostProd?.jobId).toBe("pp-final-2");
    expect(restored?.canvas.blocks[0]?.manhuaFinalPostProd?.resultGcsUri).toBe(
      "gs://bucket/post-prod/u2/burned.mp4",
    );
  });
});

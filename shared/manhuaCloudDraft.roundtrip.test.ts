import { createManhuaPrevisStudio } from "./manhuaPrevis";
import { describe, expect, it } from "vitest";
import {
  buildManhuaCloudDraftPayload,
  parseManhuaCloudDraftPayload,
  sanitizeManhuaCloudDraftBlock,
  serializeManhuaCloudDraftPayload,
  type ManhuaCloudDraftPayload,
} from "./manhuaCloudDraft";
import { isManhuaPlanApprovalCurrent, sealManhuaActionPlan } from "./manhuaActionPlan";
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
      // D（0915）：意图与提前进合同的三个身份也必须存活
      videoIntentId: "gi_clip-e01-01_abcdef",
      videoIntentStatus: "submitted",
      videoTakeId: "take_01",
      videoInputFingerprint: JSON.stringify({ prompt: "p" }),
      manhuaActionPlanRevision: "rev_0001",
    });
    expect(out?.outputUrl).toBe(stableUrl);
    expect(out?.outputUrls).toContain(stableUrl);
    expect(out?.videoTaskId).toBe("cv_abc");
    expect(out?.videoTaskEngine).toBe("wan-3.0");
    expect(out?.videoTaskStatus).toBe("running");
    expect(out?.videoIntentId).toBe("gi_clip-e01-01_abcdef");
    expect(out?.videoIntentStatus).toBe("submitted");
    expect(out?.videoTakeId).toBe("take_01");
    expect(out?.videoInputFingerprint).toBe(JSON.stringify({ prompt: "p" }));
    expect(out?.manhuaActionPlanRevision).toBe("rev_0001");
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

describe("manhuaCloudDraft · 动作计划按集往返（PR-2）", () => {
  const plan = () =>
    sealManhuaActionPlan({
      actionPlanId: "ap_ep1",
      episodeIndex: 1,
      actors: [{ actorId: "ap_a", nameZh: "阿菁" }, { actorId: "ap_b", nameZh: "墨屠" }],
      initialStates: {
        ap_a: { presence: "onstage", at: { space: "screen", x: 0.3, y: 0.7 }, heldProps: [] },
        ap_b: { presence: "onstage", at: { space: "screen", x: 0.6, y: 0.7 }, heldProps: [] },
      },
      shots: [{ shotId: "ap_s1", displayIndex: 1, timeMap: { sourceDurationSec: 5, spans: [] }, confirm: "confirmed", actorChanges: [], events: [] }],
      executionRanges: [],
    });

  it("build → serialize → parse：计划与审批原样存活，planRevision 不变", () => {
    const p = plan();
    const approved = { ...p, approval: { approvedRevision: p.planRevision, approvedAtIso: new Date(0).toISOString() } };
    const payload = buildManhuaCloudDraftPayload({
      writerSession: {} as never, blocks: [], edges: [],
      manhuaActionPlans: { "1": approved },
    });
    expect(payload.manhuaActionPlans?.["1"]?.planRevision).toBe(p.planRevision);
    const parsed = parseManhuaCloudDraftPayload(serializeManhuaCloudDraftPayload(payload));
    const back = parsed?.manhuaActionPlans?.["1"];
    expect(back?.planRevision).toBe(p.planRevision);
    expect(back && isManhuaPlanApprovalCurrent(back)).toBe(true);
    expect(parsed?.manhuaActionPlanWarnings).toBeUndefined();
  });

  it("旧稿没有 manhuaActionPlans → null，不补造 unplanned 计划", () => {
    const parsed = parseManhuaCloudDraftPayload(JSON.stringify({
      format: "mv-manhua-cloud-draft-v1", clientUpdatedAt: new Date(0).toISOString(), writerSession: {}, canvas: { blocks: [], edges: [] },
    }));
    expect(parsed?.manhuaActionPlans).toBeNull();
  });

  it("不合合同的计划不静默删：记警告并保留其它集", () => {
    const good = plan();
    const parsed = parseManhuaCloudDraftPayload(JSON.stringify({
      format: "mv-manhua-cloud-draft-v1", clientUpdatedAt: new Date(0).toISOString(), writerSession: {}, canvas: { blocks: [], edges: [] },
      manhuaActionPlans: { "1": good, "2": { format: "mv-manhua-action-plan-v1", actionPlanId: "ap_bad", episodeIndex: 2, actors: [] } },
    }));
    expect(parsed?.manhuaActionPlans?.["1"]?.actionPlanId).toBe("ap_ep1");
    expect(parsed?.manhuaActionPlans?.["2"]).toBeUndefined();
    expect(parsed?.manhuaActionPlanWarnings?.map((w) => w.episodeKey)).toEqual(["2"]);
  });

  it("键与 episodeIndex 不一致 → 警告，不放进错的集", () => {
    const parsed = parseManhuaCloudDraftPayload(JSON.stringify({
      format: "mv-manhua-cloud-draft-v1", clientUpdatedAt: new Date(0).toISOString(), writerSession: {}, canvas: { blocks: [], edges: [] },
      manhuaActionPlans: { "3": plan() },
    }));
    expect(parsed?.manhuaActionPlans).toBeNull();
    expect(parsed?.manhuaActionPlanWarnings?.[0]?.messageZh).toMatch(/不一致/);
  });
});

describe("1471 R2 · previsStudio 新字段云草稿往返", () => {
  it("cameraStyle / draftCameraPromptZh / draftTempoZh 经 sanitize 存活；旧稿没有这些字段照常通过", async () => {
    const { sanitizeManhuaCloudDraftBlock } = await import("./manhuaCloudDraft");
    const studio = { ...createManhuaPrevisStudio(), cameraStyle: "slow_orbit" as const, draftCameraPromptZh: ["0.00–1.50s 全景·平视·慢环绕：建立"], draftTempoZh: "慢 · 意图「静」且无接触" };
    const out = sanitizeManhuaCloudDraftBlock({ id: "clip-e01-01", kind: "video", previsStudio: studio } as never);
    expect(out?.previsStudio?.cameraStyle).toBe("slow_orbit");
    expect(out?.previsStudio?.draftCameraPromptZh).toEqual(studio.draftCameraPromptZh);
    expect(out?.previsStudio?.draftTempoZh).toBe(studio.draftTempoZh);
    const legacy = sanitizeManhuaCloudDraftBlock({ id: "clip-e01-02", kind: "video", previsStudio: createManhuaPrevisStudio() } as never);
    expect(legacy?.previsStudio).toBeTruthy();
    expect(legacy?.previsStudio).not.toHaveProperty("cameraStyle");
  });
});

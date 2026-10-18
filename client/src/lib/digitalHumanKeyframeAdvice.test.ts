import { describe, expect, it } from "vitest";
import { keyframeAdviceDraftFixture, keyframeAdvicePlanFixture } from "@shared/digitalHumanKeyframeAdvice.fixtures";
import { makeDigitalHumanKeyframeAdviceTarget } from "./digitalHumanKeyframeAdvice";
import { digitalHumanKeyframeAdviceTargetSchema, parseDigitalHumanKeyframeAdvice } from "@shared/digitalHumanKeyframeAdvice";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import { buildDigitalHumanAdvisorProject } from "./digitalHumanAdvisor";

describe("白模审片补图目标与候选", () => {
  it("只选择与当前完整规格一致的视频，绑定配音偏移且不携带媒体地址", () => {
    const draft = keyframeAdviceDraftFixture();
    const target = makeDigitalHumanKeyframeAdviceTarget(draft);
    expect(target.timelineStartSec).toBe(10); expect(target.previs.previousPreviewSpecJson).toBe(target.previs.specJson);
    expect(JSON.stringify(target)).not.toContain("gs://"); expect(JSON.stringify(target)).not.toContain("https://");
    expect(parseDigitalHumanKeyframeAdvice(JSON.stringify(keyframeAdvicePlanFixture(target)), target).candidates[0].startSec).toBe(11);
  });
  it.each(["missing", "old", "scene", "duration", "audio", "aspect"])("拒绝%s目标", kind => {
    const draft = keyframeAdviceDraftFixture();
    if (kind === "missing") draft.previsStudio!.history = [];
    if (kind === "old") draft.previsStudio!.spec.cameras[0].lens += 1;
    if (kind === "scene") draft.previsSpatialInvalidated = true;
    if (kind === "duration") draft.previsStudio!.audioStartSec = 29;
    if (kind === "audio") draft.approvedAudioRequestId = undefined;
    if (kind === "aspect") draft.aspectRatio = "16:9";
    expect(() => makeDigitalHumanKeyframeAdviceTarget(draft)).toThrow();
  });
  it("服务器合同独立拒绝无视频和旧规格，不依赖UI禁用", () => {
    const target = makeDigitalHumanKeyframeAdviceTarget(keyframeAdviceDraftFixture());
    expect(() => digitalHumanKeyframeAdviceTargetSchema.parse({ ...target, previs: { ...target.previs, previousPreviewRequestId: undefined } })).toThrow();
    const old = JSON.parse(target.previs.specJson); old.cameras[0].lens += 1;
    expect(() => digitalHumanKeyframeAdviceTargetSchema.parse({ ...target, previs: { ...target.previs, previousPreviewSpecJson: JSON.stringify(old) } })).toThrow();
  });
  it.each(["revision", "video", "actor", "time", "observation", "boundary", "empty"])("拒绝%s错误候选", kind => {
    const target = makeDigitalHumanKeyframeAdviceTarget(keyframeAdviceDraftFixture()); const plan = keyframeAdvicePlanFixture(target);
    if (kind === "revision") plan.revision = "old";
    if (kind === "video") plan.videoRequestId = crypto.randomUUID();
    if (kind === "actor") plan.candidates[0].actorIds = ["invented"];
    if (kind === "time") plan.candidates[0].startSec = 1;
    if (kind === "observation") plan.observations[0].atVideoSec = 5;
    if (kind === "boundary") plan.unverifiedZh = [];
    if (kind === "empty") plan.candidates = [];
    expect(() => parseDigitalHumanKeyframeAdvice(JSON.stringify(plan), target)).toThrow();
  });
  it("允许明确说明无需补图，不强制生成候选", () => {
    const target = makeDigitalHumanKeyframeAdviceTarget(keyframeAdviceDraftFixture()), plan = keyframeAdvicePlanFixture(target);
    plan.candidates = []; plan.noAdditionalFramesReasonZh = "现有镜头信息足够，先修白模接触。";
    expect(parseDigitalHumanKeyframeAdvice(JSON.stringify(plan), target).candidates).toHaveLength(0);
  });
  it("跨作品和损坏规格以合同错误拒绝，不从safeParse抛解析异常", () => {
    const target = makeDigitalHumanKeyframeAdviceTarget(keyframeAdviceDraftFixture());
    expect(digitalHumanKeyframeAdviceTargetSchema.safeParse({ ...target, previs: { ...target.previs, clipId: "other" } }).success).toBe(false);
    expect(digitalHumanKeyframeAdviceTargetSchema.safeParse({ ...target, previs: { ...target.previs, specJson: "not-json" } }).success).toBe(false);
  });
  it("禁止与发布/白模编辑模式混用", () => {
    const draft = keyframeAdviceDraftFixture(), target = makeDigitalHumanKeyframeAdviceTarget(draft), base = { ...buildDigitalHumanAdvisorProject(draft).context, digitalHumanKeyframeAdvice: target };
    expect(() => manhuaCreativeAdvisorContextSchema.parse({ ...base, previsEdit: target.previs })).toThrow();
    expect(() => manhuaCreativeAdvisorContextSchema.parse({ ...base, digitalHumanPublication: { id: draft.id, script: draft.script } })).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { buildAdvisorPrevisShotSource, advisorPrevisShotSourceSchema } from "./manhuaAdvisorPrevisShotSource";
import { createManhuaPrevisStudio } from "./manhuaPrevis";
import { sanitizeManhuaCloudDraftBlock } from "./manhuaCloudDraft";
import { makeAdvisorPrevisTarget, prepareAdvisorPrevisTrial, applyAdvisorPrevisCandidate, adoptAdvisorPrevisTrial, validateAdvisorPrevisShotCoverage, withAdvisorPrevisVideo, type AdvisorPrevisCandidate } from "./manhuaAdvisorPrevisEdit";

function fixture() {
  const studio = createManhuaPrevisStudio(5);
  studio.advisorShotSource = buildAdvisorPrevisShotSource("clip-1", [
    { index: 22, durationSec: 2, actionZh: "打手甲在后方追来，打手乙站在左侧。", cameraZh: "沿追逃方向横移", dialogueZh: "曹三：站住。" },
    { index: 23, durationSec: 3, actionZh: "阿菁侧身避开，娘仍在背上。", cameraZh: "保留两名追者" },
  ]);
  const candidate: AdvisorPrevisCandidate = { target: makeAdvisorPrevisTarget("clip-1", studio), patch: {
    kind: "previs_edit_v1", summaryZh: "依据原文调整机位", unsupportedZh: [], cameras: studio.spec.cameras.map(c => ({ ...c, endLens: 55 })),
    shotCoverage: [22, 23].map(index => ({ index, status: "covered", actorIds: [studio.spec.actors[0].id], reasonZh: "本测试仅校验覆盖声明合同，不代表动作或画面已完成" })),
  } };
  return { studio, candidate };
}

describe("顾问逐镜来源与覆盖合同", () => {
  it("原文与累积秒窗完整进入target，并经云草稿恢复保留", () => {
    const { studio, candidate } = fixture();
    const restored = sanitizeManhuaCloudDraftBlock({ id: "clip-1", kind: "video", previsStudio: studio } as never)!.previsStudio!;
    expect(restored.advisorShotSource).toEqual(studio.advisorShotSource);
    expect(candidate.target.shotSource?.shots.map(s => [s.index, s.startSec, s.endSec])).toEqual([[22, 0, 2], [23, 2, 5]]);
    expect(candidate.target.shotSource?.shots[0].dialogueZh).toBe("曹三：站住。");
    expect(makeAdvisorPrevisTarget("clip-1", restored).shotSource).toEqual(candidate.target.shotSource);
  });
  it("缺镜、重复镜及虚构人物均不能准备渲染", () => {
    const { studio, candidate } = fixture();
    for (const rows of [undefined, candidate.patch.shotCoverage!.slice(0, 1), [candidate.patch.shotCoverage![0], candidate.patch.shotCoverage![0]], candidate.patch.shotCoverage!.map(row => ({ ...row, actorIds: ["other-actor"] }))]) {
      expect(() => prepareAdvisorPrevisTrial("clip-1", studio, { ...candidate, patch: { ...candidate.patch, shotCoverage: rows } })).toThrow();
    }
  });
  it("明确不支持可返回说明，但阻止应用和渲染且保留旧配置", () => {
    const { studio, candidate } = fixture();
    candidate.patch.shotCoverage![1] = { index: 23, status: "unsupported", actorIds: [], reasonZh: "现有能力不支持倒地与喂碗接触" };
    expect(() => validateAdvisorPrevisShotCoverage(candidate.target, candidate.patch, true)).not.toThrow();
    const before = JSON.stringify(studio);
    expect(() => prepareAdvisorPrevisTrial("clip-1", studio, candidate)).toThrow("镜23：现有能力不支持倒地与喂碗接触");
    expect(JSON.stringify(studio)).toBe(before);
  });
  it("原文或时间窗改变后，旧候选和旧试看不能应用", () => {
    const { studio, candidate } = fixture();
    const trial = prepareAdvisorPrevisTrial("clip-1", studio, candidate);
    studio.advisorShotSource!.shots[0].actionZh = "新稿的真实动作";
    expect(() => applyAdvisorPrevisCandidate("clip-1", studio, candidate)).toThrow("分镜来源已变化");
    expect(() => adoptAdvisorPrevisTrial("clip-1", studio, trial, { jobId: "test", status: "succeeded", params: trial.request, output: { requestId: trial.request.requestId, clipId: "clip-1", durationSec: 5, gcsUri: "gs://test/preview.mp4", url: "/api/manhua-previs-media/test/preview" } })).toThrow("分镜来源已变化");
    const current = makeAdvisorPrevisTarget("clip-1", studio);
    expect(withAdvisorPrevisVideo(current, { target: candidate.target, requestId: crypto.randomUUID(), specJson: candidate.target.specJson })).toEqual(current);
  });
  it("缺时长、错片段、断秒窗、重复镜、来源总长不符明确拒绝，不截断", () => {
    const { studio } = fixture();
    expect(() => buildAdvisorPrevisShotSource("clip-1", [])).toThrow();
    expect(() => buildAdvisorPrevisShotSource("clip-1", [{ index: 1, durationSec: 0, actionZh: "原文" }])).toThrow("有效片长");
    expect(() => makeAdvisorPrevisTarget("clip-other", studio)).toThrow("分镜来源");
    const source = structuredClone(studio.advisorShotSource!); source.shots[1].startSec = 3;
    expect(advisorPrevisShotSourceSchema.safeParse(source).success).toBe(false);
    studio.advisorShotSource!.shots[1].endSec = 6;
    expect(() => makeAdvisorPrevisTarget("clip-1", studio)).toThrow("分镜来源");
  });
});

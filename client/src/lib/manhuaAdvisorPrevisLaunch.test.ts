import { expect, it } from "vitest";
import { checkManhuaAdvisorPrevisLaunch } from "./manhuaAdvisorPrevisLaunch";
import { defaultCanvasBlock } from "./canvasTypes";
import { createManhuaPrevisStudio } from "@shared/manhuaPrevis";
import { makeAdvisorPrevisTarget, type AdvisorPrevisCandidate } from "@shared/manhuaAdvisorPrevisEdit";

function fixture() {
  const block = { ...defaultCanvasBlock("video", 0, 0), id: "clip-e02-g01", previsStudio: createManhuaPrevisStudio(5) };
  const candidate: AdvisorPrevisCandidate = { target: makeAdvisorPrevisTarget(block.id, block.previsStudio), patch: { kind: "previs_edit_v1" as const, summaryZh: "保留角色，调整镜头", unsupportedZh: [], cameras: block.previsStudio.spec.cameras.map(c => ({ ...c, endLens: 60 })) } };
  return { block, candidate };
}
it("默认无声使用同一候选契约，不因没有音轨挖生成入口的坑", () => {
  const { block, candidate } = fixture();
  expect(block.previsStudio.audioEnabled).not.toBe(true);
  expect(checkManhuaAdvisorPrevisLaunch(block, candidate)).toBe("");
  block.previsStudio.audioEnabled = true;
  expect(checkManhuaAdvisorPrevisLaunch(block, candidate)).toContain("尚未配置音轨");
});
it("已删除、归档、队列与过期候选在建请求前明确阻断", () => {
  const { block, candidate } = fixture();
  expect(checkManhuaAdvisorPrevisLaunch(undefined, candidate)).toContain("打开当前片段");
  expect(checkManhuaAdvisorPrevisLaunch({ ...block, archivedFromPreviousScript: true }, candidate)).toContain("打开当前片段");
  expect(checkManhuaAdvisorPrevisLaunch({ ...block, videoTaskStatus: "queued" }, candidate)).toContain("正在制作");
  expect(checkManhuaAdvisorPrevisLaunch({ ...block, id: "other-clip" }, candidate)).not.toBe("");
});
it("模型标明未支持的调度不能因无声或按钮可见而通过", () => {
  const { block, candidate } = fixture(); candidate.patch.unsupportedZh = ["无法表达精细指部接触"];
  expect(checkManhuaAdvisorPrevisLaunch(block, candidate)).toContain("精细指部接触");
});

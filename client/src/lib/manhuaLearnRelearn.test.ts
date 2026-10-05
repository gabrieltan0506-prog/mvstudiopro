import { expect, it, vi } from "vitest";
import { confirmManhuaLearnSource } from "./manhuaLearnRelearn";
const source = { seriesKey: "series_real", episodeIndex: 16, alreadyLearned: true };
const params = { nativePlanLimit: 8, nativeVideoFps: 11, nativeSegmentSeconds: 319 };
it("取消重学不产生可提交参数或付费身份", () => {
  const id = vi.fn();
  expect(confirmManhuaLearnSource(source, params, () => false, id)).toBeNull();
  expect(id).not.toHaveBeenCalled();
});
it("确认只重学16，保留用户的采样和分片设置", () => {
  const confirm = vi.fn((_message: string) => true);
  const result = confirmManhuaLearnSource(source, params, confirm, () => "11111111-1111-4111-8111-111111111111");
  expect(result).toEqual({ ...params, nativePlanLimit: 1, batchSize: 1, nativeRelearn: {
    seriesKey: source.seriesKey, episodeIndex: 16, requestId: "11111111-1111-4111-8111-111111111111",
  } });
  expect(confirm.mock.calls[0][0]).toContain("再次产生模型费用");
  expect(params.nativePlanLimit).toBe(8);
});
it("未学单集不额外询问，合集保留批量", () => {
  const confirm = vi.fn();
  expect(confirmManhuaLearnSource({ ...source, alreadyLearned: false }, params, confirm)).toEqual({ ...params, nativePlanLimit: 1, batchSize: 1 });
  expect(confirmManhuaLearnSource({ ...source, episodeIndex: undefined, alreadyLearned: false }, params, confirm)).toEqual(params);
  expect(confirm).not.toHaveBeenCalled();
});

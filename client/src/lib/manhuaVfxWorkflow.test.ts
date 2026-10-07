import { describe, expect, it } from "vitest";
import type { ManhuaVfxState } from "@shared/manhuaVfx";
import { adoptedManhuaVfxClipOptions, canAdoptManhuaVfxRequest, makeManhuaVfxEffect, manhuaVfxContainedVideoRect, manhuaVfxPositionFromPointer, upsertManhuaVfxTrajectoryPoint, manhuaVfxSourceKey, pendingManhuaVfxTrackedJobs, parseManhuaVfxTrajectory, sameManhuaVfxComposition, validateManhuaVfxDuration } from "./manhuaVfxWorkflow";
import { buildPostProdClipOptions, mergeRemoteJobs, normalizeStoredJobs } from "./postProdWorkshop";

const id = "426fdd48-971a-4e84-91f1-8ef4c435ba14";
const clip = { id: "clip-e01-g01", url: "gs://test-bucket/clip-v1.mp4", label: "第一段" };
function state(): ManhuaVfxState {
  const draft = { sourceId: clip.id, videoUri: clip.url, sourceKey: manhuaVfxSourceKey(clip), composition: { version: 1 as const, seed: 1, effects: [makeManhuaVfxEffect("shield", "shield-1")] } };
  return { version: 1, scopeKey: "manhua:test", draft, adoptedRequestId: id, requests: { [id]: {
    ...draft, requestId: id, jobId: "vfx-job-1", status: "succeeded", createdAt: 1,
    output: { gcsUri: "gs://test-bucket/result.mp4", requestId: id, sourceKey: draft.sourceKey, composition: draft.composition },
  } } };
}

describe("特效来源与候选采用", () => {
  it("签名刷新仍识别同一GCS物件，但外部查询参数和素材版本改变会失效", () => {
    expect(manhuaVfxSourceKey({ ...clip, url: "https://storage.googleapis.com/test-bucket/clip-v1.mp4?X-Goog-Signature=example" })).toBe(manhuaVfxSourceKey(clip));
    expect(manhuaVfxSourceKey({ ...clip, url: "https://test-bucket.storage.googleapis.com/clip-v1.mp4?token=example" })).toBe(manhuaVfxSourceKey(clip));
    expect(manhuaVfxSourceKey({ ...clip, url: "https://example.test/video?id=1" })).not.toBe(manhuaVfxSourceKey({ ...clip, url: "https://example.test/video?id=2" }));
    expect(canAdoptManhuaVfxRequest(state(), id, [{ ...clip, url: "gs://test-bucket/clip-v2.mp4" }])).toBe(false);
  });
  it("采用同时核对当前原片、草稿与返回方案，错误回执不得混入", () => {
    expect(canAdoptManhuaVfxRequest(state(), id, [clip])).toBe(true);
    const edited = state(); edited.draft = { ...edited.draft!, composition: { ...edited.draft!.composition, seed: 2 } };
    expect(canAdoptManhuaVfxRequest(edited, id, [clip])).toBe(false);
    const wrong = state(); wrong.requests[id].output = { ...wrong.requests[id].output!, requestId: "different" };
    expect(canAdoptManhuaVfxRequest(wrong, id, [clip])).toBe(false);
    wrong.requests[id].output = { ...state().requests[id].output!, composition: { ...state().draft!.composition, seed: 6 } };
    expect(canAdoptManhuaVfxRequest(wrong, id, [clip])).toBe(false);
    expect(canAdoptManhuaVfxRequest(state(), id, [])).toBe(false);
  });
  it("仅明确采用且来源仍相同才供下游使用，跨scope及换源失效，改草稿不撤销已采用成品", () => {
    expect(adoptedManhuaVfxClipOptions(state(), "manhua:test", [clip])[0]?.url).toBe("gs://test-bucket/result.mp4");
    expect(adoptedManhuaVfxClipOptions({ ...state(), adoptedRequestId: undefined }, "manhua:test", [clip])).toEqual([]);
    expect(adoptedManhuaVfxClipOptions(state(), "manhua:other", [clip])).toEqual([]);
    expect(adoptedManhuaVfxClipOptions(state(), "manhua:test", [{ ...clip, url: "gs://test-bucket/new.mp4" }])).toEqual([]);
    expect(adoptedManhuaVfxClipOptions({ ...state(), draft: undefined }, "manhua:test", [clip])).toHaveLength(1);
  });
  it("恢复旧任务可识别新action，但成功本身不等于采用", () => {
    const jobs = mergeRemoteJobs([], [{ jobId: "vfx-job-1", action: "manhua_vfx", status: "succeeded", scopeKey: "manhua:test", output: state().requests[id].output }]);
    expect(jobs[0]?.label).toBe("漫剧特效");
    expect(normalizeStoredJobs(jobs)).toHaveLength(1);
    expect(buildPostProdClipOptions(jobs)).toEqual([]);
  });
});

describe("特效时间与手写轨迹", () => {
  it("保留每个轨迹点，不静默截断或忽略错误行", () => {
    expect(parseManhuaVfxTrajectory("0 0.2 0.5\n1,0.8,0.5")).toEqual([{ timeSec: 0, x: 0.2, y: 0.5 }, { timeSec: 1, x: 0.8, y: 0.5 }]);
    expect(parseManhuaVfxTrajectory(" ")).toBeUndefined();
    expect(() => parseManhuaVfxTrajectory("0 0.5 0.5\nbad 0.2 0.5")).toThrow("第 2 行");
    expect(() => parseManhuaVfxTrajectory("0 0.5 0.5 ignored")).toThrow();
  });
  it("未读时长、效果越界及轨迹越界阻止提交", () => {
    const composition = state().draft!.composition;
    expect(validateManhuaVfxDuration(composition, 0)).toContain("时长");
    expect(validateManhuaVfxDuration(composition, 0.5)).toContain("超过");
    expect(validateManhuaVfxDuration(composition, 2)).toBeUndefined();
    const trajectory = [{ timeSec: 0, x: 0.2, y: 0.5 }, { timeSec: 3, x: 0.8, y: 0.5 }];
    expect(validateManhuaVfxDuration({ ...composition, effects: [{ ...composition.effects[0], anchor: { ...composition.effects[0].anchor, trajectory } }] }, 2)).toContain("超过");
  });
  it("非法或递减轨迹方案不能作为匹配证据", () => {
    expect(sameManhuaVfxComposition({}, {})).toBe(false);
    const composition = state().draft!.composition;
    const invalid = { ...composition, effects: [{ ...composition.effects[0], anchor: { space: "screen", position: [0.5, 0.5], trajectory: [{ timeSec: 1, x: 0.2, y: 0.5 }, { timeSec: 0, x: 0.8, y: 0.5 }] } }] };
    expect(sameManhuaVfxComposition(invalid, invalid)).toBe(false);
  });
});


it("同源同剧本复制到另一项目不恢复旧特效，在本项目可恢复列表窗口外的pending任务", () => {
  const oldProject = state();
  oldProject.scopeKey = "vfx:project-a:same-script";
  oldProject.requests[id].status = "running";
  oldProject.requests[id].output = undefined;
  const restored = pendingManhuaVfxTrackedJobs(oldProject, "vfx:project-a:same-script", []);
  expect(restored).toHaveLength(1);
  expect(restored[0].jobId).toBe("vfx-job-1");
  expect(pendingManhuaVfxTrackedJobs(oldProject, "vfx:project-b:same-script", [])).toEqual([]);
  expect(pendingManhuaVfxTrackedJobs(oldProject, "vfx:project-a:same-script", restored)).toEqual([]);
  expect(adoptedManhuaVfxClipOptions({ ...state(), scopeKey: oldProject.scopeKey }, "vfx:project-b:same-script", [clip])).toEqual([]);
});


describe("画面定位控件", () => {
  it("contain宽屏上下黑边和竖屏左右黑边不计入源片坐标", () => {
    const wide = manhuaVfxContainedVideoRect({ width: 300, height: 300 }, { width: 1600, height: 900 });
    expect(wide).toEqual({ left: 0, top: 65.625, width: 300, height: 168.75 });
    expect(manhuaVfxPositionFromPointer(wide, { x: 150, y: 150 })).toEqual([0.5, 0.5]);
    expect(manhuaVfxPositionFromPointer(wide, { x: 75, y: 107.8125 })).toEqual([0.25, 0.25]);
    expect(manhuaVfxPositionFromPointer(wide, { x: 150, y: 20 })).toBeUndefined();
    const tall = manhuaVfxContainedVideoRect({ width: 400, height: 300 }, { width: 900, height: 1600 });
    expect(manhuaVfxPositionFromPointer(tall, { x: 20, y: 150 })).toBeUndefined();
    expect(manhuaVfxPositionFromPointer(tall, { x: 200, y: 150 })).toEqual([0.5, 0.5]);
    expect(manhuaVfxContainedVideoRect({ width: 0, height: 300 }, { width: 900, height: 1600 })).toBeUndefined();
  });
  it("播放秒位采点保留所有不同时刻，倒着采也按时间排列，同刻只更新该点", () => {
    const first = upsertManhuaVfxTrajectoryPoint([], { timeSec: 2, x: 0.7, y: 0.2 });
    const next = upsertManhuaVfxTrajectoryPoint(first, { timeSec: 1, x: 0.3, y: 0.4 });
    expect(next.map(point => point.timeSec)).toEqual([1, 2]);
    expect(upsertManhuaVfxTrajectoryPoint(next, { timeSec: 2, x: 0.9, y: 0.8 })).toEqual([{ timeSec: 1, x: 0.3, y: 0.4 }, { timeSec: 2, x: 0.9, y: 0.8 }]);
    expect(upsertManhuaVfxTrajectoryPoint([{ timeSec: 1.0004, x: 0.4, y: 0.4 }], { timeSec: 1, x: 0.3, y: 0.4 })).toHaveLength(2);
  });
  it("超出120点或画面秒窗报错，不截断原轨迹", () => {
    const points = Array.from({ length: 120 }, (_, i) => ({ timeSec: i / 10, x: 0.5, y: 0.5 }));
    expect(() => upsertManhuaVfxTrajectoryPoint(points, { timeSec: 20, x: 0.5, y: 0.5 })).toThrow("120");
    expect(upsertManhuaVfxTrajectoryPoint(points, { timeSec: 1, x: 0.8, y: 0.9 })).toHaveLength(120);
    expect(() => upsertManhuaVfxTrajectoryPoint([], { timeSec: 31, x: 0.5, y: 0.5 })).toThrow();
    expect(() => upsertManhuaVfxTrajectoryPoint([], { timeSec: 1, x: 1.1, y: 0.5 })).toThrow();
  });
});

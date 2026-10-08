import { afterEach, expect, it, vi } from "vitest";
const route = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("./heavyLearnMedia", () => ({ shouldDispatchHeavyMedia: () => true, dispatchLearnWork: route.dispatch }));
import { extractNativeKeyMomentEvidenceFrames } from "./manhuaNativeKeyMomentFrames";
import { extractSweepFrames } from "./manhuaNativeSweepFrames";
import { renderNativeEvidenceReportFromObjectNames } from "./manhuaNativeReportRender";
import { verifyNativeEvidenceFrames } from "./manhuaNativeFrameVerification";
afterEach(() => vi.clearAllMocks());
it("web截图入口只送GCS引用并回放真实帧进度，不把函数与signal序列化", async () => {
  const frame = { objectName: "test.jpg", atSec: 1 };
  const uploaded = vi.fn(); const failure = vi.fn();
  const signal = new AbortController().signal;
  route.dispatch.mockImplementation(async (_work, _signal, events) => { await events([{ frame }, { failure: { stage: "test", reason: "error" } }]); return [frame]; });
  await expect(extractNativeKeyMomentEvidenceFrames({ seriesKey: "test", episodeIndex: 1, mediaNodes: [], preparedSegments: [{ gsUri: "gs://test/segment.mp4", startSec: 0, endSec: 5 }],
    abortSignal: signal, onFrameUploaded: uploaded, onFrameFailure: failure })).resolves.toEqual([frame]);
  expect(route.dispatch.mock.calls[0]![0].input.abortSignal).toBeUndefined();
  expect(route.dispatch.mock.calls[0]![0].input.onFrameUploaded).toBeUndefined();
  expect(uploaded).toHaveBeenCalledWith(frame); expect(failure).toHaveBeenCalledWith({ stage: "test", reason: "error" });
});
it("补扫、报告、批量验证三个正式web入口全部调度到worker", async () => {
  route.dispatch.mockResolvedValue([]);
  await extractSweepFrames({ seriesKey: "test", episodeIndex: 1, segmentIndex: 0, mediaUrl: "gs://test/segment.mp4", segmentStartSec: 0, lenSec: 5 });
  await renderNativeEvidenceReportFromObjectNames({ labelZh: "测试", evidenceObjectNames: [], reportObjectName: "test.html" });
  await verifyNativeEvidenceFrames([{} as any, {} as any]);
  expect(route.dispatch.mock.calls.map(([work]) => work.operation)).toEqual(["sweep_frames", "native_report", "verify_frames"]);
  expect(route.dispatch).toHaveBeenCalledTimes(3);
});

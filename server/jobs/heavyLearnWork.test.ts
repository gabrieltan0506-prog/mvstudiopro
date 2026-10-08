import { afterEach, expect, it, vi } from "vitest";
import { executeHeavyMedia } from "./heavyMediaWorker";
import { dispatchHeavyMedia, type HeavyMediaReply, type HeavyMediaProgress } from "./heavyMediaQueue";
import { withHeavyMediaContext, heavyMediaCallbackCommand } from "./heavyMediaContext";
import { dispatchLearnCommand, dispatchLearnWork } from "../services/heavyLearnMedia";
const mock = vi.hoisted(() => ({ frames: vi.fn(), sweep: vi.fn(), report: vi.fn(), verify: vi.fn() }));
vi.mock("../services/manhuaNativeKeyMomentFrames", () => ({ extractNativeKeyMomentEvidenceFramesLocally: mock.frames }));
vi.mock("../services/manhuaNativeSweepFrames", () => ({ extractSweepFramesLocally: mock.sweep }));
vi.mock("../services/manhuaNativeReportRender", () => ({ renderNativeEvidenceReportFromObjectNamesLocally: mock.report }));
vi.mock("../services/manhuaNativeFrameVerification", () => ({ verifyNativeEvidenceFramesLocally: mock.verify }));
afterEach(() => vi.clearAllMocks());
it("工作机截图返回永久对象回执并按序持久化上传与失败事件", async () => {
  const frame = { atSec: 2, objectName: "frames/a.jpg", bytes: 4 };
  const signal = new AbortController().signal;
  mock.frames.mockImplementation(async input => {
    expect(input.abortSignal).toBe(signal);
    await input.onFrameUploaded(frame);
    input.onFrameFailure({ stage: "upload", reason: "test" });
    return [frame];
  });
  const progress: HeavyMediaProgress[] = [];
  const result = await executeHeavyMedia({ kind: "learn_work", requestId: "test", work: {
    operation: "key_frames", input: { seriesKey: "test", episodeIndex: 1, mediaNodes: [], preparedSegments: [] },
  } }, signal, async value => { progress.push(value); });
  expect(result).toEqual({ stdout: JSON.stringify([frame]), stderr: "" });
  expect(progress.map(x => x.operationEvents?.length)).toEqual([1, 2]);
});
it("补扫、报告和整批校验各执行一次，不发送模型调用", async () => {
  mock.sweep.mockResolvedValue([]); mock.report.mockResolvedValue({ frames: 3 }); mock.verify.mockResolvedValue([true, false]);
  const signal = new AbortController().signal;
  const work = [
    { operation: "sweep_frames", input: { seriesKey: "test", episodeIndex: 1, segmentIndex: 0, mediaUrl: "gs://test/a", segmentStartSec: 0, lenSec: 10 } },
    { operation: "native_report", input: { labelZh: "测试", evidenceObjectNames: [], reportObjectName: "test.html" } },
    { operation: "verify_frames", frames: [] },
  ] as const;
  for (const item of work) await executeHeavyMedia({ kind: "learn_work", requestId: "test", work: item as any }, signal, async () => {});
  expect(mock.sweep).toHaveBeenCalledOnce(); expect(mock.report).toHaveBeenCalledOnce(); expect(mock.verify).toHaveBeenCalledOnce();
});
it("并发分片回调串行，第二个请求不覆盖首个；事件只交付一次", async () => {
  let output: any = { progress: { groups: [[]] } };
  let status = "running";
  let reply: HeavyMediaReply = {};
  let reads = 0;
  const sequences: number[] = [];
  const events: unknown[] = [];
  const store = {
    enqueue: vi.fn(), cancel: vi.fn(),
    get: async () => {
      const command = reply.commandRequest;
      if (command) {
        reads++;
        output = { progress: { callbackProgress: { sequence: command.sequence, events: [{ failure: { stage: "test", reason: "fixture" } }] },
          ...(reads >= 2 ? { commandResult: { sequence: command.sequence, result: { stdout: command.request.kind === "learn_work" ? '[]' : '{}', stderr: "" } } } : {}) } };
      }
      return { id: "test", userId: "7", input: {}, output, status, error: null, updatedAt: new Date() };
    },
    reply: async (_id: string, _user: string, value: HeavyMediaReply) => {
      if (value.commandRequest) { sequences.push(value.commandRequest.sequence); reads = 0; }
      reply = { ...reply, ...value };
    },
  };
  await withHeavyMediaContext({ userId: "7", executionId: "test" }, () => dispatchHeavyMedia({ kind: "learn_prepare", episode: {} as any, nodes: [] }, {
    store, wait: async () => {}, onProgress: async () => {
      await Promise.all([
        dispatchLearnWork({ operation: "verify_frames", frames: [] }, undefined, async rows => { events.push(...rows); }),
        dispatchLearnCommand("ffprobe", ["https://fixture.invalid/a.mp4"], {}),
      ]);
      status = "succeeded"; output = { result: [] }; reply = {};
    },
  }));
  expect(sequences).toEqual([1, 2]); expect(events).toHaveLength(1); expect(store.enqueue).toHaveBeenCalledOnce();
});
it("恢复同一次轮询不重建任务，显式免费补图调用使用新身份", async () => {
  const bridge = vi.fn(async (_request: import("./heavyMediaQueue").HeavyMetadataRequest) => ({ stdout: "[]", stderr: "" }));
  await heavyMediaCallbackCommand.run(bridge, async () => {
    await dispatchLearnWork({ operation: "verify_frames", frames: [] });
    await dispatchLearnWork({ operation: "verify_frames", frames: [] });
  });
  expect((bridge.mock.calls[0]![0] as any).requestId).not.toBe((bridge.mock.calls[1]![0] as any).requestId);
});
it("取消后拒绝执行重处理，不落报告", async () => {
  const controller = new AbortController(); controller.abort(new Error("用户取消"));
  await expect(executeHeavyMedia({ kind: "learn_work", requestId: "test", work: { operation: "native_report", input: {} as any } }, controller.signal, async () => {})).rejects.toThrow("用户取消");
  expect(mock.report).not.toHaveBeenCalled();
});

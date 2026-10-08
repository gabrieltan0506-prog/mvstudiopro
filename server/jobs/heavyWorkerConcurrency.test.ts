import { afterEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ claim: vi.fn(), progress: vi.fn(), finish: vi.fn(), save: vi.fn(), exec: vi.fn(), resources: vi.fn() }));
vi.mock("./heavyMediaRepository", () => ({ claimHeavyMediaJob: mocked.claim, writeHeavyMediaProgress: mocked.progress,
  finishHeavyMediaJob: mocked.finish, countHeavyWorkerJobs: vi.fn() }));
vi.mock("./repository", () => ({ getJobByIdStrict: vi.fn() }));
vi.mock("../services/heavyMediaEvidence", () => ({ saveHeavyMediaResult: mocked.save, readHeavyMediaResult: vi.fn() }));
vi.mock("../services/heavyMediaProcess", () => ({ execHeavyMedia: mocked.exec }));
vi.mock("../services/postProdResources", () => ({ withPostProdResources: mocked.resources }));
import { heavyWorkerState, processHeavyMediaOnce } from "./heavyMediaWorker";
afterEach(() => vi.clearAllMocks());
it("两项学习实际同时执行，第三项不领取，一项结束后仍保持busy", async () => {
  heavyWorkerState.ready = true;
  mocked.progress.mockResolvedValue({}); mocked.finish.mockResolvedValue(undefined); mocked.save.mockResolvedValue(undefined);
  const releases: Array<() => void> = [];
  mocked.exec.mockImplementation(async () => { await new Promise<void>(r => { releases.push(r); }); return { stdout: "{}", stderr: "" }; });
  mocked.resources.mockImplementation(async (_id, signal, _state, work, opts) => { expect(opts.parallelLearning).toBe(true); return work(signal); });
  let sequence = 0;
  mocked.claim.mockImplementation(async () => ({ id: `test${++sequence}`, userId: "7", input: { version: 1, request: { kind: "learn_command", command: "ffprobe", args: ["https://fixture.invalid/a.mp4"], maxBuffer: 1024 } } }));
  const a = processHeavyMediaOnce(() => false);
  await vi.waitFor(() => expect(releases).toHaveLength(1));
  const b = processHeavyMediaOnce(() => false);
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  await processHeavyMediaOnce(() => false);
  expect(mocked.claim).toHaveBeenCalledTimes(2);
  expect(mocked.claim.mock.calls[1]![1]).toContain("learn_prepare");
  expect(mocked.claim.mock.calls[1]![1]).not.toContain("final_render");
  releases[0]!(); await a; expect(heavyWorkerState.active).toBe(true);
  releases[1]!(); await b; expect(heavyWorkerState.active).toBe(false);
});

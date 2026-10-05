import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ count: vi.fn(), exec: vi.fn() }));
vi.mock("./heavyMediaRepository", () => ({
  countHeavyWorkerJobs: state.count,
}));
vi.mock("../services/heavyMediaProcess", () => ({
  execHeavyMedia: state.exec,
}));
vi.mock("../services/gcs", () => ({
  getGcsBucketName: () => "offline-bucket",
}));
import { assertHeavyWorkerReady, heavyWorkerState } from "./heavyMediaWorker";
beforeEach(() => {
  heavyWorkerState.ready = false;
  state.count.mockReset().mockResolvedValue(0);
  state.exec
    .mockReset()
    .mockResolvedValue({ stdout: "fixture-version", stderr: "" });
});
afterEach(() => vi.unstubAllEnvs());
it("rejects other machines before inspecting the queue or launching media tools", async () => {
  vi.stubEnv("MANHUA_HEAVY_MACHINE_ID", "selected");
  vi.stubEnv("FLY_MACHINE_ID", "tokyo-forbidden");
  await expect(assertHeavyWorkerReady()).rejects.toThrow("identity");
  expect(state.count).not.toHaveBeenCalled();
  expect(state.exec).not.toHaveBeenCalled();
  expect(heavyWorkerState.ready).toBe(false);
});
it("readiness fails closed until DB and every tool succeed, without claiming or creating a task", async () => {
  vi.stubEnv("MANHUA_HEAVY_MACHINE_ID", "selected");
  vi.stubEnv("FLY_MACHINE_ID", "selected");
  state.count.mockRejectedValueOnce(new Error("offline"));
  await expect(assertHeavyWorkerReady()).rejects.toThrow("offline");
  expect(state.exec).not.toHaveBeenCalled();
  state.exec.mockRejectedValueOnce(new Error("missing tool"));
  await expect(assertHeavyWorkerReady()).rejects.toThrow("missing tool");
  expect(heavyWorkerState.ready).toBe(false);
  state.exec.mockClear();
  await assertHeavyWorkerReady();
  expect(state.exec.mock.calls.map(c => c[0])).toEqual([
    "ffmpeg",
    "ffprobe",
    "yt-dlp",
  ]);
  expect(heavyWorkerState.ready).toBe(true);
});

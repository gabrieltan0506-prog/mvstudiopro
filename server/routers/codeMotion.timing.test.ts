import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  load: vi.fn(),
  ensure: vi.fn(),
  analyze: vi.fn(),
}));
vi.mock("../services/codeMotionStore", async original => ({
  ...(await original<typeof import("../services/codeMotionStore")>()),
  loadCodeMotion: mock.load,
}));
vi.mock("../services/codeMotionProductionGrant", async original => ({
  ...(await original<typeof import("../services/codeMotionProductionGrant")>()),
  ensureCodeMotionProductionGrant: mock.ensure,
}));
vi.mock("../services/codeMotionTiming", () => ({
  analyzeCodeMotionTiming: mock.analyze,
}));
import { codeMotionRouter } from "./codeMotion";
const projectId = "11111111-1111-4111-8111-111111111111",
  sourceId = "22222222-2222-4222-8222-222222222222",
  grantId = "33333333-3333-4333-8333-333333333333",
  source = {
    id: sourceId,
    sha256: "a".repeat(64),
    gcsUri: "gs://fixture/owned.wav",
    duration: 100,
  };
const ctx = {
  user: { id: 7, role: "user" },
  req: { headers: {}, socket: { remoteAddress: "192.0.2.1" } },
  res: {},
} as any;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("JWT_SECRET", "test-only-not-a-real-secret");
  vi.stubEnv("FLY_APP_NAME", "");
  mock.load.mockResolvedValue({
    generation: "4",
    project: {
      brief: { audios: [source] },
      plan: {
        audioTimeline: [{ sourceId, trimStart: 12, duration: 5, volume: 1 }],
      },
    },
  });
  mock.ensure.mockResolvedValue({ id: grantId });
  mock.analyze.mockResolvedValue({
    timing: { review: "needs-review" },
    reused: false,
  });
});
afterEach(() => vi.unstubAllEnvs());
it("official authenticated entry binds current project source and <=30-second adopted window before native analysis", async () => {
  await codeMotionRouter
    .createCaller(ctx)
    .analyzeTiming({ projectId, generation: "4", sourceId });
  expect(mock.load).toHaveBeenCalledWith("7", projectId);
  expect(mock.ensure).toHaveBeenCalledWith(
    "7",
    expect.objectContaining({ projectId, expectedGeneration: "4" })
  );
  expect(mock.analyze).toHaveBeenCalledWith("7", {
    projectId,
    grantId,
    source,
    windowStart: 12,
    windowDuration: 5,
  });
  expect(mock.ensure.mock.invocationCallOrder[0]).toBeLessThan(
    mock.analyze.mock.invocationCallOrder[0]!
  );
});
it("stale generation, unselected source, oversized window and no grant cannot call native audio", async () => {
  const api = codeMotionRouter.createCaller(ctx),
    input = { projectId, generation: "4", sourceId };
  await expect(
    api.analyzeTiming({ ...input, generation: "3" })
  ).rejects.toThrow(/保存/);
  await expect(
    api.analyzeTiming({ ...input, sourceId: grantId })
  ).rejects.toThrow(/选用/);
  mock.load.mockResolvedValueOnce({
    generation: "4",
    project: {
      brief: { audios: [source] },
      plan: {
        audioTimeline: [{ sourceId, trimStart: 0, duration: 31, volume: 1 }],
      },
    },
  });
  await expect(api.analyzeTiming(input)).rejects.toThrow(/30秒/);
  expect(mock.ensure).not.toHaveBeenCalled();
  mock.ensure.mockRejectedValue(Error("无名额"));
  await expect(api.analyzeTiming(input)).rejects.toThrow("无名额");
  expect(mock.analyze).not.toHaveBeenCalled();
});

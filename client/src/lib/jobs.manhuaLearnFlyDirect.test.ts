import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { healthGate } = vi.hoisted(() => ({
  healthGate: vi.fn(async (_origin: string, run: () => Promise<Response>) => run()),
}));

vi.mock("@/lib/flyHealthGate", () => ({
  withFlyHealthGate: healthGate,
}));
vi.mock("@/lib/longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (path: string) => `https://api.mvstudiopro.com${path}`,
  flyHealthProbeOriginForUrl: (url: string) => new URL(url).origin,
}));

import {
  cancelManhuaLearnServerJob,
  clearOtherManhuaLearnSeries,
  hideManhuaLearnServerSeries,
  listManhuaLearnServerJobs,
  skipManhuaLearnServerEpisode,
} from "./jobs";

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("漫剧学习任务绕过 Vercel 质询", () => {
  const fetchMock = vi.fn(async () => jsonRes({ items: [], maxConcurrent: 1 }));

  beforeEach(() => {
    fetchMock.mockClear();
    healthGate.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("列表轮询直达 API 子域并先过 Fly 健康门", async () => {
    await listManhuaLearnServerJobs();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.mvstudiopro.com/api/jobs/manhua-learn",
      expect.objectContaining({ method: "GET", credentials: "include", cache: "no-store" }),
    );
    expect(healthGate).toHaveBeenCalledWith("https://api.mvstudiopro.com", expect.any(Function));
  });

  it.each([
    ["cancel", () => cancelManhuaLearnServerJob("job /1"), "/cancel"],
    ["skip", () => skipManhuaLearnServerEpisode("job /1"), "/skip"],
    ["hide", () => hideManhuaLearnServerSeries("job /1"), "/hide"],
    ["clear-others", () => clearOtherManhuaLearnSeries("job /1"), "/clear-others"],
  ])("%s 控制请求也不经过 Vercel", async (_name, run, suffix) => {
    fetchMock.mockResolvedValueOnce(jsonRes({ jobId: "job /1", status: "running" }));
    await run();

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.mvstudiopro.com/api/jobs/manhua-learn/job%20%2F1${suffix}`,
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
});

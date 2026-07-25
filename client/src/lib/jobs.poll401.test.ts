import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/flyHealthGate", () => ({
  withFlyHealthGate: (_origin: string, run: () => Promise<Response>) => run(),
}));
vi.mock("@/lib/longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (path: string) => path,
  flyHealthProbeOriginForUrl: () => "",
}));

import { getJobForPoll } from "./jobs";

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("轮询遇到 401", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** 服务端鉴权要读一次用户表，库抖一下就回 401；一次就判死会白扔一个长任务 */
  it("前两次 401 后恢复，则照常返回任务状态", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ error: "Unauthorized" }, 401))
      .mockResolvedValueOnce(jsonRes({ error: "Unauthorized" }, 401))
      .mockResolvedValueOnce(jsonRes({ status: "running" }));

    const p = getJobForPoll("job-1");
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ status: "running" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("连续三次 401 才认定登录失效，且报错不带状态码", async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: "Unauthorized" }, 401));

    // 先挂上 rejection 断言再推进定时器，否则拒绝会先于监听逸出成未处理错误
    const assertion = expect(getJobForPoll("job-2")).rejects.toThrow(/^登录状态已失效/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  /** 鉴权依赖挂了服务端回 503，走既有的瞬态退避，不该提示重新登录 */
  it("503 按瞬态重试，不提示重新登录", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ error: "Auth store unavailable, retry" }, 503))
      .mockResolvedValueOnce(jsonRes({ status: "succeeded" }));

    const p = getJobForPoll("job-3");
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ status: "succeeded" });
  });
});

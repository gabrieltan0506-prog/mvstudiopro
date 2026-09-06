import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import {
  fingerprintManhuaPilotProject,
  loadManhuaPilotReview,
  submitManhuaPilotDecision,
} from "./manhuaPilotReviewClient";
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
}));
afterEach(() => vi.unstubAllGlobals());
const scope = {
  projectVersion: "a".repeat(64),
  episodeIndex: 1,
  videoModel: "wan-3.0",
};
describe("试片审核真实客户端请求", () => {
  it("正文改变产生新身份，相同已确认剧本刷新保持同身份", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const pack = {
      seriesTitle: "墨菁传",
      episodes: [{ index: 1, body: "黑奇入场。" }],
    };
    const a = await fingerprintManhuaPilotProject("2026-09-05", pack);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await fingerprintManhuaPilotProject(
        "2026-09-05",
        JSON.parse(JSON.stringify(pack))
      )
    ).toBe(a);
    expect(
      await fingerprintManhuaPilotProject("2026-09-05", {
        episodes: [{ body: "黑奇入场。", index: 1 }],
        seriesTitle: "墨菁传",
      })
    ).toBe(a);
    expect(
      await fingerprintManhuaPilotProject("2026-09-05", {
        ...pack,
        episodes: [{ index: 1, body: "黑奇离场。" }],
      })
    ).not.toBe(a);
    await expect(fingerprintManhuaPilotProject("", pack)).rejects.toThrow();
  });
  it("刷新只查原审批记录，不读本机旧批准、不发生成POST", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            review: { status: "submitting", taskId: "test-original-task" },
          })
        )
    );
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("不应读取旧批准");
      },
    });
    expect(await loadManhuaPilotReview(scope)).toEqual({
      status: "submitting",
      taskId: "test-original-task",
    });
    const [url, options] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("op=manhuaPilotStatus");
    expect(url).toContain("projectVersion=" + scope.projectVersion);
    expect(options).toMatchObject({ method: "GET", credentials: "include" });
  });
  it("只审批所播放的任务，保存未确认时不回退为本机批准或重发", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("test response lost");
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(
      submitManhuaPilotDecision({
        ...scope,
        taskId: "test-watched-task",
        decision: "approve",
      })
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("op=manhuaPilotReview");
    expect(JSON.parse(String(options.body))).toEqual({
      ...scope,
      taskId: "test-watched-task",
      decision: "approve",
    });
  });
  it("200但空批准/错误记录同样关闭放行", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, review: { status: "approved" } })
          )
      )
    );
    await expect(loadManhuaPilotReview(scope)).rejects.toThrow("不完整");
  });
});

import { describe, expect, it } from "vitest";

/**
 * 六审第1条/12A:旧同步出图入口必须 410 停用——无论登录与否,绝不触发付费图片上游。
 * 直接驱动 api/jobs handler(该分支不做任何动态 import,速回 410)。
 */
import handler from "../../api/jobs";

function fakeRes() {
  const out: { statusCode?: number; headers: Record<string, string>; body?: unknown } = {
    headers: {},
  };
  const res = {
    setHeader(k: string, v: string) {
      out.headers[k] = v;
      return res;
    },
    status(code: number) {
      out.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      out.body = payload;
      return res;
    },
    end() {
      return res;
    },
  };
  return { res, out };
}

describe("api/jobs op=canvasGptImage2(已停用同步入口)", () => {
  it("未登录调用:410 + 停用码,不触发上游", async () => {
    const { res, out } = fakeRes();
    await handler(
      { method: "POST", query: { op: "canvasGptImage2" }, body: { prompt: "x" }, headers: {} } as never,
      res as never,
    );
    expect(out.statusCode).toBe(410);
    expect((out.body as { code?: string }).code).toBe("CANVAS_GPT_IMAGE2_SYNC_REMOVED");
    expect(out.headers["Cache-Control"]).toBe("no-store");
  });

  it("带登录 Cookie 调用:同样 410,登录不解锁旧入口", async () => {
    const { res, out } = fakeRes();
    await handler(
      {
        method: "POST",
        query: { op: "canvasgptimage2" },
        body: { prompt: "x" },
        headers: { cookie: "session=whatever" },
      } as never,
      res as never,
    );
    expect(out.statusCode).toBe(410);
    expect((out.body as { code?: string }).code).toBe("CANVAS_GPT_IMAGE2_SYNC_REMOVED");
  });
});

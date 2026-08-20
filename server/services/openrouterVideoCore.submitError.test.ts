import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isOpenRouterSubmitRejected,
  isOpenRouterSubmitUnknown,
  submitOpenRouterVideoJob,
} from "./openrouterVideoCore";

/**
 * 八审 P1-5:提交层直接产出 typed error,调用方不再靠文案正则猜。
 * 明确 4xx=rejected(可回落);网络断/5xx/408/409/429/2xx缺id=unknown(禁回落转对账)。
 */
describe("submitOpenRouterVideoJob · typed 提交错误(八审 P1-5)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function armEnv() {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-testkey123"); // 必须 sk- 前缀才被 getOpenRouterApiKey 采信
  }
  const body = { model: "alibaba/happyhorse-1.1", prompt: "p" };

  it("网络断=unknown", async () => {
    armEnv();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    const e = await submitOpenRouterVideoJob(body).catch((x) => x);
    expect(isOpenRouterSubmitUnknown(e)).toBe(true);
    expect(isOpenRouterSubmitRejected(e)).toBe(false);
  });

  it("422=rejected;500/429=unknown", async () => {
    armEnv();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 422 })));
    expect(isOpenRouterSubmitRejected(await submitOpenRouterVideoJob(body).catch((x) => x))).toBe(true);
    for (const code of [500, 429, 408, 409]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: code })));
      expect(isOpenRouterSubmitUnknown(await submitOpenRouterVideoJob(body).catch((x) => x))).toBe(true);
    }
  });

  it("2xx 但缺 id/polling_url=unknown(任务可能已建,禁回落)", async () => {
    armEnv();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "queued" }), { status: 200 })));
    expect(isOpenRouterSubmitUnknown(await submitOpenRouterVideoJob(body).catch((x) => x))).toBe(true);
  });
});

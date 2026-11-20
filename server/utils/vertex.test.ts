/**
 * 换令牌缓存：并发共用一次刷新、临期刷新、失败不缓存且可恢复、瞬态错误短退避重试。
 * 只用测试临时生成的密钥，不读取任何真实凭证。
 */
import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVertexAccessToken, resetVertexAccessTokenCacheForTest } from "./vertex";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
const testCredentials = JSON.stringify({
  client_email: "test-only@example.invalid",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});

let tokenCalls = 0;
function stubTokenFetch(handler: (n: number) => Promise<Response> | Response) {
  tokenCalls = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    tokenCalls += 1;
    return handler(tokenCalls);
  }));
}
const ok = (token: string, expiresIn = 3600) =>
  new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), { status: 200 });

beforeEach(() => {
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", testCredentials);
  resetVertexAccessTokenCacheForTest();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("getVertexAccessToken 缓存", () => {
  it("并发 50 次只换 1 次令牌，之后命中缓存不再请求", async () => {
    stubTokenFetch(async () => { await new Promise(r => setTimeout(r, 20)); return ok("tok-1"); });
    const tokens = await Promise.all(Array.from({ length: 50 }, () => getVertexAccessToken()));
    expect(new Set(tokens)).toEqual(new Set(["tok-1"]));
    expect(tokenCalls).toBe(1);
    expect(await getVertexAccessToken()).toBe("tok-1");
    expect(tokenCalls).toBe(1);
  });

  it("过期前 5 分钟内刷新；刷新失败时旧令牌未过期仍可用，下次再刷新成功", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    stubTokenFetch(() => ok("tok-1", 3600));
    expect(await getVertexAccessToken()).toBe("tok-1");
    vi.setSystemTime(54 * 60_000); // 距过期 6 分钟：不刷新
    expect(await getVertexAccessToken()).toBe("tok-1");
    expect(tokenCalls).toBe(1);
    vi.setSystemTime(56 * 60_000); // 距过期 4 分钟：刷新，接口明确拒绝
    stubTokenFetch(() => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    expect(await getVertexAccessToken()).toBe("tok-1");
    expect(tokenCalls).toBe(1);
    stubTokenFetch(() => ok("tok-2"));
    expect(await getVertexAccessToken()).toBe("tok-2");
    expect(await getVertexAccessToken()).toBe("tok-2");
    expect(tokenCalls).toBe(1);
  });

  it("网络错误与 5xx 短退避重试 3 次后成功", async () => {
    stubTokenFetch(n => {
      if (n === 1) throw new TypeError("fetch failed");
      if (n <= 3) return new Response("{}", { status: 503 });
      return ok("tok-r");
    });
    vi.useFakeTimers();
    const pending = getVertexAccessToken();
    await vi.runAllTimersAsync();
    expect(await pending).toBe("tok-r");
    expect(tokenCalls).toBe(4);
  });

  it("重试耗尽抛瞬态分类错误且不缓存失败；下次调用重新换令牌并恢复", async () => {
    stubTokenFetch(() => new Response("{}", { status: 502 }));
    vi.useFakeTimers();
    const failing = getVertexAccessToken();
    const assertion = expect(failing).rejects.toThrow(/^vertex_token_failed:502:/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(tokenCalls).toBe(4);
    vi.useRealTimers();
    stubTokenFetch(() => ok("tok-back"));
    expect(await getVertexAccessToken()).toBe("tok-back");
    expect(tokenCalls).toBe(1);
  });

  it("4xx 明确拒绝不重试；错误信息不含断言或私钥", async () => {
    stubTokenFetch(() => new Response(JSON.stringify({ error: "invalid_grant", error_description: "bad" }), { status: 400 }));
    const error = (await getVertexAccessToken().catch(e => e)) as Error;
    expect(error.message).toMatch(/^vertex_token_failed:400:/);
    expect(error.message).not.toMatch(/PRIVATE KEY|assertion|eyJ/);
    expect(tokenCalls).toBe(1);
  });
});

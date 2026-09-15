import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { once } from "node:events";
vi.mock("../_core/sdk", () => ({
  sdk: { authenticateRequest: vi.fn(async () => ({ id: 1 })) },
}));
import { sdk } from "../_core/sdk";
import { registerGcsTransfer } from "./gcsTransfer";
import { isGcsTransferUrl } from "../../shared/gcsTransfer";
const nativeFetch = globalThis.fetch;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(sdk.authenticateRequest).mockResolvedValue({ id: 1 } as never);
});
async function request(method: string, source: string, body?: string) {
  const app = express();
  registerGcsTransfer(app);
  const server = createServer(app).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const r = await nativeFetch(
      `http://127.0.0.1:${(server.address() as any).port}/api/gcs-transfer?url=${encodeURIComponent(source)}`,
      {
        method,
        body,
        headers: body ? { "Content-Type": "model/gltf-binary" } : {},
      }
    );
    return { status: r.status, body: await r.text() };
  } finally {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
  }
}
describe("GCS双向转发", () => {
  it.each([
    "http://storage.googleapis.com/a",
    "https://storage.googleapis.com.evil.test/a",
    "https://127.0.0.1/a",
    "https://user@storage.googleapis.com/a",
    "https://storage.googleapis.com:444/a",
  ])("拒绝伪装目标%s", async u => {
    expect(isGcsTransferUrl(u)).toBe(false);
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await request("GET", u)).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it("未登录不访问上游", async () => {
    vi.mocked(sdk.authenticateRequest).mockRejectedValue(new Error());
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(
      (await request("GET", "https://storage.googleapis.com/b/a")).status
    ).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });
  it("下载保留字节且禁止重定向", async () => {
    const f = vi.fn(
      async (_u: unknown, _o: unknown) => new Response("exact-file")
    );
    vi.stubGlobal("fetch", f);
    expect(
      await request("GET", "https://storage.googleapis.com/b/a?sig=test")
    ).toEqual({ status: 200, body: "exact-file" });
    expect(f.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      method: "GET",
    });
  });
  it("上传流写回原签名对象和MIME", async () => {
    let bytes = "";
    const f = vi.fn(async (_u: any, o: any) => {
      bytes = await new Response(o.body).text();
      expect(o.headers.get("content-type")).toBe("model/gltf-binary");
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    expect(
      (
        await request(
          "PUT",
          "https://storage.googleapis.com/b/model.glb?sig=test",
          "model-bytes"
        )
      ).status
    ).toBe(200);
    expect(bytes).toBe("model-bytes");
    expect(f.mock.calls[0][0]).toBe(
      "https://storage.googleapis.com/b/model.glb?sig=test"
    );
  });
  it("签名过期保持403，不重新签名", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("expired", { status: 403 }))
    );
    expect(
      (await request("GET", "https://storage.googleapis.com/b/a")).status
    ).toBe(403);
  });
});

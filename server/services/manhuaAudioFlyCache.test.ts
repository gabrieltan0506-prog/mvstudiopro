import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, get } from "node:http";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("./gcs.js", () => ({ signGsUriV4ReadUrl: (uri: string) => `https://signed.test/${encodeURIComponent(uri)}` }));
import { serveManhuaAudioFromFly } from "./manhuaAudioFlyCache";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("Fly 音轨临时缓存", () => {
  it("首次从原件回填，本机缓存再读，并正确响应播放 Range", async () => {
    const uri = `gs://test/post-prod/7/dialogue/${randomUUID()}.wav`;
    const content = Buffer.from("0123456789");
    const upstream = vi.fn(async () => new Response(content, { status: 200, headers: { "content-length": String(content.length) } }));
    globalThis.fetch = upstream as typeof fetch;
    const app = express();
    app.get("/audio", (req, res) => { void serveManhuaAudioFromFly(req, res, uri); });
    const server = createServer(app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test address");
    const request = (range?: string) => new Promise<{ status: number; data: string; contentRange?: string }>((resolve, reject) => {
      get({ hostname: "127.0.0.1", port: address.port, path: "/audio", headers: range ? { Range: range } : {} }, response => {
        const parts: Buffer[] = [];
        response.on("data", part => parts.push(Buffer.from(part)));
        response.on("end", () => resolve({ status: response.statusCode || 0, data: Buffer.concat(parts).toString(), contentRange: response.headers["content-range"] }));
      }).on("error", reject);
    });
    try {
      expect(await request()).toMatchObject({ status: 200, data: "0123456789" });
      expect(await request("bytes=3-5")).toMatchObject({ status: 206, data: "345", contentRange: "bytes 3-5/10" });
      expect(await request("bytes=99-")).toMatchObject({ status: 416 });
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally {
      server.close();
      await once(server, "close");
      const key = createHash("sha256").update(uri).digest("hex");
      await unlink(join(tmpdir(), "mvs-audio-preview-cache", key)).catch(() => {});
    }
  });
});

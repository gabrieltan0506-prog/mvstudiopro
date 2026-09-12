import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { mkdtemp, realpath, readFile } from "node:fs/promises";
import { createManhuaLocalVideoUploadRouter } from "./manhuaLocalVideoUpload";
import { createManhuaLocalVideoUploadService } from "./services/manhuaLocalVideoUploadService";
import { MANHUA_LOCAL_VIDEO_CHUNK_BYTES } from "../shared/manhuaLocalVideoUpload";
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: vi.fn() } }));
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
async function setup(options: { authorized?: boolean; owner?: boolean } = {}) {
  const root = await realpath(
    await mkdtemp("/private/tmp/manhua-upload-http-test-")
  );
  const service = createManhuaLocalVideoUploadService({ root });
  const create = vi.spyOn(service, "create");
  const authenticate = vi.fn(async () => {
    if (options.authorized === false) throw new Error("no session");
    return { id: 7, openId: "owner" };
  });
  const app = express();
  app.use(
    createManhuaLocalVideoUploadRouter({
      service,
      authenticate,
      isOwner: () => options.owner !== false,
    })
  );
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("listen failed");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = {
    origin: base,
    "x-manhua-upload": "1",
    "content-type": "application/json",
  };
  const endpoint = `${base}/api/manhua/local-video-uploads`;
  return { root, service, create, authenticate, headers, endpoint };
}
describe("本地视频上传 HTTP 安全边界", () => {
  it("鉴权先于JSON解析和写盘", async () => {
    const s = await setup({ authorized: false });
    const r = await fetch(s.endpoint, {
      method: "POST",
      headers: s.headers,
      body: "{" + "x".repeat(4096),
    });
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(s.authenticate).toHaveBeenCalledOnce();
    expect(s.create).not.toHaveBeenCalled();
  });
  it("管理员身份仍不能替代站点拥有者", async () => {
    const s = await setup({ owner: false });
    const r = await fetch(s.endpoint, {
      method: "POST",
      headers: s.headers,
      body: "{}",
    });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: "FORBIDDEN" });
    expect(s.create).not.toHaveBeenCalled();
  });
  const rejectedHeaders: Record<string, string>[] = [
    { "x-manhua-upload": "0" },
    { origin: "https://evil.example" },
    { "sec-fetch-site": "cross-site" },
  ];
  it.each(rejectedHeaders)("拒绝跨站或缺少专用头 %s", async override => {
    const s = await setup();
    const r = await fetch(s.endpoint, {
      method: "POST",
      headers: { ...s.headers, ...override },
      body: '{"fileName":"x.mp4","bytes":3}',
    });
    expect(r.status).toBe(403);
    expect(s.create).not.toHaveBeenCalled();
  });
  it("JSON有界并拒绝客户端路径字段", async () => {
    const s = await setup();
    const big = await fetch(s.endpoint, {
      method: "POST",
      headers: s.headers,
      body: JSON.stringify({ fileName: "x".repeat(4096), bytes: 3 }),
    });
    expect(big.status).toBe(413);
    const extra = await fetch(s.endpoint, {
      method: "POST",
      headers: s.headers,
      body: JSON.stringify({
        fileName: "x.mp4",
        bytes: 3,
        localPath: "/etc/passwd",
      }),
    });
    expect(extra.status).toBe(400);
    expect(s.create).not.toHaveBeenCalled();
  });
  it("创建、块写入、断点查询与错误均不暴露磁盘路径", async () => {
    const s = await setup();
    const created = await fetch(s.endpoint, {
      method: "POST",
      headers: s.headers,
      body: JSON.stringify({
        fileName: "x.mp4",
        bytes: MANHUA_LOCAL_VIDEO_CHUNK_BYTES + 3,
      }),
    });
    expect(created.status).toBe(201);
    const data = await created.json();
    expect(data).not.toHaveProperty("localPath");
    const url = `${s.endpoint}/${data.uploadId}`;
    const headers = {
      ...s.headers,
      "content-type": "application/octet-stream",
    };
    const appended = await fetch(`${url}?offset=0`, {
      method: "PUT",
      headers,
      body: Buffer.from("123"),
    });
    expect(appended.status).toBe(200);
    expect(await appended.json()).toMatchObject({
      offset: 3,
      status: "uploading",
    });
    const conflict = await fetch(`${url}?offset=0`, {
      method: "PUT",
      headers,
      body: Buffer.from("123"),
    });
    expect(conflict.status).toBe(409);
    const tooLarge = await fetch(`${url}?offset=3`, {
      method: "PUT",
      headers,
      body: Buffer.alloc(MANHUA_LOCAL_VIDEO_CHUNK_BYTES + 1),
    });
    expect(tooLarge.status).toBe(413);
    const queried = await fetch(url, { headers: s.headers });
    expect(await queried.json()).toMatchObject({ offset: 3 });
    const complete = await fetch(`${url}/complete`, {
      method: "POST",
      headers: s.headers,
    });
    expect(complete.status).toBe(409);
    expect(await complete.text()).not.toContain("/private/");
  });
  it("真实视频经HTTP创建、上传、完成和刷新读回同一来源", async () => {
    const s = await setup();
    const fixture = path.join(s.root, "http-fixture.mp4");
    await promisify(execFile)("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=green:s=96x64:r=12",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      fixture,
    ]);
    const bytes = await readFile(fixture);
    const created = await fetch(s.endpoint, {
      method: "POST",
      headers: s.headers,
      body: JSON.stringify({ fileName: "本机视频.mp4", bytes: bytes.length }),
    });
    const m = await created.json();
    const url = `${s.endpoint}/${m.uploadId}`;
    const upload = await fetch(`${url}?offset=0`, {
      method: "PUT",
      headers: { ...s.headers, "content-type": "application/octet-stream" },
      body: bytes,
    });
    expect(upload.status).toBe(200);
    const completed = await fetch(`${url}/complete`, {
      method: "POST",
      headers: s.headers,
    });
    expect(completed.status).toBe(200);
    const result = await completed.json();
    expect(result).toMatchObject({
      status: "completed",
      bytes: bytes.length,
      offset: bytes.length,
      durationSec: 1,
    });
    expect(result.sourceRef).toMatch(/^manhua-upload:\/\/u7\//);
    expect(result).not.toHaveProperty("localPath");
    const refreshed = await fetch(url, { headers: s.headers });
    expect(await refreshed.json()).toEqual(result);
    const owned = await s.service.resolveOwned({
      userId: 7,
      uploadId: m.uploadId,
    });
    expect(await readFile(owned.localPath)).toEqual(bytes);
    console.log(
      "LOCAL_VIDEO_HTTP_EVIDENCE",
      JSON.stringify({ root: s.root, ...result })
    );
  });

  it("无Origin的浏览器同源GET通过Referer校验", async () => {
    const s = await setup();
    const r = await fetch(
      `${s.endpoint}/11111111-1111-4111-8111-111111111111`,
      {
        headers: {
          "x-manhua-upload": "1",
          referer: s.headers.origin + "/platform",
          "sec-fetch-site": "same-origin",
        },
      }
    );
    expect(r.status).toBe(404);
  });
});

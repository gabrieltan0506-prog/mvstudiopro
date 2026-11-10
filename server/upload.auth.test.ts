import { Readable } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";

/** 服务端直收上传须登录：未登录 401，且不读请求体、不落存储（离线替身）。 */
const h = vi.hoisted(() => ({ auth: vi.fn(), storagePut: vi.fn(), gcsUpload: vi.fn(), blobPut: vi.fn() }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: h.auth } }));
vi.mock("./storage", () => ({ storagePut: h.storagePut }));
vi.mock("./services/gcs", () => ({ uploadBufferToGcs: h.gcsUpload }));
vi.mock("./services/publicStoredMedia", () => ({ putPublicStoredMedia: h.blobPut }));
import uploadRouter from "./upload";
import blobPutImage from "../api/blob-put-image";

const PATHS = ["/api/upload", "/api/upload-image", "/api/platform/upload", "/api/magazine/upload"];

function multipart(path: string) {
  const boundary = "----testboundary";
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n虚构文件内容\r\n--${boundary}--\r\n`,
  );
  let read = false;
  const req: any = Readable.from((async function* () { read = true; yield body; })());
  req.method = "POST";
  req.url = path;
  req.headers = { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(body.length) };
  return { req, wasRead: () => read };
}
function call(path: string) {
  const { req, wasRead } = multipart(path);
  return new Promise<{ status: number; body: any; wasRead: boolean }>((resolve, reject) => {
    let status = 200;
    const res: any = {
      status(code: number) { status = code; return res; },
      json(value: unknown) { resolve({ status, body: value, wasRead: wasRead() }); return res; },
    };
    (uploadRouter as any)(req, res, (error?: unknown) => (error ? reject(error) : reject(new Error(`未命中路由 ${path}`))));
  });
}
async function callBlob(body: unknown, method = "POST") {
  let status = 0, result: any;
  const res: any = { status(code: number) { status = code; return res; }, json(value: unknown) { result = value; return res; } };
  await blobPutImage({ method, body, headers: {} } as never, res as never);
  return { status, body: result };
}

beforeEach(() => {
  h.auth.mockReset().mockResolvedValue({ id: 7, role: "user" });
  h.storagePut.mockReset().mockImplementation(async (key: string) => ({ url: `https://media.example/${key}` }));
  h.gcsUpload.mockReset().mockImplementation(async ({ bucket, objectName }: any) => ({ bucket, objectName, gcsUri: `gs://${bucket}/${objectName}` }));
  h.blobPut.mockReset().mockImplementation(async (pathname: string) => ({ pathname, url: `https://blob.example/${pathname}` }));
});

it.each(PATHS)("%s 未登录 → 401，不读请求体、不落存储", async (path) => {
  h.auth.mockRejectedValue(Object.assign(new Error("Invalid session cookie"), { statusCode: 403 }));
  const rejected = await call(path);
  expect(rejected.status).toBe(401);
  expect(rejected.wasRead).toBe(false);
  h.auth.mockResolvedValue(null);
  const anonymous = await call(path);
  expect(anonymous.status).toBe(401);
  expect(anonymous.wasRead).toBe(false);
  expect(h.storagePut).not.toHaveBeenCalled();
  expect(h.gcsUpload).not.toHaveBeenCalled();
});

it("登录库暂时不可用 → 503（不当成未登录），同样不收文件", async () => {
  h.auth.mockRejectedValue(Object.assign(new Error("Auth store unavailable"), { statusCode: 503 }));
  const result = await call("/api/upload");
  expect(result.status).toBe(503);
  expect(result.wasRead).toBe(false);
  expect(h.storagePut).not.toHaveBeenCalled();
});

it("已登录：/api/upload 与 /api/upload-image 照常落存储", async () => {
  const upload = await call("/api/upload");
  expect(upload.status).toBe(200);
  expect(upload.body.key).toMatch(/^uploads\/[\w-]{12}\.png$/);
  const image = await call("/api/upload-image");
  expect(image.body.key).toMatch(/^idol-3d\/[\w-]{12}\.png$/);
  expect(h.storagePut).toHaveBeenCalledTimes(2);
});

it("已登录：/api/platform/upload 照常落 GCS 并返回 gs://", async () => {
  const result = await call("/api/platform/upload");
  expect(result.status).toBe(200);
  expect(result.body.fileUri).toMatch(/^gs:\/\/[^/]+\/platform-qa\/\d+-[\w-]{8}\.png$/);
  expect(h.gcsUpload).toHaveBeenCalledTimes(1);
});

it("blob-put-image：未登录 401、登录库不可用 503，均不落存储；已登录照常", async () => {
  const body = { dataUrl: `data:image/png;base64,${Buffer.from("虚构图片").toString("base64")}`, filename: "ref.png" };
  h.auth.mockRejectedValueOnce(Object.assign(new Error("Invalid session cookie"), { statusCode: 403 }));
  expect(await callBlob(body)).toEqual({ status: 401, body: { ok: false, error: "authentication_required", message: "请先登录后再上传图片" } });
  h.auth.mockResolvedValueOnce(null);
  expect((await callBlob(body)).status).toBe(401);
  h.auth.mockRejectedValueOnce(Object.assign(new Error("Auth store unavailable"), { statusCode: 503 }));
  expect((await callBlob(body)).status).toBe(503);
  expect(h.blobPut).not.toHaveBeenCalled();
  const ok = await callBlob(body);
  expect(ok.status).toBe(200);
  expect(ok.body.blobPath).toMatch(/^refs\/\d+-ref\.png$/);
  expect(h.blobPut).toHaveBeenCalledTimes(1);
});

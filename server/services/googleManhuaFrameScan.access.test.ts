import { beforeEach, afterEach, expect, it, vi } from "vitest";

/** 越权修复：漫剧读帧扫描须登录；gcsUri / url 只收本人登记素材；外部链接不代取（离线替身，不发真实请求、不调模型）。 */
const h = vi.hoisted(() => ({ auth: vi.fn(), analyze: vi.fn(), download: vi.fn() }));
vi.mock("../_core/sdk.js", () => ({ sdk: { authenticateRequest: h.auth } }));
vi.mock("../manhuaTemplateFrameVision", () => ({ analyzeManhuaTemplateFramesWithTerra: h.analyze }));
vi.mock("./gcs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gcs")>()),
  getGcsBucketName: () => "test-bucket",
  downloadGcsObject: h.download,
}));
// 归属核验走真实登记逻辑，只替换登记来源（不连库）：用户 7 有成功任务产物 canvas-frames/job-1/f1.jpg 与一条站外产物直链
const OWN_JOB_URL = "https://blob.example/renders/7/frame.jpg";
vi.mock("./postProdMediaSource", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./postProdMediaSource")>();
  return {
    ...actual,
    resolveRegisteredPostProdMediaSource: (input: { userId: string; source: string }) =>
      actual.resolveRegisteredPostProdMediaSource(input, {
        getBucket: () => "test-bucket",
        verifyOwnership: async () => false,
        loadSucceededJobOutputObjects: async () => new Set<string>(),
        loadSucceededJobOutputSources: async (uid: string) => ({
          objects: new Set(uid === "7" ? ["canvas-frames/job-1/f1.jpg"] : []),
          urls: new Set(uid === "7" ? [OWN_JOB_URL] : []),
        }),
      }),
  };
});
import handler from "../../api/google";

const fetchMock = vi.fn();
async function scan(frames: unknown[]) {
  let status = 0, result: any;
  const response = { status(code: number) { status = code; return this; }, json(value: unknown) { result = value; return this; } };
  await handler({ method: "POST", query: { op: "manhuaTemplateFrameScan" }, body: { frames, titleHint: "测试" } } as never, response as never);
  return { status, body: result };
}
const expectNothingTouched = () => {
  expect(h.analyze).not.toHaveBeenCalled();
  expect(h.download).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
};
const DATA_URL = "data:image/jpeg;base64,AAAA";

beforeEach(() => {
  h.auth.mockReset().mockResolvedValue({ id: 7, role: "user" });
  h.analyze.mockReset().mockResolvedValue({ model: "m", reasoningEffort: "high", lane: "爽文逆袭" });
  h.download.mockReset().mockRejectedValue(new Error("不应下载"));
  fetchMock.mockReset().mockRejectedValue(new Error("不应发起网络请求"));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GCS_BUCKET_NAME", "test-bucket");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("未登录 401：内联帧、本人对象、外部链接都不放行，不下载、不调模型", async () => {
  h.auth.mockResolvedValue(null);
  for (const frame of [{ dataUrl: DATA_URL }, { gcsUri: "gs://test-bucket/uploads/u7/f.jpg" }, { url: "https://example.com/a.jpg" }]) {
    const result = await scan([frame]);
    expect(result.status).toBe(401);
    expect(result.body.error).toBe("authentication_required");
  }
  expectNothingTouched();
});

it.each([
  ["别人上传前缀", "gs://test-bucket/uploads/u8/f.jpg"],
  ["前缀相近的别人", "gs://test-bucket/uploads/u77/f.jpg"],
  ["别的桶", "gs://other-bucket/uploads/u7/f.jpg"],
  ["本桶未登记对象", "gs://test-bucket/private/secret.jpg"],
  ["越界路径", "gs://test-bucket/uploads/u7/../u8/f.jpg"],
])("他人对象 gcsUri（%s）→ 403，不下载、不调模型", async (_name, gcsUri) => {
  const result = await scan([{ atSec: 0, dataUrl: DATA_URL }, { atSec: 1, gcsUri }]);
  expect(result.status).toBe(403);
  expect(result.body.error).toBe("gcs_uri_not_allowed");
  expectNothingTouched();
});

it.each([
  ["外部站点", "https://evil.example/a.jpg"],
  ["云元数据地址", "https://169.254.169.254/computeMetadata/v1/"],
  ["别的桶的存储链接", "https://storage.googleapis.com/other-bucket/uploads/u7/f.jpg?X-Goog-Signature=x"],
  ["本桶别人对象的签名链接", "https://storage.googleapis.com/test-bucket/uploads/u8/f.jpg?X-Goog-Signature=x"],
  ["仿冒存储域名", "https://storage.googleapis.com.evil.example/test-bucket/uploads/u7/f.jpg"],
  ["别人的任务产物直链", "https://blob.example/renders/8/frame.jpg"],
])("外部/他人 url（%s）→ 403，不代取、不调模型", async (_name, url) => {
  const result = await scan([{ atSec: 0, url }]);
  expect(result.status).toBe(403);
  expect(result.body.error).toBe("frame_url_not_allowed");
  expectNothingTouched();
});

it("非 https / 非 gs 的地址，以及把链接塞进 dataUrl 字段 → 400，不代取", async () => {
  for (const frame of [{ url: "http://127.0.0.1:8080/admin" }, { url: "file:///etc/passwd" }, { gcsUri: "s3://x/y" }, { dataUrl: "https://evil.example/a.jpg" }, { dataUrl: "data:text/html;base64,AAAA" }]) {
    expect((await scan([frame])).status).toBe(400);
  }
  expectNothingTouched();
});

it("本人素材放行：内联帧原样；本人前缀 gs、本桶本人签名链接、站内稳定链折成规范 gs://；本人任务产物直链全等放行", async () => {
  const result = await scan([
    { atSec: 0, dataUrl: DATA_URL, url: "https://evil.example/ignored.jpg" },
    { atSec: 1, gcsUri: "gs://test-bucket/uploads/u7/manhua-template-learn/frames/f.jpg" },
    { atSec: 2, url: "https://storage.googleapis.com/test-bucket/uploads/u7/f2.jpg?X-Goog-Signature=x" },
    { atSec: 3, url: "https://app.example/api/canvas-media/canvas-frames/job-1/f1.jpg" },
    { atSec: 4, url: OWN_JOB_URL },
    // 两个字段都给时以 gcsUri 为准，url 不会被另行抓取
    { atSec: 5, gcsUri: "gs://test-bucket/post-prod/7/f5.jpg", url: "https://evil.example/b.jpg" },
  ]);
  expect(result.status).toBe(200);
  expect(result.body.frameCount).toBe(6);
  expect(h.analyze).toHaveBeenCalledTimes(1);
  expect(h.analyze.mock.calls[0][0].frames.map((f: any) => [f.dataUrl, f.gcsUri, f.url])).toEqual([
    [DATA_URL, "", ""],
    ["", "gs://test-bucket/uploads/u7/manhua-template-learn/frames/f.jpg", ""],
    ["", "gs://test-bucket/uploads/u7/f2.jpg", ""],
    ["", "gs://test-bucket/canvas-frames/job-1/f1.jpg", ""],
    ["", "", OWN_JOB_URL],
    ["", "gs://test-bucket/post-prod/7/f5.jpg", ""],
  ]);
});

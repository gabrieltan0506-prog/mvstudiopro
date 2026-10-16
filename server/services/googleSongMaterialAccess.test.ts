import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), resolve: vi.fn(), sign: vi.fn(() => "https://example.test/signed") }));
vi.mock("../_core/sdk.js", () => ({ sdk: { authenticateRequest: mocks.authenticate } }));
vi.mock("./postProdMediaSource", () => ({ resolveRegisteredPostProdMediaSource: mocks.resolve }));
vi.mock("./gcs", async load => ({ ...(await load<Record<string, unknown>>()), signGsUriV4ReadUrl: mocks.sign }));
import handler from "../../api/google";
async function request(gcsUri: string) {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  await handler({ method: "GET", query: { op: "materialReadUrl", gcsUri }, headers: {} } as never, response as never);
  return response;
}
beforeEach(() => { vi.clearAllMocks(); mocks.authenticate.mockResolvedValue({ id: 7, role: "user" }); });
describe("SONG-R1-001 通用素材签名真实handler门禁", () => {
  const base = "gs://mv-studio-pro-vertex-video-temp/";
  it("未结算及JSON证据在签名前返回403", async () => {
    mocks.resolve.mockRejectedValue(new Error("not settled"));
    for (const object of ["song-operation-media/7/r/primary/0.mp3", "song-operations/7/r/result.json"]) {
      const response = await request(base + object);
      expect(response.status).toHaveBeenCalledWith(403);
    }
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("跨账号在验登记及签名前拒绝", async () => {
    const response = await request(base + "song-operation-media/8/r/primary/0.mp3");
    expect(response.status).toHaveBeenCalledWith(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("本人已登记成功产物才签发", async () => {
    const uri = base + "song-operation-media/7/r/primary/1.mp3";
    mocks.resolve.mockResolvedValue(uri);
    const response = await request(uri);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(mocks.sign).toHaveBeenCalledWith(uri, 3600);
    expect(mocks.resolve).toHaveBeenCalledWith({ userId: "7", source: uri });
  });
});

import { describe, expect, it, vi } from "vitest";
import { assertSongOperationMaterialRead } from "./songOperationMediaAccess";
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";
import { isRetiredGoogleVideoOp } from "../../shared/internalMediaEndpointPolicy";

const path = "song-operation-media/7/request/primary/0.mp3";
function resolver(objects: string[] = []) {
  return vi.fn((input: {userId: string; source: string}) => resolveRegisteredPostProdMediaSource(input, {
    getBucket: () => "test-bucket", verifyOwnership: async () => false,
    loadSucceededJobOutputObjects: async () => new Set(objects),
  }));
}
describe("SONG-R1-001 歌曲操作读签名边界", () => {
  it("本人未结算媒体不在成功任务登记中，拒绝签名", async () => {
    await expect(assertSongOperationMaterialRead(7, `gs://test-bucket/${path}`, resolver())).rejects.toThrow();
  });
  it("已结算成功任务全部变体可读取，跨账号不可借用", async () => {
    const second = path.replace("0.mp3", "1.mp3");
    const resolve = resolver([path, second]);
    for (const object of [path, second])
      await expect(assertSongOperationMaterialRead(7, `gs://test-bucket/${object}`, resolve)).resolves.toBeUndefined();
    resolve.mockClear();
    await expect(assertSongOperationMaterialRead(8, `gs://test-bucket/${path}`, resolve)).rejects.toThrow("无权");
    expect(resolve).not.toHaveBeenCalled();
  });
  it("服务端JSON证据不能通过通用签名暴露，规范化别名也不绕过", async () => {
    const resolve = resolver();
    for (const object of ["song-operations/7/request/result.json", "/song--operations/7/request/result.json"])
      await expect(assertSongOperationMaterialRead(7, `gs://test-bucket/${object}`, resolve)).rejects.toThrow("服务端");
    await expect(assertSongOperationMaterialRead(7, `gs://test-bucket//song--operation-media/7/request/primary/0.mp3`, resolve)).rejects.toThrow();
  });
  it("旧素材权限不扩大也不收紧，旧omni签名入口已停用", async () => {
    const resolve = resolver();
    await expect(assertSongOperationMaterialRead(7, "gs://test-bucket/canvas/image/old.png", resolve)).resolves.toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
    expect(isRetiredGoogleVideoOp("omniMaterialUrl")).toBe(true);
  });
});

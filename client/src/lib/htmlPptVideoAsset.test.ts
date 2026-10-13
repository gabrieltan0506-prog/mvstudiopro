import { afterEach, expect, it, vi } from "vitest";
import { loadPptVideoData } from "./htmlPptVideoAsset";

afterEach(() => vi.unstubAllGlobals());
const mp4 = Uint8Array.from([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109]);
it("读取已鉴权MP4并转为嵌入数据", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(mp4));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("FileReader", class {
    result = ""; onload?: () => void;
    async readAsDataURL(blob: Blob) { this.result = `data:video/mp4;base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`; this.onload?.(); }
  });
  const result = await loadPptVideoData("https://test.invalid/api/video");
  expect(result.bytes).toBe(mp4.length);
  expect(result.data).toBe(`data:video/mp4;base64,${Buffer.from(mp4).toString("base64")}`);
  expect(fetcher.mock.calls[0][1].credentials).toBe("include");
});
it("拒绝鉴权失败，不导出缺视频文件", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("拒绝", {status:403})));
  await expect(loadPptVideoData("test")).rejects.toThrow("未导出缺视频");
});
it("拒绝HTTP成功但内容为错误页", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>错误</html>")));
  await expect(loadPptVideoData("test")).rejects.toThrow("有效MP4");
});
it("超过单片上限时取消流，不继续加载", async () => {
  const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok:true,body:{cancel},headers:new Headers({"content-length":String(81*1024*1024)})}));
  await expect(loadPptVideoData("test")).rejects.toThrow("超过80MB");
  expect(cancel).toHaveBeenCalledTimes(1);
});

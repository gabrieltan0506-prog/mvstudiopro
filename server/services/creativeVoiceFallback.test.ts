import { describe, expect, it, vi } from "vitest";
import { connectCreativeVoiceWithFallback, creativeVoiceConnectionPlans } from "./creativeVoiceFallback";
describe("Live建立阶段备援", () => {
  it("Vertex成功不调用备用，普通模型两条路都不传推理档位", async () => {
    const connect = vi.fn().mockResolvedValue({ close: vi.fn() });
    const result = await connectCreativeVoiceWithFallback({ signal: new AbortController().signal, connect });
    expect(result.plan.route).toBe("vertex"); expect(connect).toHaveBeenCalledTimes(1);
    expect(creativeVoiceConnectionPlans(false).every(p => !p.generationConfig.thinkingConfig)).toBe(true);
  });
  it("Vertex建立失败后只尝试一次同模型Gemini API，并通知实际路由", async () => {
    const connect = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce({ close: vi.fn() });
    const onRoute = vi.fn();
    const result = await connectCreativeVoiceWithFallback({ signal: new AbortController().signal, connect, onRoute });
    expect(result.plan).toMatchObject({ route: "gemini-api", model: "gemini-3.8-live" });
    expect(connect).toHaveBeenCalledTimes(2); expect(onRoute.mock.calls.map(c => c[1])).toEqual([false, true]);
  });
  it("两端失败不循环重试，也不泄露原始错误", async () => {
    const connect = vi.fn().mockRejectedValue(new Error("secret-value"));
    await expect(connectCreativeVoiceWithFallback({ signal: new AbortController().signal, connect })).rejects.toMatchObject({ routes: ["vertex", "gemini-api"], message: expect.not.stringContaining("secret-value") });
    expect(connect).toHaveBeenCalledTimes(2);
  });
  it("用户取消不触发备用", async () => {
    const controller = new AbortController();
    const connect = vi.fn().mockImplementation(async () => { controller.abort(); throw new Error("closed"); });
    await expect(connectCreativeVoiceWithFallback({ signal: controller.signal, connect })).rejects.toMatchObject({ name: "AbortError" });
    expect(connect).toHaveBeenCalledTimes(1);
  });
  it("取消时晚到的成功连接被关闭", async () => {
    const controller = new AbortController(); const close = vi.fn();
    const connect = vi.fn().mockImplementation(async () => { controller.abort(); return { close }; });
    await expect(connectCreativeVoiceWithFallback({ signal: controller.signal, connect })).rejects.toMatchObject({ name: "AbortError" });
    expect(close).toHaveBeenCalledOnce(); expect(connect).toHaveBeenCalledOnce();
  });
  it("Extended只走已验证通道，固定HIGH，无MAX", async () => {
    const connect = vi.fn().mockResolvedValue({ close: vi.fn() });
    const { plan } = await connectCreativeVoiceWithFallback({ extended: true, signal: new AbortController().signal, connect });
    expect(plan).toMatchObject({ route: "gemini-api", model: "gemini-3.8-live-extended-thinking", generationConfig: { thinkingConfig: { thinkingLevel: "HIGH" }, maxOutputTokens: 2048 } });
    expect(connect).toHaveBeenCalledOnce();
  });
});

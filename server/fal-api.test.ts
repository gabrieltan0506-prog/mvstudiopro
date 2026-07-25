import { describe, it, expect } from "vitest";

// 活体凭证/网络探针：没有 FAL_API_KEY 或离线时跳过，避免把「本机没配 key」
// 报成产品缺陷。要真的验通道就显式设好 key 再跑。
const rawKey = String(process.env.FAL_API_KEY || "").trim();
// .env 里常留着「你的fal_api_key」这类中文占位符，Boolean() 会判成已配置，
// 结果拿占位符去打真接口必红。占位符一律当作没配。
const hasKey = rawKey.length > 10 && !/[\u4e00-\u9fa5]/.test(rawKey);

describe.skipIf(!hasKey)("fal.ai API Key validation", () => {
  it("should have FAL_API_KEY set", () => {
    expect(process.env.FAL_API_KEY).toBeDefined();
    expect(process.env.FAL_API_KEY!.length).toBeGreaterThan(10);
  });

  it("should be able to reach fal.ai API", async () => {
    const response = await fetch("https://queue.fal.run/fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d", {
      method: "POST",
      headers: {
        "Authorization": `Key ${process.env.FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input_image_url: "https://v3b.fal.media/files/b/0a865ab1/omYcawLUo4RZbO8J6ZgZR.png"
      }),
    });
    // 200 = queued successfully, 422 = validation error (but auth passed)
    // 401/403 = bad key
    expect([200, 422]).toContain(response.status);
  }, 15000);
});

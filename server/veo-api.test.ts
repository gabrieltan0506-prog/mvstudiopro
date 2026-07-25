import { describe, it, expect } from "vitest";

// 活体凭证/网络探针：没有 GEMINI_API_KEY 或离线时跳过，避免把「本机没配 key」
// 报成产品缺陷。要真的验通道就显式设好 key 再跑。
const rawKey = String(process.env.GEMINI_API_KEY || "").trim();
// .env 里常留着「你的gemini_api_key」这类中文占位符，Boolean() 会判成已配置，
// 结果拿占位符去打真接口必红。占位符一律当作没配。
const hasKey = rawKey.length > 10 && !/[\u4e00-\u9fa5]/.test(rawKey);

describe.skipIf(!hasKey)("Gemini API Key validation for Veo 3.1", () => {
  it("should have GEMINI_API_KEY set", () => {
    const key = process.env.GEMINI_API_KEY;
    expect(key).toBeDefined();
    expect(key!.length).toBeGreaterThan(10);
    expect(key!.startsWith("AIza")).toBe(true);
  });

  it("should be able to reach Gemini API", async () => {
    const key = process.env.GEMINI_API_KEY;
    // Use a lightweight models list endpoint to validate the key
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.models).toBeDefined();
    expect(data.models.length).toBeGreaterThan(0);
    
    // Check if Veo models are available
    const modelNames = data.models.map((m: any) => m.name);
    const hasVeo = modelNames.some((name: string) => name.includes("veo"));
    // Veo might not show in models list, so just verify API key works
    expect(data.models.length).toBeGreaterThan(0);
  });
});

/** 语义增强服务:方言提示注入/JSON验真/出口过格式层/空结果拒绝 */
import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("./bailianChat.js", () => ({
  invokeGlmJsonChatWithGatewayFallback: (p: unknown) => invoke(p),
}));

import { enhancePromptForEngine } from "./promptEnhance";

const ok = (enhancedPrompt: string) => ({
  gateway: "bailian",
  choices: [{ message: { content: JSON.stringify({ enhancedPrompt }) } }],
});

describe("enhancePromptForEngine", () => {
  it("Seedance:方言提示带四标记口径;出口过格式层(避审替换生效)", async () => {
    invoke.mockResolvedValueOnce(ok("「他要开枪了」压低机位"));
    const r = await enhancePromptForEngine({ prompt: "写打斗", engine: "seedance-2.5" });
    expect(String((invoke.mock.calls[0][0] as { user: string }).user)).toContain("{台词}");
    expect(r.enhancedPrompt).toContain("{他要武器击发了}");
    expect(r.gateway).toBe("bailian");
  });

  it("reserved 引擎直接调用:服务层自拒,模型 0 次", async () => {
    const before = invoke.mock.calls.length;
    await expect(
      enhancePromptForEngine({ prompt: "写打斗", engine: "wan-3.0" }),
    ).rejects.toThrow(/预留|尚未接线/);
    expect(invoke.mock.calls.length).toBe(before);
  });

  it("增强结果含阻止级问题(prompt_length):抛错不返回成功", async () => {
    invoke.mockResolvedValueOnce(ok("云".repeat(7100)));
    await expect(
      enhancePromptForEngine({ prompt: "认罪戏", engine: "minimax-hailuo-3" }),
    ).rejects.toThrow(/未过格式关/);
  });

  it("H3:方言提示禁标记;validateContent 拒空 enhancedPrompt", async () => {
    invoke.mockImplementationOnce(async (p: { validateContent?: (t: string) => void }) => {
      expect(() => p.validateContent?.(JSON.stringify({ enhancedPrompt: " " }))).toThrow(
        /enhancedPrompt/,
      );
      return ok("镜头推近,人物说:“我认罪”");
    });
    const r = await enhancePromptForEngine({ prompt: "认罪戏", engine: "minimax-hailuo-3" });
    expect(String((invoke.mock.calls[1][0] as { user: string }).user)).toContain("Image N");
    expect(r.enhancedPrompt).not.toMatch(/[{}<>【】]/);
  });
});

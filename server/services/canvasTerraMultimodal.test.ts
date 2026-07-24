import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn(),
  extractFirstChoicePlainText: vi.fn((r: unknown) => {
    const row = r as { choices?: Array<{ message?: { content?: string } }> };
    return String(row?.choices?.[0]?.message?.content || "");
  }),
}));

vi.mock("./gpt56CopywritingGateway.js", () => ({
  getOfficialOpenAiApiKey: vi.fn(() => "sk-test"),
}));

import { invokeLLM } from "../_core/llm";
import {
  runCanvasTerraVisionMarkdown,
  runCanvasTerraVideoReverse,
} from "./canvasTerraMultimodal";

describe("canvasTerraMultimodal", () => {
  beforeEach(() => {
    vi.mocked(invokeLLM).mockReset();
  });

  it("vision markdown uses official terra", async () => {
    vi.mocked(invokeLLM).mockResolvedValue({
      choices: [{ message: { content: "## 分析\n主体清晰" } }],
    } as never);
    const out = await runCanvasTerraVisionMarkdown({
      prompt: "归纳画面",
      images: [{ url: "https://cdn.example/a.jpg" }],
    });
    expect(out.markdown).toContain("主体清晰");
    expect(out.model).toBe("gpt-5.6-terra");
    expect(vi.mocked(invokeLLM)).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: "gpt-5.6-terra",
        openAiGateway: "official_only",
      }),
    );
  });

  it("video reverse uses official terra", async () => {
    vi.mocked(invokeLLM).mockResolvedValue({
      choices: [{ message: { content: "## 一句话摘要\n客栈对峙" } }],
    } as never);
    const out = await runCanvasTerraVideoReverse({
      userHint: "反推",
      images: [{ url: "data:image/jpeg;base64,aaaa" }],
      outputMode: "zh",
    });
    expect(out.markdown).toContain("客栈对峙");
    expect(out.frameCount).toBe(1);
  });
});

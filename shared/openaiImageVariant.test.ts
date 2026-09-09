import { describe, expect, it } from "vitest";
import { normalizeOpenAiImageVariant, OPENAI_IMAGE_MODEL_BY_VARIANT } from "./openaiImageVariant";
import { buildCanvasGptImage2JobInput } from "./canvasGptImage2JobInput";

describe("openaiImageVariant", () => {
  it("只认 flare/sunburst，模型名对应官方 gpt-image-2.5 两档", () => {
    expect(normalizeOpenAiImageVariant("Sunburst")).toBe("sunburst");
    expect(normalizeOpenAiImageVariant("gpt-image-2")).toBeNull();
    expect(OPENAI_IMAGE_MODEL_BY_VARIANT.flare).toBe("gpt-image-2.5-flare");
    expect(OPENAI_IMAGE_MODEL_BY_VARIANT.sunburst).toBe("gpt-image-2.5-sunburst");
  });
  it("job payload 带档位；非法值不带", () => {
    expect(buildCanvasGptImage2JobInput({ prompt: "p", openaiImageVariant: "sunburst" }).params.openaiImageVariant).toBe("sunburst");
    expect("openaiImageVariant" in buildCanvasGptImage2JobInput({ prompt: "p", openaiImageVariant: "x" }).params).toBe(false);
  });
});

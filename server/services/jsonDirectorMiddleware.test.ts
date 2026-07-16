import { describe, expect, it } from "vitest";
import {
  buildDirectorJsonFromIdea,
  compileI2VMotionPrompt,
  extractPlainImagePrompt,
  looksLikeDirectorJson,
  prepareJsonDirectorImageJob,
  stripDirectorNamesForDelivery,
  stringifyDirectorJson,
} from "../../shared/jsonDirectorMiddleware.js";

describe("jsonDirectorMiddleware", () => {
  it("strips director names for delivery", () => {
    const s = stripDirectorNamesForDelivery("Wes Anderson pastel symmetry, 布达佩斯大饭店 vibe");
    expect(s).not.toMatch(/Wes|安德森|布达佩斯/i);
    expect(s).toMatch(/pastel|symmetry/i);
  });

  it("builds JSON with cinematography lock", () => {
    const j = buildDirectorJsonFromIdea("粉彩对称的咖啡馆柜台，画册感", "9:16");
    expect(j.Project_Settings.aspect_ratio).toBe("9:16");
    expect(j.Cinematography_Lock.composition).toMatch(/symmetr/i);
    expect(stringifyDirectorJson(j)).toContain("Cinematography_Lock");
  });

  it("detects pasted director JSON", () => {
    const j = stringifyDirectorJson(buildDirectorJsonFromIdea("a rider", "16:9"));
    expect(looksLikeDirectorJson(j)).toBe(true);
    expect(looksLikeDirectorJson("just a cowboy")).toBe(false);
  });

  it("prepareJsonDirectorImageJob compiles or passes through", () => {
    const a = prepareJsonDirectorImageJob({ userPrompt: "雨夜东京街道", aspectRatio: "9:16" });
    expect(a.usedCompiledTemplate).toBe(true);
    expect(a.jsonText).toContain("Environment_Layer");
    expect(a.translationBrief).toMatch(/Cinematography_Lock/);

    const b = prepareJsonDirectorImageJob({
      userPrompt: a.jsonText,
      targetModel: "gpt-image-2",
    });
    expect(b.usedCompiledTemplate).toBe(false);
  });

  it("compileI2VMotionPrompt subtracts when reference image exists", () => {
    const long =
      "epic cinematic cyberpunk neon masterpiece 8k ultra detailed a lonely cowboy in canyon sunset film grain anamorphic lens volumetric godrays teal orange grade";
    const motion = compileI2VMotionPrompt(long, { hasReferenceImage: true });
    expect(motion.length).toBeLessThan(120);
    expect(motion).toMatch(/push-in|zoom|pan|orbit|static/i);
    expect(motion.toLowerCase()).not.toContain("cyberpunk");
    expect(motion.toLowerCase()).not.toContain("masterpiece");
  });

  it("keeps short motion prompts", () => {
    const p = "Slow cinematic zoom out, wind blowing the dust, horse breathing";
    expect(compileI2VMotionPrompt(p, { hasReferenceImage: true })).toBe(p);
  });

  it("extractPlainImagePrompt strips fences", () => {
    expect(extractPlainImagePrompt("```\nHello world shot\n```")).toBe("Hello world shot");
  });
});

import { describe, expect, it } from "vitest";
import {
  annotationFromRecipeId,
  compilePathAnnotationToMotionPrompt,
  normalizePathAnnotation,
  PATH_ANNOTATE_ANCHOR_MIN,
} from "./manhuaPathCameraAnnotate";
import {
  buildPathCameraInjectBlock,
  compilePathCameraRecipeToMotionPrompt,
  getPathCameraRecipeById,
  MANHUA_PATH_CAMERA_RECIPE_BANK,
  recommendPathCameraFromTopic,
} from "./manhuaPathCameraRecipeBank";
import {
  buildNarrativeLightingInjectBlock,
  MANHUA_NARRATIVE_LIGHTING_BANK,
  recommendNarrativeLightingFromTopic,
} from "./manhuaNarrativeLightingBank";
import {
  buildMaleHairstyleInjectBlock,
  MANHUA_MALE_HAIRSTYLE_PRESET_BANK,
} from "./manhuaMaleHairstylePresetBank";
import {
  buildMaleMicroExpressionInjectBlock,
  MANHUA_MALE_MICRO_EXPRESSION_BANK,
  recommendMaleMicroExpressionFromTopic,
} from "./manhuaMaleMicroExpressionBank";
import {
  buildPromoCoverInjectBlock,
  buildPromoCoverPrompt,
  MANHUA_PROMO_COVER_LAYOUTS,
} from "./manhuaPromoCoverLayouts";
import { compileI2VMotionPrompt } from "./jsonDirectorMiddleware";

describe("manhua path camera + P3 banks", () => {
  it("path recipe bank has 8 recipes with phases", () => {
    expect(MANHUA_PATH_CAMERA_RECIPE_BANK.length).toBe(8);
    for (const r of MANHUA_PATH_CAMERA_RECIPE_BANK) {
      expect(r.phases.length).toBeGreaterThanOrEqual(PATH_ANNOTATE_ANCHOR_MIN);
      expect(r.phases.length).toBeLessThanOrEqual(8);
    }
  });

  it("builds path inject without vendor names", () => {
    const block = buildPathCameraInjectBlock(["path_01_feet_to_face"]);
    expect(block).toContain("路径运镜");
    expect(block).toContain("脚到脸");
    expect(block).not.toMatch(/CanvasPro|阿硕|HyperFrames|EvoLink/i);
  });

  it("compiles recipe to timed motion prompt", () => {
    const r = getPathCameraRecipeById("path_01_feet_to_face")!;
    const motion = compilePathCameraRecipeToMotionPrompt(r);
    expect(motion).toMatch(/0-\d+s: camera/);
    expect(motion).toMatch(/subject/);
    expect(motion).toMatch(/One primary path move/);
  });

  it("annotation JSON compiles and feeds I2V priority", () => {
    const ann = annotationFromRecipeId("path_05_action_burst")!;
    const motion = compilePathAnnotationToMotionPrompt(ann);
    expect(motion).toMatch(/action|impact|stance/i);
    const viaI2V = compileI2VMotionPrompt("ignore long cyberpunk masterpiece 8k", {
      hasReferenceImage: true,
      pathAnnotationJson: ann,
    });
    expect(viaI2V).toBe(motion);
    const viaRecipe = compileI2VMotionPrompt("ignore", {
      hasReferenceImage: true,
      pathCameraRecipeId: "path_03_evidence_push",
    });
    expect(viaRecipe).toMatch(/evidence|reaction/i);
  });

  it("rejects annotation with too few anchors", () => {
    expect(
      normalizePathAnnotation({
        version: 1,
        anchors: [
          { x: 0.5, y: 0.8, focusZh: "a" },
          { x: 0.5, y: 0.5, focusZh: "b" },
        ],
      }),
    ).toBeNull();
  });

  it("recommends path from topic", () => {
    expect(recommendPathCameraFromTopic("江湖刀光打斗交锋").recipeId).toBe("path_05_action_burst");
    expect(recommendPathCameraFromTopic("证据揭穿翻盘").recipeId).toBe("path_03_evidence_push");
  });

  it("narrative lighting bank", () => {
    expect(MANHUA_NARRATIVE_LIGHTING_BANK.length).toBe(8);
    const block = buildNarrativeLightingInjectBlock(["nlight_07_light_the_evidence"]);
    expect(block).toContain("照亮证据");
    expect(recommendNarrativeLightingFromTopic("罪证揭穿").lightingId).toBe(
      "nlight_07_light_the_evidence",
    );
  });

  it("male hairstyle presets 18", () => {
    expect(MANHUA_MALE_HAIRSTYLE_PRESET_BANK.length).toBe(18);
    const block = buildMaleHairstyleInjectBlock(["mhair_04_warrior_braid"]);
    expect(block).toContain("战辫");
    expect(block).not.toMatch(/微信|元点Agent|AI-CanvasPro/i);
  });

  it("male micro expressions", () => {
    expect(MANHUA_MALE_MICRO_EXPRESSION_BANK.length).toBe(10);
    const block = buildMaleMicroExpressionInjectBlock(["mmicro_04_angry_stare"]);
    expect(block).toContain("愤怒对视");
    expect(recommendMaleMicroExpressionFromTopic("咬牙逞强").expressionId).toBe("mmicro_03_grit_teeth");
  });

  it("promo cover layouts", () => {
    expect(MANHUA_PROMO_COVER_LAYOUTS.length).toBe(8);
    const layout = MANHUA_PROMO_COVER_LAYOUTS[0]!;
    const prompt = buildPromoCoverPrompt(layout, { subjectZh: "红甲将军", sceneZh: "边关烽火" });
    expect(prompt).toMatch(/剪影|double exposure|silhouette/i);
    expect(prompt).toContain("红甲将军");
    const block = buildPromoCoverInjectBlock(["promo_01_silhouette_landscape"]);
    expect(block).toContain("宣发");
    expect(block).not.toMatch(/微信|抖音|小红书/i);
  });
});

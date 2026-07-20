import { describe, expect, it } from "vitest";
import {
  annotationFromRecipeId,
  compilePathAnnotationToMotionPrompt,
  downsampleStrokeToAnchors,
  mergeTrackAnchors,
  normalizePathAnnotation,
  upsertStroke,
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
import { GRAPHIC_NOTE_FUSION_TEMPLATES } from "./graphicNoteFusionTemplates";
import { INFOGRAPHIC_NOTE_TEMPLATES, listInfographicTemplatesByMode } from "./infographicNoteTemplates";
import {
  buildActionCameraInjectBlock,
  MANHUA_ACTION_CAMERA_RECIPE_BANK,
} from "./manhuaActionCameraRecipeBank";
import { formatCineVocabInjectBlock, MANHUA_CINE_VOCAB_BANK } from "./manhuaCineVocabBank";
import {
  buildWardrobePropContinuityInjectBlock,
  MANHUA_WARDROBE_PROP_CONTINUITY_BANK,
} from "./manhuaWardrobePropContinuity";
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
    expect(motion).toMatch(/\d+[–-]\d+秒：镜头/);
    expect(motion).toContain("【路径】");
    expect(motion).toMatch(/每镜一个主运镜/);
  });

  it("annotation JSON compiles and feeds I2V priority", () => {
    const ann = annotationFromRecipeId("path_05_action_burst")!;
    const motion = compilePathAnnotationToMotionPrompt(ann);
    expect(motion).toMatch(/动作|交锋|对峙|爆发|【路径】/);
    const viaI2V = compileI2VMotionPrompt("ignore long cyberpunk masterpiece 8k", {
      hasReferenceImage: true,
      pathAnnotationJson: ann,
    });
    expect(viaI2V).toBe(motion);
    const viaRecipe = compileI2VMotionPrompt("ignore", {
      hasReferenceImage: true,
      pathCameraRecipeId: "path_03_evidence_push",
    });
    expect(viaRecipe).toMatch(/证据|揭穿|反应|【路径】/);
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
    expect(MANHUA_PROMO_COVER_LAYOUTS.length).toBeGreaterThanOrEqual(11);
    const layout = MANHUA_PROMO_COVER_LAYOUTS[0]!;
    const prompt = buildPromoCoverPrompt(layout, { subjectZh: "红甲将军", sceneZh: "边关烽火" });
    expect(prompt).toMatch(/剪影|double exposure|silhouette/i);
    expect(prompt).toContain("红甲将军");
    const block = buildPromoCoverInjectBlock(["promo_01_silhouette_landscape"]);
    expect(block).toContain("宣发");
    expect(block).not.toMatch(/微信|抖音|小红书/i);
  });
});

describe("fusion + action dual-track + MIT vocab/wardrobe", () => {
  it("fusion templates ban watermarks and wire into infographic picker groups", () => {
    expect(GRAPHIC_NOTE_FUSION_TEMPLATES.length).toBe(6);
    for (const t of GRAPHIC_NOTE_FUSION_TEMPLATES) {
      expect(t.layoutPromptEn).toMatch(/no watermark/i);
      expect(t.layoutPromptEn).not.toMatch(/微信|抖音|小红书|元点|AI-CanvasPro/i);
      expect(t.compositionZh).toContain("禁止水印");
    }
    expect(INFOGRAPHIC_NOTE_TEMPLATES.some((t) => t.heroMode === "fusion")).toBe(true);
    const fusionGroup = listInfographicTemplatesByMode().find((g) => g.mode.id === "fusion");
    expect(fusionGroup?.items.length).toBe(6);
  });

  it("action recipes inject without vendor brands", () => {
    expect(MANHUA_ACTION_CAMERA_RECIPE_BANK.length).toBe(3);
    const block = buildActionCameraInjectBlock(["action_dual_track_oner"]);
    expect(block).toContain("动作运镜");
    expect(block).toContain("红轨");
    expect(block).not.toMatch(/CanvasPro|阿硕|李一帆|Seedance-2\.0|DirectorSKILL/i);
  });

  it("downsamples stroke and keeps dense stroke for display", () => {
    const stroke = Array.from({ length: 40 }, (_, i) => ({
      x: 0.1 + i * 0.02,
      y: 0.8 - i * 0.015,
    }));
    const red = downsampleStrokeToAnchors(stroke, "subject", { maxPoints: 4 });
    expect(red.length).toBeGreaterThanOrEqual(2);
    expect(red.length).toBeLessThanOrEqual(4);
    expect(red.every((a) => a.trackRole === "subject")).toBe(true);
    const blue = downsampleStrokeToAnchors(
      [
        { x: 0.2, y: 0.2 },
        { x: 0.5, y: 0.4 },
        { x: 0.8, y: 0.3 },
      ],
      "camera",
      { maxPoints: 3 },
    );
    const merged = mergeTrackAnchors(red, blue, "camera");
    expect(merged.some((a) => a.trackRole === "subject")).toBe(true);
    expect(merged.some((a) => a.trackRole === "camera")).toBe(true);
    const strokes = upsertStroke(undefined, "subject", stroke);
    expect(strokes[0]?.points.length).toBeGreaterThan(red.length);
    const normalized = normalizePathAnnotation({
      version: 1,
      anchors: merged,
      strokes,
      actionRecipeId: "action_dual_track_oner",
    });
    expect(normalized?.strokes?.[0]?.points.length).toBeGreaterThan(4);
  });

  it("dual-track annotation compiles red/blue roles", () => {
    const motion = compilePathAnnotationToMotionPrompt({
      version: 1,
      actionRecipeId: "action_dual_track_oner",
      anchors: [
        {
          index: 1,
          x: 0.2,
          y: 0.8,
          focusZh: "起势",
          cameraEn: "slow orbit start",
          subjectActionEn: "draw blade",
          durationHintSec: 2,
          trackRole: "subject",
        },
        {
          index: 2,
          x: 0.5,
          y: 0.5,
          focusZh: "交锋",
          cameraEn: "bypass subject left",
          subjectActionEn: "dodge and strike",
          durationHintSec: 2,
          trackRole: "subject",
        },
        {
          index: 3,
          x: 0.3,
          y: 0.4,
          focusZh: "绕过",
          cameraEn: "lateral bypass",
          subjectActionEn: "hold stance",
          durationHintSec: 2,
          trackRole: "camera",
        },
        {
          index: 4,
          x: 0.7,
          y: 0.3,
          focusZh: "落幅",
          cameraEn: "settle on face",
          subjectActionEn: "exhale",
          durationHintSec: 2,
          trackRole: "camera",
        },
      ],
    });
    expect(motion).toMatch(/红轨|人物节拍/);
    expect(motion).toMatch(/蓝轨|镜头节拍/);
    expect(motion).toMatch(/最终画面不显示|成片不显示轨迹/);
    const viaI2V = compileI2VMotionPrompt("ignore", {
      hasReferenceImage: true,
      pathAnnotationJson: {
        version: 1,
        actionRecipeId: "action_dual_track_oner",
        anchors: [
          {
            index: 1,
            x: 0.2,
            y: 0.8,
            focusZh: "a",
            cameraEn: "push",
            subjectActionEn: "run",
            durationHintSec: 2,
            trackRole: "subject",
          },
          {
            index: 2,
            x: 0.4,
            y: 0.6,
            focusZh: "b",
            cameraEn: "track",
            subjectActionEn: "slash",
            durationHintSec: 2,
            trackRole: "subject",
          },
          {
            index: 3,
            x: 0.6,
            y: 0.4,
            focusZh: "c",
            cameraEn: "orbit",
            subjectActionEn: "hold",
            durationHintSec: 2,
            trackRole: "camera",
          },
          {
            index: 4,
            x: 0.8,
            y: 0.3,
            focusZh: "d",
            cameraEn: "settle",
            subjectActionEn: "breathe",
            durationHintSec: 2,
            trackRole: "camera",
          },
        ],
      },
    });
    expect(viaI2V).toMatch(/红蓝双轨|人物节拍|红轨/);
  });

  it("cine vocab and wardrobe have no director names", () => {
    expect(MANHUA_CINE_VOCAB_BANK.length).toBeGreaterThanOrEqual(20);
    const cine = formatCineVocabInjectBlock(["mv_orbit", "lt_rim"]);
    expect(cine).toContain("环绕");
    expect(cine).toContain("禁止导演名");
    expect(cine).not.toMatch(/诺兰|维拉·诺瓦|王家卫|昆汀|Christopher Nolan/i);
    for (const e of MANHUA_CINE_VOCAB_BANK) {
      expect(`${e.zh} ${e.en}`).not.toMatch(/诺兰|王家卫|昆汀|Nolan|Tarantino/i);
    }
    expect(MANHUA_WARDROBE_PROP_CONTINUITY_BANK.length).toBeGreaterThanOrEqual(6);
    const wardrobe = buildWardrobePropContinuityInjectBlock(["wpc_01_xianxia_sword"]);
    expect(wardrobe).toContain("服装道具连续");
    expect(wardrobe).toContain("佩剑");
    expect(wardrobe).not.toMatch(/Emily2040|g0dam|video-studio-skills/i);
  });
});

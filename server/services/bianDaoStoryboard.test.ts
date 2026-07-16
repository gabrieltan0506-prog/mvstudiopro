import { describe, expect, it } from "vitest";
import {
  BIAN_DAO_STORYBOARD_LABEL_ZH,
  enrichScriptContextWithBianDaoDirectorBoard,
} from "../../shared/bianDaoStoryboard";
import {
  CRAFT_TECHNIQUE_PROFILES,
  STAGE2_LIGHTING_EMOTION_DIRECTOR_HINT_ZH,
  pickCraftTechniqueProfile,
} from "../../shared/storyboardLightingEmotion";
import { buildCompositeSheetDirectChineseBody } from "./geminiPlatformCompositeTranslation";

describe("bianDaoStoryboard", () => {
  it("exports product label 编导分镜图", () => {
    expect(BIAN_DAO_STORYBOARD_LABEL_ZH).toBe("编导分镜图");
  });

  it("injects director board for storyboard kind", () => {
    const out = enrichScriptContextWithBianDaoDirectorBoard("【选题】测试", {
      sheetKind: "storyboard",
    });
    expect(out).toContain("【编导分镜·导演板");
    expect(out).toContain("【选题】测试");
    expect(out).toContain("起—承—转—合");
  });

  it("injects craft card when craftSeed provided", () => {
    const out = enrichScriptContextWithBianDaoDirectorBoard("【选题】测试", {
      sheetKind: "storyboard",
      craftSeed: "dim-0",
      craftSlotLabel: "维度1",
    });
    expect(out).toContain("【本条导演灵感画布·主手法卡】");
    expect(out).toContain("导演灵感画布");
  });

  it("is idempotent and skips bare graphic notes without seed", () => {
    const once = enrichScriptContextWithBianDaoDirectorBoard("脚本", { sheetKind: "storyboard" });
    const twice = enrichScriptContextWithBianDaoDirectorBoard(once, { sheetKind: "storyboard" });
    expect(twice).toBe(once);
    expect(
      enrichScriptContextWithBianDaoDirectorBoard("图文", { sheetKind: "graphic" }),
    ).toBe("图文");
  });

  it("rotates craft profiles across stage2 dims", () => {
    const ids = [0, 1, 2, 3, 4, 5].map((i) => pickCraftTechniqueProfile(`stage2-dim-${i}:x`).id);
    expect(new Set(ids).size).toBeGreaterThan(1);
    expect(ids.every((id) => CRAFT_TECHNIQUE_PROFILES.some((p) => p.id === id))).toBe(true);
  });

  it("stage2 hint frames 导演灵感画布", () => {
    expect(STAGE2_LIGHTING_EMOTION_DIRECTOR_HINT_ZH).toContain("导演灵感画布");
    expect(STAGE2_LIGHTING_EMOTION_DIRECTOR_HINT_ZH).toContain("每条选题主用 1 种手法卡");
  });

  it("chinese body names 编导分镜图 and keeps six-column table", () => {
    const body = buildCompositeSheetDirectChineseBody(
      "storyboard_sheet_landscape",
      "【选题】测试脚本",
    );
    expect(body).toContain("编导分镜图");
    expect(body).toContain("景别 / 运镜 / 灯光安排 / 情绪表达 / 画面内容 / 台词与音效");
    expect(body).toContain("起承转合");
  });
});

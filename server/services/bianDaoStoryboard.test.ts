import { describe, expect, it } from "vitest";
import {
  BIAN_DAO_STORYBOARD_LABEL_ZH,
  enrichScriptContextWithBianDaoDirectorBoard,
} from "../../shared/bianDaoStoryboard";
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

  it("is idempotent and skips graphic notes", () => {
    const once = enrichScriptContextWithBianDaoDirectorBoard("脚本", { sheetKind: "storyboard" });
    const twice = enrichScriptContextWithBianDaoDirectorBoard(once, { sheetKind: "storyboard" });
    expect(twice).toBe(once);
    expect(
      enrichScriptContextWithBianDaoDirectorBoard("图文", { sheetKind: "graphic" }),
    ).toBe("图文");
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

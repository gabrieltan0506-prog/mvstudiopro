import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WORKBENCH = readFileSync(
  new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url),
  "utf8",
);
const CANVAS = readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");

describe("漫剧参考图导入接线", () => {
  it("剧本未确认时允许进入资产页，但分镜与剪辑仍受门禁保护", () => {
    expect(WORKBENCH).toContain(
      'activePhase !== "outline" && activePhase !== "assets"',
    );
    expect(WORKBENCH).toContain('data-manhua-action="open-assets-for-upload"');
    expect(WORKBENCH).toContain('if ((phase === "storyboard" || phase === "edit") && !outlineComplete)');
    expect(WORKBENCH).toContain("生成设定图和进入分镜仍需先确认剧本大纲");
  });

  it("资产页顶部固定提供四个分类上传入口", () => {
    expect(WORKBENCH).toContain("data-manhua-quick-asset-upload");
    for (const role of ["character", "scene", "wardrobe", "prop"]) {
      expect(WORKBENCH).toContain(`["${role}",`);
    }
    for (const label of ["导入人物图", "导入场景图", "导入服装图", "导入道具图"]) {
      expect(WORKBENCH).toContain(label);
    }
    expect(WORKBENCH).toContain("void onUploadCustomAssets(files, role)");
  });

  it("上传沿用现有签名直传生产链，并保存可续签的 GCS 地址", () => {
    const start = CANVAS.indexOf("const uploadCustomAssetFiles = useCallback");
    const end = CANVAS.indexOf("const importPropSheetFile = useCallback", start);
    const uploadFlow = CANVAS.slice(start, end);
    expect(uploadFlow).toContain("uploadCanvasFilesParallel");
    expect(uploadFlow).toContain("getSignedUrlMutation.mutateAsync");
    expect(uploadFlow).toContain("normalizeManhuaCustomAssetRole(role)");
    expect(uploadFlow).toContain("gcsUri: a.gcsUri");
    expect(uploadFlow).toContain('resolvedRole === "wardrobe"');
  });

  it("未确认剧本时资产页的付费生成与 AI 编辑按钮保持禁用", () => {
    expect(WORKBENCH.match(/disabled=\{!outlineComplete \|\|/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
});

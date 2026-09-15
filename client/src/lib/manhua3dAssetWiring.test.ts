import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WORKBENCH = readFileSync(new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url), "utf8");
const PANEL = readFileSync(new URL("../components/canvas/Manhua3dAssetImportPanel.tsx", import.meta.url), "utf8");

describe("PR-3 3D 资产链最小接线", () => {
  it("面板只挂在已完成 3D 任务的人物卡里，OmniCanvas 不改", () => {
    expect(WORKBENCH).toContain('currentModel3d?.status === "succeeded" ? (\n                                    <Manhua3dAssetImportPanel');
    expect(WORKBENCH).toContain("sourceJobId={currentModel3d.taskId}");
    expect(WORKBENCH).toContain("assetRef={ref.id}");
  });

  it("面板：不可用态带原因、单位轴向必选、只校验不生成、只有 verified 才能采用", () => {
    expect(PANEL).toContain("data-manhua-3d-asset-panel");
    expect(PANEL).toContain("Lux3D 不可用：");
    expect(PANEL).toContain("capability.data?.reasonZh");
    expect(PANEL).toContain('单位（必选）');
    expect(PANEL).toContain('轴向（必选）');
    expect(PANEL).toContain("disabled={disabled || busy || !ready}");
    expect(PANEL).toContain("导入 GLB 校验（不生成）");
    expect(PANEL).toContain('latest.verification.status === "verified" && !latest.adoptedAt');
    expect(PANEL).toContain("被拒：");
    expect(PANEL).not.toMatch(/manhua3d\.submit|generate|text-to-3d|img-to-3d/);
  });
});

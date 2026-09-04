import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CANVAS = readFileSync(
  new URL("../pages/OmniCanvas.tsx", import.meta.url),
  "utf8"
);
const WORKBENCH = readFileSync(
  new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url),
  "utf8"
);

describe("漫剧人物 3D 可选增强接线", () => {
  it("只在人物卡内出现，不新增顶级工作流阶段", () => {
    expect(WORKBENCH).toContain('ref.role === "character" && cardExpanded');
    expect(WORKBENCH).toContain("建立 3D 参考（可选）");
    expect(WORKBENCH).toContain("不影响默认出片");
    expect(WORKBENCH).not.toContain('id: "model3d"');
  });

  it("前端只向管理员与监管角色暴露，提交前必须二次确认成本", () => {
    expect(CANVAS).toContain(
      'user?.role === "admin" || user?.role === "supervisor"'
    );
    expect(CANVAS).toContain("外部生成服务并产生实际调用成本");
    expect(CANVAS).toContain("submitManhua3dMutation.mutateAsync");
    expect(CANVAS).toContain("sourceVersion: ref.gcsUri || ref.url");
  });

  it("任务完成后同时写入 GCS 身份和预览地址，并支持刷新后续查", () => {
    expect(CANVAS).toContain("glbGcsUri: task.glbGcsUri || undefined");
    expect(CANVAS).toContain("glbUrl: task.glbUrl || undefined");
    expect(CANVAS).toContain("trpcUtils.manhua3d.getStatus.fetch");
    expect(WORKBENCH).toContain("<ModelViewer glbUrl={model3dPreview.url}");
  });
});

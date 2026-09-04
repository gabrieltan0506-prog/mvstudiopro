import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CANVAS = readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");
const WORKBENCH = readFileSync(
  new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url),
  "utf8",
);

describe("漫剧人物候选图当前版本接线", () => {
  it("人物卡显示当前状态与单一切换动作，不删除候选", () => {
    expect(WORKBENCH).toContain('`设为当前${primaryDuty === "identity" ? "锁脸" : "妆造"}`');
    expect(WORKBENCH).toContain('primaryDuty === "identity" ? "锁脸" : "妆造"');
    expect(WORKBENCH).toContain("候选保留");
    expect(WORKBENCH).toContain("data-manhua-primary-ref");
    expect(WORKBENCH).toContain("aria-pressed={isPrimaryRef}");
    expect(WORKBENCH).toContain("先认领一个剧本人物");
  });

  it("页面通过共用纯函数更新并明确候选不进入生成", () => {
    expect(CANVAS).toContain("selectManhuaCharacterPrimaryRef");
    expect(CANVAS).toContain("onSetCharacterPrimaryRef={setCharacterPrimaryRef}");
    expect(CANVAS).toContain("不会再作为额外角色进入生成");
  });

  it("图片编辑、去字与标准化的新版本不会自动抢占当前图", () => {
    expect(CANVAS.match(/primaryBindings: \[\]/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

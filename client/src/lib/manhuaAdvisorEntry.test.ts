import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isManhuaAdvisorPage, MANHUA_ADVISOR_STAGE_LABELS, getManhuaAdvisorScope, publishManhuaAdvisorScope, subscribeManhuaAdvisorScope } from "./manhuaAdvisorEntry";

describe("漫剧顾问入口范围", () => {
  it("查看模板入口不会撤销剧本确认，也不调用付费生成", () => {
    const source = readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");
    const handler = source.split("onRequestTrial={(tpl) => {")[1]?.split("}}\n")[0] || "";
    expect(handler).toContain("setPublicTemplateId(tpl.publicId)");
    expect(handler).toContain('setImmersiveWorkspaceView("topic")');
    expect(handler).not.toMatch(/setWriterConfirmed\(|setCustomAssetRefs\(|\.mutate(?:Async)?\(|void expandWriterRoom\(/);
  });
  it("只接管漫剧所在页面，不向其他页面开放管理工具", () => {
    expect(isManhuaAdvisorPage("/canvas", true)).toBe(true);
    expect(isManhuaAdvisorPage("/canvas/?tab=manhua", true)).toBe(true);
    expect(isManhuaAdvisorPage("/canvas", false)).toBe(false);
    expect(isManhuaAdvisorPage("/canvas?tab=manhua")).toBe(false);
    for (const path of ["/platform", "/research", "/canvas-other", "/"]) {
      expect(isManhuaAdvisorPage(path, true)).toBe(false);
    }
  });
  it("真实模式切换和卸载能同步顶栏与旧工具，不依赖缓存", () => {
    publishManhuaAdvisorScope(false);
    const seen: boolean[] = [];
    const unsubscribe = subscribeManhuaAdvisorScope(() => seen.push(getManhuaAdvisorScope()));
    publishManhuaAdvisorScope(true);
    publishManhuaAdvisorScope(true);
    publishManhuaAdvisorScope(false);
    unsubscribe();
    expect(seen).toEqual([true, false]);
    const host = readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");
    expect(host).toContain('publishManhuaAdvisorScope(canvasMode === "manhua")');
    expect(host).toContain("return () => publishManhuaAdvisorScope(false)");
    const producer = host.split("const advisorProject = useMemo(")[1]?.split("/**")[0];
    expect(producer).toContain("videoModel: explicitWriterVideoModel");
    expect(producer).not.toContain("videoModel: writerVideoModel");
  });
  it("阶段名与五阶段工作台一致", () => {
    expect(Object.values(MANHUA_ADVISOR_STAGE_LABELS)).toEqual([
      "剧本大纲", "资产设定", "分镜", "成片", "终审",
    ]);
  });
});

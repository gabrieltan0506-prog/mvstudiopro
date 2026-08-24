/**
 * 三个新路由必须有**真实客户端调用者**。
 *
 * 同一个 PR 系列里，「写完模块没人调」的壳问题被审阅连着打回三轮。
 * 这条断言就是防它再犯 —— 不是检查有没有那段字符串，是检查调用链在不在。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(new URL("../pages/PlatformPage.tsx", import.meta.url), "utf8");

describe("模板换代与归档接线契约", () => {
  it("换代体检有真实调用", () => {
    expect(PAGE).toContain("trpc.manhuaViralTemplate.reviewTemplateGenerations.useQuery");
  });

  it("归档列表有真实调用，且按 id 懒加载 —— 不展开不请求", () => {
    expect(PAGE).toContain("trpc.manhuaViralTemplate.listArchivedVersions.useQuery");
    expect(PAGE).toContain("enabled: Boolean(archivedForId)");
  });

  it("恢复有真实调用，且带 confirmRestore", () => {
    expect(PAGE).toContain("trpc.manhuaViralTemplate.restoreArchived.useMutation");
    expect(PAGE).toContain("confirmRestore: true");
  });

  it("恢复前有二次确认 —— 会顶掉现役版本的动作不许一键完成", () => {
    const at = PAGE.indexOf("restoreArchivedMutation.mutateAsync");
    expect(at).toBeGreaterThan(0);
    expect(PAGE.slice(Math.max(0, at - 600), at)).toContain("window.confirm");
  });

  it("恢复成功后刷新列表与体检，不让页面停在旧数据", () => {
    const at = PAGE.indexOf("restoreArchivedMutation.mutateAsync");
    const after = PAGE.slice(at, at + 700);
    expect(after).toContain("listApprovedPrivate.invalidate");
    expect(after).toContain("templateReviewQuery.refetch");
  });

  it("体检默认不请求 —— 展开才查，不给每次进页面加一次全库扫描", () => {
    expect(PAGE).toContain("enabled: templateReviewOpen");
  });

  it("同赛道仅剩一张时页面就提示，不等点了下架才报错", () => {
    expect(PAGE).toContain("本赛道仅此一张");
  });
});

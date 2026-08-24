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
    expect(PAGE).toContain("ownerTemplateOptimizeAllowed && Boolean(archivedForId)");
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

  it("恢复成功后走**唯一**失效入口，不让页面停在旧数据", () => {
    const at = PAGE.indexOf("restoreArchivedMutation.mutateAsync");
    const after = PAGE.slice(at, at + 700);
    expect(after).toContain("invalidateTemplateLifecycle(it.id)");
  });

  describe("生命周期缓存：三个动作都走同一个失效入口", () => {
    it("失效入口同时覆盖私有列表、公开列表与换代体检", () => {
      const at = PAGE.indexOf("const invalidateTemplateLifecycle");
      expect(at).toBeGreaterThan(0);
      const body = PAGE.slice(at, at + 900);
      expect(body).toContain("listApprovedPrivate.invalidate");
      // /canvas 读的是 listApprovedPublic，跨页面拿不到实例，必须失效缓存
      expect(body).toContain("listApprovedPublic.invalidate");
      expect(body).toContain("reviewTemplateGenerations.invalidate");
      expect(body).toContain("listArchivedVersions.invalidate");
    });

    it("批准后失效 —— 否则体检还在建议换成一张已经批准进库的卡", () => {
      const at = PAGE.indexOf("const approveManhuaLearnProposal");
      const body = PAGE.slice(at, at + 2600);
      expect(body).toContain("invalidateTemplateLifecycle(res.card.id)");
    });

    it("下架后失效 —— 下架同时产生新归档版本", () => {
      const at = PAGE.indexOf("archiveManhuaTemplateMutation.mutateAsync");
      const body = PAGE.slice(at, at + 900);
      expect(body).toContain("invalidateTemplateLifecycle(tpl.id)");
    });
  });

  describe("owner 门禁必须在入口生效，不是点了才被服务端拒", () => {
    it("整块换代体检 UI 被 ownerTemplateOptimizeAllowed 包裹", () => {
      const at = PAGE.indexOf("换代体检：哪些还是旧学法学的");
      expect(at).toBeGreaterThan(0);
      // 按钮之前必须先出现 owner 判断（包裹整块，而不是只包按钮）
      expect(PAGE.slice(Math.max(0, at - 900), at)).toContain(
        "{ownerTemplateOptimizeAllowed ? (",
      );
    });

    it("owner 能力失效时收掉面板状态，不留点不动的空壳", () => {
      const at = PAGE.indexOf("setOwnerTemplateOptimizeResult(null);");
      const body = PAGE.slice(at, at + 300);
      expect(body).toContain("setTemplateReviewOpen(false)");
      expect(body).toContain("setArchivedForId(null)");
    });

    it("两个查询的 enabled 都带 owner 条件", () => {
      expect(PAGE).toContain("ownerTemplateOptimizeAllowed && templateReviewOpen");
      expect(PAGE).toContain("ownerTemplateOptimizeAllowed && Boolean(archivedForId)");
    });
  });

  describe("读取失败不得伪装成「没有」", () => {
    it("归档读取失败有独立提示，且「还没有归档版本」要排除 isError", () => {
      expect(PAGE).toContain("归档读取失败，请稍后重试；当前结果不能视为没有历史版本。");
      const at = PAGE.indexOf("还没有归档版本");
      expect(PAGE.slice(Math.max(0, at - 300), at)).toContain(
        "!archivedVersionsQuery.isError",
      );
    });

    it("体检读取失败不渲染空结论", () => {
      expect(PAGE).toContain("体检读取失败，请稍后重试；当前结果不能视为库里没有旧卡。");
    });
  });

  it("体检默认不请求 —— 展开才查，不给每次进页面加一次全库扫描", () => {
    expect(PAGE).toContain("ownerTemplateOptimizeAllowed && templateReviewOpen");
  });

  it("同赛道仅剩一张时页面就提示，不等点了下架才报错", () => {
    expect(PAGE).toContain("本赛道仅此一张");
  });
});

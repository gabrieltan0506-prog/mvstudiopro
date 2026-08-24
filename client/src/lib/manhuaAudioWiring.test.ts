/**
 * 三个新路由必须有**真实客户端调用者**的源码契约测试。
 *
 * 本 PR 前两轮都栽在同一件事上：模块写完了、测试全绿，但全仓没人调 ——
 * 「产出没有消费端等于没产出」。这条断言就是防它再犯。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CARD = readFileSync(
  new URL("../components/canvas/PostProdWorkshopCard.tsx", import.meta.url),
  "utf8",
);

describe("配乐间接线契约", () => {
  it("起草口有真实调用 —— 且必须是免费的那个", () => {
    expect(CARD).toContain("utils.mvAnalysis.manhuaComposeBgmBrief.fetch");
  });

  it("生成口有真实调用", () => {
    expect(CARD).toContain("trpc.mvAnalysis.manhuaGenerateBgm.useMutation");
    expect(CARD).toContain("generateBgmMutation.mutateAsync");
  });

  it("确认时才产生幂等号 —— 起草阶段不该有", () => {
    const at = CARD.indexOf("const submitScoring");
    expect(at).toBeGreaterThan(0);
    expect(CARD.slice(at, at + 900)).toContain("crypto.randomUUID()");
  });

  it("提交前过 canSubmitManhuaBgm，不靠 UI 禁用兜底", () => {
    expect(CARD).toContain("canSubmitManhuaBgm({");
  });

  it("jobId 持久化 + 刷新恢复，否则用户只会再点一次 = 再付一次", () => {
    expect(CARD).toContain("writePendingManhuaBgmJob(window.localStorage");
    expect(CARD).toContain("readPendingManhuaBgmJob(window.localStorage");
  });

  it("轮询有防重叠标记", () => {
    expect(CARD).toContain("scorePollRef.current");
  });

  it("查不到任务时不清状态 —— 清了就会重复付费", () => {
    const at = CARD.indexOf("getPostProdJob.fetch({ jobId: scorePending.jobId })");
    expect(at).toBeGreaterThan(0);
    expect(CARD.slice(at, at + 200)).toContain("!res");
  });

  it("变体全部列出，选中写进 bgm_mount 的 bgmUri", () => {
    expect(CARD).toContain("scoreVariants.map");
    expect(CARD).toContain("setBgmAudioUrl(v.gcsUri)");
  });
});

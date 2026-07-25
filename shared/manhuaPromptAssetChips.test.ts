import { describe, expect, it } from "vitest";
import {
  parseManhuaPromptAssetMetaByTag,
  stripManhuaPromptBindBlocksForReview,
  tokenizeManhuaPromptAssets,
} from "./manhuaPromptAssetChips";

const PROMPT = [
  "【第1段·15s】断月桥",
  "【场景锁】断月桥；配色：墨蓝雨夜。",
  "0–5s：动作轨迹：拔刀。景别：近景。@角色2以压嗓说「站住」。",
  "5–10s：@角色1退到@场景1边缘。",
  "【资产·Image对照】",
  "@角色1|id=cust_a|label=马县丞|kind=角色|duty=identity",
  "@角色2|id=cust_b|label=苏照雪|kind=角色|duty=look",
  "@场景1|id=cust_s|label=断月桥|kind=场景",
  "【出片Image硬绑】",
  "马县丞的面部特征参考@图片1；苏照雪的妆造参考@图片2。",
].join("\n");

describe("manhuaPromptAssetChips", () => {
  it("从提示词自带的对照表抽出映射，不用外部传", () => {
    const meta = parseManhuaPromptAssetMetaByTag(PROMPT);
    expect(meta["@角色1"]).toMatchObject({
      labelZh: "马县丞",
      kind: "角色",
      duty: "identity",
      assetId: "cust_a",
    });
    expect(meta["@角色2"]?.duty).toBe("look");
    expect(meta["@场景1"]).toMatchObject({ labelZh: "断月桥", kind: "场景", duty: null });
  });

  /**
   * 药丸视图能当「同一份提示词」看的前提：文本一个字都不能改。
   * 拼回去必须与输入完全相同，否则用户改了原文会发现内容对不上。
   */
  it("token 拼回去与原文逐字相同", () => {
    const meta = parseManhuaPromptAssetMetaByTag(PROMPT);
    const tokens = tokenizeManhuaPromptAssets(PROMPT, meta);
    const rebuilt = tokens
      .map((t) => (t.kind === "text" ? t.text : t.raw))
      .join("");
    expect(rebuilt).toBe(PROMPT);
  });

  it("认出 @角色N / @场景N / @图片N，并挂上标签", () => {
    const meta = parseManhuaPromptAssetMetaByTag(PROMPT);
    const tokens = tokenizeManhuaPromptAssets(
      "@角色2以压嗓说「站住」，退到@场景1边缘；面部参考@图片1。",
      meta,
    );
    const assets = tokens.filter((t) => t.kind === "asset");
    expect(assets.map((a) => (a.kind === "asset" ? a.raw : ""))).toEqual([
      "@角色2",
      "@场景1",
      "@图片1",
    ]);
    expect(assets[0]!.kind === "asset" && assets[0]!.meta?.labelZh).toBe("苏照雪");
    expect(assets[2]!.kind === "asset" && assets[2]!.imageIndex).toBe(1);
    // 对照表里没有 @图片N，metadata 缺失也不能崩
    expect(assets[2]!.kind === "asset" && assets[2]!.meta).toBeNull();
  });

  it("不把普通 @ 当资产吃掉", () => {
    const tokens = tokenizeManhuaPromptAssets("联系 a@b.com 或 @导演 复核。", {});
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.kind).toBe("text");
  });

  it("药丸视图藏掉对照表与硬绑句，正文一字不丢", () => {
    const out = stripManhuaPromptBindBlocksForReview(PROMPT);
    expect(out).not.toContain("【资产·Image对照】");
    expect(out).not.toContain("【出片Image硬绑】");
    expect(out).not.toContain("id=cust_a");
    // 正文与秒轴照旧
    expect(out).toContain("【第1段·15s】断月桥");
    expect(out).toContain("@角色2以压嗓说「站住」");
    expect(out).toContain("墨蓝雨夜");
  });
});

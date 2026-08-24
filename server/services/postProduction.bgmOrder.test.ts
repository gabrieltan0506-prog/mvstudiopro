/**
 * 源码契约：BGM 滤镜链顺序与提交体字段。
 *
 * 这两条都不是运行时能测出来的——顺序错了 ffmpeg 照跑，只是卡点全体后移；
 * 前端漏传 volumeExpr 也不报错，只是卡点表白做。所以直接钉源码。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("bgm 滤镜链顺序", () => {
  const src = read("server/services/postProduction.ts");

  it("bgmSeekSec 进 atrim=start（从曲内起播）", () => {
    expect(src).toContain("atrim=start=${seek.toFixed(3)}");
  });

  it("volume 必须在 adelay 之后：卡点表按片内秒位写，早求值会整体错位", () => {
    const chain = src.slice(src.indexOf("const bgmChain ="), src.indexOf("[bg]`;"));
    expect(chain.indexOf("adelay")).toBeGreaterThan(-1);
    expect(chain.indexOf("${volumeFilter}")).toBeGreaterThan(chain.indexOf("adelay"));
  });

  it("分窗表达式带 eval=frame，否则只在初始化算一次", () => {
    expect(src).toContain("eval=frame");
  });
});

describe("前端提交契约", () => {
  const card = read("client/src/components/canvas/PostProdWorkshopCard.tsx");

  it("bgm_mount 提交体必须带 volumeExpr（卡点表的唯一出口）", () => {
    expect(card).toContain("volumeExpr");
    expect(card).toContain("beatTableToVolumeExpr");
  });

  it("对齐计划来自 buildBgmAlignment，不是手算入点", () => {
    expect(card).toContain("buildBgmAlignment");
  });

  it("没有真实画面事件时不显示「已对卡点」", () => {
    expect(card).toContain("filmEvents.length > 0");
  });
});

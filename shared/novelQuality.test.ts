import { expect, it } from "vitest";
import { inspectNovelQuality } from "./novelQuality";
it("标明用户实际时间矛盾，保留原稿；不把合理顺序也报错", () => {
  const text = "明晚酉时独自前来，敢找第二人，明早让你沉尸曲江";
  expect(inspectNovelQuality(text)).toEqual([
    expect.objectContaining({
      kind: "time-order",
      excerpt: expect.stringContaining("明早"),
    }),
  ]);
  expect(text).toContain("明早");
  expect(
    inspectNovelQuality("明晚酉时独自前来，敢找第二人，后天一早让你沉尸曲江")
  ).toEqual([]);
  expect(inspectNovelQuality("明早来见我，否则明晚离开")).toEqual([]);
});
it("提示连续碎句，不把偶尔短促回应当成失败", () => {
  expect(
    inspectNovelQuality("“来。” “去。” “不。” “好。” “别动。” “是谁？”")[0]
      ?.kind
  ).toBe("fragmented-dialogue");
  expect(
    inspectNovelQuality("“别动。” “先把事情说清楚，这封信究竟是谁交给你的？”")
  ).toEqual([]);
});

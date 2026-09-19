import { describe, expect, it } from "vitest";
import { manhuaFinalCutSourceKey, manhuaFinalCutStaleOf } from "./manhuaFinalCutSource";

const piece = (blockId: string, clipUrl: string) => ({ blockId, clipUrl });

describe("长片用料指纹", () => {
  it("同一批料顺序不同指纹相同；换掉任一段的成片地址指纹就变", () => {
    const a = manhuaFinalCutSourceKey([piece("clip-1", "https://x/1.mp4"), piece("clip-2", "https://x/2.mp4")]);
    const shuffled = manhuaFinalCutSourceKey([piece("clip-2", "https://x/2.mp4"), piece("clip-1", "https://x/1.mp4")]);
    expect(shuffled).toBe(a);
    const rerun = manhuaFinalCutSourceKey([piece("clip-1", "https://x/1b.mp4"), piece("clip-2", "https://x/2.mp4")]);
    expect(rerun).not.toBe(a);
  });

  it("签名参数变化不算换料（同一媒体续签），但段数变化一定变", () => {
    const signed = manhuaFinalCutSourceKey([piece("clip-1", "https://x/1.mp4?sig=aaa&exp=1")]);
    const resigned = manhuaFinalCutSourceKey([piece("clip-1", "https://x/1.mp4?sig=bbb&exp=2")]);
    expect(resigned).toBe(signed);
    const plusOne = manhuaFinalCutSourceKey([piece("clip-1", "https://x/1.mp4"), piece("clip-2", "https://x/2.mp4")]);
    expect(plusOne).not.toBe(signed);
    expect(plusOne.startsWith("2|")).toBe(true);
  });

  it("没有成片地址的段不进指纹；全是空则指纹为空串", () => {
    expect(manhuaFinalCutSourceKey([{ blockId: "clip-1" }, piece("clip-2", "https://x/2.mp4")]).startsWith("1|")).toBe(true);
    expect(manhuaFinalCutSourceKey([{ blockId: "clip-1" }])).toBe("");
  });

  it("缺 blockId 时退回集号+段号，不允许两段挤成同一条", () => {
    const key = manhuaFinalCutSourceKey([
      { episodeIndex: 1, segmentIndex: 1, clipUrl: "https://x/a.mp4" },
      { episodeIndex: 1, segmentIndex: 2, clipUrl: "https://x/b.mp4" },
    ]);
    expect(key.startsWith("2|")).toBe(true);
    expect(key).toContain("e1s1@");
    expect(key).toContain("e1s2@");
  });
});

describe("终审是否在拿旧料充当完成", () => {
  const current = manhuaFinalCutSourceKey([piece("clip-1", "https://x/1.mp4"), piece("clip-2", "https://x/2.mp4")]);

  it("同一批料：不失效、不报警", () => {
    expect(manhuaFinalCutStaleOf({ versionSourceKey: current, currentSourceKey: current, currentCount: 2 }))
      .toEqual({ stale: false, reasonZh: "" });
  });

  it("段数变了：说清「当时几段、现在几段」", () => {
    const three = manhuaFinalCutSourceKey([
      piece("clip-1", "https://x/1.mp4"),
      piece("clip-2", "https://x/2.mp4"),
      piece("clip-3", "https://x/3.mp4"),
    ]);
    const out = manhuaFinalCutStaleOf({ versionSourceKey: current, currentSourceKey: three, currentCount: 3 });
    expect(out.stale).toBe(true);
    expect(out.reasonZh).toContain("2 段合的");
    expect(out.reasonZh).toContain("现在是 3 段");
  });

  it("段数没变但有段重出过：说清是旧料，并声明旧片仍保留", () => {
    const rerun = manhuaFinalCutSourceKey([piece("clip-1", "https://x/1b.mp4"), piece("clip-2", "https://x/2.mp4")]);
    const out = manhuaFinalCutStaleOf({ versionSourceKey: current, currentSourceKey: rerun, currentCount: 2 });
    expect(out.stale).toBe(true);
    expect(out.reasonZh).toContain("重出过");
    expect(out.reasonZh).toContain("旧片仍保留");
  });

  it("旧长片没有用料记录：既不谎报通过也不谎报失效，明说无法核对", () => {
    const out = manhuaFinalCutStaleOf({ versionSourceKey: "", currentSourceKey: current, currentCount: 2 });
    expect(out.stale).toBe(false);
    expect(out.reasonZh).toContain("无法核对");
  });

  it("现在一段可用成片都没有：不拿指纹说事（该由别的判据拦）", () => {
    expect(manhuaFinalCutStaleOf({ versionSourceKey: current, currentSourceKey: "", currentCount: 0 }))
      .toEqual({ stale: false, reasonZh: "" });
  });
});

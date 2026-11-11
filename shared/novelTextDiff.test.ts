import { describe, expect, it } from "vitest";
import { diffNovelText, novelDiffSide, splitNovelSentences } from "./novelTextDiff";

describe("正文差异（句级对齐 + 字级比较）", () => {
  it("按句切分可逐字拼回原文", () => {
    const t = "沈昭跪在殿前。侍郎说：“交不出账！”她没答话……\n\n第二段？是的";
    const parts = splitNovelSentences(t);
    expect(parts.join("")).toBe(t);
    expect(parts.length).toBeGreaterThanOrEqual(5);
  });
  it("片段能分别还原两版，统计新增/删除字数", () => {
    const a = "沈昭跪在殿前。侍郎把账册摔在她脚边。她起身去库房。";
    const b = "沈昭跪在殿前。侍郎把真账册摔在她脚边。她连夜去库房，带上玉佩。";
    const d = diffNovelText(a, b);
    expect(novelDiffSide(d.segments, "original")).toBe(a);
    expect(novelDiffSide(d.segments, "revised")).toBe(b);
    expect(d.segments.filter(s => s.type === "added").map(s => s.text).join("")).toContain("真");
    expect(d.added).toBeGreaterThan(0);
    expect(d.removed).toBeGreaterThan(0);
    expect(d.changeRatio).toBeGreaterThan(0);
    expect(d.changeRatio).toBeLessThan(0.6);
  });
  it("相同文本改动为 0；完全不同时接近 100%", () => {
    expect(diffNovelText("一样的正文。", "一样的正文。")).toMatchObject({ added: 0, removed: 0, changeRatio: 0 });
    const d = diffNovelText("甲乙丙丁。", "戊己庚辛。");
    expect(d.changeRatio).toBeGreaterThanOrEqual(0.8); // 只剩句号相同
  });
  it("性能：4000 字对 4000 字（局部改动与几乎全改两种）< 300ms", () => {
    const pool = "沈昭跪殿前侍郎摔账册库房换锁钥匙御史台玉佩背面刻户字明日早朝满门流放";
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const sentence = () =>
      Array.from({ length: 12 + Math.floor(rand() * 20) }, () => pool[Math.floor(rand() * pool.length)]).join("") + "。";
    const make = (n: number) => {
      let s = "";
      while (s.length < n) s += sentence() + (rand() < 0.15 ? "\n" : "");
      return s.slice(0, n);
    };
    const a = make(4000);
    const sentences = splitNovelSentences(a);
    const b = sentences.map((s, i) => (i % 4 === 0 ? sentence() : s)).join("").slice(0, 4000);
    const c = make(4000);
    for (const [x, y] of [[a, b], [a, c]]) {
      const t0 = performance.now();
      const d = diffNovelText(x, y);
      const ms = performance.now() - t0;
      console.info(`diff ${x.length}×${y.length}: ${ms.toFixed(1)}ms`);
      expect(ms).toBeLessThan(300);
      expect(novelDiffSide(d.segments, "original")).toBe(x);
      expect(novelDiffSide(d.segments, "revised")).toBe(y);
    }
  });
});

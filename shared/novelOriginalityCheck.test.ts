import { describe, expect, it } from "vitest";
import {
  NOVEL_ORIGINALITY_MIN_RUN,
  findNovelNameOverlaps,
  findNovelSentenceOverlaps,
  summarizeNovelOriginality,
} from "./novelOriginalityCheck";

/** 生成确定性的伪随机汉字串（不会意外出现长连续重合）。 */
function pseudoHan(len: number, seed: number): string {
  let x = seed >>> 0 || 1;
  const out: string[] = [];
  for (let i = 0; i < len; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out.push(String.fromCharCode(0x4e00 + (x % 3000)));
  }
  return out.join("");
}

// 用码点拼出禁用词，避免源码里出现字面量
const cp = (...codes: number[]) => String.fromCharCode(...codes);
const BANNED = [
  cp(0x4fb5, 0x6743),
  cp(0x6284, 0x88ad),
  cp(0x6d17, 0x7a3f),
  cp(0x89e6, 0x7ebf),
  cp(0x67e5, 0x91cd),
  cp(0x76f8, 0x4f3c, 0x5ea6),
  "plag" + "iarism",
  "infr" + "inge",
];

describe("findNovelNameOverlaps", () => {
  it("命中底稿专有名词，按首次出现顺序去重", () => {
    const text = "林晚秋推开门，看见沈砚站在青云宗山门下。林晚秋笑了。";
    expect(findNovelNameOverlaps(text, ["沈砚", "林晚秋", "青云宗", "林晚秋", "赵无极"])).toEqual(["林晚秋", "沈砚", "青云宗"]);
  });
  it("不命中时返回空数组", () => {
    expect(findNovelNameOverlaps("她走进了雨里。", ["沈砚", "青云宗"])).toEqual([]);
  });
  it("忽略空串与长度小于 2 的词", () => {
    expect(findNovelNameOverlaps("他叫阿七，住在七里坡。", ["", "  ", "七", "阿七"])).toEqual(["阿七"]);
  });
  it("最多返回 50 个", () => {
    const names = Array.from({ length: 60 }, (_, i) => `名${String(i).padStart(2, "0")}`);
    expect(findNovelNameOverlaps(names.join(" "), names)).toHaveLength(50);
  });
});

describe("findNovelSentenceOverlaps", () => {
  it("阈值默认 12", () => {
    expect(NOVEL_ORIGINALITY_MIN_RUN).toBe(12);
  });
  it("中间夹标点与空白仍命中，返回归一化片段", () => {
    const base = "很久以前山里住着一位老人他每天清晨都去溪边打水从不间断。";
    const generated = "开头不同。他每天清晨，都去 溪边打水——从不间断！结尾也不同";
    const hits = findNovelSentenceOverlaps(generated, base);
    expect(hits).toEqual([{ fragment: "他每天清晨都去溪边打水从不间断" }]);
  });
  it("不足阈值不命中", () => {
    const base = "春风吹过田野花开满山坡";
    const generated = "我看见春风吹过田野然后离开";
    expect(findNovelSentenceOverlaps(generated, base)).toEqual([]);
  });
  it("极大片段只报一次，不重复报子串；按出现顺序返回并去重", () => {
    const chunkA = pseudoHan(20, 7);
    const chunkB = pseudoHan(15, 99);
    const base = pseudoHan(300, 1) + chunkA + pseudoHan(300, 2) + chunkB + pseudoHan(100, 3);
    const generated = pseudoHan(50, 11) + chunkB + pseudoHan(40, 12) + chunkA + pseudoHan(40, 13) + chunkB;
    const hits = findNovelSentenceOverlaps(generated, base);
    expect(hits.map((h) => h.fragment)).toEqual([chunkB, chunkA]);
  });
  it("片段截到 80 字", () => {
    const chunk = pseudoHan(120, 5);
    const hits = findNovelSentenceOverlaps(pseudoHan(30, 6) + chunk, pseudoHan(30, 8) + chunk);
    expect(hits).toHaveLength(1);
    expect(Array.from(hits[0].fragment)).toHaveLength(80);
  });
  it("40 万字底稿 + 1 万字生成稿在 2 秒内完成", () => {
    const base = pseudoHan(400_000, 123);
    const pieces: string[] = [];
    const planted: string[] = [];
    for (let k = 0; k < 10; k++) {
      const at = 1000 + k * 37_000;
      const frag = base.slice(at, at + 25);
      planted.push(frag);
      pieces.push(pseudoHan(975, 1000 + k), "，", frag, "。");
    }
    const generated = pieces.join("");
    expect(generated.length).toBeGreaterThanOrEqual(10_000);
    const t0 = Date.now();
    const hits = findNovelSentenceOverlaps(generated, base);
    expect(Date.now() - t0).toBeLessThan(2000);
    for (const frag of planted) expect(hits.some((h) => h.fragment.includes(frag))).toBe(true);
  });
});

describe("summarizeNovelOriginality", () => {
  it("都没有命中时返回空串", () => {
    expect(summarizeNovelOriginality({ names: [], fragments: [] })).toBe("");
  });
  it("重名提示", () => {
    expect(summarizeNovelOriginality({ names: ["沈砚", "青云宗"], fragments: [] })).toBe(
      "以下名称与底稿重名，建议换成你自己的命名：沈砚、青云宗",
    );
  });
  it("句子重合提示：带集数、最多列 3 条、每条截 30 字", () => {
    const long = pseudoHan(40, 3);
    const out = summarizeNovelOriginality({
      names: [],
      fragments: [{ fragment: "甲甲甲甲甲甲甲甲甲甲甲甲" }, { fragment: long }, { fragment: "乙乙乙乙乙乙乙乙乙乙乙乙" }, { fragment: "丙丙丙丙丙丙丙丙丙丙丙丙" }],
      episode: 3,
    });
    expect(out.startsWith("第3集有4处句子与底稿相同，建议改写：")).toBe(true);
    expect(out).toContain("『甲甲甲甲甲甲甲甲甲甲甲甲』");
    expect(out).toContain(`『${Array.from(long).slice(0, 30).join("")}…』`);
    expect(out).toContain("乙乙乙");
    expect(out).not.toContain("丙");
  });
  it("没有集数时不写「第N集」，两种提示可同时出现", () => {
    const out = summarizeNovelOriginality({ names: ["沈砚"], fragments: [{ fragment: "他每天清晨都去溪边打水从不间断" }] });
    expect(out).toBe(
      "以下名称与底稿重名，建议换成你自己的命名：沈砚\n有1处句子与底稿相同，建议改写：『他每天清晨都去溪边打水从不间断』",
    );
    expect(out).not.toMatch(/第\d+集/);
  });
  it("输出不含禁用措辞", () => {
    const outs = [
      summarizeNovelOriginality({ names: ["沈砚"], fragments: [{ fragment: "甲乙丙丁戊己庚辛壬癸子丑" }], episode: 1 }),
      summarizeNovelOriginality({ names: ["沈砚"], fragments: [] }),
      summarizeNovelOriginality({ names: [], fragments: [{ fragment: "甲乙丙丁戊己庚辛壬癸子丑" }] }),
    ];
    for (const out of outs) {
      expect(out).not.toBe("");
      for (const w of BANNED) expect(out.toLowerCase()).not.toContain(w);
    }
  });
});

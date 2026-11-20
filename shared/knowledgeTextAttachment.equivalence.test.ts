import { describe, expect, it } from "vitest";
import { attachKnowledgeTextModules, attachKnowledgeTextModulesReference } from "./knowledgeTextAttachment";

/** 确定性伪随机，保证用例可复现。 */
function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }; }
const vocab = "司马光记述此事先叙其始末再论得失诸侯盟约兵力粮道判断形势转折因果血脂胆固醇饮食运动敦煌壁画洞窟".split("");

describe("attachKnowledgeTextModules 倒排提速：与原实现逐项相同", () => {
  it("随机稿（大量文字模块、空模块、重复标题、空图章）归属逐字一致", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const word = (n: number) => Array.from({ length: n }, () => vocab[Math.floor(r() * vocab.length)]).join("");
      const images = Array.from({ length: 1 + Math.floor(r() * 12) }, () => (r() < 0.1 ? "" : word(Math.floor(r() * 400))));
      const texts = Array.from({ length: Math.floor(r() * 200) }, (_, i) => ({
        headline: r() < 0.3 ? "重复标题" : `标题${i}${word(3)}`,
        body: r() < 0.15 ? "" : word(Math.floor(r() * 300)),
      }));
      expect(attachKnowledgeTextModules(images, texts)).toEqual(attachKnowledgeTextModulesReference(images, texts));
    }
  });
  it("三千个文字模块并入 30 章：结果相同且明显更快", () => {
    const r = rng(7);
    const word = (n: number) => Array.from({ length: n }, () => vocab[Math.floor(r() * vocab.length)]).join("");
    const images = Array.from({ length: 30 }, () => word(20000));
    const texts = Array.from({ length: 3000 }, (_, i) => ({ headline: `模块${i % 50}`, body: word(200) }));
    let t = performance.now(); const fast = attachKnowledgeTextModules(images, texts); const fastMs = performance.now() - t;
    t = performance.now(); const ref = attachKnowledgeTextModulesReference(images, texts); const refMs = performance.now() - t;
    expect(fast).toEqual(ref);
    expect(fastMs).toBeLessThan(refMs);
  });
});

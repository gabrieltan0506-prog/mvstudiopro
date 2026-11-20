import { describe, expect, it } from "vitest";
import { partitionKnowledgeTopics } from "./knowledgeTopicImagePlan";

/** 改求法前的原实现（逐个切点比较）。划分结果即主题身份，新求法必须与它逐项相同。 */
function referencePartition(weights: readonly number[], groups: number): number[][] {
  const n = weights.length;
  const k = Math.max(1, Math.min(groups, n));
  if (!n) return [];
  const prefix = [0];
  for (const w of weights) prefix.push(prefix[prefix.length - 1]! + Math.max(1, w));
  const sum = (a: number, b: number) => prefix[b]! - prefix[a]!;
  const cost: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(0));
  cost[0]![0] = 0;
  for (let j = 1; j <= k; j++) {
    for (let i = j; i <= n; i++) {
      for (let p = j - 1; p < i; p++) {
        const value = Math.max(cost[j - 1]![p]!, sum(p, i));
        if (value < cost[j]![i]!) { cost[j]![i] = value; cut[j]![i] = p; }
      }
    }
  }
  const result: number[][] = [];
  let end = n;
  for (let j = k; j >= 1; j--) {
    const start = cut[j]![end]!;
    result.unshift(Array.from({ length: end - start }, (_, x) => start + x));
    end = start;
  }
  return result;
}

/** 固定种子的伪随机，失败可复现。 */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
}

describe("主题划分：新求法与原实现逐项相同", () => {
  it("小规模穷举：节数 0–9、组数 0–11、权重 0–3 的全部组合", () => {
    for (let n = 0; n <= 9; n++) {
      const total = 4 ** n;
      // n 较大时抽样，保证总量可控；n≤6 全量。
      const step = n <= 6 ? 1 : Math.max(1, Math.floor(total / 4000));
      for (let code = 0; code < total; code += step) {
        const weights = Array.from({ length: n }, (_, i) => Math.floor(code / 4 ** i) % 4);
        for (let groups = 0; groups <= 11; groups++) {
          expect(partitionKnowledgeTopics(weights, groups), `权重=${weights.join(",")} 组数=${groups}`).toEqual(referencePartition(weights, groups));
        }
      }
    }
  });

  it("随机：大量并列值（权重取自很小的集合）与一般分布", () => {
    const random = seeded(20261120);
    for (let round = 0; round < 1500; round++) {
      const n = 1 + Math.floor(random() * 90);
      const span = [1, 2, 3, 10, 400, 3000][Math.floor(random() * 6)]!;
      const weights = Array.from({ length: n }, () => Math.floor(random() * span) * (random() < 0.1 ? 0 : 1));
      const groups = 1 + Math.floor(random() * 60);
      expect(partitionKnowledgeTopics(weights, groups), `第${round}轮 n=${n} 组数=${groups}`).toEqual(referencePartition(weights, groups));
    }
  });

  it("真实量级：160、600、1500 节分 30 / 48 / 56 组", () => {
    const random = seeded(4208);
    for (const n of [160, 600, 1500]) {
      const weights = Array.from({ length: n }, () => (random() < 0.05 ? 0 : 80 + Math.floor(random() * 2400)));
      for (const groups of [30, 48, 56]) {
        expect(partitionKnowledgeTopics(weights, groups)).toEqual(referencePartition(weights, groups));
      }
    }
  });

  it("四千多节的书：与原实现相同，且不再是秒级", () => {
    const random = seeded(1726101);
    const weights = Array.from({ length: 4208 }, () => (random() < 0.03 ? 0 : 60 + Math.floor(random() * 900)));
    const expected = referencePartition(weights, 48);
    const started = performance.now();
    const actual = partitionKnowledgeTopics(weights, 48);
    const elapsed = performance.now() - started;
    expect(actual).toEqual(expected);
    expect(elapsed).toBeLessThan(500);
  }, 60_000);
});

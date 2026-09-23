import { afterEach, describe, expect, it, vi } from "vitest";
import {
  batchSections,
  compactTargetSections,
  deriveKnowledgeCardCompact,
  DERIVE_MIN_OUTPUT_TOKENS,
  KNOWLEDGE_CARD_DERIVE_TRUNCATED_MESSAGE,
  splitMarkdownSections,
} from "./knowledgeCardLevelDerive";

const sec = (i: number, extra = "") => `## 第${i}节标题\n\n图：示意${i}\n\n- 要点A${i}\n- 要点B${i}\n\n| 列 | 值 |\n|---|---|\n| k${i} | v${i} |${extra}\n`;
const book = (n: number) => `# 书名\n\n${Array.from({ length: n }, (_, i) => sec(i + 1)).join("\n")}`;

describe("知识卡精华版派生（完整版长稿为真源）", () => {
  it("目标节数约 1/6，最少 12 最多 120；切批不拆节", () => {
    expect(compactTargetSections(581)).toBe(97);
    expect(compactTargetSections(30)).toBe(12);
    expect(compactTargetSections(2000)).toBe(120);
    const { head, sections } = splitMarkdownSections(book(10));
    expect(head.trim()).toBe("# 书名");
    expect(sections).toHaveLength(10);
    const batches = batchSections(sections, sections[0]!.length * 3 + 5);
    expect(batches.map((b) => b.length)).toEqual([3, 3, 3, 1]);
  });

  it("按批调用模型、每批按份额挑节、合并后达标；输出异常整次失败；不足目标直接原样返回", async () => {
    const calls: Array<{ keep: number; given: number }> = [];
    const chat = async (p: { system: string; user: string }) => {
      const keep = Number(/挑出[^0-9]*(\d+)\s*节/.exec(p.system)?.[1] || 0);
      const given = Number(/这\s*(\d+)\s*节里/.exec(p.system)?.[1] || 0);
      calls.push({ keep, given });
      const { sections } = splitMarkdownSections(p.user.startsWith("## ") ? p.user : `## x\n${p.user}`);
      return splitMarkdownSections(p.user).sections.slice(0, keep).join("\n\n") || sections.slice(0, keep).join("\n\n");
    };
    const progress: number[] = [];
    const out = await deriveKnowledgeCardCompact({
      fullMarkdown: book(60),
      targetSections: 10,
      chat: chat as never,
      onProgress: (p) => { progress.push(p.doneBatches); },
    });
    expect(out.sections).toBeLessThanOrEqual(10);
    expect(out.markdown.startsWith("# 书名")).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.keep >= 2 && c.given >= c.keep)).toBe(true);
    expect(progress.length).toBeGreaterThan(0);

    const same = await deriveKnowledgeCardCompact({ fullMarkdown: book(5), targetSections: 10, chat: chat as never });
    expect(same.passes).toBe(0);
    expect(same.sections).toBe(5);

    const garbage = async () => "这不是小节格式的输出";
    await expect(deriveKnowledgeCardCompact({ fullMarkdown: book(40), targetSections: 8, chat: garbage as never })).rejects.toThrow(/输出异常/);
  });
});

describe("0923 派生额度：8.5 万字的书不再被思考吃光输出", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // 约 8.5 万字、150 节：与 0923 实际失败那本同量级
  const bigBook = () => `# 书名\n\n${Array.from({ length: 150 }, (_, i) => `## 第${i + 1}节\n\n${"正文内容".repeat(140)}\n`).join("\n")}`;

  it("每批不超过 3 万字，每批输出额度不低于 6.4 万 token", async () => {
    const seen: Array<{ chars: number; maxTokens: number }> = [];
    const chat = async (p: { system: string; user: string; maxTokens: number }) => {
      seen.push({ chars: p.user.length, maxTokens: p.maxTokens });
      const keep = Number(/挑出[^0-9]*(\d+)\s*节/.exec(p.system)?.[1] || 0);
      return splitMarkdownSections(p.user).sections.slice(0, keep).join("\n\n");
    };
    const full = bigBook();
    expect(full.length).toBeGreaterThan(80_000);
    await deriveKnowledgeCardCompact({ fullMarkdown: full, chat: chat as never });
    expect(seen.length).toBeGreaterThanOrEqual(3);
    // 批内节与节之间用空行拼接，允许每节多出两个换行
    expect(seen.every((c) => c.chars <= 30_000 + 2 * 150)).toBe(true);
    expect(seen.every((c) => c.maxTokens >= DERIVE_MIN_OUTPUT_TOKENS)).toBe(true);
    expect(DERIVE_MIN_OUTPUT_TOKENS).toBe(64_000);
  });

  it("所有通道都截断时如实报「超出输出长度」，不报算力紧张", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-or");
    vi.stubEnv("EVOLINK_API_KEY", "test-evo");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "test-sg");
    vi.stubEnv("KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS", "0");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "## 半截\n\n写到一半" }, finish_reason: "length" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const err = await deriveKnowledgeCardCompact({ fullMarkdown: book(60), targetSections: 10 }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(KNOWLEDGE_CARD_DERIVE_TRUNCATED_MESSAGE);
    expect((err as Error).message).not.toMatch(/算力紧张/);
    // 每个通道都真的试过（六跳），整条链还按 0923 用户令重跑了 3 次：6 × 4
    expect(fetchMock.mock.calls.length).toBe(24);
  });

  it("只有部分通道截断（其它是 503）：不说「所有通道都没写完」，报最后一跳的真实错误", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-or");
    vi.stubEnv("EVOLINK_API_KEY", "test-evo");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "test-sg");
    vi.stubEnv("KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS", "0");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      n += 1;
      // 每轮六跳：前五跳 503，末跳截断
      if (n % 6 !== 0) return new Response("upstream down", { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "## 半截" }, finish_reason: "length" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    const err = await deriveKnowledgeCardCompact({ fullMarkdown: book(60), targetSections: 10 }).catch((e: Error) => e);
    expect((err as Error).message).not.toBe(KNOWLEDGE_CARD_DERIVE_TRUNCATED_MESSAGE);
    expect((err as Error).message).toMatch(/截断/);
  });
});

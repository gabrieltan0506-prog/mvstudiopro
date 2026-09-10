import { describe, expect, it } from "vitest";
import { batchSections, compactTargetSections, deriveKnowledgeCardCompact, splitMarkdownSections } from "./knowledgeCardLevelDerive";

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

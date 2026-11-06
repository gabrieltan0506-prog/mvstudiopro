import { afterEach, describe, expect, it, vi } from "vitest";
import { assertKnowledgeCardDeriveTablesComplete } from "./knowledgeCardDeriveIntegrity";
import { deriveKnowledgeCardCompact } from "./knowledgeCardLevelDerive";

const complete = "## 收藏\n\n图：收藏时间线\n\n- 由私藏到公藏\n\n| 编目 | 成书时间 | 要点 |\n|---|---|---|\n| 《宣和书谱》 | 北宋 | 书法目录 |";
// 2026-11-06 正式精华稿的残缺结尾；不是工具展示时的截断。
const incomplete = complete.slice(0, complete.lastIndexOf("| 《宣和")) + "| 《宣和";
const full = Array.from({ length: 6 }, (_, i) => complete.replace("## 收藏", `## 收藏${i}`)).join("\n\n");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("派生表格完整性", () => {
  it.each([
    ["正式残缺尾行", incomplete],
    ["有末尾竖线但仍少列", incomplete + " |"],
    ["后续批次不能掩盖前批残缺", incomplete + "\n\n" + complete],
  ])("拒绝%s", (_, markdown) => {
    expect(() => assertKnowledgeCardDeriveTablesComplete(markdown)).toThrow(/表格不完整（应有 3 列，实际 1 列）/);
  });

  it.each([
    ["完整表格", complete],
    ["省略外侧竖线", "A | B\n---|---\n甲 | 乙"],
    ["转义竖线", "| A | B |\n|---|---|\n| 甲\\|乙 | 丙 |"],
    ["显式空单元格", "| A | B |\n|---|---|\n| 甲 | |"],
    ["无表格的正文", "## 标题\n\n一段没有标点的正文"],
    ["围栏中的表格示例", "````md\n" + incomplete + "\n```\n````"],
    ["波浪线围栏", "~~~md\n" + incomplete + "\n~~~"],
    ["带竖线的下一节标题", complete + "\n## 下一节 | 对照\n正文"],
  ])("保留%s", (_, markdown) => {
    expect(() => assertKnowledgeCardDeriveTablesComplete(markdown)).not.toThrow();
  });

  it("无需压缩的返回路径也拒绝残缺，且不调用模型", async () => {
    const chat = vi.fn();
    await expect(deriveKnowledgeCardCompact({ fullMarkdown: incomplete, targetSections: 3, chat })).rejects.toThrow(/表格不完整/);
    expect(chat).not.toHaveBeenCalled();
  });

  it("批次在合并之前检查，注入的生产者也不能绕过", async () => {
    const chat = vi.fn(async () => incomplete);
    await expect(deriveKnowledgeCardCompact({ fullMarkdown: full, targetSections: 3, chat })).rejects.toThrow(/表格不完整/);
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

function response(content: string, stream: boolean): Response {
  if (!stream) return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 });
  return new Response([
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join(""), { headers: { "Content-Type": "text/event-stream" } });
}

describe("真实派生调用链（仅替换网络）", () => {
  function setup() {
    vi.stubEnv("EVOLINK_API_KEY", "test-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS", "0");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  }

  it.each([false, true])("finish=stop 仍拒绝坏表格，再由原链取完整回复（流式=%s）", async stream => {
    setup();
    const fetchMock = vi.fn().mockImplementationOnce(async () => response(incomplete, stream))
      .mockImplementationOnce(async () => response(complete, stream));
    vi.stubGlobal("fetch", fetchMock);
    const result = await deriveKnowledgeCardCompact({ fullMarkdown: full, targetSections: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.markdown).toBe(complete);
    expect(result.sections).toBe(1);
  });

  it("所有回复均残缺时按既有次数失败，不伪称已确认输出额度耗尽", async () => {
    setup();
    const fetchMock = vi.fn(async () => response(incomplete, false));
    vi.stubGlobal("fetch", fetchMock);
    await expect(deriveKnowledgeCardCompact({ fullMarkdown: full, targetSections: 3 })).rejects.toThrow(/表格不完整/);
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });
});

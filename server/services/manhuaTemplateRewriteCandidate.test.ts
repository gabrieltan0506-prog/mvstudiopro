import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  sourceScriptSha256,
  summarizeTemplateCandidateChanges,
  validateCompleteSourceScript,
  validateCompleteTemplateCandidate,
} from "./manhuaTemplateRewriteCandidate.js";

const source = [
  "第1集 第一场 雨夜城门。阿菁赶到城门，发现母亲留下的密信。她和守卫围绕通行令牌争执，守卫阻拦。",
  "第二场 客栈。阿菁与伙伴讨论密信的意思，对白交代两人各自的选择，随后黑衣人闯入。",
  "第三场 河岸。阿菁追上黑衣人，展开交锋；她认出对方身上的旧印记，决定暂不动手。",
  "第四场 旧宅。母亲现身，揭示令牌背后的因果，阿菁的目标随之改变。",
  "第五场 黎明。伙伴带来反证，阿菁必须在公开密信与救母之间选择；片尾出现新的追兵。",
].join("\n\n").repeat(5);

const candidate = source.replaceAll("阿菁", "阿菁回头") + "\n\n第六场。阿菁收好令牌，追兵的脚步声逼近。";

describe("完整单集模板候选合同", () => {
  it("对原稿按原始 UTF-8 字节计算指纹", () => {
    expect(sourceScriptSha256(source)).toBe(createHash("sha256").update(source, "utf8").digest("hex"));
    expect(sourceScriptSha256(source + "\n")).not.toBe(sourceScriptSha256(source));
  });

  it("拒绝短梗概和超过采用合同的全文", () => {
    expect(() => validateCompleteSourceScript("一段梗概".repeat(20))).toThrow("完整剧本原文");
    expect(() => validateCompleteSourceScript("甲".repeat(8001))).toThrow("完整剧本原文");
    expect(() => validateCompleteSourceScript(source)).not.toThrow();
  });

  it("拒绝以重复字符或短句灌到 678 字的假原稿", () => {
    expect(() => validateCompleteSourceScript("甲".repeat(678))).toThrow("明显重复");
    expect(() => validateCompleteSourceScript("剧情开始，人物对白。".repeat(68))).toThrow("明显重复");
  });

  it("接受真实工作流风格的 89 秒单段完整剧本", () => {
    const oneParagraph = ("清晨阿菁背娘进城，墨屠一瘸一拐跟随。曹三：「交出马！」阿菁：「它受伤了！」墨屠替她挡下红光。娘：「先去医馆。」先生：「药只能撑三天。」墨屠：「取我的血。」").repeat(4);
    const rewritten = ("清晨，阿菁背娘越过城门，墨屠受伤仍守着她。曹三：「交出那匹马！」阿菁：「它受了伤，你看不见吗？」墨屠迎着红光挡在她身前。娘：「先去医馆。」先生：「药只够三天。」墨屠：「用我的血。」").repeat(7);
    expect(oneParagraph.length).toBeGreaterThan(300);
    expect(oneParagraph.length).toBeLessThan(800);
    expect(() => validateCompleteSourceScript(oneParagraph)).not.toThrow();
    expect(() => validateCompleteTemplateCandidate(oneParagraph, rewritten)).not.toThrow();
    expect(() => validateCompleteTemplateCandidate(oneParagraph, "场景推进".repeat(160))).toThrow("对白内容");
    expect(() => validateCompleteTemplateCandidate(oneParagraph, "甲：「对白推进。」".repeat(100))).toThrow("主要人物身份");
  });

  it("扣费前拒绝摘要、截短版、超长版和原文复刻", () => {
    expect(() => validateCompleteTemplateCandidate(source, "第一集摘要".repeat(50))).toThrow("完整单集剧本长度");
    expect(() => validateCompleteTemplateCandidate(source, "新剧情".repeat(3001))).toThrow("完整单集剧本长度");
    expect(() => validateCompleteTemplateCandidate(source, source)).toThrow("完全相同");
    expect(() => validateCompleteTemplateCandidate(source, candidate)).not.toThrow();
  });

  it("变化提示符合既有采用合同的 1–6 条、单条 800 字上限", () => {
    const changes = summarizeTemplateCandidateChanges(source, candidate);
    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes.length).toBeLessThanOrEqual(6);
    expect(changes.every((change) => change.length <= 800)).toBe(true);
  });
});

import { expect, it } from "vitest";
import { validateKnowledgeEditionVerificationReceipt } from "./knowledgeEditionVerificationReceipt";
import { compileKnowledgeEditions, knowledgeModulesFromMarkdown } from "../../shared/knowledgeCardEdition";
import { synchronizedKnowledgeCardSource } from "../../shared/knowledgeCardEditableLayout";
import { layoutFromSource } from "../../shared/editableLayout";
import { planKnowledgeCardPages } from "../../shared/knowledgeCardPagination";
import { knowledgeSourceSchema } from "../../shared/knowledgePublication";

// 大书精华版改按原书顺序归属后，服务端每次读稿都会重做的「核实回执逐页核对」仍须通过（核对与排版源共用同一构造）。
it("大书精华版（按原书顺序归属）：核实回执逐页核对通过，改稿仍被拒", async () => {
  const para = (i: number, k: number) => `第${i}节第${k}段：诸侯盟约、兵力与粮道皆有详载，读者可据此判断形势的转折与因果。`;
  const md = "# 资治通鉴\n\n" + Array.from({ length: 3200 }, (_, i) => `## ${i % 6 === 0 ? "主要重点" : "次要重点"}｜事件${i + 1}\n\n` +
    Array.from({ length: 3 + (i % 9) }, (_, k) => para(i, k)).join("\n\n")).join("\n\n");
  const parsed = knowledgeModulesFromMarkdown(md);
  const edition = compileKnowledgeEditions(parsed.title, parsed.modules);
  const src = synchronizedKnowledgeCardSource({ owner: "7", sourceId: "s", fullMarkdown: edition.full, illustrationMarkdown: edition.concise, detailLevel: "concise",
    imageJobIds: planKnowledgeCardPages(edition.concise).pages.map((_, i) => `image-${i}`) });
  src.verificationJobId = "kc_test";
  const source = knowledgeSourceSchema.parse(layoutFromSource(src).publication!.source);
  const job: any = { userId: "7", status: "succeeded", input: { action: "knowledge_card_derive_level" }, output: { distilledMarkdown: edition.concise, fullEditionMarkdown: edition.full, verificationProcessed: true } };
  await expect(validateKnowledgeEditionVerificationReceipt(7, source, async () => job)).resolves.toBeUndefined();
  await expect(validateKnowledgeEditionVerificationReceipt(7, { ...source, pages: source.pages.map((p, i) => i ? p : { ...p, supplement: `${p.supplement}改稿` }) }, async () => job)).rejects.toThrow("正文已变化");
}, 60_000);

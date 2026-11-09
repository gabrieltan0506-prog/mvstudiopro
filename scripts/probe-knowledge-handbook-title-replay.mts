/**
 * 本地零调用重放：把 1108g2 已存的主题命题原始回执（full/concise 两档，含首发与各次重试回包）
 * 用分支现行 parseKnowledgeTopicTitles / auditKnowledgeTopicTitles 逻辑重新解析，报告是否仍判占位。
 * 不联网、不写数据库、不改任何文件。
 * 用法：node_modules/.bin/tsx scripts/probe-knowledge-handbook-title-replay.mts <title-receipts.json>（title-receipts.json 由 probe-knowledge-handbook-timing.mts 的 fetchTitleReceipts 带回）
 */
import fs from "node:fs";
import { parseKnowledgeTopicTitles } from "../server/services/knowledgeTopicTitles";
import { auditKnowledgeTopicTitles, mechanicalKnowledgeTopicTitle, knowledgeTopicKey } from "../shared/knowledgeTopicImagePlan";

const receipts: Record<string, any> = JSON.parse(fs.readFileSync(process.argv[2]!, "utf8"));
const prefixes = Array.from(new Set(Object.keys(receipts).map(k => k.split("/")[0]!))).sort();

/** 从回包文本提取模型输出 JSON：先按归一化格式（candidates），再按 OpenRouter 原生格式（choices）。 */
function extractReport(text: string): { report: any; via: string } | { error: string } {
  let outer: any;
  try { outer = JSON.parse(text); } catch (e) { return { error: `外层非 JSON：${String((e as Error).message).slice(0, 80)}` }; }
  const inner = outer?.candidates?.[0]?.content?.parts?.[0]?.text ?? outer?.choices?.[0]?.message?.content;
  if (typeof inner !== "string") return { error: "回包里没有 candidates/choices 文本" };
  try { return { report: JSON.parse(inner), via: outer?.candidates ? "candidates" : "choices" }; }
  catch (e) { return { error: `模型输出非 JSON：${String((e as Error).message).slice(0, 80)}` }; }
}

for (const prefix of prefixes) {
  const topics: { id: string; headlines: string[] }[] = receipts[`${prefix}/parsed.json`]?.topics || [];
  console.log(`\n==== ${prefix}  主题数=${topics.length}  原解析 rejected=${(receipts[`${prefix}/parsed.json`]?.rejected || []).length}`);
  const oldTitles = receipts[`${prefix}/parsed.json`]?.titles || {};
  const oldImages = topics.map(t => { const e = oldTitles[knowledgeTopicKey(t.headlines)] || {}; const title = e.image || mechanicalKnowledgeTopicTitle(t.headlines); return { headlines: t.headlines, title, readingTitle: e.reading || title }; });
  console.log("  旧 parsed.json 直接核查(auditKnowledgeTopicTitles):", JSON.stringify(auditKnowledgeTopicTitles(oldImages, oldTitles)));

  const sources: [string, string | undefined][] = [
    ["raw.json(被采纳回包)", receipts[`${prefix}/raw.json`]?.responseText],
    ...Object.keys(receipts).filter(k => k.startsWith(`${prefix}/`) && k.endsWith("-response.json") && !k.includes("heartbeat"))
      .sort().map(k => [k.slice(prefix.length + 1), receipts[k]?.text] as [string, string]),
  ];
  for (const [label, text] of sources) {
    if (!text) { console.log(`  -- ${label}: 无文本`); continue; }
    const ex = extractReport(text);
    if ("error" in ex) { console.log(`  -- ${label}: 解析失败 → ${ex.error}`); continue; }
    const { titles, rejected } = parseKnowledgeTopicTitles(ex.report, topics);
    const images = topics.map(t => { const e = titles[knowledgeTopicKey(t.headlines)] || {}; const title = e.image || mechanicalKnowledgeTopicTitle(t.headlines); return { headlines: t.headlines, title, readingTitle: e.reading || title }; });
    const audit = auditKnowledgeTopicTitles(images, titles);
    const named = Object.values(titles).filter(t => t.image && t.reading).length;
    console.log(`  -- ${label} [${ex.via}] pages=${(ex.report?.pages || []).length}`);
    console.log(`     新逻辑解析: 图片+内文标题齐全 ${named}/${topics.length}; rejected ${rejected.length} 条`);
    console.log(`     出图前关卡 audit: ${JSON.stringify(audit)}`);
    const reasons = new Map<string, number>();
    for (const r of rejected) { const k = r.replace(/^[0-9a-f-]+: /, "").replace(/\d+项/g, "N项"); reasons.set(k, (reasons.get(k) || 0) + 1); }
    for (const [k, n] of reasons) console.log(`       · ${n}× ${k}`);
    const sample = Object.values(titles).slice(0, 2).map(t => ({ image: t.image, reading: t.reading, sections: Object.values(t.sections || {}).slice(0, 2) }));
    console.log(`     样例: ${JSON.stringify(sample)}`);
  }
}

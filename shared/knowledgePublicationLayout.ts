import { getInfographicNoteTemplate } from "./infographicNoteTemplates";
import { KNOWLEDGE_TEMPLATE_SELECTION_INSTRUCTIONS } from "./knowledgePublicationTemplates";
import { knowledgeDecorationSchema, KNOWLEDGE_DECORATION_INSTRUCTIONS } from "./knowledgeDecorations";
import { z } from "zod";
import { Marked } from "marked";

const text = (max: number) => z.string().trim().min(1).max(max);
const base = { title: text(160), note: z.string().max(1500).default("") };
const item = z.object({ title: text(160), body: text(3000) }).strict();
/** 模型只组织知识结构，不能提供 HTML、样式或可执行代码。 */
export const knowledgeReadingBlockSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("prose"), text: text(12000) }).strict(),
  z.object({ ...base, type: z.literal("table"), columns: z.array(text(160)).min(2).max(6), rows: z.array(z.array(z.string().max(4000)).min(2).max(6)).min(1).max(120) }).strict(),
  z.object({ ...base, type: z.literal("sequence"), items: z.array(item).min(2).max(60), relation: z.enum(["chronology", "process", "comparison"]) }).strict(),
  z.object({ ...base, type: z.literal("cards"), items: z.array(item).min(1).max(60) }).strict(),
]);
export const knowledgeReadingSchema = z.object({
  version: z.literal(1),
  templateId: z.string().max(100).refine(id => Boolean(getInfographicNoteTemplate(id)), "请选择已有知识卡模板").optional(),
  templateReason: z.string().trim().min(1).max(500).optional(),
  decoration: knowledgeDecorationSchema.optional(),
  subtitle: z.string().max(400),
  accent: z.enum(["indigo", "jade", "ochre", "rose"]),
  blocks: z.array(knowledgeReadingBlockSchema).min(1).max(40),
}).strict().superRefine((reading, ctx) => {
  for (const block of reading.blocks) {
    if (block.type === "table" && block.rows.some(row => row.length !== block.columns.length))
      ctx.addIssue({ code: "custom", message: "知识表格每行必须与表头列数一致，不能丢单元格" });
  }
});
export type KnowledgeReading = z.infer<typeof knowledgeReadingSchema>;
export type KnowledgeReadingBlock = z.infer<typeof knowledgeReadingBlockSchema>;

const cell = (value: string) => value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
/** 确认框与结构化版式共享一份正文，避免确认文字和实际导出出现两个版本。 */
export function knowledgeReadingMarkdown(reading: KnowledgeReading): string {
  const parts = reading.blocks.map(block => {
    let content: string;
    if (block.type === "prose") content = block.text;
    else if (block.type === "table") content = [
      `| ${block.columns.map(cell).join(" | ")} |`,
      `| ${block.columns.map(() => "---").join(" | ")} |`,
      ...block.rows.map(row => `| ${row.map(cell).join(" | ")} |`),
    ].join("\n");
    else content = block.items.map((v, i) =>
      `${block.type === "sequence" ? `${i + 1}.` : "-"} **${v.title}**：${v.body}`
    ).join("\n");
    return `### ${block.title}\n\n${content}${block.note ? `\n\n> ${block.note}` : ""}`;
  });
  return [reading.subtitle, ...parts].filter(Boolean).join("\n\n");
}

/** 手改或旧稿仍自动识别表格/段落；不继续展示与确认稿不符的旧模型结构。 */
export function readingFromMarkdown(body: string): KnowledgeReading {
  const lexer = new Marked();
  const blocks: KnowledgeReadingBlock[] = [];
  let title = "知识说明";
  for (const token of lexer.lexer(body)) {
    if (token.type === "heading") { title = token.text; continue; }
    if (token.type === "space" || token.type === "hr") continue;
    if (token.type === "table") {
      const t = token as { header: { text: string }[]; rows: { text: string }[][] };
      // 旧稿的宽表原样保留为 Markdown，不丢列或强行压进六列合同。
      if (t.header.length >= 2 && t.header.length <= 6)
        blocks.push({ type: "table", title, note: "", columns: t.header.map(c => c.text), rows: t.rows.map(r => r.map(c => c.text)) });
      else blocks.push({ type: "prose", title, note: "", text: token.raw });
    } else blocks.push({ type: "prose", title, note: "", text: token.raw });
  }
  return { version: 1, subtitle: "", accent: "indigo", blocks };
}

export const KNOWLEDGE_READING_INSTRUCTIONS = `同时为每页输出reading={version:1,subtitle:简短引导语,accent:"indigo"|"jade"|"ochre"|"rose",blocks:[...]}。根据真实知识关系自动设计，不让用户逐页手排。
blocks可选：
1. {type:"table",title,note,columns:[2至6个表头],rows:[[单元格,...],...]}：可比较的概念、人物、参数、职责、优缺点优先整理成表格；每行列数与表头严格一致。表中单元格保留关键数字、单位、限定，不编造缺失值。
2. {type:"sequence",title,note,relation:"chronology"|"process"|"comparison",items:[{title,body},...]}：时间顺序或真实步骤才用前两种关系；并列或世系不明用comparison，不能凭箭头捏造父子关系或因果。
3. {type:"cards",title,note,items:[{title,body},...]}：分类要点、独立概念、完整清单适合卡片/矩阵。
4. {type:"prose",title,note,text}：用短段落解释背景、因果与边界，不以表格代替必须说明的内容。
每页可组合多个类型，避免整页长文章，也不要把不适合比较的知识硬凑表格。优先2至6个有信息量的块，内容多可增加块或行，不删重要事实。reading包含此页全部读者正文，不是body的缩略示意，body必须与reading表达相同事实；系统会从reading生成最终确认稿。每块note可为空。不得写入任意HTML/CSS，不生成假数据、空单元格占位或“待补充”。表格最多120行、卡片最多60项、单页最多40块，接近容量时明确失败，不静默丢内容。配色应服务主题与层级，跟随选中模板的配色，不固定为蓝金或墨绿色；图片来自绑定原图，不输出新图片地址。
${KNOWLEDGE_TEMPLATE_SELECTION_INSTRUCTIONS}
${KNOWLEDGE_DECORATION_INSTRUCTIONS}`;

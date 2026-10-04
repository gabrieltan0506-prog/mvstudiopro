import { z } from "zod";
const prose = (max: number) =>
  z
    .string()
    .trim()
    .min(2)
    .max(max)
    .refine(
      s => !/https?:\/\/|gs:\/\/|tpl_|manhua-template-learn\//i.test(s),
      "方法说明不能包含来源链接或内部编号"
    );
export const templateMethodBriefSchema = z
  .object({
    title: prose(80),
    highlights: z.array(prose(300)).min(2).max(8),
    useWhen: prose(200),
  })
  .strict();
export type TemplateMethodBrief = z.infer<typeof templateMethodBriefSchema>;
export function parseTemplateMethodBrief(
  value: unknown
): TemplateMethodBrief | undefined {
  const result = templateMethodBriefSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
export function mergeTemplateMethodBriefs(
  values: unknown[]
): TemplateMethodBrief | undefined {
  const briefs = values
    .map(parseTemplateMethodBrief)
    .filter((v): v is TemplateMethodBrief => !!v);
  if (!briefs.length) return undefined;
  if (briefs.length === 1) return briefs[0];
  return {
    title: briefs[0].title,
    highlights: Array.from(new Set(briefs.flatMap(b => b.highlights))).slice(
      0,
      8
    ),
    useWhen: Array.from(new Set(briefs.map(b => b.useWhen)))
      .join("；")
      .slice(0, 200),
  };
}
export const TEMPLATE_METHOD_BRIEF_INSTRUCTION = `额外输出 methodBrief：面向模板选择的匿名方法说明，title概括可借用的呈现方式（不写剧情主线或题材），highlights为2–8条“具体如何呈现→造成什么效果”的短句，每条不超过300字；useWhen说明适用场面，不承诺质量。根据实际证据覆盖节奏与信息、场景空间与调度、人物表演与关系、妆造道具、灯光色彩、声音剪辑和氛围中真正有特色的部分；没有证据的维度省略，不能只写对白关系，不能套通用标签。不得出现原角色名、剧名、原台词、平台、来源链接、内部编号或剧情复述。该字段与本次完整学习证据同时重新生成，不能照搬旧说明。`;

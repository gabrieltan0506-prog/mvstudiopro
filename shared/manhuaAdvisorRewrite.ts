import { z } from "zod";

export const TEMPLATE_REWRITE_MARKER = "【模板改写建议】";
const text = z.string().trim().min(1).max(800);
export const advisorTemplatePlanSchema = z
  .object({
    publicId: z.string().min(1).max(160),
    reason: text,
    changes: z.array(text).min(2).max(5),
    preserve: text,
  })
  .strict();
export const advisorTemplatePlansSchema = z
  .object({
    kind: z.literal("template-plans"),
    plans: z.array(advisorTemplatePlanSchema).min(3).max(5),
  })
  .strict();
export const advisorRewriteResponseSchema = z
  .object({
    kind: z.literal("template-rewrite"),
    body: z.string().trim().min(1),
    endHook: z.string().trim().min(1).optional(),
    changes: z.array(text).min(1).max(6),
  })
  .strict();
export const advisorRewriteCandidateSchema = z
  .object({
    episodeIndex: z.number().int().positive(),
    originalEndHook: z.string().optional(),
    endHook: z.string().trim().min(1).optional(),
    originalBody: z.string().min(1),
    rewrittenBody: z.string().trim().min(1),
    changes: z.array(text).min(1).max(6),
  })
  .strict();
export type AdvisorRewriteCandidate = z.infer<
  typeof advisorRewriteCandidateSchema
>;

/** 剧情编辑不改技术表；只识别明确的技术章节，不把普通“第一段”叙述猜成分镜。 */
export function splitManhuaEpisodeStoryText(body: string): { story: string; technicalSections: string[] } {
  const lines = body.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) || [];
  const story: string[] = [];
  const technicalSections: string[] = [];
  for (let i = 0; i < lines.length;) {
    const heading = lines[i]!.trim().match(/^(#{1,6})\s+(.+?)\s*#*$/);
    const table = /^\s*\|/.test(lines[i]!) && /镜号|镜头/.test(lines[i]!) && /秒位|时间轴|约时码|时长/.test(lines[i]!);
    let end = i + 1;
    if (heading) {
      while (end < lines.length) {
        const next = lines[end]!.trim().match(/^(#{1,6})\s+/);
        if (next && next[1]!.length <= heading[1]!.length) break;
        end++;
      }
    } else if (table) {
      while (end < lines.length && /^\s*\|/.test(lines[end]!)) end++;
    }
    const section = lines.slice(i, end).join("");
    const technicalHeading = heading && /可拍表|分镜表|镜头表|镜头节拍|技术分段|分段计划|^(?:分镜|节拍表)$/.test(heading[2]!);
    const technicalSegment = heading && /^(?:段\s*0*\d+|第\s*\d+\s*段)(?:\s|[（(:：]|$)/.test(heading[2]!) && /(?:^|\n)\s*[-*]?\s*(?:意图|本段意图|对白|台词|表演|配色|服化道|光影运镜)\s*[:：]/.test(section);
    if (table || technicalHeading || technicalSegment) {
      technicalSections.push(section.trim());
      i = end;
    } else {
      story.push(lines[i]!);
      i++;
    }
  }
  return { story: story.join("").trim(), technicalSections };
}

/** 保留原技术材料供后续分镜复核；当前入口仅替换剧情与对白。 */
export function replaceManhuaEpisodeStoryText(originalBody: string, nextStory: string): string {
  const original = splitManhuaEpisodeStoryText(originalBody);
  const next = splitManhuaEpisodeStoryText(nextStory);
  if (!next.story.trim()) throw new Error("剧情正文不能为空，原稿保留。");
  if (next.technicalSections.some(section => !original.technicalSections.includes(section)))
    throw new Error("本入口只确认剧情和对白；请将新增或改动的技术分镜表留到分镜步骤处理。");
  return [next.story, ...original.technicalSections].join("\n\n");
}

/** 只校验非空、可读内容和已知时序错误，不用人工字数或比例判断创作品质。 */
export function validateAdvisorRewriteBody(
  original: string,
  body: string,
  endHook?: string
): void {
  if (!original.trim())
    throw new Error("当前集原稿为空，未采用改稿");
  const originalStory = splitManhuaEpisodeStoryText(original).story;
  const nextStory = splitManhuaEpisodeStoryText(body).story;
  if (nextStory.trim() === originalStory.trim())
    throw new Error("改写与原稿相同，请检查顾问回答。");
  if (
    !nextStory.trim() ||
    /\[object Object\]|object_object/i.test(body)
  )
    throw new Error("优化稿未保留完整单集正文，原稿保留");
  const sceneIds = Array.from(
    originalStory.matchAll(/(?:场次|場次)\s*(E\d+-S\d+)\b/gi)
  ).map(m => m[1].toUpperCase());
  if (sceneIds.some(id => !new RegExp(`\\b${id}\\b`, "i").test(body)))
    throw new Error("优化稿缺少原集场次，原稿保留");
  // 仅拦截已验出的特定时序矛盾，不冒充通用创作质量检查，也不自动改写。
  if (/(?:明晚|明天晚上|明日酉时)[^\n]{0,100}(?:敢|若|如果|否则)[^\n]{0,40}明早(?:就|便|让你|讓你|叫你|要你|你就)?(?:浮尸|浮屍|沉尸|沉屍|横尸|橫屍|死|没命|沒命|沉江)/.test(`${body}\n${endHook || ""}`))
    throw new Error("会面与后果时序矛盾：明晚赴约不能因违约在明早受罚，请同步修正正文与可拍表，原稿保留");
}
export const TEMPLATE_REWRITE_DELIVERY = `输出可直接套用的完整单集剧情与对白，不交分析报告或操作建议；未改的剧情正文也必须完整保留。本步骤不输出可拍表、分段技术表、秒位表或运镜表，已有技术材料由系统保留供后续分镜复核。正文篇幅由剧情需要决定，不按固定字数或原文比例裁切。只借模板的创作方法，不搬入来源人物、剧情或强加回忆。结合本集具体情况改进节奏、场景空间与调度、人物关系及动作、服装妆容、灯光色彩、声音氛围和自然对白；只用适合本集的特色，不机械加满所有效果。保留人物身份、动机、关键因果、场次编号及格式，核对会面、威胁、行动和后果的日期先后，例如明晚会面不能因未赴约而在明早受罚。用简体中文。仅在answer内返回对象或JSON文本：{"kind":"template-rewrite","body":"完整单集剧情与对白","endHook":"与正文时序一致的完整片尾钩子","changes":["实际落实的具体变化，不超过6条"]}。用户确认前不写回项目、不生成媒体。`;

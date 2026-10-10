import { z } from "zod";
import { templateFeatureChoices } from "./manhuaEpisodeOptimization";
import type { PublicManhuaViralTemplateCard } from "./manhuaViralTemplateBank";
export const advisorTemplateChoiceSchema = z.object({
  kind: z.literal("template-choice"),
  explanation: z.string().trim().min(1).max(2000),
  choices: z.array(z.object({
    publicId: z.string().regex(/^mt_[a-z0-9]{4,16}$/i),
    features: z.array(z.string().min(1).max(400)).min(1).max(30),
  }).strict()).min(1).max(5),
}).strict();
export type AdvisorTemplateChoice = z.infer<typeof advisorTemplateChoiceSchema>;
export function validateAdvisorTemplateChoice(raw: unknown, cards: readonly PublicManhuaViralTemplateCard[], allowedIds: readonly string[]) {
  const value = advisorTemplateChoiceSchema.parse(raw);
  if (new Set(value.choices.map(c => c.publicId)).size !== value.choices.length) throw new Error("搭配中有重复选择，请顾问重新整理");
  for (const choice of value.choices) {
    const card = cards.find(c => c.publicId === choice.publicId);
    if (!allowedIds.includes(choice.publicId) || !card || choice.features.some(id => !templateFeatureChoices(card).some(f => f.id === id)) || new Set(choice.features).size !== choice.features.length) throw new Error("可选亮点已更新，请顾问重新核对；未提交改稿");
  }
  return value;
}
export const MANHUA_ADVISOR_PLAIN_LANGUAGE = "面向用户一律用自然语言，像编剧同事交流。用户没有记模板编号、字段或术语的义务；不要求输入编号，不展示内部ID、JSON或路由。用‘开头更抓人’‘先留一个疑问’‘镜头慢慢靠近’等具体说法，专业方法翻译成能想象的画面与效果。程序要求的结构化外壳只供界面处理，explanation/reason/changes等面向用户的正文仍须日常表达。";

export const TEMPLATE_RECOMMENDATION_DELIVERY = `本次请在answer返回{kind:"template-plans",plans:[{publicId:"真实内部身份",reason:"用日常语言解释推荐原因和适用位置",changes:["本集可借的亮点与具体做法","另一项具体做法"],preserve:"保留哪些人物和情节"}]}。优先一个主推荐加三个不同备选，第一项为主推荐。每份2—5个具体亮点，共4份；可用库只有3份时如实给3份，不编造。不要列术语给用户，不要求用户记编号；用户可以单选或混合。`;
export function requestsTemplateRecommendations(question: string) {
  return /推荐|推薦|还有|還有|其他|别的|別的|看看/.test(question) && /模板|思路|亮点|亮點|三种|三種|选择|選擇/.test(question);
}

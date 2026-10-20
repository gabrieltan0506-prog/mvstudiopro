/** 仅测算用户输入的单笔贡献，不参与平台计费或代替经营净利润。 */
export type OfferEconomicsInput = { price: string; variableCost: string; acquisitionCost: string; targetMargin: string };

const amount = (value: string): number | null => {
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed <= 1e12 ? parsed : null;
};

export function calculateOfferEconomics(input: OfferEconomicsInput) {
  const price = amount(input.price);
  const variableCost = amount(input.variableCost);
  const acquisitionCost = amount(input.acquisitionCost);
  const targetMargin = amount(input.targetMargin);
  const costsKnown = variableCost !== null && acquisitionCost !== null;
  const contribution = costsKnown && price !== null ? price - variableCost - acquisitionCost : null;
  const contributionRate = contribution !== null && price !== null && price > 0 ? contribution / price * 100 : null;
  const targetPrice = costsKnown && targetMargin !== null && targetMargin < 100
    ? (variableCost + acquisitionCost) / (1 - targetMargin / 100) : null;
  return { price, variableCost, acquisitionCost, targetMargin, contribution, contributionRate, targetPrice };
}

export const OFFER_BRIEF_TEMPLATE = `【产品与销售背景】
产品/服务：待补，请写已有交付或标明待开发
目标客户与使用场景：待补
已有价格、交付范围与证据：待补
每单变动成本、获客费用与产能：待补
销售目标：请设计引流品、利润品、高价产品候选，解释适合谁、交付差异、定价依据与验证方式；未知项列待补，不编造价格或成交保证。
【产品与销售背景结束】`;

export const WEBSITE_OFFER_EXAMPLE = `【产品与销售背景｜示例，按你的实际情况修改】
产品方向：推广我的网站，提供资料转图文卡片、选题文案和内容制作相关工具
目标客户：已有素材、需要持续发布内容的中文创作者（候选）
推广目标：给网站带来真实体验与重复使用，探索产品梯度和推广方案
实际功能效果、价格、成本、客户证据、已有流量与渠道资源：请补充；未知先列假设
制作要求：选题有特色与反差，创意贯穿封面、正文、图文分页或视频脚本，给具体发布标题、标签与承接建议
【产品与销售背景结束】`;

export const PARENT_CHILD_OFFER_EXAMPLE = `【产品与销售背景｜示例，按你的实际情况修改】
产品方向：亲子绘本《妈妈今天也大声了》，面向3—6岁孩子及家长
故事：团团想帮妈妈倒牛奶却洒了；赶时间的妈妈提高嗓门，之后道歉、陪伴并一起收拾
当前素材：仅确认第一页，完整绘本和试读包尚未就绪
渠道：没有现成家长群，线上招募困难；请提供零资源路线和有熟人资源时的可选路线
价格、成本、购买与订阅意愿：未知。可提出免费试读、绘本组合、机构共读或定制等创意，明确候选、交付与验证方式
制作要求：有特色的选题与反差，贯穿封面、故事内容、图文/动画制作与发布标题、标签；不责备家长，不承诺孩子听话或治疗效果
【产品与销售背景结束】`;

export function appendOfferContext(context: string, addition: string): { value: string; error?: string } {
  if (context.includes(addition.trim())) return { value: context, error: "这段内容已在需求里，可直接修改。" };
  const value = [context.trimEnd(), addition.trim()].filter(Boolean).join("\n\n");
  if (value.length > 8000) return { value: context, error: "加入后超过8000字，请先精简原需求。" };
  return { value };
}

export function formatOfferEconomics(input: OfferEconomicsInput): string {
  const result = calculateOfferEconomics(input);
  const money = (value: number | null) => value === null ? "待补有效数值" : value.toFixed(2);
  return [
    "【单笔价格测算｜用户填写，金额按同一币种、同一单笔口径】",
    `候选售价：${money(result.price)}；每单变动成本：${money(result.variableCost)}；每单获客费用：${money(result.acquisitionCost)}。`,
    `单笔贡献（售价－变动成本－获客费用）：${money(result.contribution)}；贡献率：${result.contributionRate === null ? "不可计算" : result.contributionRate.toFixed(2) + "%"}。`,
    `目标贡献率：${result.targetMargin === null || result.targetMargin >= 100 ? "待补0至小于100的百分数" : result.targetMargin + "%"}；对应候选售价下限：${money(result.targetPrice)}。`,
    "这是成本条件下的算术测算，不是市场可接受价格或净利润；固定开支、税费、退款与漏列成本尚未扣除。请核实成本覆盖范围和支付意愿，再设计引流品、利润品与高价产品。",
    "【单笔价格测算结束】",
  ].join("\n");
}

/** 沿用现有说明文本和导出字段，建议不进入待发布正文/生图输入。 */
export function formatOptimizationAdvice(result: { summary: string; platformNotes?: Array<{ platform: string; angle: string }> }): string {
  const notes = (result.platformNotes || []).filter(note => note.angle.trim()).map(note => `${note.platform}：${note.angle.trim()}`);
  return [result.summary.trim(), notes.length ? `【平台与经营建议】\n${notes.join("\n\n")}` : ""].filter(Boolean).join("\n\n");
}

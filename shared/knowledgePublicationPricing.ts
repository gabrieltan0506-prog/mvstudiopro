/** 2026-11-07：图片沿原价，顾问不另收；纯内文按最终PDF实页统一结算。 */
export const KNOWLEDGE_INTERIOR_BILLING_VERSION = 'interior-pages-v1' as const;
export const KNOWLEDGE_INTERIOR_PRICE_COPY = '纯内文不超过10页，每页8积分；超过10页，全部纯内文页按每页6积分。按最终PDF实际页数结算，顾问不另收费，同稿恢复和重复下载不重复扣费。';
export function knowledgeInteriorPrice(totalPages: number, imagePages: number) {
  if(!Number.isSafeInteger(totalPages)||totalPages<1||!Number.isSafeInteger(imagePages)||imagePages<0||imagePages>totalPages)throw Error('实际内文页数无法核对，未扣费');
  const readingPages=totalPages-imagePages,unitCredits=readingPages>10?6:8;
  const credits=readingPages*unitCredits;
  if(!Number.isSafeInteger(credits))throw Error("实际内文页数无法核对，未扣费");
  return {readingPages,unitCredits,credits};
}

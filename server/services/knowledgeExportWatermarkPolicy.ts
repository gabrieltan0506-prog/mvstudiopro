/**
 * 图文手册成品水印规则（站长 2026-11-21）：
 * - 水印是为了宣传：一般用户的手册照打，不能自己去掉。
 * - 付费用户（沿用全站既有付费判定 resolveWatermark：付费角色或有过正式加值）不打。
 * - 站长/督导账号自己出的手册默认照打（宣传用），可在排版面板勾选「去水印」关掉。
 */
export type KnowledgeExportWatermarkPolicy = { watermarkByDefault: boolean; canRemove: boolean };

export function knowledgeExportWatermarkPolicyFor(input: { supervisor: boolean; paid: boolean }): KnowledgeExportWatermarkPolicy {
  if (input.supervisor) return { watermarkByDefault: true, canRemove: true };
  if (input.paid) return { watermarkByDefault: false, canRemove: true };
  return { watermarkByDefault: true, canRemove: false };
}
/** 本次成品是否打水印：默认照规则；有权去掉的账号勾了「去水印」才去掉，无权的账号勾了也不生效。 */
export function knowledgeExportAppliesWatermark(policy: KnowledgeExportWatermarkPolicy, noWatermark?: boolean) {
  return policy.watermarkByDefault && !(policy.canRemove && noWatermark === true);
}
export async function loadKnowledgeExportWatermarkPolicy(owner: number): Promise<KnowledgeExportWatermarkPolicy> {
  const { resolveUserTier, resolveWatermark } = await import("./tier-provider-routing");
  if (await resolveUserTier(owner, false) === "supervisor") return knowledgeExportWatermarkPolicyFor({ supervisor: true, paid: false });
  return knowledgeExportWatermarkPolicyFor({ supervisor: false, paid: !(await resolveWatermark(owner, false)) });
}

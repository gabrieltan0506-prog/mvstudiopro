import { expect, it } from "vitest";
import { buildAdvisorComparisonRequest, comparisonEpisodeIndex, requestsAdvisorComparison } from "./manhuaAdvisorComparisonRequest";
import { TEMPLATE_CATALOG_REQUEST_MARKER } from "@shared/manhuaTemplateCraft";
import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";
const cards = [{publicId:"mt_a123",nameZh:"冲突前置 A123"},{publicId:"mt_b456",nameZh:"动作反转 B456"}] as PublicManhuaViralTemplateCard[];
it.each(["用模板写一篇与原文不同的比较稿", "給第一集寫一篇比較稿", "不要覆盖原稿，请生成新稿"])('明确比较稿请求进入候选：%s', q => expect(requestsAdvisorComparison(q)).toBe(true));
it.each(["只看原稿和新稿", "不要生成比较稿", "请分析新稿", "请推荐适合本集的模板", "这个改写稿与原稿哪个好", "这个改写稿写得怎么样", "给我分析新稿"])('仅查看或讨论不生成：%s', q => expect(requestsAdvisorComparison(q)).toBe(false));
it('选中模板编号进入原始请求，显式指定覆盖默认模板，未选择则取真实模板目录',()=>{
 expect(buildAdvisorComparisonRequest('写比较稿',cards,cards[0])).toContain('模板编号 A123');
 const q=buildAdvisorComparisonRequest('用动作反转 B456写比较稿',cards,cards[0]);expect(q).toContain('模板编号 B456');expect(q).not.toContain('A123');
 const unavailable=buildAdvisorComparisonRequest('用模板编号 C789写比较稿',cards,cards[0]);expect(unavailable).toContain('C789');expect(unavailable).not.toContain('A123');
 expect(buildAdvisorComparisonRequest('用模板写比较稿',cards)).toContain(TEMPLATE_CATALOG_REQUEST_MARKER);
 expect(()=>buildAdvisorComparisonRequest('写'.repeat(1200),cards,cards[0])).toThrow('未截断');
});
it('集数按原话确定，多个目标拒绝猜测',()=>{
 expect(comparisonEpisodeIndex('给第一集写稿',2)).toBe(1);expect(comparisonEpisodeIndex('第十二集',2)).toBe(12);expect(comparisonEpisodeIndex('当前集',2)).toBe(2);
 expect(()=>comparisonEpisodeIndex('第一集和第二集',2)).toThrow('一次只处理一集');
});

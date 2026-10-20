import { expect, it } from "vitest";
import { buildPlatformEditorialCoverGuidance, PLATFORM_EDITORIAL_COVER_GUIDANCE } from "./platformEditorialCover";
import { PLATFORM_HIGH_CTR_TITLE_COVER_GUIDANCE } from "./platformCreatorInsightFraming";
import { composePlatformImageSkillHints } from "./platformNativeVariants";
import { XHS_PACKAGE_OUTPUT_PROMPT } from "./xhsCreationPackage";
it("创意生产与封面出图提示使用同一摄影规则，不再正向注入旧壳",()=>{
 for(const prompt of [PLATFORM_HIGH_CTR_TITLE_COVER_GUIDANCE,composePlatformImageSkillHints(),XHS_PACKAGE_OUTPUT_PROMPT]) {
  expect(prompt).toContain(PLATFORM_EDITORIAL_COVER_GUIDANCE);
  expect(prompt).not.toContain("A1 抽帧全量对齐");expect(prompt).not.toContain("A1 壳与配色池轮换");
 }
});
it("成交/获客强调购买理由，明确非营销与关注任务不硬塞购买",()=>{
 expect(buildPlatformEditorialCoverGuidance("【封面目标】成交；亲子绘本")).toContain("【本张封面·购买与行动动机】");
 expect(buildPlatformEditorialCoverGuidance("【封面目标】获客；试读已就绪")).toContain("【本张封面·购买与行动动机】");
 expect(buildPlatformEditorialCoverGuidance("推广我的产品：共读绘本")).toContain("【本张封面·购买与行动动机】");
 for(const text of ["只做科普，不卖产品", "【封面目标】关注；商品未设", "生活摄影知识分享"]) expect(buildPlatformEditorialCoverGuidance(text)).toContain("【本张封面·内容阅读动机】");
 expect(PLATFORM_EDITORIAL_COVER_GUIDANCE).toContain("用户本次明确指定插画、动画或其他画风时保留该画风");
});

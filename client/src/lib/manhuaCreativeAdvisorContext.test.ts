/**
 * 创作顾问上下文组装单测。
 * 核心断言：①零泄漏（来源片名/导演溯源字段绝不进上下文）②长度硬上限
 * ③用户问题永不被裁剪掉 ④模板点名识别只认全名。
 */
import { describe, it, expect } from "vitest";
import {
  ADVISOR_QUESTION_MAX_CHARS,
  buildAdvisorQuestion,
  digestCraftProfiles,
  findMentionedTemplates,
} from "./manhuaCreativeAdvisorContext";
import { CRAFT_TECHNIQUE_PROFILES } from "@shared/storyboardLightingEmotion";
import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";

const tpl = (id: string, name: string): PublicManhuaViralTemplateCard => ({
  publicId: id,
  nameZh: name,
  laneZh: "都市情感" as PublicManhuaViralTemplateCard["laneZh"],
  classificationTagsZh: ["强钩子", "关系反转"],
  beatCount: 20,
  densityLevel: "standard",
  featureZh: "开场 3 秒立冲突，关系变化驱动跨集推进",
  introZh: "以持续冲突引擎组织每集升级",
});

describe("digestCraftProfiles 零泄漏", () => {
  it("投影结果不含 sourceLabel / sourceRefZh / creativeMotifsZh 的任何内容", () => {
    const digests = digestCraftProfiles();
    const joined = JSON.stringify(digests);
    for (const p of CRAFT_TECHNIQUE_PROFILES) {
      // 溯源字段（导演/作品名）一个字都不许出现在投影里
      if (p.sourceLabel) expect(joined).not.toContain(p.sourceLabel);
      if (p.sourceRefZh) expect(joined).not.toContain(p.sourceRefZh);
      for (const motif of p.creativeMotifsZh || []) {
        // 母题字段含括号片名，整字段禁入
        const bracket = motif.match(/[（(]([^）)]{2,})[）)]/)?.[1];
        if (bracket && bracket.length >= 2) expect(joined).not.toContain(bracket);
      }
    }
  });

  it("每张卡得到中性编号，数量与库一致", () => {
    const digests = digestCraftProfiles();
    expect(digests.length).toBe(CRAFT_TECHNIQUE_PROFILES.length);
    expect(digests[0]!.labelZh).toBe("手法①");
  });
});

describe("buildAdvisorQuestion", () => {
  it("含身份/状态/模板/手法/规则/用户问题六段，且引用了已选模板名", () => {
    const q = buildAdvisorQuestion({
      question: "这一集为什么不够吸引人？",
      stageZh: "剧本大纲",
      selectedTemplate: tpl("mt_abc1", "都市情感·创作模板 AB12"),
      templates: [tpl("mt_abc1", "都市情感·创作模板 AB12"), tpl("mt_abc2", "古风逆袭·创作模板 CD34")],
    });
    expect(q).toContain("创作顾问");
    expect(q).toContain("剧本大纲");
    expect(q).toContain("都市情感·创作模板 AB12");
    expect(q).toContain("【可引用手法】");
    expect(q).toContain("【用户问题】这一集为什么不够吸引人？");
    expect(q).toContain("不得出现任何影视作品名");
  });

  it("组装结果不泄漏手法卡溯源（真库全量跑一遍）", () => {
    const q = buildAdvisorQuestion({ question: "这场对峙适合哪种手法？", templates: [] });
    for (const p of CRAFT_TECHNIQUE_PROFILES) {
      if (p.sourceRefZh && p.sourceRefZh.length >= 2) expect(q).not.toContain(p.sourceRefZh);
    }
  });

  it("永不超过 API 上限，且超长时用户问题仍在", () => {
    const longQuestion = "为什么".repeat(500); // 1500 字，会被 clip 到 1200
    const manyTemplates = Array.from({ length: 20 }, (_, i) =>
      tpl(`mt_x${i}`, `批量模板·创作模板 X${i}`),
    );
    const q = buildAdvisorQuestion({ question: longQuestion, templates: manyTemplates });
    expect(q.length).toBeLessThanOrEqual(ADVISOR_QUESTION_MAX_CHARS);
    expect(q).toContain("【用户问题】为什么为什么");
  });

  it("无模板时明说无可用模板，不留空段", () => {
    const q = buildAdvisorQuestion({ question: "帮我诊断节奏", templates: [] });
    expect(q).toContain("（当前无可用模板）");
  });
});

describe("findMentionedTemplates", () => {
  const list = [tpl("mt_a", "都市情感·创作模板 AB12"), tpl("mt_b", "古风逆袭·创作模板 CD34")];

  it("答案点到全名才算命中，按出现去重，最多 3 个", () => {
    const hits = findMentionedTemplates(
      "推荐「都市情感·创作模板 AB12」，它的关系反转……再看都市情感·创作模板 AB12 的钩子。",
      list,
    );
    expect(hits.map((t) => t.publicId)).toEqual(["mt_a"]);
  });

  it("没点名则空数组", () => {
    expect(findMentionedTemplates("先把人物动机立住。", list)).toEqual([]);
  });

  it("变长码前缀不误挂：答案只提长码模板时，短码前缀模板不得命中", () => {
    // 审查建议实锤：publicCode 4-16 位变长，「AB12」是「AB123」前缀
    const short = tpl("mt_s", "都市情感·创作模板 AB12");
    const long = tpl("mt_l", "都市情感·创作模板 AB123");
    const hits = findMentionedTemplates("推荐「都市情感·创作模板 AB123」。", [short, long]);
    expect(hits.map((t) => t.publicId)).toEqual(["mt_l"]);
  });
});

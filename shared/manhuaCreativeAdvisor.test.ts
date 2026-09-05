import { describe, expect, it } from "vitest";
import {
  MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS,
  manhuaCreativeAdvisorContextSchema,
  resolveManhuaCreativeAdvisorEngineFacts,
} from "./manhuaCreativeAdvisor";
import { COMPILER_ENGINE_LIMITS } from "./manhuaShotIR";
import { formatPromptForEngine } from "./promptFormatLayer";
import { MANHUA_DIRECTOR_STRATEGY_APPROVED_MANIFEST_VERSION } from "./manhuaDirectorStrategy";

function validContext() {
  return {
    seriesTitle: "墨菁传",
    episodeIndex: 1,
    episodeTitle: "黑奇入局",
    stage: "storyboard" as const,
    videoModel: "未选择",
    writerConfirmed: true,
    episodeBody: "玄璃推门，黑奇拖着受伤的前腿后退。令牌掉在地上。",
    assetSummary: "已绑定：玄璃、黑奇；待认领：无；待审核：黑奇侧视；3D：黑奇已建立。",
    shotSummary: "当前选中镜头 2：玄璃从画面左侧逼近；本集共 12 镜。",
    blockers: ["镜头 2 的人物距离尚未确认"],
    directorStrategyId: "relational_action",
    directorStrategyRevision: MANHUA_DIRECTOR_STRATEGY_APPROVED_MANIFEST_VERSION,
    history: [
      { role: "user" as const, content: "这一镜为什么不够紧张？" },
      { role: "assistant" as const, content: "人物距离没有形成压迫递进。" },
    ],
  };
}

describe("manhuaCreativeAdvisorContextSchema", () => {
  it("接受真实项目上下文并保留未知引擎原值", () => {
    const parsed = manhuaCreativeAdvisorContextSchema.parse(validContext());
    expect(parsed.videoModel).toBe("未选择");
    expect(parsed.history).toHaveLength(2);
    expect(parsed.episodeBody).toContain("令牌");
  });

  it("本集正文超过 24000 字符时显式拒绝，不静默截断", () => {
    const result = manhuaCreativeAdvisorContextSchema.safeParse({
      ...validContext(),
      episodeBody: "剧".repeat(
        MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.episodeBodyChars + 1,
      ),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("24000");
    }
  });

  it("strict 拒绝 owner/user 字段，文本只拒绝真实 URL 或凭证形状", () => {
    expect(
      manhuaCreativeAdvisorContextSchema.safeParse({
        ...validContext(),
        userId: 42,
      }).success,
    ).toBe(false);
    expect(
      manhuaCreativeAdvisorContextSchema.safeParse({
        ...validContext(),
        ownerId: "owner-42",
      }).success,
    ).toBe(false);
    expect(
      manhuaCreativeAdvisorContextSchema.safeParse({
        ...validContext(),
        shotSummary: "参考图：https://example.com/ref.png",
      }).success,
    ).toBe(false);
    expect(
      manhuaCreativeAdvisorContextSchema.safeParse({
        ...validContext(),
        episodeBody: "角色说：口令、令牌和 token 都只是剧情词。",
      }).success,
    ).toBe(true);
    expect(
      manhuaCreativeAdvisorContextSchema.safeParse({
        ...validContext(),
        assetSummary: "api_key=abcdefghijklmnop",
      }).success,
    ).toBe(false);
  });

  it("只接受已批准的中性策略 ID，历史最多八条且子对象 strict", () => {
    expect(
      manhuaCreativeAdvisorContextSchema.safeParse({
        ...validContext(),
        directorStrategyId: "unknown-director-name",
      }).success,
    ).toBe(false);
    expect(
      manhuaCreativeAdvisorContextSchema.safeParse({
        ...validContext(),
        directorStrategyRevision: "修".repeat(
          MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.directorStrategyRevisionChars + 1,
        ),
      }).success,
    ).toBe(false);
    expect(
      manhuaCreativeAdvisorContextSchema.safeParse({
        ...validContext(),
        history: Array.from({ length: 9 }, () => ({
          role: "user",
          content: "继续",
        })),
      }).success,
    ).toBe(false);
    expect(
      manhuaCreativeAdvisorContextSchema.safeParse({
        ...validContext(),
        history: [{ role: "user", content: "继续", timestamp: 123 }],
      }).success,
    ).toBe(false);
  });
});

describe("resolveManhuaCreativeAdvisorEngineFacts", () => {
  it("逐项读取生产编译器白名单，不另设顾问侧时长或引用上限", () => {
    for (const [engineId, profile] of Object.entries(COMPILER_ENGINE_LIMITS)) {
      const facts = resolveManhuaCreativeAdvisorEngineFacts(engineId);
      expect(facts.recognized).toBe(true);
      if (!facts.recognized) continue;
      expect(facts).toMatchObject({
        engineId,
        dialect: profile.dialect,
        minSegmentSec: profile.minSegmentSec,
        maxSegmentSec: profile.maxSegmentSec,
        references: profile.references,
        maxPromptChars: "maxPromptChars" in profile ? profile.maxPromptChars : null,
        requiresIntegerSegmentSec:
          "requiresIntegerSegmentSec" in profile &&
          profile.requiresIntegerSegmentSec === true,
      });
    }
  });

  it("按生产方言暴露真实引用写法，能力为零的媒体不冒充支持", () => {
    const seedance = resolveManhuaCreativeAdvisorEngineFacts("seedance-2.5");
    const h3 = resolveManhuaCreativeAdvisorEngineFacts("minimax-h3");
    const wan = resolveManhuaCreativeAdvisorEngineFacts("wan-3.0");

    expect(seedance.recognized && seedance.referenceSyntaxZh).toBe(
      "图片=@图N；视频=@视频N；音频=@音频N",
    );
    expect(h3.recognized && h3.referenceSyntaxZh).toBe("图片=Image N");
    expect(h3.recognized && h3.references.video).toBe(0);
    expect(h3.recognized && h3.references.audio).toBe(0);
    expect(wan.recognized && wan.referenceSyntaxZh).toBe(
      "图片=Reference image N；视频=Reference video N；音频=Reference audio N",
    );
  });

  it("方言说明与生产格式层 golden 输出一致", () => {
    const seedance = formatPromptForEngine("@图1 @视频1 @音频1 {回来}", "seedance-2.5", {
      imageRefCount: 1,
      videoRefCount: 1,
      audioRefCount: 1,
      applyCensorReplacements: false,
    });
    const h3 = formatPromptForEngine("@图1 @角色1说{回来}<风声>", "minimax-hailuo-3", {
      imageRefCount: 1,
      applyCensorReplacements: false,
    });
    const wan = formatPromptForEngine("@图1 @视频1 @音频1 @角色1说{回来}", "wan-3.0", {
      imageRefCount: 1,
      videoRefCount: 1,
      audioRefCount: 1,
      applyCensorReplacements: false,
    });

    expect(seedance.text).toBe("@图1 @视频1 @音频1 {回来}");
    expect(h3.text).toBe("Image 1 角色1说“回来”风声");
    expect(wan.text).toBe(
      "Reference image 1 Reference video 1 Reference audio 1 角色1说“回来”",
    );
    expect(seedance.issues).toEqual([]);
    expect(h3.issues).toEqual([]);
    expect(wan.issues).toEqual([]);
  });

  it("未知或未选择引擎关闭式返回，不默认到任一方言", () => {
    const facts = resolveManhuaCreativeAdvisorEngineFacts("未选择");
    expect(facts).toEqual({
      recognized: false,
      requestedVideoModel: "未选择",
      reasonZh: "当前值不在生产编译器已接通白名单；不得推测时长、引用能力或提示词方言",
    });
    expect(facts).not.toHaveProperty("engineId");
    expect(facts).not.toHaveProperty("references");
  });
});

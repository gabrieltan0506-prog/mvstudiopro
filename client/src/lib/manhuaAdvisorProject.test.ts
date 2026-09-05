import { describe, expect, it } from "vitest";
import { buildManhuaAdvisorProject, resolveManhuaAdvisorVideoModel } from "./manhuaAdvisorProject";
import { buildManhuaProjectBible } from "@shared/manhuaProjectBible";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import type { ManhuaWriterPack } from "@shared/manhuaWriterRoom";
import { defaultCanvasBlock } from "./canvasTypes";
import type { CanvasBlock } from "./canvasTypes";
import { getManhuaDirectorStrategyContract } from "@shared/manhuaDirectorStrategy";

const pack: ManhuaWriterPack = {
  seriesTitle: "墨菁传", logline: "少女与驮兽进入坊市。", charactersMd: "", propsMd: "", locationsMd: "", rawMarkdown: "", episodeCount: 2,
  episodes: [{ index: 1, title: "驮兽开口", body: "阿菁牵着黑奇进入坊市。黑奇抬起受伤的前腿。", endHook: "黑奇开口" },
    { index: 2, title: "府宴风波", body: "第二集不得串入第一集", endHook: "闭门" }],
};
const base = { pack, bible: null, episodeIndex: 1, phase: "assets" as const, videoModel: "seedance-2.0-mini", writerConfirmed: false, refs: [], blocks: [] };

describe("创作顾问的真实项目生产者", () => {
  it("复现线上六图未认领，不编造人物绑定或质量通过", () => {
    const result = buildManhuaAdvisorProject({ ...base, refs: Array.from({ length: 6 }, (_, i) => ({
      id: `r${i}`, role: "character" as const, source: "upload" as const, url: `https://example.com/${i}.png`, labelZh: `候选${i}`,
    })) });
    expect(result.issues.find((issue) => issue.id === "claims")?.text).toBe("6 张人物图尚未认领到本剧人物。");
    expect(result.issues.find((issue) => issue.id === "canon")?.phase).toBe("outline");
    expect(result.context.episodeBody).toBe(pack.episodes[0]!.body);
    expect(JSON.stringify(result.context)).not.toContain("https://");
    expect(JSON.stringify(result.context)).not.toContain("第二集不得串入");
    expect(manhuaCreativeAdvisorContextSchema.safeParse(result.context).success).toBe(true);
  });

  it("选中镜头用工作台实际字段，包括无对白覆盖，不复制旧 prompt", () => {
    const result = buildManhuaAdvisorProject({ ...base, phase: "storyboard", selection: {
      episodeIndex: 1, segmentIndex: 2, shot: { index: 4, durationSec: 3, actionZh: "黑奇停步", cameraZh: "缓慢推近", dialogueZh: "", dialogueSuppressed: true },
    } });
    expect(result.selectionLabel).toBe("第 2 段 · 镜 4");
    expect(result.context.shotSummary).toContain('"dialogueSuppressed":true');
    expect(result.context.shotSummary).toContain("黑奇停步");
    const anotherEpisode = buildManhuaAdvisorProject({ ...base, selection: { episodeIndex: 2, segmentIndex: 1, shot: { index: 1, durationSec: 3, actionZh: "不能串镜", cameraZh: "" } } });
    expect(anotherEpisode.context.shotSummary).not.toContain("不能串镜");
  });

  it("未产出的分镜 prompt 不冒充真实产物，未知引擎保持未知", () => {
    const block = { ...defaultCanvasBlock("text", 0, 0), id: "beats-e01-a", episodeIndex: 1, prompt: "待生成的假分镜", outputText: "" };
    const result = buildManhuaAdvisorProject({ ...base, videoModel: "", blocks: [block] });
    expect(result.context.videoModel).toBe("未选择");
    expect(result.context.shotSummary).not.toContain("待生成的假分镜");
    expect(result.issues.map((issue) => issue.id)).toContain("engine");
    const archived = buildManhuaAdvisorProject({ ...base, blocks: [{ ...block, outputText: "已经归档的旧稿分镜", archivedFromPreviousScript: true }] });
    expect(archived.context.shotSummary).not.toContain("已经归档的旧稿分镜");
  });

  it("显式引擎优先，否则读当前集未归档 clip；同集冲突不猜", () => {
    const clip = (id: string, episodeIndex: number, videoModel: CanvasBlock["videoModel"]): CanvasBlock => ({
      ...defaultCanvasBlock("video", 0, 0),
      id,
      episodeIndex,
      videoModel,
    });
    const blocks = [
      clip("clip-e01-g01", 1, "seedance-2.5"),
      clip("clip-e02-g01", 2, "wan-3.0"),
      { ...clip("clip-e01-old", 1, "wan-3.0"), archivedFromPreviousScript: true },
    ];
    expect(
      resolveManhuaAdvisorVideoModel({ episodeIndex: 1, blocks }),
    ).toEqual({ videoModel: "seedance-2.5", conflictModels: [] });
    expect(
      resolveManhuaAdvisorVideoModel({
        explicitVideoModel: "minimax-hailuo-2.3",
        episodeIndex: 1,
        blocks,
      }),
    ).toEqual({ videoModel: "minimax-hailuo-2.3", conflictModels: [] });

    const restored = buildManhuaAdvisorProject({ ...base, videoModel: "", blocks });
    expect(restored.context.videoModel).toBe("seedance-2.5");
    expect(restored.issues.map((issue) => issue.id)).not.toContain("engine");

    const conflict = buildManhuaAdvisorProject({
      ...base,
      videoModel: "",
      blocks: [...blocks, clip("clip-e01-g02", 1, "wan-3.0")],
    });
    expect(conflict.context.videoModel).toBe("未选择");
    expect(conflict.issues.map((issue) => issue.id)).toContain("engine-conflict");

    expect(resolveManhuaAdvisorVideoModel({
      episodeIndex: 1,
      blocks: [
        { ...clip("clip-e01-old-provider", 1, "wan-3.0"), videoModel: "legacy-provider" } as unknown as CanvasBlock,
        clip("clip-e01-current", 1, "wan-3.0"),
      ],
    })).toEqual({ videoModel: "", conflictModels: ["legacy-provider", "wan-3.0"] });
  });

  it("当前人物选择及冻结策略来自正式真源，摘要不带 URL 或内部溯源", () => {
    const bible = buildManhuaProjectBible({ topic: "墨菁传", pack, cast: { lane: "ancient", characterIds: [], ancientArchetypeIds: [], artStyleId: "cg", propIds: [], wardrobePropContinuityIds: [] },
      directorStrategyContract: getManhuaDirectorStrategyContract("relational_action"),
      assetCanon: { characters: [{ id: "heiqi", role: "character", nameZh: "黑奇", lookZh: "灰黑驮兽", promptZh: "灰黑驮兽" }], locations: [], props: [], episodeMainSceneId: {} },
    });
    const result = buildManhuaAdvisorProject({ ...base, bible, writerConfirmed: true, refs: [{ id: "r", role: "character", source: "upload", url: "https://example.com/heiqi.png", labelZh: "黑奇定稿", refDuty: "identity", claimedAnchorIds: ["heiqi"], primaryBindings: [{ anchorId: "heiqi", duty: "identity" }] }] });
    expect(result.context.assetSummary).toContain("认领黑奇；当前参考");
    expect(result.context.directorStrategyId).toBe("relational_action");
    expect(result.context.directorStrategyRevision).toBe(getManhuaDirectorStrategyContract("relational_action")?.revision);
    expect(JSON.stringify(result.context)).not.toContain("sourceClaim");
    expect(result.issues.map((issue) => issue.id)).not.toContain("claims");
  });

  it("旧合同缺版本不冒充当前已批准版本，未分类图片不会误称人物", () => {
    const bible = { directorStrategyContract: { format: "mv-manhua-director-strategy-v1", version: 1, strategyId: "relational_action" } } as never;
    const result = buildManhuaAdvisorProject({ ...base, bible, refs: [{ id: "x", role: "unset", source: "upload", url: "https://example.com/x.png", labelZh: "候选" }] });
    expect(result.context.directorStrategyId).toBe("relational_action");
    expect(result.context.directorStrategyRevision).toBeUndefined();
    expect(result.context.assetSummary).toContain("未分类「候选」");
  });

  it("长剧本和多段产物明确节选仍可提问，不改原稿，也不冒充全片已读", () => {
    const body = `正文开头${"场景动作".repeat(8000)}正文结尾`;
    const outputText = `分镜开头${"角色动作".repeat(2000)}分镜结尾`;
    const longPack = { ...pack, episodes: [{ ...pack.episodes[0]!, body }] };
    const block = { ...defaultCanvasBlock("text", 0, 0), id: "beats-e01-a", episodeIndex: 1, outputText };
    const result = buildManhuaAdvisorProject({ ...base, pack: longPack, blocks: [block] });
    expect(manhuaCreativeAdvisorContextSchema.safeParse(result.context).success).toBe(true);
    expect(result.context.episodeBody).toContain("【已节选：本集正文");
    expect(result.context.episodeBody).toContain("正文开头");
    expect(result.context.episodeBody).toContain("正文结尾");
    expect(result.context.shotSummary).toContain("未提供部分不可判定");
    expect(result.contextNotes).toHaveLength(2);
    expect(longPack.episodes[0]!.body).toBe(body);
    expect(block.outputText).toBe(outputText);
    const selected = buildManhuaAdvisorProject({ ...base, blocks: [block], selection: { episodeIndex: 1, segmentIndex: 1, shot: { index: 1, durationSec: 3, actionZh: "真实选中动作", cameraZh: "固定" } } });
    expect(selected.context.shotSummary).toContain("真实选中动作");
    expect(selected.context.shotSummary).not.toContain("分镜开头");
    expect(selected.contextNotes).toEqual([]);
  });
});

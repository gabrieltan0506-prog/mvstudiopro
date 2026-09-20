import { buildManhuaDirectionCanonFromSelection } from "@shared/manhuaDirectionCanonLibrary";
import { describe, expect, it } from "vitest";
import {
  buildManhuaAdvisorProject,
  claimManhuaAdvisorNudgeOnce,
  formatManhuaAdvisorAssetGapZh,
  formatManhuaAdvisorPipeline3dZh,
  pickManhuaAdvisorPhaseNudge,
  pickManhuaAdvisorTopIssue,
  recommendManhua3dUsage,
  resolveManhuaAdvisorVideoModel,
} from "./manhuaAdvisorProject";
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
    const claims = result.issues.find((issue) => issue.id === "claims");
    expect(claims?.text).toContain("6 张人物图尚未认领到本剧人物");
    // 0919：未认领的多余图不挡出片，文案必须说清后果，否则用户看到 ✅ 旁边挂警告会以为自相矛盾
    expect(claims?.text).toContain("不挡出片");
    expect(claims?.blocking).toBe(false);
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

describe("PR-12 · 上下文补喂与四类 issue", () => {
  it("六项字段进上下文并通过 schema，门禁/缺口/关键帧/绑骨四类 issue 各归各阶段", () => {
    const result = buildManhuaAdvisorProject({
      ...base,
      gate: ["第 1 集对白不足 12 句", "场景表为空"],
      assetGap: formatManhuaAdvisorAssetGapZh({ characters: 0, scenes: 5, props: 0 }),
      keyframeBlock: "请先出齐本段所需关键静帧",
      pipeline3d: formatManhuaAdvisorPipeline3dZh({ modelReady: 1, rigged: 0, total: 6, previsSegments: 0 }),
      queue: "生成中：道具图·药碗",
      credits: "未知",
    });
    expect(result.context.gateZh).toEqual(["第 1 集对白不足 12 句", "场景表为空"]);
    expect(result.context.assetGapZh).toBe("待生成 5：人物 0 · 场景 5 · 道具 0");
    expect(result.context.keyframeBlockZh).toBe("请先出齐本段所需关键静帧");
    expect(result.context.pipeline3dZh).toBe("模型就绪 1/6 · 已绑骨 0/6 · 白模参考 0 段");
    expect(result.context.queueZh).toBe("生成中：道具图·药碗");
    expect(result.context.creditsZh).toBe("未知");
    expect(manhuaCreativeAdvisorContextSchema.safeParse(result.context).success).toBe(true);
    const byId = Object.fromEntries(result.issues.map((issue) => [issue.id, issue.phase]));
    expect(byId["gate"]).toBe("outline");
    expect(byId["asset-gap"]).toBe("assets");
    expect(byId["keyframe"]).toBe("storyboard");
    expect(byId["rig"]).toBe("storyboard");
    expect(result.context.blockers).toContain(result.issues.find((i) => i.id === "gate")!.text);
  });

  it("缺口为零、已绑骨、无门禁时不造 issue；超长门禁只取前 8 条各 120 字", () => {
    const result = buildManhuaAdvisorProject({
      ...base,
      gate: [],
      assetGap: formatManhuaAdvisorAssetGapZh({ characters: 0, scenes: 0, props: 0 }),
      pipeline3d: formatManhuaAdvisorPipeline3dZh({ modelReady: 2, rigged: 2, total: 6, previsSegments: 1 }),
    });
    const ids = result.issues.map((issue) => issue.id);
    expect(ids).not.toContain("gate");
    expect(ids).not.toContain("asset-gap");
    expect(ids).not.toContain("keyframe");
    expect(ids).not.toContain("rig");
    expect(result.context.gateZh).toBeUndefined();
    const many = buildManhuaAdvisorProject({ ...base, gate: Array.from({ length: 10 }, (_, i) => `${i}${"错".repeat(200)}`) });
    expect(many.context.gateZh).toHaveLength(8);
    expect(many.context.gateZh![0]!.length).toBeLessThanOrEqual(120);
    expect(manhuaCreativeAdvisorContextSchema.safeParse(many.context).success).toBe(true);
  });

  it("3D 规则：武打段且同一已锁脸角色跨三段才推荐，只推一段", () => {
    const segments = [
      { intentZh: "阿菁在坊市与恶少对峙", dialogueZh: "「让开」", castZh: "阿菁、恶少" },
      { intentZh: "恶少拔剑劈向阿菁", dialogueZh: "", castZh: "阿菁、恶少" },
      { intentZh: "阿菁反手一掌击退", dialogueZh: "「滚」", castZh: "阿菁" },
      { intentZh: "黑奇低吼", dialogueZh: "", castZh: "黑奇" },
    ];
    const yes = recommendManhua3dUsage({ segments, lockedCharacterNames: ["阿菁"] });
    expect(yes.recommend).toBe(true);
    expect(yes.suggestedSegmentIndex).toBe(2);
    expect(yes.reasonZh).toContain("阿菁");
    expect(yes.reasonZh).toContain("第 2 段");
    const noLock = recommendManhua3dUsage({ segments, lockedCharacterNames: [] });
    expect(noLock.recommend).toBe(false);
    expect(noLock.suggestedSegmentIndex).toBeUndefined();
    expect(noLock.recommendPrevis).toBe(true);
    expect(noLock.previsSuggestedSegmentIndex).toBe(2);
    const talky = recommendManhua3dUsage({
      segments: [
        { intentZh: "两人对坐叙旧", dialogueZh: "「多年不见」", castZh: "阿菁、黑奇" },
        { intentZh: "阿菁回忆往事", dialogueZh: "「那年」", castZh: "阿菁" },
        { intentZh: "阿菁落泪", dialogueZh: "", castZh: "阿菁" },
      ],
      lockedCharacterNames: ["阿菁"],
    });
    expect(talky.recommend).toBe(false);
    expect(talky.reasonZh).toContain("对话");
    const built = buildManhuaAdvisorProject({ ...base, segments, lockedCharacterNames: ["阿菁"] });
    expect(built.contextNotes.some((n) => n.includes("3D") && n.includes("第 2 段"))).toBe(true);
    expect(built.recommend3d?.recommend).toBe(true);
  });

  it("对白中的走位、上楼、道具互动和演唱会可独立推荐白模，不要求锁脸或昂贵资产", () => {
    for (const intentZh of ["两人边走边谈", "她上楼继续对话", "他接过茶杯回答", "演唱会舞台上弹奏吉他"]) {
      const result = recommendManhua3dUsage({ segments: [{ intentZh, dialogueZh: "对白持续", castZh: "甲" }], lockedCharacterNames: [] });
      expect(result.recommend).toBe(false);
      expect(result.recommendPrevis).toBe(true);
      expect(result.previsSuggestedSegmentIndex).toBe(1);
      expect(pickManhuaAdvisorPhaseNudge({ phase: "storyboard", issues: [], recommend3d: result })).toContain("通用白模");
      expect(result.reasonZh).not.toContain("不建议用 3D");
    }
  });

  it("打算和对白中的追杀不冒充实际动作，静态对白也不禁用白模", () => {
    const result = recommendManhua3dUsage({ segments: [{ intentZh: "甲打算告诉乙往事，两人对坐", dialogueZh: "那年他们追逐打斗", castZh: "甲、乙" }], lockedCharacterNames: ["甲"] });
    expect(result.recommendPrevis).toBe(false);
    expect(result.reasonZh).toContain("仍可手动使用白模预演");
  });

  it("阶段顶部提示与进阶段气泡：取当前阶段第一条 issue，否则 3D 理由；每阶段只弹一次", () => {
    const issues = [
      { id: "gate", text: "门禁", phase: "outline" as const, blocking: true },
      { id: "asset-gap", text: "缺口", phase: "assets" as const, blocking: true },
    ];
    expect(pickManhuaAdvisorTopIssue(issues, "assets")?.id).toBe("asset-gap");
    expect(pickManhuaAdvisorTopIssue(issues, "storyboard")?.id).toBe("gate");
    // 0919 阻断优先：本阶段有不挡路的提醒排在前面时，仍要先报真正卡住的那条
    expect(
      pickManhuaAdvisorTopIssue(
        [
          { id: "claims", text: "未认领", phase: "assets" as const, blocking: false },
          { id: "asset-gap", text: "缺口", phase: "assets" as const, blocking: true },
        ],
        "assets",
      )?.id,
    ).toBe("asset-gap");
    // 本阶段没有阻断时，跨阶段的阻断也优先于本阶段的提醒——它同样挡着往下走
    expect(
      pickManhuaAdvisorTopIssue(
        [
          { id: "claims", text: "未认领", phase: "assets" as const, blocking: false },
          { id: "gate", text: "门禁", phase: "outline" as const, blocking: true },
        ],
        "assets",
      )?.id,
    ).toBe("gate");
    // 反例对照：全是提醒时照旧按阶段取第一条，不许凭空升级成阻断
    expect(
      pickManhuaAdvisorTopIssue(
        [
          { id: "review", text: "待确认", phase: "assets" as const, blocking: false },
          { id: "rig", text: "未绑骨", phase: "storyboard" as const, blocking: false },
        ],
        "storyboard",
      )?.id,
    ).toBe("rig");
    expect(pickManhuaAdvisorTopIssue([], "assets")).toBeNull();
    expect(pickManhuaAdvisorPhaseNudge({ phase: "assets", issues, recommend3d: null })).toBe("进入资产设定：缺口");
    expect(pickManhuaAdvisorPhaseNudge({ phase: "storyboard", issues: [], recommend3d: { recommend: true, reasonZh: "理由", suggestedSegmentIndex: 2 } })).toBe("进入分镜：理由");
    expect(pickManhuaAdvisorPhaseNudge({ phase: "storyboard", issues: [], recommend3d: { recommend: false, reasonZh: "不推荐" } })).toBeNull();
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    expect(claimManhuaAdvisorNudgeOnce(storage, "assets")).toBe(true);
    expect(claimManhuaAdvisorNudgeOnce(storage, "assets")).toBe(false);
    expect(claimManhuaAdvisorNudgeOnce(storage, "storyboard")).toBe(true);
    expect(claimManhuaAdvisorNudgeOnce({ getItem: () => { throw new Error("blocked"); }, setItem: () => {} }, "edit")).toBe(true);
  });
});

describe("1471 R1 · 存储不可用", () => {
  it("取 sessionStorage 本身抛 SecurityError 或为 null：仍返回可弹，不抛", async () => {
    const { claimManhuaAdvisorNudgeOnce } = await import("./manhuaAdvisorProject");
    expect(claimManhuaAdvisorNudgeOnce(() => { throw new Error("SecurityError"); }, "assets")).toBe(true);
    expect(claimManhuaAdvisorNudgeOnce(null, "assets")).toBe(true);
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(claimManhuaAdvisorNudgeOnce(() => store, "edit")).toBe(true);
    expect(claimManhuaAdvisorNudgeOnce(store, "edit")).toBe(false);
  });
});

it("当前导演包七核心检查进入真实顾问摘要", () => {
 const bible = buildManhuaProjectBible({ topic: "墨菁传", pack, cast: { lane: "ancient", characterIds: [], ancientArchetypeIds: [], artStyleId: "cg", propIds: [], wardrobePropContinuityIds: [] } });
 bible.directionCanon = buildManhuaDirectionCanonFromSelection({ mainCardId: "parallel_action_editing" })!;
 const result = buildManhuaAdvisorProject({ ...base, bible, phase: "storyboard", selection: { episodeIndex: 1, segmentIndex: 1, shot: { index: 1, durationSec: 5, actionZh: "黑奇护住阿菁", cameraZh: "全景" } } });
 for (const label of ["景别", "角度", "构图", "光影", "色调", "动势", "转场"]) expect(result.context.shotSummary).toContain(`七核心检查·${label}`);
 expect(result.context.shotSummary).toContain("黑奇护住阿菁");
 expect(manhuaCreativeAdvisorContextSchema.safeParse(result.context).success).toBe(true);
});

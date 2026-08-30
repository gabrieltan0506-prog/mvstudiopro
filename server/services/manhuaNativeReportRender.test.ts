/**
 * 报告渲染服务测试（PR1325 第三、五节）：
 * 精确证据名寻址 fail closed + 无删节渲染 + 帧可选 + HTML 严格转义。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  objects: new Map<string, unknown>(),
  uploads: [] as Array<{ objectName: string; html: string }>,
  listNames: [] as string[],
}));

vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "test-bucket",
  downloadGcsObjectVersioned: vi.fn(async ({ gcsUri }: { gcsUri: string }) => {
    const objectName = gcsUri.replace("gs://test-bucket/", "");
    if (!state.objects.has(objectName)) throw new Error(`no such object: ${objectName}`);
    const value = state.objects.get(objectName);
    const buffer = typeof value === "string"
      ? Buffer.from(value, "utf8")
      : Buffer.from(JSON.stringify(value), "utf8");
    return { buffer, generation: "1" };
  }),
  listGcsObjectNamesByPrefix: vi.fn(async () => state.listNames),
  uploadBufferToGcs: vi.fn(async ({ objectName, buffer }: { objectName: string; buffer: Buffer }) => {
    state.uploads.push({ objectName, html: buffer.toString("utf8") });
    return { gcsUri: `gs://test-bucket/${objectName}` };
  }),
}));

vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    bucket(bucketName: string) {
      return {
        file(objectName: string) {
          return {
            getSignedUrl: async () => [`https://signed.example/${bucketName}/${objectName}`],
          };
        },
      };
    }
  },
}));

import { renderNativeEvidenceReportFromObjectNames } from "./manhuaNativeReportRender";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const LONG_ACTION = "影中人回身横刀劈开雨幕，".repeat(12) + "UNTRUNCATED_ACTION_END";
const LONG_CUE = "刀锋入水的闷响接一声极长的低频嗡鸣渐弱UNTRUNCATED_CUE_END";
const XSS = '<script>alert("x")</script>';

function segmentEntry(segmentIndex: number, overrides?: Partial<Record<string, unknown>>) {
  return {
    seriesKey: "seriesabc",
    episodeIndex: 1,
    segmentIndex,
    sourceDigest: DIGEST_A,
    raw: {
      shots: [
        {
          startSec: segmentIndex * 30,
          endSec: segmentIndex * 30 + 10,
          unitTypeZh: "冲突单元",
          shotSizeZh: "特写",
          angleZh: "俯拍",
          compositionZh: "对角线",
          cameraMoveZh: "急推",
          blockingZh: "背向转正",
          bodyActionZh: `第${segmentIndex}段身体动作${XSS}`,
          limbPropActionZh: "握刀",
          microExpressionZh: "眼睑微颤",
          gazeBreathZh: "屏息",
          relationshipReactionZh: "众人后退",
          lightingZh: "侧逆光",
          actionZh: LONG_ACTION,
          transitionInZh: "硬切",
          evidenceRole: "story",
        },
      ],
      subtitles: segmentIndex === 0
        // 5 条间隔 2 秒的密集字幕：会被节点表合并成同一个节点。
        // 旧版每节点只显示前 3 句，后 2 句被「…」吞掉——本夹具专门钉住那个洞。
        ? Array.from({ length: 5 }, (_, i) => ({
          atSec: i * 2,
          textZh: `密集台词${i}_UNTRUNCATED_SUB_END`,
        }))
        : [{ atSec: segmentIndex * 30, textZh: `第${segmentIndex}段台词` }],
      audioResolution: [
        {
          chunkIndex: segmentIndex,
          analysis: {
            audioTrack: [
              {
                fromSec: 0,
                toSec: 10,
                emotionArcZh: "压抑到爆发",
                toneZh: "低哑",
                sfxZh: "雨声",
                bgmZh: "弦乐渐强",
                atmosphereZh: "肃杀",
                silenceZh: "半拍留白",
                cues: [{ atSec: 3, kind: "sfx", detailZh: LONG_CUE }],
              },
            ],
            audioBeatStructureZh: `第${segmentIndex}段声音节奏原文`,
            mixNotesZh: "人声前置",
            reusableAudioZh: "低频先行",
            genAudioHintZh: "雨夜刀鸣",
          },
        },
      ],
      beatStructureZh: `第${segmentIndex + 1}段节拍原文`,
      moodArcZh: `第${segmentIndex + 1}段情绪弧原文`,
      reusableZh: "反打延迟半拍",
      genPromptHintZh: "雨夜巷战",
      classification: { emotionTagsZh: [`情绪标签${segmentIndex}`, "共有标签"] },
      ...overrides,
    },
  };
}

const NAMES = [
  "manhua-template-learn/segment-evidence/tpl_native_seriesabc_ep001/dig/seg0-fp-r0.json",
  "manhua-template-learn/segment-evidence/tpl_native_seriesabc_ep001/dig/seg1-fp-r1.json",
  "manhua-template-learn/segment-evidence/tpl_native_seriesabc_ep001/dig/seg2-fp-r2.json",
];

function seedThreeSegments() {
  state.objects.set(NAMES[0]!, segmentEntry(0));
  state.objects.set(NAMES[1]!, segmentEntry(1));
  state.objects.set(NAMES[2]!, segmentEntry(2));
}

function baseInput() {
  return {
    labelZh: "seriesabc 第 1 集",
    evidenceObjectNames: [...NAMES],
    expectEpisodeIndex: 1,
    expectSeriesKey: "seriesabc",
    expectSourceDigest: DIGEST_A,
    expectSegmentCount: 3,
    framesV2SummaryObjectName: "manhua-template-learn/probes/tpl_native_seriesabc_ep001/frames-v2-summary.json",
    framesPrefix: "manhua-template-learn/probes/tpl_native_seriesabc_ep001/frames/",
    reportObjectName: "manhua-template-learn/reports/tpl_native_seriesabc_ep001.html",
  };
}

beforeEach(() => {
  state.objects.clear();
  state.uploads.length = 0;
  state.listNames = [];
});

describe("精确证据名路径：三段卡渲染成功且无删节", () => {
  it("HTML 含全量字段名、未截断长文本、全段合并摘要、动态字段数", async () => {
    seedThreeSegments();
    state.objects.set(
      "manhua-template-learn/probes/tpl_native_seriesabc_ep001/frames-v2-summary.json",
      { frames: [{ atSec: 5, reasons: ["高潮"], objectName: "frames-v2/seg0/f1.jpg" }] },
    );
    const result = await renderNativeEvidenceReportFromObjectNames(baseInput());
    expect(result.shots).toBe(3);
    expect(result.frames).toBe(1);
    expect(state.uploads).toHaveLength(1);
    const html = state.uploads[0]!.html;
    // 镜头表全字段名（含中文标签）
    for (const label of ["单元类型", "景别", "机位角度", "构图", "运镜", "调度", "身体动作", "肢体道具", "微表情", "视线呼吸", "关系反应", "灯光", "动作叙述", "入镜转场"]) {
      expect(html).toContain(label);
    }
    // 音轨表全字段 + chunk 级模型原文区
    for (const label of ["情绪弧", "语气", "音效", "配乐", "气氛", "留白", "声音节奏", "混音", "可复用声音手法", "生成声音要素"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("第0段声音节奏原文");
    expect(html).toContain("第2段声音节奏原文");
    // 无删节：90/24 字截断已删
    expect(html).toContain("UNTRUNCATED_ACTION_END");
    expect(html).toContain("UNTRUNCATED_CUE_END");
    // 摘要 fallback 合并全段（按段号标注拼接），不再只取第一段
    expect(html).toContain("【第1段】第1段节拍原文");
    expect(html).toContain("【第3段】第3段节拍原文");
    // 分类标签跨段并集去重
    expect(html).toContain("情绪标签0");
    expect(html).toContain("情绪标签2");
    expect((html.match(/共有标签/g) ?? []).length).toBe(1);
    // 「17 字段」硬编码已改 FIELDS.length 动态
    expect(html).toContain("× 14 字段");
    expect(html).not.toContain("× 17 字段");

    // 🔒 字幕零截断（0830 补：此前「不做任何内容截断」只是文件头一句话，没有守卫，
    // 结果剧情节点表每节点只显示前 3 句、其余用「…」吞掉，全仓 3264 测照样绿）。
    // 五条密集台词必须**每一条**都出现在页面里，且页面不许出现截断标记。
    for (let i = 0; i < 5; i += 1) {
      expect(html).toContain(`密集台词${i}_UNTRUNCATED_SUB_END`);
    }
    expect(html).not.toContain("…");
    // 节点表确实做了分组（5 条并成 1 个节点），而不是退回逐条铺开
    expect(html).toContain("5 句");
  });
});

describe("fail closed：缺段/段号重复/digest 混杂/集号不符各抛错且不上传", () => {
  it("🔒 keyMoments 与 excludedAdRanges 必须进合并卡（P0：此前生产路径整字段丢弃，高亮区块永远空）", async () => {
    seedThreeSegments();
    const raw = state.objects.get(NAMES[0]!) as { raw: Record<string, unknown> };
    raw.raw.keyMoments = [
      { atSec: 7, kindZh: "情绪", noteZh: "眉头锁紧_KM_END" },
      { atSec: 7, kindZh: "情绪", noteZh: "同秒同类应被去重" },
      { atSec: 3, kindZh: "切镜", noteZh: "中景转特写_KM_END" },
    ];
    raw.raw.excludedAdRanges = [{ startSec: 100, endSec: 139 }];
    const html = (await renderNativeEvidenceReportFromObjectNames(baseInput()), state.uploads[0]!.html);
    expect(html).toContain("眉头锁紧_KM_END");
    expect(html).toContain("中景转特写_KM_END");
    // 同秒同类去重：只留一条
    expect(html).not.toContain("同秒同类应被去重");
    // KPI 两项不再恒 0
    expect(html).toContain("重点时刻表 · 2 条");
    expect(html).not.toContain("本卡无重点时刻");
    expect(html).toMatch(/>1<\/b>广告区间/);
  });

  it("🔒 广告镜数从未过滤的原始 shots 上数（P0：此前恒为 0 的空改）", async () => {
    seedThreeSegments();
    const raw = state.objects.get(NAMES[1]!) as { raw: Record<string, unknown> };
    (raw.raw.shots as Array<Record<string, unknown>>).push({
      ...(raw.raw.shots as Array<Record<string, unknown>>)[0]!,
      startSec: 200, endSec: 205, evidenceRole: "non_story_ad",
    });
    await renderNativeEvidenceReportFromObjectNames(baseInput());
    const html = state.uploads[0]!.html;
    expect(html).toContain("已剔除 1 广告镜");
    expect(html).not.toContain("已剔除 0 广告镜");
  });

  it("🔒 覆盖按并集算并报重叠；秒位非法的镜显式标注，不许绿灯报喜（P0×2）", async () => {
    seedThreeSegments();
    const raw = state.objects.get(NAMES[2]!) as { raw: Record<string, unknown> };
    const shots = raw.raw.shots as Array<Record<string, unknown>>;
    // 与首镜重叠的镜 + 一条 endSec 缺失的非法镜
    shots.push({ ...shots[0]!, startSec: 0, endSec: 8 });
    shots.push({ ...shots[0]!, startSec: 400, endSec: undefined });
    await renderNativeEvidenceReportFromObjectNames(baseInput());
    const html = state.uploads[0]!.html;
    expect(html).toContain("处镜头重叠");
    expect(html).toContain("镜秒位非法，未计入镜长统计");
  });

  it("🔒 剧情节点表不许塌成一个节点（P1：滑动窗口 + 密集对白）", async () => {
    seedThreeSegments();
    const raw = state.objects.get(NAMES[0]!) as { raw: Record<string, unknown> };
    // 30 条间隔 5 秒的字幕：滑动窗口下会全部并成 1 个节点
    raw.raw.subtitles = Array.from({ length: 30 }, (_, i) => ({
      atSec: i * 5, textZh: `连续台词${i}`,
    }));
    await renderNativeEvidenceReportFromObjectNames(baseInput());
    const html = state.uploads[0]!.html;
    expect(html).not.toMatch(/剧情节点表 · 1 节点/);
    // 每条原文仍一句不少
    for (let i = 0; i < 30; i += 1) expect(html).toContain(`连续台词${i}`);
  });

  it("缺一段抛错", async () => {
    seedThreeSegments();
    state.objects.delete(NAMES[1]!);
    await expect(renderNativeEvidenceReportFromObjectNames(baseInput()))
      .rejects.toThrow(/缺失|不可读/);
    expect(state.uploads).toHaveLength(0);
  });

  it("段号重复抛错", async () => {
    seedThreeSegments();
    state.objects.set(NAMES[2]!, segmentEntry(1));
    await expect(renderNativeEvidenceReportFromObjectNames(baseInput()))
      .rejects.toThrow(/segmentIndex 重复/);
    expect(state.uploads).toHaveLength(0);
  });

  it("段号必须严格等于下标：seg2 位置放 seg3 抛「不完整」", async () => {
    seedThreeSegments();
    state.objects.set(NAMES[2]!, segmentEntry(3));
    await expect(renderNativeEvidenceReportFromObjectNames(baseInput()))
      .rejects.toThrow("证据 segmentIndex 不完整：应有 seg2，实际为 seg3");
    expect(state.uploads).toHaveLength(0);
  });

  it("段数够但整体缺首段（seg1/2/3）抛「不完整」——只查相邻连续会放过", async () => {
    state.objects.set(NAMES[0]!, segmentEntry(1));
    state.objects.set(NAMES[1]!, segmentEntry(2));
    state.objects.set(NAMES[2]!, segmentEntry(3));
    await expect(renderNativeEvidenceReportFromObjectNames(baseInput()))
      .rejects.toThrow("证据 segmentIndex 不完整：应有 seg0，实际为 seg1");
    expect(state.uploads).toHaveLength(0);
  });

  it("少末段：证据名只有 2 个而卡片 attemptedSegments=3 → 段数不完整", async () => {
    seedThreeSegments();
    await expect(renderNativeEvidenceReportFromObjectNames({
      ...baseInput(),
      evidenceObjectNames: NAMES.slice(0, 2),
    })).rejects.toThrow("证据段数不完整：卡片应有 3 段，provenance 只有 2 段");
    expect(state.uploads).toHaveLength(0);
  });

  it("少首段：证据名只有 seg1/seg2 → 段数不完整", async () => {
    seedThreeSegments();
    await expect(renderNativeEvidenceReportFromObjectNames({
      ...baseInput(),
      evidenceObjectNames: NAMES.slice(1),
    })).rejects.toThrow("证据段数不完整：卡片应有 3 段，provenance 只有 2 段");
    expect(state.uploads).toHaveLength(0);
  });

  it("证据 seriesKey 与请求系列不符抛错", async () => {
    seedThreeSegments();
    const alien = segmentEntry(2);
    (alien as { seriesKey: string }).seriesKey = "otherseries";
    state.objects.set(NAMES[2]!, alien);
    await expect(renderNativeEvidenceReportFromObjectNames(baseInput()))
      .rejects.toThrow(/seriesKey/);
    expect(state.uploads).toHaveLength(0);

    // 三段整体都是别的系列：一致性检查过得去，但与请求系列不符必须拦下
    NAMES.forEach((name, i) => {
      const entry = segmentEntry(i);
      (entry as { seriesKey: string }).seriesKey = "otherseries";
      state.objects.set(name, entry);
    });
    await expect(renderNativeEvidenceReportFromObjectNames(baseInput()))
      .rejects.toThrow("证据 seriesKey=otherseries 与请求系列 seriesabc 不符");
    expect(state.uploads).toHaveLength(0);
  });

  it("证据对象缺少 seriesKey 抛错", async () => {
    seedThreeSegments();
    const noKey = segmentEntry(1) as Record<string, unknown>;
    delete noKey.seriesKey;
    state.objects.set(NAMES[1]!, noKey);
    await expect(renderNativeEvidenceReportFromObjectNames(baseInput()))
      .rejects.toThrow(/证据对象缺少 seriesKey/);
    expect(state.uploads).toHaveLength(0);
  });

  it("证据 sourceDigest 与卡片 provenance 不符抛错", async () => {
    seedThreeSegments();
    await expect(renderNativeEvidenceReportFromObjectNames({
      ...baseInput(),
      expectSourceDigest: DIGEST_B,
    })).rejects.toThrow("证据 sourceDigest 与卡片 provenance 不符");
    expect(state.uploads).toHaveLength(0);
  });

  it("证据 sourceDigest 非 64 位 hex 抛错", async () => {
    seedThreeSegments();
    const badDigest = segmentEntry(0);
    (badDigest as { sourceDigest: string }).sourceDigest = "PRIVATE_SOURCE_DIGEST";
    state.objects.set(NAMES[0]!, badDigest);
    await expect(renderNativeEvidenceReportFromObjectNames(baseInput()))
      .rejects.toThrow(/证据对象 sourceDigest 非法/);
    expect(state.uploads).toHaveLength(0);
  });

  it("sourceDigest 混杂抛错", async () => {
    seedThreeSegments();
    const mixed = segmentEntry(2);
    (mixed as { sourceDigest: string }).sourceDigest = DIGEST_B;
    state.objects.set(NAMES[2]!, mixed);
    await expect(renderNativeEvidenceReportFromObjectNames(baseInput()))
      .rejects.toThrow(/sourceDigest 混杂/);
    expect(state.uploads).toHaveLength(0);
  });

  it("证据损坏（非法 JSON）抛错", async () => {
    seedThreeSegments();
    state.objects.set(NAMES[1]!, "{broken json");
    await expect(renderNativeEvidenceReportFromObjectNames(baseInput()))
      .rejects.toThrow(/损坏/);
    expect(state.uploads).toHaveLength(0);
  });

  it("episodeIndex 与请求集号不符抛错", async () => {
    seedThreeSegments();
    await expect(renderNativeEvidenceReportFromObjectNames({
      ...baseInput(),
      expectEpisodeIndex: 2,
    })).rejects.toThrow(/episodeIndex/);
    expect(state.uploads).toHaveLength(0);
  });

  it("空证据名列表抛错（拒绝列目录猜证据）", async () => {
    await expect(renderNativeEvidenceReportFromObjectNames({
      ...baseInput(),
      evidenceObjectNames: [],
    })).rejects.toThrow(/segmentEvidenceObjectNames/);
    expect(state.uploads).toHaveLength(0);
  });
});

describe("帧包始终可选", () => {
  it("frames-v2 与 frames 都缺失仍成功，页面明示未抽帧", async () => {
    seedThreeSegments();
    state.listNames = [];
    const result = await renderNativeEvidenceReportFromObjectNames(baseInput());
    expect(result.frames).toBe(0);
    expect(result.frameSource).toContain("未抽帧");
    expect(state.uploads[0]!.html).toContain("未抽帧");
  });
});

describe("HTML 严格转义", () => {
  it("<script> 注入渲染为实体，不出现可执行标签", async () => {
    seedThreeSegments();
    await renderNativeEvidenceReportFromObjectNames(baseInput());
    const html = state.uploads[0]!.html;
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain('<script>alert("x")</script>');
  });
});

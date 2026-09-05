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
          hintZh: "场景道具观察".repeat(25) + "观察尾部保留" + XSS,
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
    segmentSpans: [
      { startSec: 0, endSec: 281 },
      { startSec: 281, endSec: 562 },
      { startSec: 562, endSec: 843 },
    ],
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
    state.objects.set(
      "frames-v2/seg0/f1.jpg",
      "fake-jpeg-bytes",
    );
    const result = await renderNativeEvidenceReportFromObjectNames(baseInput());
    expect(result.shots).toBe(3);
    expect(result.frames).toBe(1);
    expect(state.uploads).toHaveLength(1);
    const html = state.uploads[0]!.html;
    // 镜头表全字段名（含中文标签）
    for (const label of ["运镜解读", "景别", "机位角度", "构图", "运镜", "调度", "身体动作", "肢体道具", "微表情", "视线呼吸", "关系反应", "灯光", "动作叙述"]) {
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
    // 0905：分段摘要压成前/中/后，不再逐段铺
    expect(html).toContain("【前段】第1段节拍原文");
    expect(html).toContain("【后段】第3段节拍原文");
    // 分类标签跨段并集去重
    expect(html).toContain("情绪标签0");
    expect(html).toContain("情绪标签2");
    expect((html.match(/共有标签/g) ?? []).length).toBe(1);
    // 0905 用户令：镜头表只列重点镜（剧情亮点/转折 + 运镜/剪辑技巧），不再全镜
    expect(html).toContain("重点镜头表 · ");
    expect(html).toContain("观察尾部保留&lt;script&gt;");
    expect(html).toContain("本镜观察");
    expect(html).not.toContain("× 17 字段");
    // 独立 HTML 自带编码声明；下载到本地后不依赖 GCS 响应头也不能乱码。
    expect(html).toContain('<meta charset="utf-8">');
    // 音轨局部秒按真实 281 秒分片边界换算；第 3 片从 09:22 开始，不得用 10:00。
    expect(html).toContain("09:22–09:32");
    expect(html).not.toContain("10:00–10:10");

    // 没有 keyMoments 时不展示字幕流水账；完整字幕仍留在 JSON，不在报告重复铺开。
    expect(html).toContain("0 重点字幕");
    expect(html).not.toContain("密集台词0_UNTRUNCATED_SUB_END");
    expect(html).not.toContain("字幕原始证据");
    expect(html).not.toContain("剧情节点表");
  });

  it("优先渲染最终 GLM 整集 parsed 证据，并用真实分片计划换算音轨秒位", async () => {
    seedThreeSegments();
    const glmObjectName = "manhua-template-learn/episode-glm-evidence/native-structuring-test1234567890/parsed.json";
    const raws = [0, 1, 2].map((index) => (segmentEntry(index) as { raw: Record<string, unknown> }).raw);
    const glmCard = {
      shots: raws.flatMap((raw) => raw.shots as unknown[]),
      subtitles: raws.flatMap((raw) => raw.subtitles as unknown[]),
      audioResolution: raws.flatMap((raw) => raw.audioResolution as unknown[]),
      beatStructureZh: "GLM最终整集节奏_GLM_END",
      moodArcZh: "GLM最终整集情绪",
      reusableZh: "GLM最终可复用手法",
      genPromptHintZh: "GLM最终生成提示",
      classification: { emotionTagsZh: ["GLM最终标签"] },
    };
    state.objects.set(glmObjectName, { parsed: { answer: JSON.stringify(glmCard) } });
    await renderNativeEvidenceReportFromObjectNames({
      ...baseInput(),
      glmCardObjectName: glmObjectName,
    });
    const html = state.uploads[0]!.html;
    // 0902 去内部术语：来源说明只留在返回值里给面板，客户 HTML 一律不出现
    expect(html).not.toContain("provenance");
    expect(html).toContain("第 1 集 · 逐镜逐秒审读整理");
    expect(html).toContain("GLM最终整集节奏_GLM_END");
    expect(html).toContain("GLM最终标签");
    expect(html).toContain("09:22–09:32");
    expect(html).not.toContain("10:00–10:10");
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
    // 0902 表瘦身：说明列删除（与截图标注同源），noteZh 不再渲染进页面
    expect(html).not.toContain("眉头锁紧_KM_END");
    expect(html).toContain("关键字幕（前后 2 秒）");
    // 0902 表瘦身后 noteZh 不进页面——改验类型行仍渲染（keyMoments 字段没被产线丢弃）
    expect(html).toContain("关键字幕（前后 2 秒）");
    expect(html).not.toContain("中景转特写_KM_END");
    // 同秒同类去重：只留一条
    expect(html).not.toContain("同秒同类应被去重");
    // KPI 两项不再恒 0
    expect(html).toContain("重点时刻表 · 2 条");
    expect(html).not.toContain("本卡无重点时刻");
    expect(html).toMatch(/>1<\/b><span[^>]*>广告区间/);
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

  it("字幕只展示 keyMoments 前后 2 秒，并直接并入重点时刻表", async () => {
    seedThreeSegments();
    const raw = state.objects.get(NAMES[0]!) as { raw: Record<string, unknown> };
    raw.raw.keyMoments = [{ atSec: 4, kindZh: "剧情", noteZh: "冲突落点" }];
    await renderNativeEvidenceReportFromObjectNames(baseInput());
    const html = state.uploads[0]!.html;
    expect(html).toContain("3 重点字幕");
    expect(html).toContain("关键字幕（前后 2 秒）");
    for (const i of [1, 2, 3]) expect(html).toContain(`密集台词${i}_UNTRUNCATED_SUB_END`);
    for (const i of [0, 4]) expect(html).not.toContain(`密集台词${i}_UNTRUNCATED_SUB_END`);
    expect(html).not.toContain("字幕原始证据");
    expect(html).not.toContain("剧情节点表");
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
  it("正式卡 evidenceFrames 优先进入导出，不再只找旧 probes 帧包", async () => {
    seedThreeSegments();
    state.objects.set(
      `manhua-template-learn/native-frames/seriesabc/ep001/70ds-${"d".repeat(24)}.jpg`,
      "fake-jpeg-bytes",
    );
    const result = await renderNativeEvidenceReportFromObjectNames({
      ...baseInput(),
      evidenceFrames: [{
        atSec: 7,
        kindZh: "情绪",
        noteZh: "眉头锁紧指节发白",
        objectName: `manhua-template-learn/native-frames/seriesabc/ep001/70ds-${"d".repeat(24)}.jpg`,
        mimeType: "image/jpeg",
        bytes: 1234,
        sha256: "d".repeat(64),
      }],
    });
    expect(result.frames).toBe(1);
    expect(result.frameSource).toBe("正式卡重点时刻抽帧");
    // 0902 短标注富化规则：≥6 字的原标注原样保留
    expect(state.uploads[0]!.html).toContain("眉头锁紧指节发白");
    // 0902 内嵌改造：页面不再出现内部帧包来源词，只写「精选画面 N 张」且图为 data URI
    expect(state.uploads[0]!.html).toContain("精选画面 1 张");
    expect(state.uploads[0]!.html).toContain("data:image/jpeg;base64,");
  });

  it("frames-v2 与 frames 都缺失仍成功，页面明示未抽帧", async () => {
    seedThreeSegments();
    state.listNames = [];
    const result = await renderNativeEvidenceReportFromObjectNames(baseInput());
    expect(result.frames).toBe(0);
    expect(result.frameSource).toContain("未抽帧");
    expect(state.uploads[0]!.html).toContain("精选画面 0 张");
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

describe("0905 · 分段摘要压成前/中/后", () => {
  it("九段摘要按前/中/后重新分组，内容一字不删", async () => {
    const { condenseSegmentedSummaryZh } = await import("./manhuaNativeReportRender");
    const nine = Array.from({ length: 9 }, (_, i) => `【第${i + 1}段】甲${i + 1}句。乙${i + 1}句。`).join("");
    const out = condenseSegmentedSummaryZh(nine);
    expect(out.split("\n")).toHaveLength(3);
    expect(out).toMatch(/^【前段】/);
    expect(out).toContain("【中段】");
    expect(out).toContain("【后段】");
    expect(out).not.toContain("第4段");
    // 内容一字不删：只重新分组
    expect(out.split("\n")[0]).toBe("【前段】甲1句。乙1句。甲2句。乙2句。甲3句。乙3句。");
    expect(out).toContain("甲9句。乙9句。");
    expect(condenseSegmentedSummaryZh("一句。二句。三句。四句。五句。六句。七句。")).toBe("一句。二句。三句。四句。五句。六句。七句。");
    expect(condenseSegmentedSummaryZh("")).toBe("");
  });
});

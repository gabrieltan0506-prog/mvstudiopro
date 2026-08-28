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
      subtitles: [{ atSec: segmentIndex * 30, textZh: `第${segmentIndex}段台词` }],
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
  });
});

describe("fail closed：缺段/段号重复/digest 混杂/集号不符各抛错且不上传", () => {
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

  it("段号断裂抛错", async () => {
    seedThreeSegments();
    state.objects.set(NAMES[2]!, segmentEntry(3));
    await expect(renderNativeEvidenceReportFromObjectNames(baseInput()))
      .rejects.toThrow(/segmentIndex 断裂/);
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

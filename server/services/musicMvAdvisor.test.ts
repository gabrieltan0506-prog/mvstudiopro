import { describe, expect, it, vi } from "vitest";
import { askMusicMvAdvisor } from "./musicMvAdvisor";
import { parseAskJson } from "./platformSkillQa";
import { CreativeProposalError, creativeProposalFailureMessage } from "./creativeProposalFailure";
import {
  parseMusicMvAdvisorProposal,
  type MusicMvAdvisorTarget,
} from "../../shared/canvasMusicMv";

const emotion = {fromZh:"克制",toZh:"释然",triggerZh:"归还旧物",musicZh:"减少鼓点后人声展开",visualZh:"建议：把车票递回"};
const target: MusicMvAdvisorTarget = {
  sourceKey: "test-song-version",
  audio: { id: "song", url: "https://example.test/song.wav", durationSec: 12 },
  lyrics: "归来",
  creativePrompt: "故乡重逢",
  referenceSummaries: ["主唱肖像"],
  referenceKeys: ["gs://test-bucket/portrait.png"],
  footage: [
    {
      assetId: "street",
      url: "gs://test-bucket/street.mp4",
      durationSec: 30,
      sourceStartSec: 0,
      name: "街道",
    },
  ],
};
function proposal() {
  return {
    kind: "music_mv_v1",
    sourceKey: target.sourceKey,
    summaryZh: "由独唱转向归途",
    sections: [
      { startSec: 0, endSec: 12, labelZh: "副歌", heardZh: "持续人声与弦乐", emotion },
    ],
    uncertaintiesZh: ["唱段边界须试听"],
    concepts: Array.from({ length: 4 }, (_, i) => ({
      id: `idea-${i}`,
      titleZh: `归途${i}`,
      rationaleZh: "呼应副歌归来",
      emotionalArc: [{sectionZh:"副歌",emotion}],
      openingZh: "主唱凝视",
      peakZh: "街道出现",
      endingZh: "回到主唱",
      plan: {
        version: 1,
        audioId: "song",
        audioDurationSec: 12,
        analysisBasis: "native_audio",
        shots: [
          {
            id: "sing",
            startSec: 0,
            endSec: 6,
            kind: "singing",
            visualPrompt: "主唱轻唱",
            cameraPrompt: "缓慢推进",
            lyricQuote: "归来",
            referenceIndices: [0],
          },
          {
            id: "street",
            startSec: 6,
            endSec: 12,
            kind: "footage",
            visualPrompt: "街道空镜",
            cameraPrompt: "保留素材运镜",
            lyricQuote: "",
            referenceIndices: [],
            sourceClip: {
              ...target.footage[0],
              name: undefined,
              sourceStartSec: 7,
            },
          },
        ],
      },
    })),
  };
}
function fixture() {
  const records = new Map<string, unknown>();
  const d = {
    resolveAudio: vi.fn(async () => "gs://test-bucket/song.wav"),
    resolveVideo: vi.fn(async () => "gs://test-bucket/street.mp4"),
    read: vi.fn(async () => ({
      buffer: Buffer.from("test-audio"),
      mimeType: "audio/wav",
      durationSec: 12,
    })),
    generate: vi.fn(async () => ({
      text: JSON.stringify({kind: "native_music_evidence_v1", sourceKey: target.sourceKey, summaryZh: "持续人声", sections: proposal().sections, uncertaintiesZh: []}),
      candidates: [{finishReason: "STOP"}],
      modelVersion: "gemini-3.8-flash",
      usageMetadata: {
        promptTokensDetails: [{ modality: "AUDIO", tokenCount: 30 }],
      },
    })),
    upload: vi.fn(
      async ({
        objectName,
        buffer,
      }: {
        objectName: string;
        buffer: Buffer;
      }) => {
        records.set(objectName, JSON.parse(buffer.toString()));
        return { created: true };
      }
    ),
    compose: vi.fn(async () => ({decoded: JSON.parse(JSON.stringify(proposal())), model: "glm-5.3-flashx"})),
    readKnowledge: vi.fn(async () => ({entries: [], selectedIds: []})),
    bucket: () => "test-bucket",
    refine: vi.fn(async (input: any) => ({proposal: input.candidate, review: {verdict: "approved" as const, summaryZh: "离线联合审阅", findings: [], mediaReview: [], inspirationZh: ["用动作推进关系"], limitationsZh: ["离线替身"],model:"gpt-6-astra"}})),
    uuid: () => "11111111-1111-4111-8111-111111111111",
  };
  return {
    d: d as unknown as NonNullable<Parameters<typeof askMusicMvAdvisor>[3]>,
    records,
    mocks: d,
  };
}
describe("MV真实听音消费合同（离线替身，不证明上游可用）", () => {
  it("发送真实音频字段并持久化原文，解析后保留四份完整计划", async () => {
    const { d, records, mocks } = fixture();
    const answer = parseAskJson(
      await askMusicMvAdvisor(7, target, "设计MV", d),
      true
    );
    const accepted = parseMusicMvAdvisorProposal(answer.answer, target);
    expect(accepted.evidenceId).toBe("11111111-1111-4111-8111-111111111111");
    expect(accepted.concepts).toHaveLength(4);
    expect(mocks.compose).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.compose.mock.calls)).toContain("native_music_evidence_v1");
    expect(JSON.stringify(mocks.generate.mock.calls)).not.toContain("music_mv_v1");
    expect(JSON.stringify(mocks.generate.mock.calls)).toContain(
      Buffer.from("test-audio").toString("base64")
    );
    expect(Array.from(records.keys()).map(k => k.split("/").at(-1))).toEqual([
      "request.json",
      "raw.json",
      "decoded.json",
      "glm-draft-validated.json",
      "accepted.json",
    ]);
  });
  it("无音频用量回执不能冒充听音，也不自动重试", async () => {
    const { d, mocks, records } = fixture();
    mocks.generate.mockResolvedValueOnce({
      text: JSON.stringify(proposal()),
      candidates: [{finishReason: "STOP"}],
      modelVersion: "gemini-3.8-flash",
      usageMetadata: { promptTokensDetails: [] },
    });
    await expect(askMusicMvAdvisor(7, target, "设计MV", d)).rejects.toThrow(
      "音频处理回执"
    );
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(Array.from(records.keys()).some(k => k.endsWith("accepted.json"))).toBe(
      false
    );
  });
  it("素材不属于本人或歌曲时长漂移时不调用模型", async () => {
    const { d, mocks } = fixture();
    mocks.resolveVideo.mockRejectedValueOnce(new Error("素材无权限"));
    await expect(askMusicMvAdvisor(7, target, "设计MV", d)).rejects.toThrow(
      "无权限"
    );
    expect(mocks.generate).not.toHaveBeenCalled();
    mocks.read.mockResolvedValueOnce({
      buffer: Buffer.from("test"),
      mimeType: "audio/wav",
      durationSec: 13,
    });
    await expect(askMusicMvAdvisor(7, target, "设计MV", d)).rejects.toThrow(
      "时长"
    );
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("线上案例①：GLM 在 sections 末尾追加 {0,0,占位避免空段} → 确定性丢弃并落证据，不重 compose", async () => {
    const { d, mocks, records } = fixture();
    const bad = JSON.parse(JSON.stringify(proposal()));
    bad.sections.push({ startSec: 0, endSec: 0, labelZh: "占位避免空段", heardZh: "无（此条为校验占位）", emotion: { fromZh: "无", toZh: "无", triggerZh: "无", musicZh: "无", visualZh: "无" } });
    mocks.compose.mockResolvedValueOnce({ decoded: bad, model: "glm-5.3-flashx" });
    const answer = parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", d), true);
    const accepted = parseMusicMvAdvisorProposal(answer.answer, target);
    expect(accepted.sections.map(s => [s.startSec, s.endSec])).toEqual([[0, 12]]);
    expect(mocks.compose).toHaveBeenCalledTimes(1);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    const normalized = records.get("canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/glm-draft-normalized.json") as any;
    expect(normalized.before.sections).toHaveLength(2);
    expect(normalized.after.sections).toHaveLength(1);
    expect(normalized.fixes.sections).toEqual([{ index: 1, field: "section", before: { startSec: 0, endSec: 0, labelZh: "占位避免空段" }, after: undefined, reasonZh: "零长或倒序段落，已并入相邻段落" }]);
    expect(Array.from(records.keys()).map(k => k.split("/").at(-1))).toEqual([
      "request.json", "raw.json", "decoded.json", "glm-draft-normalized.json", "glm-draft-validated.json", "accepted.json",
    ]);
  });
  it("线上案例②：uncertainties 别名/字符串 + 末尾零长闭合段 → 形状修复后通过", async () => {
    const { d, mocks, records } = fixture();
    const bad = JSON.parse(JSON.stringify(proposal()));
    delete bad.uncertaintiesZh;
    bad.uncertainties = "实听速度约115–125BPM，与brief标注有出入";
    bad.sections.push({ startSec: 12, endSec: 12, labelZh: "（占位闭合段）", heardZh: "无", emotion: { fromZh: "无", toZh: "无", triggerZh: "无", musicZh: "无", visualZh: "无" } });
    mocks.compose.mockResolvedValueOnce({ decoded: bad, model: "glm-5.3-flashx" });
    const accepted = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", d), true).answer, target);
    expect(accepted.uncertaintiesZh).toEqual(["实听速度约115–125BPM，与brief标注有出入"]);
    expect(accepted.sections.map(s => [s.startSec, s.endSec])).toEqual([[0, 12]]);
    expect(mocks.compose).toHaveBeenCalledTimes(1);
    const normalized = records.get("canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/glm-draft-normalized.json") as any;
    expect(normalized.fixes.shape.map((f: any) => [f.path, f.reasonZh])).toEqual([
      ["uncertainties", "未知字段改名为 uncertaintiesZh"],
      ["uncertaintiesZh", "字符串包成单元素数组"],
    ]);
    expect(normalized.fixes.sections.map((f: any) => [f.index, f.field])).toEqual([[1, "section"]]);
  });
  it("听音证据本身的零长段与字符串 uncertaintiesZh 在校验前修复，落 evidence-normalized", async () => {
    const { d, mocks, records } = fixture();
    mocks.generate.mockResolvedValueOnce({
      text: JSON.stringify({ kind: "native_music_evidence_v1", sourceKey: target.sourceKey, summaryZh: "持续人声", sections: [{ ...proposal().sections[0], startSec: 0.5, endSec: 11.8 }, { startSec: 0, endSec: 0, labelZh: "占位", heardZh: "无", emotion }], uncertaintiesZh: "尾音边界需复听" }),
      candidates: [{ finishReason: "STOP" }],
      modelVersion: "gemini-3.8-flash",
      usageMetadata: { promptTokensDetails: [{ modality: "AUDIO", tokenCount: 30 }] },
    });
    await askMusicMvAdvisor(7, target, "设计MV", d);
    const normalized = records.get("canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/evidence-normalized.json") as any;
    expect(normalized.after.sections).toEqual([{ ...proposal().sections[0], startSec: 0, endSec: 12 }]);
    expect(normalized.after.uncertaintiesZh).toEqual(["尾音边界需复听"]);
    expect(normalized.fixes.sections.map((f: any) => [f.index, f.field, f.after])).toEqual([[0, "startSec", 0], [1, "section", undefined], [0, "endSec", 12]]);
    expect(JSON.stringify((mocks.compose.mock.calls as unknown as [string, unknown][])[0][1])).toContain('"uncertaintiesZh":["尾音边界需复听"]');
  });
  it("形状修复后仍不过（concepts 只有 3 个）→ 带校验原因重 compose 一次，不重新听歌", async () => {
    const { d, mocks, records } = fixture();
    const bad = JSON.parse(JSON.stringify(proposal()));
    bad.concepts.pop();
    mocks.compose.mockResolvedValueOnce({ decoded: bad, model: "glm-5.3-flashx" });
    const accepted = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", d), true).answer, target);
    expect(accepted.concepts).toHaveLength(4);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.compose).toHaveBeenCalledTimes(2);
    const [instructions, input] = mocks.compose.mock.calls[1] as unknown as [string, any];
    expect(instructions).toContain("上一版方案未通过服务端校验：方案数量不足：至少 4 项");
    expect(input.repair).toEqual({ attempt: 1, reasonZh: "方案数量不足：至少 4 项" });
    expect(input.sourceEvidence).toEqual((mocks.compose.mock.calls[0] as unknown as [string, any])[1].sourceEvidence);
    const names = Array.from(records.keys()).map(k => k.split("/").at(-1));
    expect(names).toContain("glm-draft-rejected.json");
    expect((records.get("canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/glm-draft-rejected.json") as any).reasonZh).toBe("方案数量不足：至少 4 项");
    expect(names).toContain("accepted.json");
  });
  it("重 compose 仍不过 → 抛出带具体原因的 CreativeProposalError，不再第三次", async () => {
    const { d, mocks, records } = fixture();
    const bad = JSON.parse(JSON.stringify(proposal()));
    bad.concepts[3].id = bad.concepts[0].id;
    mocks.compose.mockResolvedValue({ decoded: bad, model: "glm-5.3-flashx" });
    const error = await askMusicMvAdvisor(7, target, "设计MV", d).catch(e => e);
    expect(error).toBeInstanceOf(CreativeProposalError);
    expect(error.message).toBe("修复重试后方案仍未通过校验：MV方案来源或编号不一致");
    expect(creativeProposalFailureMessage(error)).toBe(error.message);
    expect(mocks.compose).toHaveBeenCalledTimes(2);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.refine).not.toHaveBeenCalled();
    const names = Array.from(records.keys()).map(k => k.split("/").at(-1));
    expect(names).toContain("glm-draft-rejected.json");
    expect(names).toContain("repair-1-glm-draft-rejected.json");
    expect(names).not.toContain("accepted.json");
  });
  it("Astra 修订结果追加占位段时同样修复；改写区间则带原因重 refine 一次", async () => {
    const { d, mocks } = fixture();
    mocks.refine.mockImplementationOnce(async (input: any) => ({ proposal: { ...input.candidate, sections: [...input.candidate.sections, { startSec: 0, endSec: 0, labelZh: "占位", heardZh: "无", emotion }], uncertaintiesZh: "一条" }, review: { verdict: "approved" as const, summaryZh: "离线", findings: [], mediaReview: [], inspirationZh: ["x"], limitationsZh: ["y"], model: "gpt-6-astra" } }));
    const accepted = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", d), true).answer, target);
    expect(accepted.sections).toHaveLength(1);
    expect(accepted.uncertaintiesZh).toEqual(["一条"]);
    expect(mocks.refine).toHaveBeenCalledTimes(1);
    const second = fixture();
    second.mocks.refine.mockImplementationOnce(async (input: any) => ({ proposal: { ...input.candidate, sections: [{ ...input.candidate.sections[0], startSec: 0, endSec: 6 }, { ...input.candidate.sections[0], startSec: 6, endSec: 12 }] }, review: { verdict: "approved" as const, summaryZh: "离线", findings: [], mediaReview: [], inspirationZh: ["x"], limitationsZh: ["y"], model: "gpt-6-astra" } }));
    const result = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", second.d), true).answer, target);
    expect(result.sections.map(s => [s.startSec, s.endSec])).toEqual([[0, 12]]);
    expect(second.mocks.refine).toHaveBeenCalledTimes(2);
    expect(second.mocks.compose).toHaveBeenCalledTimes(1);
    expect((second.mocks.refine.mock.calls as unknown as [any][])[1][0].requirements).toContain("联合创作不得改写媒体观察区间和证据");
    expect(Array.from(second.records.keys()).map(k => k.split("/").at(-1))).toContain("astra-rejected.json");
  });
  it("四份完整方案超过旧12000字限制仍原样消费", () => {
    const p = proposal();
    for (const c of p.concepts)
      c.plan.shots[0].visualPrompt = "主唱望向窗外。".repeat(450);
    const raw = JSON.parse(JSON.stringify(p));
    expect(JSON.stringify(raw).length).toBeGreaterThan(12000);
    expect(
      JSON.parse(parseAskJson(JSON.stringify({ answer: raw }), true).answer)
    ).toEqual(raw);
  });
  it("拒绝越界切片、未提供素材和缺人物的演唱", () => {
    const p = JSON.parse(JSON.stringify(proposal()));
    p.concepts[0].plan.shots[1].sourceClip.sourceStartSec = 29;
    expect(() => parseMusicMvAdvisorProposal(p, target)).toThrow();
    p.concepts[0].plan.shots[1].sourceClip.sourceStartSec = 7;
    p.concepts[0].plan.shots[1].sourceClip.assetId = "invented";
    expect(() => parseMusicMvAdvisorProposal(p, target)).toThrow("未提供");
    p.concepts[0].plan.shots[1].sourceClip.assetId = "street";
    p.concepts[0].plan.shots[0].referenceIndices = [];
    expect(() => parseMusicMvAdvisorProposal(p, target)).toThrow();
  });
});

import { describe, expect, it, vi } from "vitest";
import { askMusicMvAdvisor } from "./musicMvAdvisor";
import { parseAskJson } from "./platformSkillQa";
import { CreativeProposalError, creativeProposalFailureMessage } from "./creativeProposalFailure";
import { CREATIVE_LLM_HOPS, CreativeHopTransportError, type CreativeLlmHop } from "./creativeLlmHops";
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
const review = { verdict: "approved" as const, summaryZh: "离线联合审阅", findings: [], mediaReview: [], inspirationZh: ["用动作推进关系"], limitationsZh: ["离线替身"] };
const envelope = (candidate: unknown) => ({ proposal: candidate, review, changesZh: ["保留初稿"] });
/** 用模型回包文本替换一次 compose（走真实 JSON 解析 → 修复 → 校验链）。 */
const composeText = (mocks: ReturnType<typeof fixture>["mocks"], value: unknown, times = 1) => {
  const impl = async (_i: string, _in: unknown, save: (n: string, v: unknown) => Promise<unknown>, hop: CreativeLlmHop) => {
    await save("raw", { model: hop.modelName });
    return { text: typeof value === "string" ? value : JSON.stringify(value), model: hop.modelName };
  };
  for (let i = 0; i < times; i += 1) mocks.compose.mockImplementationOnce(impl as any);
};
const HOP1 = "compose-hop-1-glm-5.3-flashx";
const HOP2 = "compose-hop-2-z-ai_glm-5.3-flashx";
const HOP3 = "compose-hop-3-deepseek_deepseek-v4.1-flash-1017";
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
    compose: vi.fn(async (_instructions: string, _input: unknown, save: (n: string, v: unknown) => Promise<unknown>, hop: CreativeLlmHop) => {
      await save("raw", { model: hop.modelName });
      return { text: JSON.stringify(proposal()), model: hop.modelName };
    }),
    readKnowledge: vi.fn(async () => ({entries: [], selectedIds: []})),
    bucket: () => "test-bucket",
    refine: vi.fn(async (input: any, _draftModel: string, save: (n: string, v: unknown) => Promise<unknown>, hop: CreativeLlmHop) => {
      await save("raw", { model: hop.modelName });
      return { text: JSON.stringify(envelope(input.candidate)), model: hop.modelName, inputSha256: "sha" as string | undefined };
    }),
    hops: CREATIVE_LLM_HOPS,
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
      `${HOP1}-raw.json`,
      `${HOP1}-decoded.json`,
      "compose-hop-used.json",
      "glm-draft-validated.json",
      "refine-hop-1-glm-5.3-flashx-raw.json",
      "refine-hop-1-glm-5.3-flashx-decoded.json",
      "refine-hop-used.json",
      "accepted.json",
    ]);
    const used = records.get(`canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/compose-hop-used.json`) as any;
    expect([used.hop, used.model, used.gateway, used.attempt, used.failuresZh]).toEqual([1, "glm-5.3-flashx", "evolink_flash_only", 1, []]);
    expect((records.get(`canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/accepted.json`) as any).hopsUsed.refine.hop).toBe(1);
    expect(mocks.refine).toHaveBeenCalledTimes(1);
    expect((mocks.refine.mock.calls[0] as unknown as [any])[0].requirements).toContain("【硬约束");
  });
  it("无音频用量回执不能冒充听音，也不自动重试", async () => {
    const { d, mocks, records } = fixture();
    mocks.generate.mockResolvedValueOnce({
      text: JSON.stringify(proposal()),
      candidates: [{finishReason: "STOP"}],
      modelVersion: "gemini-3.8-flash",
      usageMetadata: { promptTokensDetails: [] },
    } as any);
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
    composeText(mocks, bad);
    const answer = parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", d), true);
    const accepted = parseMusicMvAdvisorProposal(answer.answer, target);
    expect(accepted.sections.map(s => [s.startSec, s.endSec])).toEqual([[0, 12]]);
    expect(mocks.compose).toHaveBeenCalledTimes(1);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    const normalized = records.get(`canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/${HOP1}-repaired.json`) as any;
    expect(normalized.before.sections).toHaveLength(2);
    expect(normalized.after.sections).toHaveLength(1);
    expect(normalized.fixes.sections).toEqual([{ index: 1, field: "section", before: { startSec: 0, endSec: 0, labelZh: "占位避免空段" }, after: undefined, reasonZh: "零长或倒序段落，已并入相邻段落" }]);
    expect(Array.from(records.keys()).map(k => k.split("/").at(-1)).filter(n => n?.startsWith("compose"))).toEqual([
      `${HOP1}-raw.json`, `${HOP1}-decoded.json`, `${HOP1}-repaired.json`, "compose-hop-used.json",
    ]);
  });
  it("线上案例②：uncertainties 别名/字符串 + 末尾零长闭合段 → 形状修复后通过", async () => {
    const { d, mocks, records } = fixture();
    const bad = JSON.parse(JSON.stringify(proposal()));
    delete bad.uncertaintiesZh;
    bad.uncertainties = "实听速度约115–125BPM，与brief标注有出入";
    bad.sections.push({ startSec: 12, endSec: 12, labelZh: "（占位闭合段）", heardZh: "无", emotion: { fromZh: "无", toZh: "无", triggerZh: "无", musicZh: "无", visualZh: "无" } });
    composeText(mocks, bad);
    const accepted = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", d), true).answer, target);
    expect(accepted.uncertaintiesZh).toEqual(["实听速度约115–125BPM，与brief标注有出入"]);
    expect(accepted.sections.map(s => [s.startSec, s.endSec])).toEqual([[0, 12]]);
    expect(mocks.compose).toHaveBeenCalledTimes(1);
    const normalized = records.get(`canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/${HOP1}-repaired.json`) as any;
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
  it("形状修复后仍不过（concepts 只有 3 个）→ 同一跳带校验原因重写一次，不重新听歌", async () => {
    const { d, mocks, records } = fixture();
    const bad = JSON.parse(JSON.stringify(proposal()));
    bad.concepts.pop();
    composeText(mocks, bad);
    const accepted = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", d), true).answer, target);
    expect(accepted.concepts).toHaveLength(4);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.compose).toHaveBeenCalledTimes(2);
    const [instructions, input, , hop] = mocks.compose.mock.calls[1] as unknown as [string, any, unknown, CreativeLlmHop];
    expect(hop.modelName).toBe("glm-5.3-flashx");
    expect(instructions).toContain("上一版方案未通过服务端校验：方案数量不足：至少 4 项");
    expect(instructions).toContain("非 footage 镜头不得出现 sourceClip");
    expect(input.repair).toEqual({ attempt: 2, reasonZh: "方案数量不足：至少 4 项" });
    expect(input.sourceEvidence).toEqual((mocks.compose.mock.calls[0] as unknown as [string, any])[1].sourceEvidence);
    const names = Array.from(records.keys()).map(k => k.split("/").at(-1));
    expect(names).toContain(`${HOP1}-rejected.json`);
    expect((records.get(`canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/${HOP1}-rejected.json`) as any).reasonZh).toBe("方案数量不足：至少 4 项");
    expect(names).toContain(`${HOP1}-rewrite-decoded.json`);
    const used = records.get("canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/compose-hop-used.json") as any;
    expect([used.hop, used.attempt, used.rewritten]).toEqual([1, 2, true]);
    expect(names).toContain("accepted.json");
  });
  it("三跳链①：第一跳写坏两次 → 切第二跳（GLM@OpenRouter）成功，记录 hop-used 与每跳原因", async () => {
    const { d, mocks, records } = fixture();
    const bad = JSON.parse(JSON.stringify(proposal()));
    bad.concepts[3].id = bad.concepts[0].id;
    composeText(mocks, bad, 2);
    const accepted = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", d), true).answer, target);
    expect(accepted.concepts).toHaveLength(4);
    expect(mocks.compose).toHaveBeenCalledTimes(3);
    expect((mocks.compose.mock.calls as unknown as [string, unknown, unknown, CreativeLlmHop][]).map(c => c[3].modelName)).toEqual(["glm-5.3-flashx", "glm-5.3-flashx", "z-ai/glm-5.3-flashx"]);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    const used = records.get("canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/compose-hop-used.json") as any;
    expect([used.hop, used.model, used.gateway, used.attempt]).toEqual([2, "z-ai/glm-5.3-flashx", "auto", 1]);
    expect(used.failuresZh).toEqual([
      "第1跳 GLM 5.3 FlashX · EvoLink：MV方案来源或编号不一致",
      "第1跳 GLM 5.3 FlashX · EvoLink（重写）：MV方案来源或编号不一致",
    ]);
    const names = Array.from(records.keys()).map(k => k.split("/").at(-1));
    expect(names).toContain(`${HOP1}-rejected.json`);
    expect(names).toContain(`${HOP1}-rewrite-rejected.json`);
    expect(names).toContain(`${HOP2}-decoded.json`);
  });
  it("三跳链②：前两跳通道异常（超时/429）→ 不重写直接切第三跳 DeepSeek 成功", async () => {
    const { d, mocks, records } = fixture();
    mocks.compose.mockImplementationOnce(async () => { throw new CreativeHopTransportError("GLM 5.3 FlashX · EvoLink 通道失败（超时）：timeout", undefined); });
    mocks.compose.mockImplementationOnce(async () => { throw new CreativeHopTransportError("GLM 5.3 FlashX · OpenRouter 通道失败（HTTP 429）：rate limited", 429); });
    const accepted = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", d), true).answer, target);
    expect(accepted.concepts).toHaveLength(4);
    expect(mocks.compose).toHaveBeenCalledTimes(3);
    expect((mocks.compose.mock.calls[2] as unknown as [string, unknown, unknown, CreativeLlmHop])[3]).toEqual(CREATIVE_LLM_HOPS[2]);
    const used = records.get("canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/compose-hop-used.json") as any;
    expect([used.hop, used.model, used.gateway]).toEqual([3, "deepseek/deepseek-v4.1-flash-1017", "auto"]);
    expect(used.failuresZh).toEqual([
      "第1跳 GLM 5.3 FlashX · EvoLink：GLM 5.3 FlashX · EvoLink 通道失败（超时）：timeout",
      "第2跳 GLM 5.3 FlashX · OpenRouter：GLM 5.3 FlashX · OpenRouter 通道失败（HTTP 429）：rate limited",
    ]);
    expect(Array.from(records.keys()).map(k => k.split("/").at(-1))).toContain(`${HOP3}-decoded.json`);
  });
  it("三跳链③：三跳全败（各写坏两次）→ CreativeProposalError 含三段原因，不进 refine", async () => {
    const { d, mocks, records } = fixture();
    const bad = JSON.parse(JSON.stringify(proposal()));
    bad.concepts[3].id = bad.concepts[0].id;
    composeText(mocks, bad, 6);
    const error = await askMusicMvAdvisor(7, target, "设计MV", d).catch(e => e);
    expect(error).toBeInstanceOf(CreativeProposalError);
    expect(error.stage).toBe("compose");
    expect(error.hopFailuresZh).toHaveLength(6);
    expect(error.message).toContain("创作方案三条通道均未通过校验：第1跳 GLM 5.3 FlashX · EvoLink：MV方案来源或编号不一致");
    expect(error.message).toContain("第2跳 GLM 5.3 FlashX · OpenRouter（重写）：MV方案来源或编号不一致");
    expect(error.message).toContain("第3跳 DeepSeek V4.1 Flash 1017 · OpenRouter（重写）：MV方案来源或编号不一致");
    expect(creativeProposalFailureMessage(error)).toBe(error.message);
    expect(mocks.compose).toHaveBeenCalledTimes(6);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.refine).not.toHaveBeenCalled();
    const names = Array.from(records.keys()).map(k => k.split("/").at(-1));
    expect(names).toContain(`${HOP3}-rewrite-rejected.json`);
    expect(names).toContain("compose-hop-exhausted.json");
    expect(names).not.toContain("accepted.json");
  });
  it("线上 DeepSeek 案例①：concepts 数组里混写 \"c2\":{…} 的非法 JSON → 带原因重写一次后通过", async () => {
    const { d, mocks, records } = fixture();
    const good = JSON.stringify(proposal());
    const broken = good.replace('"concepts":[', '"concepts":["c2":');
    expect(() => JSON.parse(broken)).toThrow();
    composeText(mocks, broken);
    const accepted = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", d), true).answer, target);
    expect(accepted.concepts).toHaveLength(4);
    expect(mocks.compose).toHaveBeenCalledTimes(2);
    const [instructions, input] = mocks.compose.mock.calls[1] as unknown as [string, any];
    expect(instructions).toContain("上一版方案未通过服务端校验：模型输出不是合法 JSON");
    expect(input.repair.reasonZh).toContain("模型输出不是合法 JSON");
    const rejected = records.get(`canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/${HOP1}-rejected.json`) as any;
    expect(rejected.phase).toBe("json_parse");
    expect(Array.from(records.keys()).map(k => k.split("/").at(-1))).not.toContain(`${HOP1}-decoded.json`);
  });
  it("线上 DeepSeek 案例②：每个非素材镜头塞 sourceClip:{} → 确定性删除，不重写；footage 镜头的空 sourceClip 不可删", async () => {
    const { d, mocks, records } = fixture();
    const bad = JSON.parse(JSON.stringify(proposal()));
    for (const c of bad.concepts) c.plan.shots[0].sourceClip = {};
    composeText(mocks, bad);
    const accepted = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", d), true).answer, target);
    expect(mocks.compose).toHaveBeenCalledTimes(1);
    expect(accepted.concepts.every(c => c.plan.shots[0].sourceClip === undefined && c.plan.shots[1].sourceClip)).toBe(true);
    const repaired = records.get(`canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/${HOP1}-repaired.json`) as any;
    expect(repaired.fixes.shape.map((f: any) => [f.path, f.code])).toEqual([0, 1, 2, 3].map(i => [`concepts.[${i}].plan.shots.[0].sourceClip`, "empty_object"]));
    const second = fixture();
    const worse = JSON.parse(JSON.stringify(proposal()));
    worse.concepts[0].plan.shots[1].sourceClip = {};
    composeText(second.mocks, worse);
    await askMusicMvAdvisor(7, target, "设计MV", second.d);
    expect(second.mocks.compose).toHaveBeenCalledTimes(2);
    expect((second.records.get(`canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/${HOP1}-rejected.json`) as any).reasonZh).toContain("素材切片");
  });
  it("refine 修订结果追加占位段时同样修复；改写区间则回填初稿 sections 落 sections-restored（不重写、不烧第二次）；通道异常切下一跳", async () => {
    const { d, mocks } = fixture();
    mocks.refine.mockImplementationOnce(async (input: any, _m: string, _s: unknown, hop: CreativeLlmHop) => ({ text: JSON.stringify(envelope({ ...input.candidate, sections: [...input.candidate.sections, { startSec: 0, endSec: 0, labelZh: "占位", heardZh: "无", emotion }], uncertaintiesZh: "一条" })), model: hop.modelName, inputSha256: "sha" }));
    const accepted = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", d), true).answer, target);
    expect(accepted.sections).toHaveLength(1);
    expect(accepted.uncertaintiesZh).toEqual(["一条"]);
    expect(accepted.review?.model).toBe("glm-5.3-flashx");
    expect(mocks.refine).toHaveBeenCalledTimes(1);
    const second = fixture();
    second.mocks.refine.mockImplementationOnce(async (input: any, _m: string, _s: unknown, hop: CreativeLlmHop) => ({ text: JSON.stringify(envelope({ ...input.candidate, sections: [{ ...input.candidate.sections[0], startSec: 0, endSec: 6 }, { ...input.candidate.sections[0], startSec: 6, endSec: 12 }] })), model: hop.modelName, inputSha256: "sha" }));
    const result = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", second.d), true).answer, target);
    expect(result.sections.map(s => [s.startSec, s.endSec])).toEqual([[0, 12]]);
    expect(second.mocks.refine).toHaveBeenCalledTimes(1);
    expect(second.mocks.compose).toHaveBeenCalledTimes(1);
    const names = Array.from(second.records.keys()).map(k => k.split("/").at(-1));
    expect(names).toContain("refine-hop-1-glm-5.3-flashx-sections-restored.json");
    expect(names).not.toContain("refine-hop-1-glm-5.3-flashx-rejected.json");
    const restored = second.records.get("canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/refine-hop-1-glm-5.3-flashx-sections-restored.json") as any;
    expect(restored.after).toEqual(proposal().sections);
    expect(restored.fixes.length).toBeGreaterThan(0);
    // refine 的硬约束照抄 candidate.sections 而非 sourceEvidence.sections，并带回包骨架
    const refineReq = (second.mocks.refine.mock.calls as unknown as [any][])[0][0].requirements as string;
    expect(refineReq).toContain("照抄输入 candidate.sections");
    expect(refineReq).not.toContain("照抄所给 sourceEvidence.sections");
    expect(refineReq).toContain("【回包骨架");
    const third = fixture();
    third.mocks.refine.mockImplementationOnce(async () => { throw new CreativeHopTransportError("GLM 5.3 FlashX · EvoLink 通道失败（HTTP 503）：down", 503); });
    const out = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", third.d), true).answer, target);
    expect(out.review?.model).toBe("z-ai/glm-5.3-flashx");
    expect((third.records.get("canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/refine-hop-used.json") as any).hop).toBe(2);
  });
  it("1109 探针四类 refine 写坏：review-only 根对象 / 漏 limitationsZh / 坏证据路径 / visualZh 改回证据原文 → 同一跳一次通过，落 envelope-repaired", async () => {
    const { d, mocks, records } = fixture();
    const draftSections = proposal().sections;
    mocks.refine.mockImplementationOnce(async (input: any, _m: string, _s: unknown, hop: CreativeLlmHop) => ({
      text: JSON.stringify({
        proposal: { ...input.candidate, sections: [{ ...draftSections[0], emotion: { ...emotion, visualZh: "仅音频，未观察画面" } }] },
        review: { verdict: "revise", summaryZh: "一处文案", findings: [{ id: "f1", severity: "note", evidencePaths: ["/candidate/sections/0/visualZh", "/candidate/unsections"], observationZh: "o", suggestionZh: "s" }], mediaReview: [], inspirationZh: ["灵感"] },
        changesZh: "补了画面建议",
      }),
      model: hop.modelName, inputSha256: "sha",
    }));
    const accepted = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", d), true).answer, target);
    expect(mocks.refine).toHaveBeenCalledTimes(1);
    expect(accepted.sections).toEqual(draftSections);
    expect(accepted.review?.limitationsZh).toEqual(["本次为创作结果审阅，依据已保存的音画分析；尚未人工验收"]);
    expect(accepted.review?.findings[0].evidencePaths).toEqual(["/candidate/sections/0/emotion/visualZh", "/candidate"]);
    expect(accepted.review?.revisionsZh).toEqual(["补了画面建议"]);
    const repaired = records.get("canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/refine-hop-1-glm-5.3-flashx-envelope-repaired.json") as any;
    expect(repaired.fixes.envelope.map((f: any) => f.code)).toEqual(["changes_string"]);
    expect(repaired.fixes.review.map((f: any) => f.code)).toEqual(["limitations_missing", "evidence_path_normalized", "evidence_path_normalized"]);
    expect(records.has("canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/refine-hop-1-glm-5.3-flashx-sections-restored.json")).toBe(true);
    // review-only 根对象（第 1 跳重写的原样写坏）：以初稿为 proposal 包起来，审阅照常入账
    const second = fixture();
    second.mocks.refine.mockImplementationOnce(async (_input: any, _m: string, _s: unknown, hop: CreativeLlmHop) => ({
      text: JSON.stringify({ verdict: "approved", summaryZh: "无问题", findings: [], mediaReview: [], inspirationZh: ["灵感"], limitationsZh: ["离线"] }),
      model: hop.modelName, inputSha256: "sha",
    }));
    const kept = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", second.d), true).answer, target);
    expect(second.mocks.refine).toHaveBeenCalledTimes(1);
    expect(kept.review?.verdict).toBe("approved");
    expect(kept.review?.revisionsZh?.[0]).toContain("原稿保留");
    const shell = second.records.get("canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/refine-hop-1-glm-5.3-flashx-envelope-repaired.json") as any;
    expect(shell.fixes.envelope.map((f: any) => f.code)).toEqual(["review_only_root", "changes_missing"]);
  });
  it("线上第四次重跑：镜头 15.5s 超限 → 确定性等分，不重 compose，落 glm-draft-shots-split", async () => {
    const { d, mocks, records } = fixture();
    const bad = JSON.parse(JSON.stringify({ ...proposal(), sections: [{ ...proposal().sections[0], endSec: 20 }] }));
    for (const c of bad.concepts) {
      c.plan.audioDurationSec = 20;
      // 0–15.5 生成镜（超 15s，GLM 两次都不切）+ 15.5–20 对口型镜（4.5s 合法）
      c.plan.shots = [
        { id: "long", startSec: 0, endSec: 15.5, kind: "generated", visualPrompt: "长镜", cameraPrompt: "推", lyricQuote: "", referenceIndices: [] },
        { ...c.plan.shots[0], startSec: 15.5, endSec: 20 },
      ];
    }
    const wide = { ...target, audio: { ...target.audio, durationSec: 20 } };
    mocks.read.mockResolvedValue({ buffer: Buffer.from("test-audio"), mimeType: "audio/wav", durationSec: 20 });
    mocks.generate.mockResolvedValue({ text: JSON.stringify({ kind: "native_music_evidence_v1", sourceKey: target.sourceKey, summaryZh: "持续人声", sections: bad.sections, uncertaintiesZh: [] }), candidates: [{ finishReason: "STOP" }], modelVersion: "gemini-3.8-flash", usageMetadata: { promptTokensDetails: [{ modality: "AUDIO", tokenCount: 30 }] } });
    composeText(mocks, bad);
    const accepted = parseMusicMvAdvisorProposal(parseAskJson(await askMusicMvAdvisor(7, wide, "设计MV", d), true).answer, wide);
    expect(mocks.compose).toHaveBeenCalledTimes(1);
    expect(accepted.concepts[0].plan.shots.map(s => [s.id, s.startSec, s.endSec])).toEqual([["long", 0, 7.75], ["long-2", 7.75, 15.5], ["sing", 15.5, 20]]);
    expect(accepted.concepts[0].plan.shots[1].visualPrompt).toBe("长镜（续）");
    const split = records.get(`canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/${HOP1}-repaired.json`) as any;
    expect(split.fixes.shots).toHaveLength(4);
    expect(split.fixes.shots.map((f: any) => [f.concept, f.id, f.action])).toEqual([[0, "long", "split"], [1, "long", "split"], [2, "long", "split"], [3, "long", "split"]]);
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

describe("1109 逐窗节拍阶段（audiomap + 三跳链）", () => {
  it("有拍点网格时：主推荐方案的生成/演唱镜带逐窗节拍、复杂度与 audiomap；素材段不出窗；证据落盘", async () => {
    const { d, records, mocks } = fixture();
    const grid = { bpm: 120, beatSec: 0.5, phaseSec: 0, source: "creative_prompt" as const, beatConfidence: 0.7, segments: [{ startSec: 0, endSec: 12, energy: 1, beatConfidence: 0.7, pacing: "beat" as const }], strongBeatsSec: [0, 2, 4] };
    (d as any).beatGrid = vi.fn(async () => grid);
    mocks.compose.mockImplementationOnce(async (_i: string, _input: unknown, save: (n: string, v: unknown) => Promise<unknown>, hop: CreativeLlmHop) => {
      await save("raw", { model: hop.modelName });
      return { text: JSON.stringify(proposal()), model: hop.modelName };
    });
    mocks.compose.mockImplementationOnce(async (instructions: string, input: any, save: (n: string, v: unknown) => Promise<unknown>, hop: CreativeLlmHop) => {
      expect(instructions).toContain("逐窗节拍");
      expect(input.shots.map((s: any) => s.id)).toEqual(["sing"]);
      expect(input.beatGrid.segments[0].pacing).toBe("beat");
      await save("raw", { model: hop.modelName });
      return { text: JSON.stringify({ shots: [{ id: "sing", continuesFromPrevious: false, complexity: { people: 1, action: "light", contact: false, cameraSetups: 1, scenes: 1 },
        beats: [
          { startSec: 0, endSec: 3, actionZh: "主唱抬眼开口", cameraZh: "近景缓推", lightingZh: "暖侧光", moodZh: "克制", sfxZh: "室内底噪", lipSync: true, lyricZh: "归来" },
          { startSec: 3, endSec: 6, actionZh: "主唱闭眼换气", cameraZh: "停稳", lightingZh: "暖光收", moodZh: "释然", sfxZh: "衣料轻响", lipSync: false },
        ] }] }), model: hop.modelName };
    });
    const answer = parseAskJson(await askMusicMvAdvisor(7, target, "设计MV", d), true);
    const accepted = parseMusicMvAdvisorProposal(answer.answer, target);
    const main = accepted.concepts[0]!.plan;
    expect(main.beatGrid).toMatchObject({ bpm: 120, beatConfidence: 0.7 });
    expect((main.beatGrid as any).strongBeatsSec).toBeUndefined();
    expect(main.shots[0]!.beats?.map(b => [b.startSec, b.endSec, b.lipSync])).toEqual([[0, 3, true], [3, 6, false]]);
    expect(main.shots[0]!.complexity?.people).toBe(1);
    expect(main.shots[1]!.beats).toBeUndefined();
    expect(accepted.concepts[1]!.plan.shots[0]!.beats).toBeUndefined();
    const names = Array.from(records.keys()).map(k => k.split("/").at(-1));
    expect(names).toContain("beat-grid.json");
    expect(names).toContain("beats-1-hop-used.json");
    expect(names).toContain("beats-summary.json");
    expect((records.get(`canvas-music-mv/advisor/7/11111111-1111-4111-8111-111111111111/accepted.json`) as any).beatsReport.failedShotIds).toEqual([]);
  });
});


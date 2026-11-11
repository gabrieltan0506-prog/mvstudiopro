import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLapianFixtureCard } from "../../shared/__fixtures__/manhuaTemplateLapianCard.fixture";
import { planManhuaTemplateLapianSegments, buildManhuaTemplateLapianSegmentEvidence } from "../../shared/manhuaTemplateLapianView";
import { videoBreakdownRecreatePromptSchema } from "../../shared/videoBreakdown";
import { CREATIVE_LLM_HOPS, CreativeHopTransportError, type CreativeLlmHop, type Save } from "./creativeLlmHops";
import {
  getManhuaTemplateLapianGenes,
  getManhuaTemplateLapianSegmentClip,
  getManhuaTemplateLapianSegmentPrompt,
  manhuaTemplateLapianEvidenceDigest,
  manhuaTemplateLapianPrefix,
  resetManhuaTemplateLapianInflightForTest,
  type ManhuaTemplateLapianDeps,
} from "./manhuaTemplateLapianService";

const card = buildLapianFixtureCard();
const segments = planManhuaTemplateLapianSegments(card);

function goodSegment(lengthSec: number) {
  return {
    title: "殿前对峙",
    recreatePrompt: {
      subject: "黑袍青年将军，外形服饰全程一致", scene: "古装宫殿夜景内殿",
      timeline: [{ fromSec: 0, toSec: Math.round(lengthSec / 2 * 10) / 10, text: "竖屏近景，冷峻凝视" }, { fromSec: Math.round(lengthSec / 2 * 10) / 10, toSec: lengthSec, text: "竖屏特写，怒目" }],
      camera: "竖屏 9:16 近景为主", lightColor: "暖烛侧光", rhythm: "前慢后急", constraints: "保留冷暖对冲，避免现代道具",
    },
  };
}
const goodGenes = {
  visualGenes: { mediumAndArtStyle: "古装实拍", color: "朱红与墨黑", lighting: "暖烛侧光", materialTexture: "锦缎漆木", composition: "对称纵深", camera: "近景为主" },
  recurringElements: ["烛台"], mustKeep: ["冷暖对冲"],
};

type Script = Array<(hop: CreativeLlmHop) => string | Error>;

function makeDeps(script: Script, extra: Partial<ManhuaTemplateLapianDeps> = {}) {
  const store = new Map<string, Buffer>();
  const calls: Array<{ hop: string; instructions: string; input: unknown }> = [];
  let step = 0;
  const deps: Partial<ManhuaTemplateLapianDeps> = {
    loadCard: async (id) => (id === card.id ? card : null),
    read: async (name) => store.get(name) ?? null,
    createIfAbsent: async (name, buffer) => {
      if (store.has(name)) return { created: false };
      store.set(name, buffer);
      return { created: true };
    },
    hops: CREATIVE_LLM_HOPS,
    invokeHop: async (hop, instructions, input, save: Save) => {
      calls.push({ hop: hop.label, instructions, input });
      await save("request", { model: hop.modelName, instructions, input });
      const next = script[step++];
      if (!next) throw new Error("脚本用尽：不应再调用模型");
      const out = next(hop);
      if (out instanceof Error) {
        await save("error", { message: out.message });
        throw out;
      }
      await save("raw", { choices: [{ message: { content: out }, finish_reason: "stop" }] });
      return { text: out, model: hop.modelName, inputSha256: "x", elapsedMs: 1 };
    },
    readPreparedVideo: async () => null,
    cutClip: async () => { throw new Error("不应裁切"); },
    sign: (name) => `https://signed.example/${name}`,
    now: () => Date.UTC(2026, 10, 11),
    runId: () => `run${step}`,
    log: () => {},
    ...extra,
  };
  return { deps, store, calls };
}

const names = (store: Map<string, Buffer>) => Array.from(store.keys());

beforeEach(() => resetManhuaTemplateLapianInflightForTest());

describe("段复刻提示词 · 懒生成 + 三跳", () => {
  it("未缓存且 generate=false 不调模型", async () => {
    const { deps, calls } = makeDeps([]);
    const r = await getManhuaTemplateLapianSegmentPrompt({ templateId: card.id, segmentIndex: 3, generate: false }, deps);
    expect(r.status).toBe("absent");
    expect(calls).toHaveLength(0);
  });

  it("首跳成功：输入是该段全部镜头证据，产出通过拉片 schema，原始与解析分对象落盘，再次打开走缓存", async () => {
    const seg = segments[3]!;
    const len = Math.round((seg.endSec - seg.startSec) * 10) / 10;
    const { deps, store, calls } = makeDeps([() => JSON.stringify(goodSegment(len))]);
    const r = await getManhuaTemplateLapianSegmentPrompt({ templateId: card.id, segmentIndex: 3, generate: true }, deps);
    expect(r.status).toBe("generated");
    expect(videoBreakdownRecreatePromptSchema.safeParse(r.recreatePrompt).success).toBe(true);
    expect(r.text).toContain("【镜头序列】");
    expect((calls[0]!.input as { shots: unknown[] }).shots).toHaveLength(seg.shotIndexes.length);
    expect(calls[0]!.input).toEqual(buildManhuaTemplateLapianSegmentEvidence(card, seg));
    const all = names(store);
    expect(all.some(n => n.endsWith("hop1-glm-5.3-flashx-try1-raw.json"))).toBe(true);
    expect(all.some(n => n.endsWith("hop1-glm-5.3-flashx-try1-parsed.json"))).toBe(true);
    expect(all.some(n => n.endsWith("/segments/seg003/result.json"))).toBe(true);
    const again = await getManhuaTemplateLapianSegmentPrompt({ templateId: card.id, segmentIndex: 3, generate: true }, deps);
    expect(again.status).toBe("cached");
    expect(calls).toHaveLength(1);
  });

  it("写坏先带原因重写一次，再坏切下一跳；通道失败直接切跳；全部回执保留", async () => {
    const seg = segments[0]!;
    const len = Math.round((seg.endSec - seg.startSec) * 10) / 10;
    const bad = goodSegment(len);
    bad.recreatePrompt.timeline[1]!.toSec = len + 30; // 越界
    const { deps, store, calls } = makeDeps([
      () => "不是 JSON",
      () => JSON.stringify(bad),
      () => new CreativeHopTransportError("HTTP 503", 503),
      () => JSON.stringify(goodSegment(len)),
    ]);
    const r = await getManhuaTemplateLapianSegmentPrompt({ templateId: card.id, segmentIndex: 0, generate: true }, deps);
    expect(r.status).toBe("generated");
    expect(calls.map(c => c.hop)).toEqual([CREATIVE_LLM_HOPS[0]!.label, CREATIVE_LLM_HOPS[0]!.label, CREATIVE_LLM_HOPS[1]!.label, CREATIVE_LLM_HOPS[2]!.label]);
    expect(calls[1]!.instructions).toContain("上一次输出未通过校验");
    const all = names(store);
    expect(all.filter(n => n.endsWith("-rejected.json"))).toHaveLength(2);
    expect(all.filter(n => n.endsWith("-error.json"))).toHaveLength(1);
    expect(all.filter(n => n.endsWith("-raw.json"))).toHaveLength(3);
    expect(all.filter(n => n.endsWith("-parsed.json"))).toHaveLength(1);
    const result = JSON.parse(store.get(all.find(n => n.endsWith("result.json"))!)!.toString());
    expect(result.receipt).toMatchObject({ hopIndex: 3, attempt: 1 });
    expect(result.receipt.failuresZh).toHaveLength(3);
  });

  it("三跳全坏显式失败，不写结果", async () => {
    const { deps, store } = makeDeps(Array.from({ length: 6 }, () => () => "{}"));
    await expect(getManhuaTemplateLapianSegmentPrompt({ templateId: card.id, segmentIndex: 1, generate: true }, deps)).rejects.toThrow(/三跳/);
    expect(names(store).some(n => n.endsWith("result.json"))).toBe(false);
    expect(names(store).filter(n => n.endsWith("-rejected.json"))).toHaveLength(6);
  });

  it("证据落盘失败立即停止，不切跳继续烧钱", async () => {
    const { deps, calls } = makeDeps([() => "{}", () => "{}"], {
      createIfAbsent: async () => { throw new Error("gcs down"); },
    });
    await expect(getManhuaTemplateLapianSegmentPrompt({ templateId: card.id, segmentIndex: 1, generate: true }, deps)).rejects.toThrow(/不切跳/);
    expect(calls).toHaveLength(1);
  });

  it("段号越界与模板不存在报错", async () => {
    const { deps } = makeDeps([]);
    await expect(getManhuaTemplateLapianSegmentPrompt({ templateId: card.id, segmentIndex: 999, generate: false }, deps)).rejects.toThrow(/越界/);
    await expect(getManhuaTemplateLapianSegmentPrompt({ templateId: "tpl_missing", segmentIndex: 0, generate: false }, deps)).rejects.toThrow(/不存在/);
  });

  it("同段并发只调用一次模型", async () => {
    const seg = segments[2]!;
    const len = Math.round((seg.endSec - seg.startSec) * 10) / 10;
    const { deps, calls } = makeDeps([() => JSON.stringify(goodSegment(len))]);
    const [a, b] = await Promise.all([
      getManhuaTemplateLapianSegmentPrompt({ templateId: card.id, segmentIndex: 2, generate: true }, deps),
      getManhuaTemplateLapianSegmentPrompt({ templateId: card.id, segmentIndex: 2, generate: true }, deps),
    ]);
    expect(a.text).toBe(b.text);
    expect(calls).toHaveLength(1);
  });
});

describe("视觉基因 · 一次汇总", () => {
  it("输入含全片每一镜；结果缓存", async () => {
    const { deps, calls } = makeDeps([() => JSON.stringify(goodGenes)]);
    const r = await getManhuaTemplateLapianGenes({ templateId: card.id, generate: true }, deps);
    expect(r.status).toBe("generated");
    expect(r.text).toContain("【复刻时要保留的要点】");
    expect((calls[0]!.input as { shots: unknown[] }).shots).toHaveLength(card.beatGrid.length);
    expect((await getManhuaTemplateLapianGenes({ templateId: card.id, generate: false }, deps)).status).toBe("cached");
    expect(calls).toHaveLength(1);
  });

  it("卡证据变化（优化修订）→ 摘要变化 → 派生路径不同，不复用旧产物", () => {
    const changed = { ...card, beatGrid: card.beatGrid.slice(0, -1) };
    expect(manhuaTemplateLapianEvidenceDigest(changed)).not.toBe(manhuaTemplateLapianEvidenceDigest(card));
    expect(manhuaTemplateLapianPrefix(card.id, manhuaTemplateLapianEvidenceDigest(card))).toMatch(/^manhua-template-learn\/lapian-derived\/v1\/tpl_native_fixture29_ep029\/[a-f0-9]{16}$/);
  });
});

describe("可播放片段", () => {
  it("源分片不在：不裁切、说明原因", async () => {
    const { deps } = makeDeps([]);
    const r = await getManhuaTemplateLapianSegmentClip({ templateId: card.id, segmentIndex: 5 }, deps);
    expect(r).toMatchObject({ available: false });
    if (!r.available) expect(r.reasonZh).toMatch(/截图/);
  });

  it("源分片仍在：按段相对学习分片的秒位裁切、条件上传、签名；再次请求不重裁", async () => {
    const seg = segments[5]!;
    const spans = card.provenance!.nativeVideoDeepRead!.segmentSpans!;
    const learn = spans[seg.learnSpanIndex]!;
    const readPrepared = vi.fn(async () => ({ gsUri: "gs://b/manhua-template-learn/tmp/native-deep-read/r1.mp4", startSec: learn.startSec, endSec: learn.endSec,
      temporaryGcs: { bucket: "b", objectName: "manhua-template-learn/tmp/native-deep-read/r1.mp4" }, bytes: 10, hasAudio: true, reusable: true }));
    const cut = vi.fn(async () => ({ mode: "remote" as const, bytes: 1234 }));
    const { deps, store } = makeDeps([], { readPreparedVideo: readPrepared, cutClip: cut });
    const r = await getManhuaTemplateLapianSegmentClip({ templateId: card.id, segmentIndex: 5 }, deps);
    expect(r).toMatchObject({ available: true, startSec: seg.startSec, endSec: seg.endSec });
    expect(readPrepared).toHaveBeenCalledWith(expect.objectContaining({ seriesKey: "fixture29", episodeIndex: 29, startSec: learn.startSec, endSec: learn.endSec, sourceDigest: "d".repeat(64) }));
    expect(cut).toHaveBeenCalledWith(expect.objectContaining({ startSec: seg.startSec - learn.startSec, endSec: seg.endSec - learn.startSec }));
    expect(names(store).some(n => n.endsWith("/clips/seg005.json"))).toBe(true);
    await getManhuaTemplateLapianSegmentClip({ templateId: card.id, segmentIndex: 5 }, deps);
    expect(cut).toHaveBeenCalledTimes(1);
  });

  it("没有恢复身份的旧卡不出片段", async () => {
    const legacy = { ...card, provenance: undefined };
    const { deps } = makeDeps([], { loadCard: async () => legacy });
    const r = await getManhuaTemplateLapianSegmentClip({ templateId: card.id, segmentIndex: 0 }, deps);
    expect(r.available).toBe(false);
  });
});

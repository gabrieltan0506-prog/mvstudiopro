import { describe, it, expect, vi } from "vitest";
import { reviewCreativeEvidence } from "./creativeEvidenceReview";
import { parseCreativeEvidenceReview, type CreativeEvidenceReviewInput } from "../../shared/creativeEvidenceReview";
const input: CreativeEvidenceReviewInput = {
  sourceTaskId: "test-source", mediaKind: "audio", durationSec: 120,
  sourceEvidence: { sections: [{ startSec: 0, endSec: 120, heard: "人声结束后是器乐" }] },
  candidate: { style: "钢琴与克制的人声" }, requirements: "写重逢",
};
const good = { verdict: "approved", summaryZh: "方法与所给证据一致", findings: [], mediaReview: [], inspirationZh: ["第二段用归还车票推进关系"], limitationsZh: ["仅审查文本结果，未重新听音"] };
function fixture() {
  const store = new Map<string, unknown>();
  const invoke = vi.fn(async () => ({ model: "test-review-model", choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(good) } }] }));
  const upload = vi.fn(async ({objectName, buffer}: {objectName: string; buffer: Buffer}) => {
    if (store.has(objectName)) return {created: false};
    store.set(objectName, JSON.parse(buffer.toString())); return {created: true};
  });
  const mocks = { invoke, upload, read: vi.fn(async (key: string) => store.get(key) ?? null), bucket: () => "test", sleep: vi.fn(async (_ms: number) => {}) };
  return { store, mocks, deps: mocks as unknown as NonNullable<Parameters<typeof reviewCreativeEvidence>[2]> };
}
describe("创作顾问结果审阅", () => {
  it("完整传入证据、保存原文和结果，相同输入恢复且不重复调用", async () => {
    const { store, mocks, deps } = fixture();
    const first = await reviewCreativeEvidence(7, input, deps);
    expect(JSON.parse((mocks.invoke.mock.calls as unknown as Array<[{messages:Array<{content:string}>}]>)[0][0].messages[1].content)).toEqual(input);
    expect(Array.from(store.keys()).some(k => k.endsWith("attempt-1-raw.json"))).toBe(true);
    expect(first.model).toBe("test-review-model");
    expect(await reviewCreativeEvidence(7, input, deps)).toEqual(first);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it("拒绝不存在的证据路径和带阻断的通过结论", () => {
    const finding = {id:"T1",severity:"blocking",evidencePaths:["/sourceEvidence/missing"],observationZh:"矛盾",suggestionZh:"复核"};
    expect(() => parseCreativeEvidenceReview({...good,verdict:"revise",findings:[finding]},input)).toThrow("不存在");
    expect(() => parseCreativeEvidenceReview({...good,findings:[{...finding,evidencePaths:["/candidate/style"]}]},input)).toThrow("不能判通过");
    expect(() => parseCreativeEvidenceReview({...good,verdict:"needs_media_review",mediaReview:[{startSec:100,endSec:121,questionZh:"核查尾声"}]},input)).toThrow("超出");
  });
  it("不完整模型输出先永久保存，不把解析失败换模型重买", async () => {
    const {store,mocks,deps} = fixture();
    mocks.invoke.mockResolvedValue({model:"test",choices:[{finish_reason:"length",message:{role:"assistant",content:"{}"}}]});
    await expect(reviewCreativeEvidence(7,input,deps)).rejects.toThrow("未完整");
    expect(Array.from(store.keys()).some(k=>k.endsWith("raw.json"))).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await expect(reviewCreativeEvidence(7,input,deps)).rejects.toThrow("未重复调用");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it("429/503等待18秒再走既有备用链，错误回执保留", async () => {
    const {store,mocks,deps}=fixture();
    mocks.invoke.mockRejectedValueOnce(Object.assign(new Error("test"),{status:503}));
    await reviewCreativeEvidence(7,input,deps);
    expect(mocks.sleep).toHaveBeenCalledWith(18000);
    expect(Array.from(store.keys()).some(k=>k.endsWith("attempt-1-error.json"))).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
  it("输入过大明确拒绝，不截断送审", async () => {
    const {mocks,deps}=fixture();
    await expect(reviewCreativeEvidence(7,{...input,sourceEvidence:{text:"x".repeat(2100000)}},deps)).rejects.toThrow("未截断");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

it("仅恢复已有完整顾问原稿，修订建议无需伪造blocking等级",async()=>{
 const {store,mocks,deps}=fixture();
 const original={...good,verdict:"revise",findings:[{id:"N1",severity:"note",evidencePaths:["/candidate/style"],observationZh:"情绪层次可增强",suggestionZh:"桥段留白"}]};
 mocks.invoke.mockResolvedValue({model:"test",choices:[{finish_reason:"stop",message:{role:"assistant",content:JSON.stringify(original)}}]});
 const first=await reviewCreativeEvidence(7,input,deps);
 store.delete(first.reviewId!+"/result.json");
 expect((await reviewCreativeEvidence(7,input,deps)).verdict).toBe("revise");
 expect(mocks.invoke).toHaveBeenCalledTimes(1);
});

it("歌词方法和完整诊断进入实际LLM请求并可按证据路径引用，不影响原稿",async()=>{
 const {store,mocks,deps}=fixture();
 const original={...input,candidate:{lyrics:"[Verse]\n灯还亮着\n[Chorus]\n灯还亮着"}};
 await reviewCreativeEvidence(7,original,deps);
 const sent=JSON.parse((mocks.invoke.mock.calls as unknown as Array<[{messages:Array<{content:string}>}]>)[0][0].messages[1].content);
 expect(sent.lyricCraft.diagnostics[0].repeatedLines[0].lineNumbers).toEqual([2,4]);
 expect(sent.candidate).toEqual(original.candidate);
 expect(Array.from(store.values()).some((v:any)=>v.input?.lyricCraft?.methodVersion)).toBe(true);
 expect((original as any).lyricCraft).toBeUndefined();
});

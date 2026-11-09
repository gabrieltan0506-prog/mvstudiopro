import { describe, it, expect, vi } from "vitest";
import { hearSongIndependently } from "./musicMvSongHearing";
import { askSunoSongAdvisor } from "./musicMvAdvisor";
import {
  parseSunoSongProposal,
  type SunoSongTarget,
} from "../../shared/canvasMusicMv";
import { CREATIVE_LLM_HOPS, type CreativeLlmHop } from "./creativeLlmHops";
const envelope=(candidate:unknown)=>({proposal:candidate,review:{verdict:"approved" as const,summaryZh:"离线联合审阅",findings:[],mediaReview:[],inspirationZh:["用动作推进关系"],limitationsZh:["离线替身"]},changesZh:["保留初稿"]});
const emotion = {fromZh:"克制",toZh:"释然",triggerZh:"归还旧物",musicZh:"减少鼓点后人声展开",visualZh:"建议：把车票递回"};
const target: SunoSongTarget = {
  sourceKey: "original-topic",
  requirements: "写毕业后的重逢",
};
const proposal = (audio = false) => ({
  kind: "suno_song_v1",
  sourceKey: target.sourceKey,
  summaryZh: audio ? "实际听音" : "依据主题创作",
  sections: audio
    ? [{ startSec: 0, endSec: 12, labelZh: "主歌", heardZh: "轻唱", emotion }]
    : [],
  uncertaintiesZh: ["未生成试听"],
  craftSelections: ["lin-inner-turn", "fang-image-story"].map(id => ({id,reasonZh:"适合重逢主题",applicationZh:"以旧车票推动关系转折"})),
  transferableCraft: ["第二段推进关系"],
  concepts: Array.from({ length: 3 }, (_, i) => ({
    id: `c${i}`,
    rationaleZh: "主题一致",
    emotionalArc: [{sectionZh:"主歌到副歌",emotion}],
    differenceZh: "原创叙事",
    hookZh: "明天再见",
    lyricMethodZh: "从迟到者的视角展开",
    mvDirectionZh: "空车站到重逢，红围巾贯穿",
    brief: {
      model: "suno-v6",
      custom_mode: true,
      instrumental: false,
      title: `重逢${i}`,
      style: "acoustic pop, warm piano, restrained vocal",
      prompt: "[Verse]\n你把旧车票放回口袋\n[Chorus]\n明天再见",
      negative_tags: "",
      duration: 180,
      style_weight: 0,
      weirdness_constraint: 0.25,
    },
  })),
});
function fixture() {
  const records = new Map<string, unknown>();
  const mocks = {
    readVideo: vi.fn(async () => ({kind: "film_review_v1", summary: "实际MV", findings: [], limitations: "无人工审片", nativeEvidence: {analysis: {allAudioAndShots: ["完整原生证据"]}, sourceGeneration: "1", audioTokens: 33}})),
    resolveAudio: vi.fn(async () => "gs://test/song.wav"),
    resolveVideo: vi.fn(async () => "gs://test/v.mp4"),
    read: vi.fn(async () => ({
      buffer: Buffer.from("fake-audio"),
      mimeType: "audio/wav",
      durationSec: 12,
    })),
    generate: vi.fn(async () => ({
      text: JSON.stringify(proposal()),
      usageMetadata: {
        promptTokensDetails: [] as Array<{
          modality: string;
          tokenCount: number;
        }>,
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
    compose: vi.fn(async (_instructions: string, input: any, save: (name: string, value: unknown) => Promise<unknown>, hop: CreativeLlmHop) => {
      const decoded = proposal(Boolean(input.target.audio));
      await save("raw", {model: hop.modelName, decoded});
      return {text: JSON.stringify(decoded), model: hop.modelName};
    }),
    readKnowledge: vi.fn(async (_userId: number, _question: string, selectedIds: readonly string[]) => ({catalog: ["lin-inner-turn", "fang-image-story"].map(id => ({id})), selectedIds})),
    bucket: () => "test",
    refine: vi.fn(async (input: any, _draftModel: string, _save: unknown, hop: CreativeLlmHop) => ({text: JSON.stringify(envelope(input.candidate)), model: hop.modelName})),
    hops: CREATIVE_LLM_HOPS,
    uuid: () => "11111111-1111-4111-8111-111111111111",
  };
  return {
    mocks,
    records,
    deps: mocks as unknown as NonNullable<
      Parameters<typeof askSunoSongAdvisor>[3]
    >,
  };
}
describe("原创歌曲与参考听音分开", () => {
  it("无音频仅发主题，保留完整创作/风格/MV方案及原始证据", async () => {
    const { deps, mocks, records } = fixture();
    const response = JSON.parse(
      await askSunoSongAdvisor(7, target, "写歌", deps)
    );
    const p = parseSunoSongProposal(response.answer, target);
    expect(p.concepts[0].mvDirectionZh).toContain("车站");
    expect(mocks.resolveAudio).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.generate.mock.calls)).not.toContain(
      "inlineData"
    );
    expect(Array.from(records.keys()).map(k => k.split("/").at(-1))).toEqual([
      "request.json",
      "compose-hop-1-glm-5.3-flashx-raw.json",
      "compose-hop-1-glm-5.3-flashx-decoded.json",
      "compose-hop-used.json",
      "glm-draft-validated.json",
      "refine-hop-1-glm-5.3-flashx-decoded.json",
      "refine-hop-used.json",
      "accepted.json",
    ]);
  });
  it("选择的访谈方法进入实际请求与永久证据，不假称歌曲已读取", async () => {
    const { deps, mocks, records } = fixture();
    await askSunoSongAdvisor(
      7,
      { ...target, craftIds: ["lin-inner-turn"] },
      "写歌",
      deps
    );
    const request = Array.from(records.entries()).find(([k]) =>
      k.endsWith("request.json")
    )![1] as any;
    expect(JSON.stringify(mocks.compose.mock.calls)).toContain("lin-inner-turn");
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.readKnowledge).toHaveBeenCalledWith(7, expect.any(String), ["lin-inner-turn"]);
    expect(request.analysisBasis).toBe("user_brief");
  });
  it("新响应缺少方法时拒绝采用并保留原始与解析证据", async () => {
    const { deps, mocks, records } = fixture();
    const incomplete = proposal();
    delete (incomplete.concepts[0] as any).mvDirectionZh;
    // 三跳链：每跳（含重写）都返回同一份缺字段方案 → 三跳全败，错误带每跳原因
    mocks.compose.mockImplementation(async (_instructions, _input, save, hop) => {
      await save("raw", incomplete);
      return {text: JSON.stringify(incomplete), model: hop.modelName};
    });
    await expect(askSunoSongAdvisor(7, target, "写歌", deps)).rejects.toThrow(
      "缺少写词方法或MV方向"
    );
    const names = Array.from(records.keys()).map(k => k.split("/").at(-1));
    expect(names).toContain("compose-hop-1-glm-5.3-flashx-raw.json");
    expect(names).toContain("compose-hop-3-deepseek_deepseek-v4.1-flash-1017-rewrite-rejected.json");
    expect(mocks.compose).toHaveBeenCalledTimes(6);
    expect(names).toContain("compose-hop-1-glm-5.3-flashx-decoded.json");
    expect(names).not.toContain("accepted.json");
  });
  it("主题创作拒绝虚构听音时间线", () =>
    expect(() => parseSunoSongProposal(proposal(true), target)).toThrow(
      "不能生成听音"
    ));
  it("参考创作必须实际送音频且有音频回执，不能退回主题创作", async () => {
    const { deps, mocks, records } = fixture();
    const audioTarget = {
      ...target,
      audio: { id: "s", url: "https://example.test/s.wav", durationSec: 12 },
    };
    mocks.generate.mockResolvedValue({
      text: JSON.stringify(proposal(true)),
      usageMetadata: { promptTokensDetails: [] },
    });
    // 1109：参考听音走独立听歌两跳（Vertex gs:// → EvoLink 签名 URL）；两跳都无 AUDIO 回执 → 失败，不退回主题创作。
    const listen = vi.fn(async (input: any) => {
      const failures: string[] = [];
      for (const [hop, fileUri] of [["Vertex", input.media.vertexFileUri], ["EvoLink", input.media.evolinkFileUri()]]) {
        const payload = await (mocks.generate as any)({ fileUri, prompt: input.prompt, model: input.model });
        const reject = input.checkPayload?.(payload);
        if (reject) { failures.push(`${hop}（${reject}）`); continue; }
        return { value: input.validate(JSON.parse(payload.text)), channel: hop, model: input.model, failuresZh: failures, payload };
      }
      throw new Error(`听音识别全部通道失败：${failures.join("；")}`);
    });
    (deps as any).hear = (input: any) => hearSongIndependently(input, {
      listen: listen as any, sign: (u: string) => `https://signed.example/${u.slice(5)}`, upload: mocks.upload as any,
      readJson: async () => undefined, bucket: () => "test-bucket", uuid: () => "33333333-3333-4333-8333-333333333333",
    });
    await expect(
      askSunoSongAdvisor(7, audioTarget, "听歌", deps)
    ).rejects.toThrow("音频处理回执");
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mocks.generate.mock.calls)).toContain("gs://test/song.wav");
    expect(JSON.stringify(mocks.generate.mock.calls)).toContain("https://signed.example/test/song.wav");
    expect(JSON.stringify(mocks.generate.mock.calls)).not.toContain("inlineData");
    expect(
      Array.from(records.keys()).some(k => k.endsWith("accepted.json"))
    ).toBe(false);
  });
  it("参考音频未覆盖不能采用，旧方案可兼容没有新增方法字段", () => {
    const t = {
      ...target,
      audio: { id: "s", url: "https://example.test/s.wav", durationSec: 13 },
    };
    expect(() => parseSunoSongProposal(proposal(true), t)).toThrow("覆盖");
    const old = proposal();
    for (const c of old.concepts) {
      delete (c as any).lyricMethodZh;
      delete (c as any).mvDirectionZh;
    }
    expect(parseSunoSongProposal(old, target).concepts).toHaveLength(3);
  });
});


describe("参考MV先原生读片再创作与审阅", () => {
  it("MV不走音频伪装，完整原生证据交创作顾问审阅", async () => {
    const {deps,mocks,records}=fixture();
    const t = {...target,referenceMediaKind:"video" as const,audio:{id:"upload:mv",url:"https://example.test/mv.mp4",durationSec:12}};
    mocks.generate.mockResolvedValue({text:JSON.stringify(proposal(true)),usageMetadata:{promptTokensDetails:[]}});
    const result=JSON.parse(await askSunoSongAdvisor(7,t,"从MV获得灵感",deps));
    expect(mocks.readVideo).toHaveBeenCalledWith(7,t.audio,t.sourceKey);
    expect(mocks.resolveAudio).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.compose.mock.calls)).toContain("完整原生证据");
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.refine).toHaveBeenCalledWith(expect.objectContaining({mediaKind:"video",sourceEvidence:expect.objectContaining({media:expect.objectContaining({nativeEvidence:expect.any(Object)})})}),expect.any(String),expect.any(Function),CREATIVE_LLM_HOPS[0]);
    expect(result.answer.review.verdict).toBe("approved");
    expect(Array.from(records.values()).some((x:any)=>x.audioTokens===33)).toBe(true);
  });
  it("原生MV失败不能降级成文字创作",async()=>{
    const {deps,mocks}=fixture();mocks.readVideo.mockRejectedValueOnce(Error("读片未通过"));
    await expect(askSunoSongAdvisor(7,{...target,referenceMediaKind:"video",audio:{id:"upload:mv",url:"https://example.test/mv.mp4",durationSec:12}},"审阅",deps)).rejects.toThrow("读片未通过");
    expect(mocks.generate).not.toHaveBeenCalled();expect(mocks.refine).not.toHaveBeenCalled();
  });
});

it("优化现有提示词保留完整歌词和时长，初稿及Astra任一阶段改词均拒绝",async()=>{
 const original={...proposal().concepts[0].brief,model:'suno-v6' as const,custom_mode:true as const,prompt:'【Verse 1】\n完整主歌原文\n【Chorus】\n意想愛 unexpected love\n【Outro】\nLove is brave',title:'意想爱',duration:300};
 const rawTarget={...target,originalBrief:original};
 const answer=proposal();answer.concepts=answer.concepts.map((c,i)=>({...c,brief:{...original,style:`73 BPM, original arrangement ${i}`}}));
 const f=fixture();f.mocks.compose.mockImplementation(async(_instructions,input,save,hop)=>{expect(input.target.originalBrief).toEqual(original);await save('raw',answer);return {text:JSON.stringify(answer),model:hop.modelName};});
 const result=JSON.parse(await askSunoSongAdvisor(7,rawTarget,'仅优化音乐提示词',f.deps));
 expect(result.answer.concepts.every((c:any)=>c.brief.prompt===original.prompt&&c.brief.duration===300)).toBe(true);
 expect(f.mocks.refine.mock.calls[0][0].sourceEvidence.originalBrief).toEqual(original);
 const changed=structuredClone(answer);changed.concepts[1].brief.prompt+='改词';
 expect(()=>parseSunoSongProposal(changed,rawTarget)).toThrow('不得改写');
 f.mocks.refine.mockImplementation(async(_i:any,_m:string,_s:unknown,hop:CreativeLlmHop)=>({text:JSON.stringify(envelope(changed)),model:hop.modelName}));
 await expect(askSunoSongAdvisor(7,rawTarget,'仅优化音乐提示词',f.deps)).rejects.toThrow('不得改写');
});

it('工作流超长style自动交同一LLM服务精炼，模板引用与原词继续保留',async()=>{
 const f=fixture();let n=0;
 f.mocks.refine.mockImplementation(async(input:any,_m:string,_s:unknown,hop:CreativeLlmHop)=>{n++;const p=structuredClone(input.candidate);p.concepts=p.concepts.map((c:any,i:number)=>({...c,brief:{...c.brief,style:n===1?'详细编曲要求'.repeat(240):'LLM精炼编曲'+i}}));return {text:JSON.stringify(envelope(p)),model:hop.modelName};});
 const result=JSON.parse(await askSunoSongAdvisor(7,target,'创作歌曲',f.deps));
 expect(f.mocks.refine).toHaveBeenCalledTimes(2);expect(f.mocks.compose).toHaveBeenCalledTimes(1);
 expect(f.mocks.refine.mock.calls[1][0].requirements).toContain('语义精炼');
 expect(result.answer.concepts[0].brief.style).toBe('LLM精炼编曲0');expect(result.answer.concepts[0].brief.prompt).toBe(proposal().concepts[0].brief.prompt);
 expect(result.answer.craftSelections).toEqual(proposal().craftSelections);
 expect(Array.from(f.records.keys()).some(k=>k.includes('style-refinement-validated'))).toBe(true);
});

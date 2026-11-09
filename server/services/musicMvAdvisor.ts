import {refineSunoSongStyles} from './sunoStyleRefinement';
import { MUSIC_EMOTION_INSTRUCTIONS, assertNewMusicEmotionCoverage } from "../../shared/musicEmotion";
import { askManhuaFilmReview } from "./manhuaAdvisorFilmReview";
import { advisorFilmReviewSchema } from "../../shared/manhuaAdvisorFilmReview";
import { CREATIVE_REFINE_INSTRUCTIONS, parseRefinementEnvelope } from "./creativeAstraRefinement";
import { CREATIVE_LLM_HOPS, invokeCreativeHop, type CreativeLlmHop } from "./creativeLlmHops";
import { buildLyricReviewContext } from "../../shared/lyricCraftReview";
import type { CreativeEvidenceReviewInput } from "../../shared/creativeEvidenceReview";
import { readCreativeLibraryContext, assertCreativeSelections, CREATIVE_LIBRARY_SELECTION_INSTRUCTIONS } from "./creativeLibraryRetrieval";
import { creativeLearningTargetSchema, creativeLearningReportSchema, assertCreativeMethodEvidence, CREATIVE_LEARNING_INSTRUCTIONS, type CreativeLearningTarget } from "../../shared/creativeGenerationLibrary";
import { parseCreativeAudioEvidence } from "../../shared/creativeMediaEvidence";
import { repairJsonShape, normalizeMediaSections, normalizeShotDurations } from "../../shared/creativeProposalRepair";
import { mvShotPlanMaxSec } from "../../shared/canvasMusicMvReferences";
import { runCreativeHopChain } from "./creativeHopChain";
import { computeSongBeatGrid } from "./musicMvBeatGrid";
import { composeMusicMvShotBeats } from "./musicMvShotBeats";
import { snapShotCutsToBeats } from "../../shared/canvasMusicMvBeats";
import { detectPerformerGender, performerLabelZh } from "../../shared/canvasMusicMvReferences";
import type { MusicMvBeatGrid } from "../../shared/canvasMusicMv";
import { SUNO_SONG_CRAFT } from "../../shared/sunoSongCraft";
import {
  sunoSongTargetSchema,
  sunoSongProposalSchema,
  parseSunoSongProposal,
  type SunoSongTarget,
} from "../../shared/canvasMusicMv";
import { createHash, randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectGcsObjectBounded,
  uploadBufferToGcsIfAbsent,
  getGcsBucketName,
} from "./gcs";
import {
  resolveCanvasMusicMvAudio,
  resolveCanvasMusicMvVideo,
} from "./canvasMusicMvMedia";
import { hearSongIndependently, SONG_HEARING_MODEL } from "./musicMvSongHearing";
import { probeAudio } from "./postProduction";
import {
  musicMvAdvisorTargetSchema,
  musicMvAdvisorProposalSchema,
  parseMusicMvAdvisorProposal,
  type MusicMvAdvisorTarget,
} from "../../shared/canvasMusicMv";
import { MUSIC_MV_ADVISOR_INSTRUCTIONS, MUSIC_MV_REFINE_ENVELOPE_ZH, musicMvHardConstraintsZh } from "../../shared/musicMvCraft";
import { repairRefinementEnvelope, repairReviewObject, restoreDraftSections } from "../../shared/creativeRefinementRepair";

type Save = (name: string, value: unknown) => Promise<unknown>;
/** 一跳 compose：系统提示 + 完整创作上下文 → 模型正文（未解析）；request/raw 由 hopSave 落盘。 */
export const composeCreativeAtHop = (instructions: string, input: unknown, save: Save, hop: CreativeLlmHop) =>
  invokeCreativeHop(hop, instructions, input, save, { timeoutMs: 180_000 });
/** 一跳 refine（联合创作审阅）：同 Astra 合同与指令，但走三跳 fallback 模型；回包 {proposal,review,changesZh} 由调用方解析校验。 */
export const refineCreativeAtHop = (input: CreativeEvidenceReviewInput, draftModel: string, save: Save, hop: CreativeLlmHop) =>
  invokeCreativeHop(hop, CREATIVE_REFINE_INSTRUCTIONS, { ...input, lyricCraft: buildLyricReviewContext(input.candidate), draftModel }, save, { timeoutMs: 240_000 });

async function readAudio(gcsUri: string) {
  const chunks: Buffer[] = [];
  await inspectGcsObjectBounded({
    gcsUri,
    maxBytes: 64 * 1024 * 1024,
    timeoutMs: 30_000,
    onChunk: chunk => chunks.push(Buffer.from(chunk)),
  });
  const buffer = Buffer.concat(chunks);
  const mimeType =
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE"
      ? "audio/wav"
      : buffer.toString("ascii", 0, 3) === "ID3" ||
          (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
        ? "audio/mpeg"
        : buffer.toString("ascii", 4, 8) === "ftyp"
          ? "audio/mp4"
          : undefined;
  if (!mimeType) throw new Error("歌曲格式无法识别，请使用WAV、MP3或M4A音频");
  const dir = await mkdtemp(join(tmpdir(), "mv-hearing-"));
  try {
    const file = join(dir, "song");
    await writeFile(file, buffer);
    const durationSec = await probeAudio(file, AbortSignal.timeout(30_000));
    return { buffer, mimeType, durationSec };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const real = {
  resolveAudio: resolveCanvasMusicMvAudio,
  resolveVideo: resolveCanvasMusicMvVideo,
  read: readAudio,
  /** 独立听歌（Vertex gs:// → EvoLink 签名 URL 两跳；按歌曲 SHA 永久存档并复用）。 */
  hear: hearSongIndependently as (input: { gcsUri: string; mimeType: string; durationSec: number; audioSha256: string }) => ReturnType<typeof hearSongIndependently>,
  upload: uploadBufferToGcsIfAbsent,
  bucket: getGcsBucketName,
  uuid: randomUUID,
  refine: refineCreativeAtHop,
  compose: composeCreativeAtHop,
  hops: CREATIVE_LLM_HOPS,
  /** 1109 拍点网格（整首解码 + 起音包络）；离线替身可省略，省略时不出逐窗节拍。 */
  beatGrid: computeSongBeatGrid as ((buffer: Buffer, creativePrompt?: string, sections?: Array<{ startSec: number; endSec: number }>) => Promise<MusicMvBeatGrid & { strongBeatsSec?: number[] }>) | undefined,
  readKnowledge: readCreativeLibraryContext,
  readVideo: async (userId: number, source: { url: string; gcsUri?: string; durationSec: number; title?: string }, sourceKey: string) => {
    const raw = await askManhuaFilmReview(userId, {
      videoUri: source.gcsUri || source.url, blockId: sourceKey, revision: sourceKey,
      label: source.title || "参考MV", expectedDurationSec: source.durationSec,
    }, "读取本版MV的完整声音与画面，核对人声/器乐段落、编曲动态、情绪、表演、镜头与音乐的对应。音乐判断只据声音，不将画面动作猜成音效；统一使用累计秒。提供创作方法证据，不照抄歌词或旋律。");
    const report = advisorFilmReviewSchema.parse(JSON.parse(JSON.parse(raw).answer));
    if (!report.nativeEvidence || !(report.nativeEvidence.audioTokens && report.nativeEvidence.audioTokens > 0)) throw Error("参考MV缺少音频处理回执，未当作听音成功");
    return report;
  },
};

/** 真实依赖集合（隔离机端到端探针用：可在其上包一层计时，不改业务路径）。 */
export const musicMvAdvisorRealDeps = real;

/** 仅消费本人已登记歌曲；复用顾问事务，失败不回落文字推测，不重试听音。 */
/** 写入方案的 audiomap（去掉只给顾问看的强拍清单）。 */
function audioMapOf(grid:MusicMvBeatGrid&{strongBeatsSec?:number[]}):MusicMvBeatGrid{
  const {strongBeatsSec:_drop,...map}=grid;
  return map;
}
/** 每个方案的非演唱剪点吸附拍点，并写入 plan.beatGrid（确定性修复，fixes 进 `<stage>-repaired`）。 */
function snapPlanCuts(value:unknown,grid:MusicMvBeatGrid):{value:unknown;fixes:unknown[]}{
  if(!value||typeof value!=="object"||!Array.isArray((value as {concepts?:unknown}).concepts))return {value,fixes:[]};
  const fixes:unknown[]=[];
  const concepts=((value as {concepts:unknown[]}).concepts).map((concept,ci)=>{
    const plan=(concept as {plan?:{shots?:unknown}})?.plan;
    if(!plan||!Array.isArray(plan.shots)||plan.shots.some(s=>!s||typeof s!=="object"||!Number.isFinite((s as {startSec?:unknown}).startSec)||!Number.isFinite((s as {endSec?:unknown}).endSec)))return concept;
    const snapped=snapShotCutsToBeats(plan.shots as Array<{id:string;startSec:number;endSec:number;kind?:string}>,grid);
    fixes.push(...snapped.fixes.map(f=>({concept:ci,...f})));
    return {...(concept as object),plan:{...plan,shots:snapped.shots,beatGrid:audioMapOf(grid)}};
  });
  return {value:{...(value as object),concepts},fixes};
}

export async function askMusicMvAdvisor(
  userId: number,
  rawTarget: MusicMvAdvisorTarget | SunoSongTarget | CreativeLearningTarget,
  question: string,
  deps = real,
  purpose: "mv" | "song" | "learn" = "mv",
  /** 1109 所选成片模型：MV 单镜上限按它定（mvShotPlanMaxSec），不锁 15 秒。 */
  opts: { videoModel?: string } = {}
) {
  const target =
    purpose === "learn" ? creativeLearningTargetSchema.parse(rawTarget) : purpose === "song"
      ? sunoSongTargetSchema.parse(rawTarget)
      : musicMvAdvisorTargetSchema.parse(rawTarget);
  if (purpose === "mv" && !target.audio)
    throw new Error("MV分镜必须提供真实歌曲");
  const videoReference = purpose !== "mv" && "referenceMediaKind" in target && target.referenceMediaKind === "video";
  if (videoReference && !target.audio) throw Error("未选择参考MV");
  const audioUri = target.audio && !videoReference
    ? await deps.resolveAudio(userId, target.audio)
    : undefined;
  if ("footage" in target)
    for (const clip of target.footage) await deps.resolveVideo(userId, clip);
  const videoReport = videoReference && target.audio ? await deps.readVideo(userId, target.audio, target.sourceKey) : undefined;
  const media = audioUri ? await deps.read(audioUri) : undefined;
  const { buffer, mimeType, durationSec } = media || {};
  if (
    target.audio && !videoReference &&
    (!Number.isFinite(durationSec) ||
      (durationSec ?? 0) <= 0 ||
      (durationSec ?? 0) > 3600 ||
      Math.abs((durationSec ?? 0) - target.audio.durationSec) > 0.1)
  )
    throw new Error("歌曲实际时长与所选版本不一致，请重新读取歌曲");
  const evidenceId = deps.uuid();
  const prefix = `canvas-music-mv/advisor/${userId}/${evidenceId}`;
  const save = async (name: string, value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value));
    const objectName = `${prefix}/${name}.json`;
    const saved = await deps.upload({
      bucket: deps.bucket(),
      objectName,
      buffer: bytes,
      contentType: "application/json",
    });
    if (!saved.created) throw new Error("MV顾问证据已存在，未覆盖原记录");
    return {
      objectName,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  };
  const audioSha256=buffer?createHash("sha256").update(buffer).digest("hex"):undefined;
  await save("request",{target,purpose,question,audioUri,durationSec,analysisBasis:videoReport?"native_video_audio":media?"native_audio":"user_brief",nativeVideoEvidence:videoReport,audioSha256,model:media?SONG_HEARING_MODEL:undefined,hearingScope:media?"song_only_no_story":undefined,audioMimeType:mimeType,audioBytes:buffer?.length});
  let sourceEvidence: unknown=videoReport || {basis:"user_brief",noteZh:"无参考媒体，不声称听过或看过"};
  let audioTokens=videoReport?.nativeEvidence?.audioTokens || 0;
  let receipt: unknown;
  if(media&&audioUri&&mimeType&&audioSha256){
    // 1109：先「不看剧情」独立听歌（只送歌曲），结果按歌曲永久存档复用；剧情只在后续 GLM 编排阶段合入。
    const hearing=await deps.hear({gcsUri:audioUri,mimeType,durationSec:target.audio!.durationSec,audioSha256});
    receipt=await save("hearing",{reused:hearing.reused,cacheObject:hearing.cacheObject,evidencePrefix:hearing.evidencePrefix,channel:hearing.channel,model:hearing.model,audioTokens:hearing.audioTokens});
    audioTokens=hearing.audioTokens;
    if(!audioTokens)throw Error("未取得歌曲音频处理回执，未以文字分析冒充听音");
    sourceEvidence=parseCreativeAudioEvidence({...(hearing.evidence as object),sourceKey:target.sourceKey},target.sourceKey,target.audio!.durationSec);
  }
  // 1109 拍点网格：剪点吸附与逐窗节拍的依据（只在 MV 且真实听音时计算）
  const beatGrid=purpose==="mv"&&media&&buffer&&deps.beatGrid?await deps.beatGrid(buffer,(target as MusicMvAdvisorTarget).creativePrompt,((sourceEvidence as {sections?:Array<{startSec:number;endSec:number}>}).sections)||undefined):undefined;
  if(beatGrid)await save("beat-grid",beatGrid);
  const creativeLibrary=purpose==="learn"?undefined:await deps.readKnowledge(userId,question+"\n"+("requirements" in target?target.requirements:target.creativePrompt),"craftIds" in target?target.craftIds:[]);
  const instructions=purpose==="learn"?CREATIVE_LEARNING_INSTRUCTIONS:(purpose==="song"?SUNO_SONG_CRAFT:MUSIC_MV_ADVISOR_INSTRUCTIONS)+"\n"+MUSIC_EMOTION_INSTRUCTIONS+(purpose==="song"?"\n"+CREATIVE_LIBRARY_SELECTION_INSTRUCTIONS:"");
  const proposalSchema:ZodType=purpose==="learn"?creativeLearningReportSchema:purpose==="song"?sunoSongProposalSchema:musicMvAdvisorProposalSchema;
  const sectionTolerance=purpose==="mv"?0.03:0.1;
  /** 方案校验前的确定性修复：形状（字符串→数组、别名键、数字字符串、空对象占位）、sections 时间边界、MV 镜头 >15s 等分 / <0.5s 并入；有修复才落 `<stage>-repaired`。 */
  const shotMaxSec=mvShotPlanMaxSec(opts.videoModel);
  const prepareCandidate=async(raw:unknown,stage:string)=>{
    const shape=repairJsonShape(raw,proposalSchema);
    const sections=target.audio?normalizeMediaSections(shape.value,target.audio.durationSec,sectionTolerance):{value:shape.value,fixes:[]};
    const shots=purpose==="mv"?normalizeShotDurations(sections.value,shotMaxSec):{value:sections.value,fixes:[]};
    const beats=purpose==="mv"&&beatGrid?snapPlanCuts(shots.value,beatGrid):{value:shots.value,fixes:[]};
    if(shape.fixes.length||sections.fixes.length||shots.fixes.length||beats.fixes.length)await save(`${stage}-repaired`,{before:raw,after:beats.value,fixes:{shape:shape.fixes,sections:sections.fixes,shots:shots.fixes,beats:beats.fixes},remainingIssues:shape.issues});
    return beats.value;
  };
  const validateDraft=(candidate:unknown)=>{
    const parsed=purpose==="learn"?creativeLearningReportSchema.parse(candidate):purpose==="song"?parseSunoSongProposal(candidate,target as SunoSongTarget):parseMusicMvAdvisorProposal(candidate,target as MusicMvAdvisorTarget);
    if(parsed.kind==="creative_learning_v1"){
      if(parsed.sourceKey!==target.sourceKey)throw Error("学习结果来源版本不一致");
      assertCreativeMethodEvidence(parsed,sourceEvidence);
    }else{
      assertNewMusicEmotionCoverage(parsed);
      if(parsed.kind==="suno_song_v1"){
        if(parsed.concepts.length!==3)throw Error("新歌曲方案必须包含3个不同曲风demo");
        if(parsed.concepts.some(c=>!c.lyricMethodZh?.trim()||!c.mvDirectionZh?.trim()))throw Error("新歌方案缺少写词方法或MV方向，原始响应已保留");
        assertCreativeSelections(parsed,creativeLibrary!);
      }
    }
    return parsed;
  };
  const composeInput={sourceKey:target.sourceKey,target,question,sourceEvidence,creativeLibrary,...(beatGrid?{beatGrid:{bpm:beatGrid.bpm,beatSec:beatGrid.beatSec,firstBeatSec:beatGrid.phaseSec,beatConfidence:beatGrid.beatConfidence,segments:beatGrid.segments,noteZh:"按段落节奏模式安排剪点：pacing=beat 的段剪点落在拍点（firstBeatSec + n×beatSec），服务端会吸附；phrase 段按乐句与能量峰切，不硬切网格；free 段按能量与静音切；演唱镜按唱句起止落位，不吸附"}}:{})};
  const hopsUsed:Record<string,unknown>={};
  /**
   * 三跳 fallback（GLM@EvoLink → GLM@OpenRouter → DeepSeek 1017@OpenRouter）：每跳 调用 → JSON 解析 → 形状/分段/镜长修复 → 校验；
   * 解析或校验失败先带具体原因重写一次，仍失败切下一跳；通道异常直接切下一跳；三跳全败抛 CreativeProposalError（含每跳原因）。
   * 证据：`<stage>-hop-<n>-<model>[-rewrite]-{request,raw,error,decoded,repaired,rejected}` 与 `<stage>-hop-used`。
   */
  const runHopChain=async<T>(stage:"compose"|"refine",chainSave:Save,call:(hop:CreativeLlmHop,hopSave:Save,repair?:{attempt:number;reasonZh:string})=>Promise<{text:string;model:string;inputSha256?:string;elapsedMs?:number}>,accept:(decoded:unknown,hopSave:Save,stageName:string,model:string,inputSha256?:string)=>Promise<T>)=>{
    const result=await runCreativeHopChain(deps.hops,stage,chainSave,call,accept);
    hopsUsed[stage]=result.used;
    return result;
  };
  /** 重写提示：compose 照抄 sourceEvidence.sections，refine 照抄 candidate.sections（1109 探针根因：refine 被要求照抄证据原文，与「不得改初稿 sections」冲突）。 */
  const mvRepairHintZh=(stage:"compose"|"refine")=>purpose==="mv"?`sections 逐条照抄 ${stage==="refine"?"输入 candidate.sections":"sourceEvidence.sections"} 的 startSec/endSec/labelZh/heardZh/emotion 全部字段，不追加占位段、全曲段、零长段或任何 endSec≤startSec 的段；uncertaintiesZh 必须是字符串数组且字段名严格按合同；concepts 是恰好 4 个元素的 JSON 数组且 id 唯一；每个 plan 的 shots 从 0 连续无缝覆盖到歌曲时长，每镜 0.5 至 15 秒（超过 15 秒的镜头拆成两镜），singing 至少 4 秒并带人物参考下标；非 footage 镜头不得出现 sourceClip。`:"字段名、类型与数量严格按合同。";
  const composed=await runHopChain("compose",save,
    (hop,hopSave,repair)=>deps.compose(repair?instructions+`\n上一版方案未通过服务端校验：${repair.reasonZh}。请基于同一份 sourceEvidence 逐条修正上述问题后重新输出完整 JSON（不得只输出解释或声称已修好）：${mvRepairHintZh("compose")}`:instructions,repair?{...composeInput,repair}:composeInput,hopSave,hop),
    async(decoded,_hopSave,stageName)=>validateDraft(await prepareCandidate(decoded,stageName)),
  );
  let proposal=composed.value;
  await save("glm-draft-validated",{proposal,model:composed.model,hop:composed.hop,creativeLibrary});
  const draft=proposal;
  const refineInput={sourceTaskId:evidenceId,durationSec:target.audio?.durationSec,mediaKind:(videoReport?"video":media?"audio":"none") as "video"|"audio"|"none",sourceEvidence:{media:sourceEvidence,creativeLibrary,...("originalBrief" in target?{originalBrief:target.originalBrief}:{})},candidate:draft,requirements:question+("originalBrief" in target&&target.originalBrief?"\n本次只优化音乐提示词，逐字符保留sourceEvidence.originalBrief的歌词、标题、演唱类型和完整版时长；不得改写歌词。":"")+(purpose==="mv"?"\n"+musicMvHardConstraintsZh("refine")+"\n"+MUSIC_MV_REFINE_ENVELOPE_ZH:"\n"+MUSIC_MV_REFINE_ENVELOPE_ZH)};
  const validateRefined=(candidate:unknown)=>{
    const parsed=purpose==="learn"?creativeLearningReportSchema.parse(candidate):purpose==="song"?parseSunoSongProposal(candidate,target as SunoSongTarget):parseMusicMvAdvisorProposal(candidate,target as MusicMvAdvisorTarget);
    if(parsed.kind==="creative_learning_v1"){
      if(parsed.sourceKey!==target.sourceKey)throw Error("联合创作学习来源不一致");
      assertCreativeMethodEvidence(parsed,sourceEvidence);
    }else{
      assertNewMusicEmotionCoverage(parsed);
      if("sections" in draft && JSON.stringify(parsed.sections)!==JSON.stringify(draft.sections))throw Error("联合创作不得改写媒体观察区间和证据");
      if(parsed.kind==="suno_song_v1"){
        if(parsed.concepts.length!==3 || parsed.concepts.some(c=>!c.lyricMethodZh?.trim()||!c.mvDirectionZh?.trim()))throw Error("联合创作缺少三种曲风或创作方法");
        assertCreativeSelections(parsed,creativeLibrary!);
      }
    }
    return parsed;
  };
  /** refine 三跳链：回包 {proposal,review,changesZh} 先过合同，再对 proposal 做修复 + 校验；歌曲 style 精炼复用同一条链。 */
  const refineChain=async(input:CreativeEvidenceReviewInput,chainSave:Save,validate:(candidate:unknown)=>unknown=validateRefined)=>{
    const result=await runHopChain("refine",chainSave,
      (hop,hopSave,repair)=>deps.refine(repair?{...input,requirements:input.requirements+`\n上一版联合创作结果未通过服务端校验：${repair.reasonZh}。请在 candidate 结构内修正后重新输出完整 JSON {proposal,review,changesZh}（根对象只有这三个键，review 六个键齐全）：sections 与 candidate.sections 完全一致，不追加占位段或零长段；${mvRepairHintZh("refine")}`}:input,composed.model,hopSave,hop),
      async(decoded,hopSave,stageName,model,inputSha256)=>{
        // 合同校验前的确定性修复（1109 探针四类写坏）：根对象包裹/别名/changesZh → review 形状、limitationsZh、evidencePaths → 校验后再回填初稿 sections。
        const shell=repairRefinementEnvelope(decoded,input.candidate);
        const shellValue=shell.value as Record<string,unknown>;
        const reviewRepair=typeof shellValue==="object"&&shellValue?repairReviewObject(shellValue.review,{...input,candidate:shellValue.proposal}):{value:undefined,fixes:[]};
        const repairedEnvelope=typeof shellValue==="object"&&shellValue?{...shellValue,review:reviewRepair.value}:shell.value;
        if(shell.fixes.length||reviewRepair.fixes.length)await hopSave("envelope-repaired",{before:decoded,after:repairedEnvelope,fixes:{envelope:shell.fixes,review:reviewRepair.fixes}});
        const envelope=parseRefinementEnvelope(repairedEnvelope,input,{model,inputSha256:inputSha256||"",draftModel:composed.model});
        let candidate=await prepareCandidate(envelope.proposal,stageName);
        if("sections" in draft){
          const restored=restoreDraftSections(candidate,draft.sections);
          if(restored.replaced){
            await hopSave("sections-restored",{before:(candidate as Record<string,unknown>).sections,after:draft.sections,fixes:restored.fixes,reasonZh:"联合创作回传的 sections 与初稿不一致，已回填初稿（媒体观察不是 refine 的创作对象）"});
            candidate=restored.value;
          }
        }
        validate(candidate);
        return {...envelope,proposal:candidate};
      },
    );
    return result.value;
  };
  let refinement=await refineChain(refineInput,save);
  if(purpose==="song"){
    const candidate=parseSunoSongProposal(refinement.proposal,target as SunoSongTarget);
    if(candidate.concepts.some(c=>c.brief.style.length>1000))refinement=await refineSunoSongStyles(candidate,target as SunoSongTarget,{...refineInput,candidate},composed.model,save,(input,_draftModel,styleSave)=>refineChain(input,styleSave,value=>parseSunoSongProposal(value,target as SunoSongTarget)));
  }
  proposal=validateRefined(refinement.proposal);
  let beatsReport:unknown;
  if(purpose==="mv"&&beatGrid&&proposal.kind==="music_mv_v1"){
    // 1109 第三阶段：主推荐方案逐窗节拍（同一三跳链）；三跳全败的镜头不出窗，编译器整镜一窗降级并标注。
    const mvTarget=target as MusicMvAdvisorTarget;
    const main=proposal.concepts[0]!;
    const gender=detectPerformerGender(mvTarget.creativePrompt);
    const beats=await composeMusicMvShotBeats({plan:main.plan,beatGrid,lyrics:mvTarget.lyrics,creativePrompt:mvTarget.creativePrompt,concept:{titleZh:main.titleZh,rationaleZh:main.rationaleZh},sections:proposal.sections,...(gender?{performer:{genderZh:gender,descZh:performerLabelZh(gender,mvTarget)}}:{})},{hops:deps.hops,compose:deps.compose,save});
    beatsReport={filledShotIds:beats.filledShotIds,failedShotIds:beats.failedShotIds,failuresZh:beats.failuresZh};
    proposal=validateRefined({...proposal,concepts:proposal.concepts.map((c,i)=>i===0?{...c,plan:beats.plan}:c)});
  }
  const review=refinement.review;
  const answer={...proposal,evidenceId,review};
  await save("accepted",{target,proposal:answer,sourceEvidence,creativeLibrary,receipt,model:review.model,draftModel:composed.model,hopsUsed,beatGrid,beatsReport,mediaModel:target.audio?SONG_HEARING_MODEL:undefined,audioTokens});
  return JSON.stringify({
    answer,
    model: review.model,
    imageIntent: false,
    creationRelated: false,
    suggestedImagePrompt: "",
    guideMessage: "",
  });
}

export const askSunoSongAdvisor = (
  userId: number,
  target: SunoSongTarget,
  question: string,
  deps = real
) => askMusicMvAdvisor(userId, target, question, deps, "song");

/** 学习仍走既有顾问事务与额度入口；这里只执行媒体读取和GLM提炼，不自动入库。 */
export function askCreativeLearning(userId:number,target:CreativeLearningTarget,question:string,deps=real){
  return askMusicMvAdvisor(userId,target,question,deps,"learn");
}

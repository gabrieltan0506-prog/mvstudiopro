import {refineSunoSongStyles} from './sunoStyleRefinement';
import { MUSIC_EMOTION_INSTRUCTIONS, assertNewMusicEmotionCoverage } from "../../shared/musicEmotion";
import { askManhuaFilmReview } from "./manhuaAdvisorFilmReview";
import { advisorFilmReviewSchema } from "../../shared/manhuaAdvisorFilmReview";
import { CREATIVE_REFINE_INSTRUCTIONS, parseRefinementEnvelope } from "./creativeAstraRefinement";
import { CREATIVE_LLM_HOPS, CreativeHopTransportError, creativeHopSlug, invokeCreativeHop, type CreativeLlmHop } from "./creativeLlmHops";
import { buildLyricReviewContext } from "../../shared/lyricCraftReview";
import type { CreativeEvidenceReviewInput } from "../../shared/creativeEvidenceReview";
import { extractJsonString } from "../_core/llm";
import { readCreativeLibraryContext, assertCreativeSelections, CREATIVE_LIBRARY_SELECTION_INSTRUCTIONS } from "./creativeLibraryRetrieval";
import { creativeLearningTargetSchema, creativeLearningReportSchema, assertCreativeMethodEvidence, CREATIVE_LEARNING_INSTRUCTIONS, type CreativeLearningTarget } from "../../shared/creativeGenerationLibrary";
import { parseCreativeAudioEvidence, creativeAudioEvidenceSchema, CREATIVE_AUDIO_READ_INSTRUCTIONS } from "../../shared/creativeMediaEvidence";
import { repairJsonShape, normalizeMediaSections, normalizeShotDurations, describeValidationErrorZh } from "../../shared/creativeProposalRepair";
import { CreativeProposalError } from "./creativeProposalFailure";
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
import {
  generateGeminiBgmAnalysis,
  MANHUA_BGM_ADVISOR_MODEL,
} from "./manhuaAdvisorBgmMix";
import { probeAudio } from "./postProduction";
import {
  musicMvAdvisorTargetSchema,
  musicMvAdvisorProposalSchema,
  parseMusicMvAdvisorProposal,
  type MusicMvAdvisorTarget,
} from "../../shared/canvasMusicMv";
import { MUSIC_MV_ADVISOR_INSTRUCTIONS, MUSIC_MV_HARD_CONSTRAINTS_ZH } from "../../shared/musicMvCraft";

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
  generate: generateGeminiBgmAnalysis,
  upload: uploadBufferToGcsIfAbsent,
  bucket: getGcsBucketName,
  uuid: randomUUID,
  refine: refineCreativeAtHop,
  compose: composeCreativeAtHop,
  hops: CREATIVE_LLM_HOPS,
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
export async function askMusicMvAdvisor(
  userId: number,
  rawTarget: MusicMvAdvisorTarget | SunoSongTarget | CreativeLearningTarget,
  question: string,
  deps = real,
  purpose: "mv" | "song" | "learn" = "mv"
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
  const request = {
    model: MANHUA_BGM_ADVISOR_MODEL,
    contents: [{ role: "user", parts: [
      { text: JSON.stringify({sourceKey:target.sourceKey,audioId:target.audio?.id,audioDurationSec:target.audio?.durationSec,task:"读取本次完整音频的声音证据与逐段情绪，不生成创作方案"}) },
      ...(buffer && mimeType ? [{inlineData:{mimeType,data:buffer.toString("base64")}}] : []),
    ]}],
    config: {systemInstruction:CREATIVE_AUDIO_READ_INSTRUCTIONS,responseMimeType:"application/json",maxOutputTokens:32768,httpOptions:{timeout:240_000}},
  };
  await save("request",{target,purpose,question,audioUri,durationSec,analysisBasis:videoReport?"native_video_audio":media?"native_audio":"user_brief",nativeVideoEvidence:videoReport,audioSha256:buffer?createHash("sha256").update(buffer).digest("hex"):undefined,model:media?MANHUA_BGM_ADVISOR_MODEL:undefined,config:media?request.config:undefined,textParts:request.contents.flatMap(c=>c.parts).filter(p=>"text" in p),audioMimeType:mimeType,audioBytes:buffer?.length});
  let sourceEvidence: unknown=videoReport || {basis:"user_brief",noteZh:"无参考媒体，不声称听过或看过"};
  let audioTokens=videoReport?.nativeEvidence?.audioTokens || 0;
  let receipt: unknown;
  if(media){
    const response=await deps.generate(request);
    receipt=await save("raw",response);
    audioTokens=response.usageMetadata?.promptTokensDetails?.filter(row=>String(row.modality)==="AUDIO").reduce((sum,row)=>sum+(row.tokenCount||0),0)||0;
    if(!audioTokens)throw Error("未取得歌曲音频处理回执，未以文字分析冒充听音");
    if(response.candidates?.[0]?.finishReason!=="STOP" || !String(response.modelVersion||"").startsWith(MANHUA_BGM_ADVISOR_MODEL))throw Error("媒体读取模型或结束状态不符，原始回执保留");
    if(!response.text?.trim())throw Error("歌曲分析未返回内容，原回执保留");
    const decoded:unknown=JSON.parse(response.text);
    await save("decoded",decoded);
    // 听音分段先做确定性修复（形状 + 时间边界），修复过程落永久证据，再进严格校验；不动 heardZh/emotion。
    const evidenceShape=repairJsonShape(decoded,creativeAudioEvidenceSchema);
    const evidenceSections=normalizeMediaSections(evidenceShape.value,target.audio!.durationSec,0.1);
    if(evidenceShape.fixes.length||evidenceSections.fixes.length)await save("evidence-normalized",{before:decoded,after:evidenceSections.value,fixes:{shape:evidenceShape.fixes,sections:evidenceSections.fixes}});
    sourceEvidence=parseCreativeAudioEvidence(evidenceSections.value,target.sourceKey,target.audio!.durationSec);
  }
  const creativeLibrary=purpose==="learn"?undefined:await deps.readKnowledge(userId,question+"\n"+("requirements" in target?target.requirements:target.creativePrompt),"craftIds" in target?target.craftIds:[]);
  const instructions=purpose==="learn"?CREATIVE_LEARNING_INSTRUCTIONS:(purpose==="song"?SUNO_SONG_CRAFT:MUSIC_MV_ADVISOR_INSTRUCTIONS)+"\n"+MUSIC_EMOTION_INSTRUCTIONS+(purpose==="song"?"\n"+CREATIVE_LIBRARY_SELECTION_INSTRUCTIONS:"");
  const proposalSchema:ZodType=purpose==="learn"?creativeLearningReportSchema:purpose==="song"?sunoSongProposalSchema:musicMvAdvisorProposalSchema;
  const sectionTolerance=purpose==="mv"?0.03:0.1;
  /** 方案校验前的确定性修复：形状（字符串→数组、别名键、数字字符串、空对象占位）、sections 时间边界、MV 镜头 >15s 等分 / <0.5s 并入；有修复才落 `<stage>-repaired`。 */
  const prepareCandidate=async(raw:unknown,stage:string)=>{
    const shape=repairJsonShape(raw,proposalSchema);
    const sections=target.audio?normalizeMediaSections(shape.value,target.audio.durationSec,sectionTolerance):{value:shape.value,fixes:[]};
    const shots=purpose==="mv"?normalizeShotDurations(sections.value):{value:sections.value,fixes:[]};
    if(shape.fixes.length||sections.fixes.length||shots.fixes.length)await save(`${stage}-repaired`,{before:raw,after:shots.value,fixes:{shape:shape.fixes,sections:sections.fixes,shots:shots.fixes},remainingIssues:shape.issues});
    return shots.value;
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
  const composeInput={sourceKey:target.sourceKey,target,question,sourceEvidence,creativeLibrary};
  const hopsUsed:Record<string,unknown>={};
  /**
   * 三跳 fallback（GLM@EvoLink → GLM@OpenRouter → DeepSeek 1017@OpenRouter）：每跳 调用 → JSON 解析 → 形状/分段/镜长修复 → 校验；
   * 解析或校验失败先带具体原因重写一次，仍失败切下一跳；通道异常直接切下一跳；三跳全败抛 CreativeProposalError（含每跳原因）。
   * 证据：`<stage>-hop-<n>-<model>[-rewrite]-{request,raw,error,decoded,repaired,rejected}` 与 `<stage>-hop-used`。
   */
  const runHopChain=async<T>(stage:"compose"|"refine",chainSave:Save,call:(hop:CreativeLlmHop,hopSave:Save,repair?:{attempt:number;reasonZh:string})=>Promise<{text:string;model:string;inputSha256?:string;elapsedMs?:number}>,accept:(decoded:unknown,hopSave:Save,stageName:string,model:string,inputSha256?:string)=>Promise<T>)=>{
    const failures:string[]=[];
    const attemptsLog:Array<Record<string,unknown>>=[];
    const startedAt=Date.now();
    for(let index=0;index<deps.hops.length;index+=1){
      const hop=deps.hops[index];
      let reasonZh:string|undefined;
      for(let attempt=1;attempt<=2;attempt+=1){
        const stageName=`${stage}-hop-${index+1}-${creativeHopSlug(hop)}${attempt>1?"-rewrite":""}`;
        const hopSave=(name:string,value:unknown)=>chainSave(`${stageName}-${name}`,value);
        const t0=Date.now();
        let text:string,model:string,inputSha256:string|undefined;
        try{
          const result=await call(hop,hopSave,reasonZh?{attempt,reasonZh}:undefined);
          text=result.text;model=result.model;inputSha256=result.inputSha256;
        }catch(error){
          const message=error instanceof Error?error.message:String(error);
          const reason=`第${index+1}跳 ${hop.label}${attempt>1?"（重写）":""}：${error instanceof CreativeHopTransportError?message:`通道异常：${message}`}`;
          failures.push(reason);
          attemptsLog.push({hop:index+1,model:hop.modelName,gateway:hop.gateway,attempt,outcome:"transport_error",reasonZh:reason,elapsedMs:Date.now()-t0});
          break; // 通道挂/超时/429/截断：不重写，直接切下一跳
        }
        let decoded:unknown;
        try{
          decoded=JSON.parse(extractJsonString(text));
        }catch(error){
          reasonZh=`模型输出不是合法 JSON（${(error instanceof Error?error.message:String(error)).slice(0,160)}）`;
          await hopSave("rejected",{stage:stageName,phase:"json_parse",reasonZh,model,textLength:text.length,textHead:text.slice(0,400),textTail:text.slice(-400)});
          failures.push(`第${index+1}跳 ${hop.label}${attempt>1?"（重写）":""}：${reasonZh}`);
          attemptsLog.push({hop:index+1,model,gateway:hop.gateway,attempt,outcome:"invalid_json",reasonZh,elapsedMs:Date.now()-t0});
          continue;
        }
        await hopSave("decoded",decoded);
        try{
          const value=await accept(decoded,hopSave,stageName,model,inputSha256);
          const used={stage,hop:index+1,label:hop.label,model,gateway:hop.gateway,attempt,rewritten:attempt>1,elapsedMs:Date.now()-t0,totalElapsedMs:Date.now()-startedAt,failuresZh:failures,attempts:[...attemptsLog,{hop:index+1,model,gateway:hop.gateway,attempt,outcome:"accepted",elapsedMs:Date.now()-t0}]};
          await chainSave(`${stage}-hop-used`,used);
          hopsUsed[stage]=used;
          return {value,model,hop,inputSha256};
        }catch(error){
          reasonZh=describeValidationErrorZh(error);
          await hopSave("rejected",{stage:stageName,phase:"validate",reasonZh,error:error instanceof Error?error.message:String(error),model});
          failures.push(`第${index+1}跳 ${hop.label}${attempt>1?"（重写）":""}：${reasonZh}`);
          attemptsLog.push({hop:index+1,model,gateway:hop.gateway,attempt,outcome:"rejected",reasonZh,elapsedMs:Date.now()-t0});
        }
      }
    }
    await chainSave(`${stage}-hop-exhausted`,{stage,failuresZh:failures,attempts:attemptsLog,totalElapsedMs:Date.now()-startedAt});
    throw new CreativeProposalError(stage,failures.join("；"),attemptsLog.length,failures);
  };
  const mvRepairHintZh=purpose==="mv"?"sections 逐条照抄 sourceEvidence.sections 的 startSec/endSec/labelZh/heardZh/emotion，不追加占位段、全曲段、零长段或任何 endSec≤startSec 的段；uncertaintiesZh 必须是字符串数组且字段名严格按合同；concepts 是恰好 4 个元素的 JSON 数组且 id 唯一；每个 plan 的 shots 从 0 连续无缝覆盖到歌曲时长，每镜 0.5 至 15 秒（超过 15 秒的镜头拆成两镜），singing 至少 4 秒并带人物参考下标；非 footage 镜头不得出现 sourceClip。":"字段名、类型与数量严格按合同。";
  const composed=await runHopChain("compose",save,
    (hop,hopSave,repair)=>deps.compose(repair?instructions+`\n上一版方案未通过服务端校验：${repair.reasonZh}。请基于同一份 sourceEvidence 逐条修正上述问题后重新输出完整 JSON（不得只输出解释或声称已修好）：${mvRepairHintZh}`:instructions,repair?{...composeInput,repair}:composeInput,hopSave,hop),
    async(decoded,_hopSave,stageName)=>validateDraft(await prepareCandidate(decoded,stageName)),
  );
  let proposal=composed.value;
  await save("glm-draft-validated",{proposal,model:composed.model,hop:composed.hop,creativeLibrary});
  const draft=proposal;
  const refineInput={sourceTaskId:evidenceId,durationSec:target.audio?.durationSec,mediaKind:(videoReport?"video":media?"audio":"none") as "video"|"audio"|"none",sourceEvidence:{media:sourceEvidence,creativeLibrary,...("originalBrief" in target?{originalBrief:target.originalBrief}:{})},candidate:draft,requirements:question+("originalBrief" in target&&target.originalBrief?"\n本次只优化音乐提示词，逐字符保留sourceEvidence.originalBrief的歌词、标题、演唱类型和完整版时长；不得改写歌词。":"")+(purpose==="mv"?"\n"+MUSIC_MV_HARD_CONSTRAINTS_ZH:"")};
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
      (hop,hopSave,repair)=>deps.refine(repair?{...input,requirements:input.requirements+`\n上一版联合创作结果未通过服务端校验：${repair.reasonZh}。请在 candidate 结构内修正后重新输出完整 JSON {proposal,review,changesZh}：sections 与 candidate.sections 完全一致，不追加占位段或零长段；${mvRepairHintZh}`}:input,composed.model,hopSave,hop),
      async(decoded,_hopSave,stageName,model,inputSha256)=>{
        const envelope=parseRefinementEnvelope(decoded,input,{model,inputSha256:inputSha256||"",draftModel:composed.model});
        const candidate=await prepareCandidate(envelope.proposal,stageName);
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
  const review=refinement.review;
  const answer={...proposal,evidenceId,review};
  await save("accepted",{target,proposal:answer,sourceEvidence,creativeLibrary,receipt,model:review.model,draftModel:composed.model,hopsUsed,mediaModel:target.audio?MANHUA_BGM_ADVISOR_MODEL:undefined,audioTokens});
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

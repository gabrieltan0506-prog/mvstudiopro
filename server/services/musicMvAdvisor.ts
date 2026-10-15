import { MUSIC_EMOTION_INSTRUCTIONS, assertNewMusicEmotionCoverage } from "../../shared/musicEmotion";
import { askManhuaFilmReview } from "./manhuaAdvisorFilmReview";
import { advisorFilmReviewSchema } from "../../shared/manhuaAdvisorFilmReview";
import { refineCreativeProposal } from "./creativeAstraRefinement";
import { composeCreativeJson } from "./creativeGlmComposer";
import { readCreativeLibraryContext, assertCreativeSelections, CREATIVE_LIBRARY_SELECTION_INSTRUCTIONS } from "./creativeLibraryRetrieval";
import { creativeLearningTargetSchema, creativeLearningReportSchema, assertCreativeMethodEvidence, CREATIVE_LEARNING_INSTRUCTIONS, type CreativeLearningTarget } from "../../shared/creativeGenerationLibrary";
import { parseCreativeAudioEvidence, CREATIVE_AUDIO_READ_INSTRUCTIONS } from "../../shared/creativeMediaEvidence";
import { SUNO_SONG_CRAFT } from "../../shared/sunoSongCraft";
import {
  sunoSongTargetSchema,
  parseSunoSongProposal,
  type SunoSongTarget,
} from "../../shared/canvasMusicMv";
import { createHash, randomUUID } from "node:crypto";
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
  parseMusicMvAdvisorProposal,
  type MusicMvAdvisorTarget,
} from "../../shared/canvasMusicMv";
import { MUSIC_MV_ADVISOR_INSTRUCTIONS } from "../../shared/musicMvCraft";

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
  refine: refineCreativeProposal,
  compose: composeCreativeJson,
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
    sourceEvidence=parseCreativeAudioEvidence(decoded,target.sourceKey,target.audio!.durationSec);
  }
  const creativeLibrary=purpose==="learn"?undefined:await deps.readKnowledge(userId,question+"\n"+("requirements" in target?target.requirements:target.creativePrompt),"craftIds" in target?target.craftIds:[]);
  const instructions=purpose==="learn"?CREATIVE_LEARNING_INSTRUCTIONS:(purpose==="song"?SUNO_SONG_CRAFT:MUSIC_MV_ADVISOR_INSTRUCTIONS)+"\n"+MUSIC_EMOTION_INSTRUCTIONS+(purpose==="song"?"\n"+CREATIVE_LIBRARY_SELECTION_INSTRUCTIONS:"");
  const composed=await deps.compose(instructions,{sourceKey:target.sourceKey,target,question,sourceEvidence,creativeLibrary},save);
  let proposal=purpose==="learn"?creativeLearningReportSchema.parse(composed.decoded):purpose==="song"?parseSunoSongProposal(composed.decoded,target as SunoSongTarget):parseMusicMvAdvisorProposal(composed.decoded,target as MusicMvAdvisorTarget);
  if(proposal.kind==="creative_learning_v1"){
    if(proposal.sourceKey!==target.sourceKey)throw Error("学习结果来源版本不一致");
    assertCreativeMethodEvidence(proposal,sourceEvidence);
  }else{
    assertNewMusicEmotionCoverage(proposal);
    if(proposal.kind==="suno_song_v1"){
      if(proposal.concepts.length!==3)throw Error("新歌曲方案必须包含3个不同曲风demo");
      if(proposal.concepts.some(c=>!c.lyricMethodZh?.trim()||!c.mvDirectionZh?.trim()))throw Error("新歌方案缺少写词方法或MV方向，原始响应已保留");
      assertCreativeSelections(proposal,creativeLibrary!);
    }
  }
  await save("glm-draft-validated",{proposal,model:composed.model,creativeLibrary});
  const draft=proposal;
  const refinement=await deps.refine({sourceTaskId:evidenceId,durationSec:target.audio?.durationSec,mediaKind:videoReport?"video":media?"audio":"none",sourceEvidence:{media:sourceEvidence,creativeLibrary},candidate:draft,requirements:question},composed.model,save);
  proposal=purpose==="learn"?creativeLearningReportSchema.parse(refinement.proposal):purpose==="song"?parseSunoSongProposal(refinement.proposal,target as SunoSongTarget):parseMusicMvAdvisorProposal(refinement.proposal,target as MusicMvAdvisorTarget);
  if(proposal.kind==="creative_learning_v1"){
    if(proposal.sourceKey!==target.sourceKey)throw Error("联合创作学习来源不一致");
    assertCreativeMethodEvidence(proposal,sourceEvidence);
  }else{
    assertNewMusicEmotionCoverage(proposal);
    if("sections" in draft && JSON.stringify(proposal.sections)!==JSON.stringify(draft.sections))throw Error("联合创作不得改写媒体观察区间和证据");
    if(proposal.kind==="suno_song_v1"){
      if(proposal.concepts.length!==3 || proposal.concepts.some(c=>!c.lyricMethodZh?.trim()||!c.mvDirectionZh?.trim()))throw Error("联合创作缺少三种曲风或创作方法");
      assertCreativeSelections(proposal,creativeLibrary!);
    }
  }
  const review=refinement.review;
  const answer={...proposal,evidenceId,review};
  await save("accepted",{target,proposal:answer,sourceEvidence,creativeLibrary,receipt,model:review.model,draftModel:composed.model,mediaModel:target.audio?MANHUA_BGM_ADVISOR_MODEL:undefined,audioTokens});
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

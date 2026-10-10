import { z } from "zod";
import { codeMotionProjectSchema } from "../../shared/codeMotion";
import { codeMotionAudioSourceSchema } from "../../shared/codeMotionAudio";
import { adoptCodeMotionSoundWithMeasuredDuration } from "../../shared/codeMotionSoundAdoption";
import { adoptCodeMotionSound, getCodeMotionSound } from "./codeMotionSound";
import { codeMotionStorage, loadCodeMotion, saveCodeMotion, type CodeMotionStoreDeps } from "./codeMotionStore";
import {
  getCodeMotionProductionGrant, assertCodeMotionProductionSlot,
  beginCodeMotionSpeechRebase, completeCodeMotionSpeechRebase,
  codeMotionProductionDigest, codeMotionProductionFingerprint,
  type CodeMotionProductionGrantDeps,
} from "./codeMotionProductionGrant";

const journalSchema = z.object({
  userId: z.string(), projectId: z.string().uuid(), requestId: z.string().uuid(), variantIndex: z.number().int(),
  id: z.string(), beforeDigest: z.string(), target: codeMotionProjectSchema,
  source: codeMotionAudioSourceSchema, extendedBy: z.number(),
  grantId: z.string().uuid().optional(), fromFingerprint: z.string(), toFingerprint: z.string(),
}).strict();
export type CodeMotionSoundAdoptionDeps = {
  storage: CodeMotionStoreDeps;
  adopt: typeof adoptCodeMotionSound;
  sound: typeof getCodeMotionSound;
  grant?: CodeMotionProductionGrantDeps;
};
const real: CodeMotionSoundAdoptionDeps = {storage:codeMotionStorage, adopt:adoptCodeMotionSound, sound:getCodeMotionSound};
type Input = {projectId:string;requestId:string;variantIndex:number;expectedGeneration:string};
function notSubmitted(message:string):never {
  throw new Error(`SOUND_ADOPTION_NOT_COMMITTED:${message}`);
}

/** Product-owned adoption/save transaction with a permanent journal and recoverable grant CAS. */
export async function adoptAndSaveCodeMotionSound(userId:string,input:Input,deps=real) {
  if (!/^[1-9]\d*$/.test(userId)) throw new Error("请重新登录");
  z.string().uuid().parse(input.projectId); z.string().uuid().parse(input.requestId);
  z.number().int().min(0).max(10).parse(input.variantIndex);
  const key=`code-motion/u${userId}/sound-adoptions/${input.projectId}/${input.requestId}-${input.variantIndex}.json`;
  const old=await deps.storage.read(key);
  let journal=old ? journalSchema.parse(JSON.parse(old.body.toString())) : null;
  let saved=await loadCodeMotion(userId,input.projectId,deps.storage);
  if(!saved) throw new Error("作品不存在");
  if(journal && (journal.userId!==userId || journal.projectId!==input.projectId || journal.requestId!==input.requestId || journal.variantIndex!==input.variantIndex))
    throw new Error("音源采用身份不一致");
  if(!journal) {
    if(saved.generation!==input.expectedGeneration) notSubmitted("作品版本已变化，请先恢复云端作品");
    const sound=await deps.sound(userId,input.projectId,input.requestId);
    const source=await deps.adopt(userId,input.projectId,input.requestId,input.variantIndex);
    let adopted:ReturnType<typeof adoptCodeMotionSoundWithMeasuredDuration>;
    try { adopted=adoptCodeMotionSoundWithMeasuredDuration(saved.project,source); }
    catch(error) { notSubmitted(error instanceof Error ? error.message : "音源无法采用"); }
    const parsed=codeMotionProjectSchema.safeParse(adopted.project);
    if(!parsed.success) notSubmitted("延长后的作品超出当前编排能力，原音源已保留");
    const target=parsed.data;
    const grant=await getCodeMotionProductionGrant(userId,input.projectId,undefined,deps.grant);
    const fromFingerprint=codeMotionProductionFingerprint(saved.project);
    if(grant && grant.fingerprint!==fromFingerprint)
      notSubmitted("已保存分镜偏离原制作，请恢复原版本后采用；原音源未丢失");
    if(adopted.extendedBy && grant) {
      if(grant.revision || Object.keys(grant.slots).some(k=>k.startsWith("video:") || k.startsWith("export:")))
        notSubmitted("已有视频或导出任务，不能移动已确认镜窗；已生成音图仍保留");
      if(!sound.productionSlot || sound.productionSlot.grantId!==grant.id || sound.productionSlot.kind!=="speech")
        notSubmitted("此音源没有原制作的语音授权，未改变镜窗");
      await assertCodeMotionProductionSlot(userId,sound.productionSlot,deps.grant);
      if(target.brief.duration>60) notSubmitted("配音延长后超过本批制作60秒能力，音源已保留，未占新名额");
      const scene=target.plan!.scenes[source.generated!.sceneIndex!];
      if((scene.speech?.role==="dialogue" || scene.production?.motion==="natural") && scene.duration>(grant.tier==="free"?5:30))
        notSubmitted(`配音长于${grant.tier==="free"?"免费5":"付费30"}秒模型镜头上限；原音源已保留，未重新生成`);
    }
    const toFingerprint=codeMotionProductionFingerprint(target);
    journal=journalSchema.parse({userId,projectId:input.projectId,requestId:input.requestId,variantIndex:input.variantIndex,
      id:codeMotionProductionDigest({source:source.id,fromFingerprint,toFingerprint}),
      beforeDigest:codeMotionProductionDigest(saved.project),target,source,extendedBy:adopted.extendedBy,
      ...(grant ? {grantId:grant.id}:{}),fromFingerprint,toFingerprint});
    try { await deps.storage.write(key,Buffer.from(JSON.stringify(journal)),"0"); }
    catch(error) {
      const winner=await deps.storage.read(key);
      if(!winner) throw error;
      const value=journalSchema.parse(JSON.parse(winner.body.toString()));
      if(codeMotionProductionDigest(value)!==codeMotionProductionDigest(journal)) throw error;
      journal=value;
    }
  }
  const targetDigest=codeMotionProductionDigest(journal.target);
  const currentDigest=codeMotionProductionDigest(saved.project);
  const changesDuration=journal.fromFingerprint!==journal.toFingerprint;
  if(currentDigest!==targetDigest && currentDigest!==journal.beforeDigest) {
    const currentGrant=journal.grantId ? await getCodeMotionProductionGrant(userId,input.projectId,journal.grantId,deps.grant) : null;
    const existing=saved.project.brief.audios?.find(a=>a.id===journal.source.id);
    if(!currentGrant?.speechRebase && existing && codeMotionProductionDigest(existing)===codeMotionProductionDigest(journal.source)) {
      // A later sound/image adoption may have advanced the project; never restore an old snapshot over it.
      const candidate=adoptCodeMotionSoundWithMeasuredDuration(saved.project,journal.source);
      const expectedClip=candidate.project.plan!.audioTimeline!.find(c=>c.sourceId===journal.source.id);
      const currentClip=saved.project.plan?.audioTimeline?.find(c=>c.sourceId===journal.source.id);
      if(candidate.extendedBy===0 && codeMotionProductionDigest(currentClip)===codeMotionProductionDigest(expectedClip))
        return {source:journal.source,saved,extendedBy:0};
    }
    throw new Error("另一个窗口已修改作品；本次音源采用记录已保留，未覆盖任何版本");
  }
  if(journal.grantId && changesDuration) {
    const grant=await getCodeMotionProductionGrant(userId,input.projectId,journal.grantId,deps.grant);
    if(!grant) throw new Error("原制作授权不存在");
    if(grant.fingerprint!==journal.toFingerprint || grant.speechRebase)
      await beginCodeMotionSpeechRebase(userId,input.projectId,journal.grantId,{
        journalId:journal.id,fromFingerprint:journal.fromFingerprint,toFingerprint:journal.toFingerprint,duration:journal.target.brief.duration,
      },deps.grant);
  }
  if(currentDigest!==targetDigest)
    saved=await saveCodeMotion(userId,journal.target,saved.generation,deps.storage);
  if(journal.grantId && changesDuration)
    await completeCodeMotionSpeechRebase(userId,input.projectId,journal.grantId,journal.id,deps.grant);
  return {source:journal.source,saved,extendedBy:journal.extendedBy};
}

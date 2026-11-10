import { randomUUID } from "node:crypto";
import { advisorFilmReviewSchema, type AdvisorFilmReviewTarget } from "../../shared/manhuaAdvisorFilmReview";
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";
import { uploadBufferToGcs, statGcsObjectVersion, signGsUriV4ReadUrl } from "./gcs";
import { resolveGeminiModel, type GeminiModelEnv } from "../../shared/geminiModelConfig";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildFilmReviewNativeRequest, type FilmReviewContinuityContext } from "./manhuaFilmReviewNativeContract";
import { assertNativeDeepReadRequiredSegmentEvidence, evaluateNativeDeepReadSegmentAcceptance, parseJsonObject } from "./manhuaNativeDeepReadRunner";
/** 1110 不写死：MANHUA_ADVISOR_WATCH_MODEL → GEMINI_DEFAULT_MODEL → gemini-3.8-flash（每次调用现读 env）。 */
export function resolveManhuaAdvisorWatchModel(env?: GeminiModelEnv): string {
  return resolveGeminiModel("manhuaAdvisorWatch", env);
}
/** 证据只记 gs://：EvoLink 跳发送时才把 fileData.fileUri 换成签名 https，换出的请求体不落档。 */
function withFileUri(request: { contents: unknown[] } & Record<string, unknown>, fileUri: string) {
  const copy = structuredClone(request) as { contents: Array<{ parts: Array<{ fileData?: { fileUri: string } }> }> } & Record<string, unknown>;
  for (const content of copy.contents) for (const part of content.parts) if (part.fileData) part.fileData.fileUri = fileUri;
  return copy;
}
class FilmReviewFatal extends Error {}
export async function resolveAdvisorFilmSource(input: { userId: string; source: string }, deps = {
  resolve: resolveRegisteredPostProdMediaSource,
  loadCanvas: async (userId: number) => (await import("./canvasVideoTask")).loadSucceededCanvasVideoOutputObjects(userId),
}) {
  try { return await deps.resolve(input); }
  catch (error) {
    if (!(error instanceof Error) || error.message !== "素材尚未登记,请从画布/成片里重新选择站内素材") throw error;
    // Canvas video tasks have their own server-owned store, separate from jobs.
    // Match only this user's succeeded output; never trust client block URLs alone.
    const userId = Number(input.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) throw error;
    const objects = await deps.loadCanvas(userId);
    return deps.resolve(input, undefined, { jobObjects: objects });
  }
}
const defaults = {
  resolve: resolveAdvisorFilmSource,
  post: async (body: unknown, model: string) => {
    const { postVertexNativeDeepRead } = await import("./manhuaNativeDeepReadRunner");
    return postVertexNativeDeepRead(body, undefined, undefined, model);
  },
  /** 1110 第二跳：EvoLink 同构 generateContent，只收签名 https（读不了 gs://）。 */
  postEvolink: async (body: unknown, model: string) => {
    const { postEvolinkNativeDeepRead } = await import("./manhuaNativeDeepReadRunner");
    return postEvolinkNativeDeepRead(body, undefined, undefined, model);
  },
  sign: (uri: string) => signGsUriV4ReadUrl(uri, 3600),
  save: uploadBufferToGcs,
  inspect: (uri:string) => statGcsObjectVersion({gcsUri:uri,signal:AbortSignal.timeout(30000)}),
  probe: async (uri:string) => {
    let raw;
    try { const result=await promisify(execFile)("ffprobe",["-v","error","-show_format","-show_streams","-of","json",signGsUriV4ReadUrl(uri)],{timeout:120000,maxBuffer:4*1024*1024});raw=JSON.parse(result.stdout); }
    catch { throw new Error("影片元资料读取失败；未提交审片，未暴露签名链接"); }
    if(!raw.streams?.some((s:{codec_type:string})=>s.codec_type==="video")) throw new Error("没有视频轨道");
    const durationSec=Number(raw.format?.duration);
    if(!Number.isFinite(durationSec)||durationSec<=0) throw new Error("影片时长无效");
    return {durationSec,audioStreams:raw.streams.filter((s:{codec_type:string})=>s.codec_type==="audio")};
  },
  count: async (contents:unknown[], model:string) => {
    const {getVertexAuthHeaders,getVertexProjectId,baseUrlForVertex}=await import("./vertexMedia");
    const response=await fetch(`${baseUrlForVertex("global")}/v1/projects/${encodeURIComponent(getVertexProjectId())}/locations/global/publishers/google/models/${encodeURIComponent(model)}:countTokens`,{method:"POST",headers:await getVertexAuthHeaders(),body:JSON.stringify({contents}),signal:AbortSignal.timeout(120000)});
    if(!response.ok) throw new Error(`审片预检返回${response.status}，未生成`);
    const result=await response.json();if(!Number.isFinite(result.totalTokens)||result.totalTokens<=0) throw new Error("审片预检token数量无效");return result;
  },
};
/** Reuse the native learning contract for owned-media review; no learning-library writes. */
export async function askManhuaFilmReview(userId: number, target: AdvisorFilmReviewTarget, question: string, deps = defaults, continuity?: FilmReviewContinuityContext, craftReference?: string) {
  const uri=await deps.resolve({userId:String(userId),source:target.videoUri});
  if(!uri.startsWith("gs://")) throw new Error("请先将影片登记到作品云素材；本次未发送影片或降级成文字审片");
  const model=resolveManhuaAdvisorWatchModel();
  const evidence=`manhua-film-review/${userId}/${randomUUID()}`;
  const save=(name:string,value:unknown)=>deps.save({objectName:`${evidence}/${name}.json`,buffer:Buffer.from(JSON.stringify(value)),contentType:"application/json"});
  const receipt:Record<string,unknown>={status:"preparing",contract:"native_learning_plus_film_review",requestedModel:model,route:"vertex_existing_gcs_video",uploaded:false,retries:0,generationAttempted:false,actualSamplingFps:null,requestedSamplingFps:12,cloudCostUsd:null,cost:{status:"pricing_not_verified",meaning:"Token usage is not an invoice; administrator credits are not provider cost."}};
  try {
    const source=await deps.inspect(uri); const media=await deps.probe(uri);
    if(target.expectedDurationSec !== undefined && Math.abs(media.durationSec-target.expectedDurationSec)>0.1) throw new FilmReviewFatal("影片实际时长与所选版本不一致，未提交读片");
    const request=buildFilmReviewNativeRequest({uri,durationSec:media.durationSec,hasAudio:media.audioStreams.length>0,question,continuity,craftReference});
    receipt.sourceGeneration=source.generation;
    await save("plan",{source:{uri,generation:source.generation},media,requestedSamplingFps:12,maxOutputTokens:65536});
    await save("request",request);
    // 1110 两跳（用户口径：Gemini 只走 Vertex → EvoLink）：Vertex 读 gs:// → EvoLink 读签名 https；
    // 预检失败/HTTP 错/断线超时/未完整结束/写坏（解析、门禁、契约不过）都换下一跳；每跳 raw/analysis/validation 分别永久存档，不覆盖。
    const hops=[
      {name:"Vertex",slug:"hop-1-vertex",route:"vertex_existing_gcs_video",run:async()=>{receipt.countTokenReceipt=await deps.count(request.contents,model);return deps.post(request,model);}},
      {name:"EvoLink",slug:"hop-2-evolink",route:"evolink_signed_https_video",run:async()=>{
        const signed=deps.sign(uri);
        if(!/^https:\/\//.test(signed)) throw new Error("EvoLink 只收签名 https 媒体链接");
        return deps.postEvolink(withFileUri(request,signed),model);
      }},
    ] as const;
    const failures:string[]=[];
    for (const [index,hop] of hops.entries()) {
      try {
        if(index>0) receipt.retries=index;
        receipt.route=hop.route;receipt.channel=hop.name;
        await save(`${hop.slug}-request`,{channel:hop.name,model,mediaGsUri:uri,bodyObject:"request.json",noteZh:hop.name==="EvoLink"?"发送时 fileUri 换成 V4 签名 https（3600 秒），签名链接不入档":"fileUri 即 gs://"});
        const current=await deps.inspect(uri);
        if(current.generation!==source.generation) throw new FilmReviewFatal("影片版本已变化；未提交模型，请重新选择影片");
        receipt.status="generation_started";receipt.generationAttempted=true;await save("receipt",receipt);
        const response=await hop.run();
        await save(`${hop.slug}-raw`,{channel:hop.name,model,target,response});
        receipt.httpStatus=response.status;
        if(response.status<200||response.status>=300) throw new Error(`${hop.name}影片审阅返回${response.status}`);
        const envelope=JSON.parse(response.text);receipt.usageMetadata=envelope.usageMetadata??null;receipt.reportedModelVersion=envelope.modelVersion??null;
        const details=envelope.usageMetadata?.promptTokensDetails;
        receipt.providerReportedAudioInputTokens=Array.isArray(details)?details.filter((d:{modality:string})=>d.modality==="AUDIO").reduce((n:number,d:{tokenCount:number})=>n+Number(d.tokenCount||0),0):null;
        receipt.status="response_received";await save("receipt",receipt);
        if(envelope.modelVersion&&!envelope.modelVersion.startsWith(model)) throw new Error("审片返回模型不符；原始结果已保留");
        const candidate=envelope.candidates?.[0];if(candidate?.finishReason!=="STOP") throw new Error("审片回答未完整结束；原始结果已保留");
        const analysis=parseJsonObject(candidate.content.parts.filter((p:{thought?:boolean;text?:string})=>!p.thought&&typeof p.text==="string").map((p:{text:string})=>p.text).join(""));
        await save(`${hop.slug}-analysis`,{analysis});
        const gateInput={episodeIndex:0,segmentIndex:0,startSec:0,endSec:media.durationSec,hasAudio:media.audioStreams.length>0,raw:structuredClone(analysis),requireShotObservations:true,requireShotDetailLevels:true};
        assertNativeDeepReadRequiredSegmentEvidence(gateInput);
        const validation=evaluateNativeDeepReadSegmentAcceptance(gateInput);
        await save(`${hop.slug}-validation`,validation);
        if(validation.retry) throw new Error("原生学习链路审片校验未通过；完整结果已保留");
        const review=analysis.filmReview;
        if(!review||typeof review!=="object"||Array.isArray(review))throw new Error("缺少审片结果；原始证据已保留");
        const continuityLimit = "跨集核对范围：本次只读取当前影片；其他集如有提供，仅为保存正文与任务/采用身份，未读取其成片音画，不能据此确认前集实际表现。";
        const limitations = (review as Record<string, unknown>).limitations;
        if (typeof limitations !== "string" || !limitations.length || limitations.length > 1500)
          throw new Error("审片限制说明无效；原始证据已保留");
        const report=advisorFilmReviewSchema.parse({...review,limitations: limitations + "\n" + continuityLimit,kind:"film_review_v1",nativeEvidence:{analysis,sourceGeneration:source.generation,audioTokens:receipt.providerReportedAudioInputTokens}});
        if(report.findings.some(f=>f.endSec>media.durationSec))throw new Error("审片建议时间超出原片；原始证据已保留");
        await save("report",{model,channel:hop.name,failuresZh:failures,target,report});receipt.status="completed";await save("receipt",receipt);
        const answer=JSON.stringify(report);
        return JSON.stringify({answer,imageIntent:false,creationRelated:false,suggestedImagePrompt:"",guideMessage:""});
      } catch(error) {
        if(error instanceof FilmReviewFatal) throw error;
        const reason=error instanceof Error?(error.name==="TimeoutError"?"请求超时":error.message.slice(0,300)):String(error);
        failures.push(`${hop.name}（${reason}）`);
        await save(`${hop.slug}-rejected`,{channel:hop.name,model,reasonZh:reason});
      }
    }
    throw new Error(`影片审阅全部通道失败：${failures.join("；")}；原始证据已保留，未降级为文字审片`);
  } catch(error) {receipt.status="failed";receipt.error=error instanceof Error?error.message:"审片失败";receipt.noAutomaticRetry=true;await save("receipt",receipt);throw error;}
}

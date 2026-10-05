import { randomUUID } from "node:crypto";
import { advisorFilmReviewSchema, type AdvisorFilmReviewTarget } from "../../shared/manhuaAdvisorFilmReview";
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";
import { uploadBufferToGcs, statGcsObjectVersion, signGsUriV4ReadUrl } from "./gcs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildRequest, validateAnalysis, type Analysis } from "./videoObserver/contract.mjs";
const MODEL = "gemini-3.8-flash";
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
  post: async (body: unknown) => {
    const { postVertexNativeDeepRead } = await import("./manhuaNativeDeepReadRunner");
    return postVertexNativeDeepRead(body, undefined, undefined, MODEL);
  },
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
  count: async (contents:unknown[]) => {
    const {getVertexAuthHeaders,getVertexProjectId,baseUrlForVertex}=await import("./vertexMedia");
    const response=await fetch(`${baseUrlForVertex("global")}/v1/projects/${encodeURIComponent(getVertexProjectId())}/locations/global/publishers/google/models/${MODEL}:countTokens`,{method:"POST",headers:await getVertexAuthHeaders(),body:JSON.stringify({contents}),signal:AbortSignal.timeout(120000)});
    if(!response.ok) throw new Error(`审片预检返回${response.status}，未生成`);
    const result=await response.json();if(!Number.isFinite(result.totalTokens)||result.totalTokens<=0) throw new Error("审片预检token数量无效");return result;
  },
};
/** Observer contract adapted to owned media and existing advisor jobs; no learning-library writes. */
export async function askManhuaFilmReview(userId: number, target: AdvisorFilmReviewTarget, question: string, deps = defaults) {
  const uri=await deps.resolve({userId:String(userId),source:target.videoUri});
  if(!uri.startsWith("gs://")) throw new Error("请先将影片登记到作品云素材；本次未发送影片或降级成文字审片");
  const evidence=`manhua-film-review/${userId}/${randomUUID()}`;
  const save=(name:string,value:unknown)=>deps.save({objectName:`${evidence}/${name}.json`,buffer:Buffer.from(JSON.stringify(value)),contentType:"application/json"});
  const receipt:Record<string,unknown>={status:"preparing",requestedModel:MODEL,route:"vertex_existing_gcs_video",uploaded:false,retries:0,generationAttempted:false,actualSamplingFps:null,requestedSamplingFps:12,cloudCostUsd:null,cost:{status:"pricing_not_verified",meaning:"Token usage is not an invoice; administrator credits are not provider cost."}};
  try {
    const source=await deps.inspect(uri); const media=await deps.probe(uri);
    const plan={media,requestedSamplingFps:12,maxOutputTokens:16000,context:question};
    const request=buildRequest(plan,uri);
    // Role guidance augments the observer evidence contract, never replaces it.
    Object.assign(request,{systemInstruction:{parts:[{text:"你是影片监制。结合实际音画评估构图、灯光氛围、妆造、人物关系与表演、对白逻辑、音效混音、节奏和视觉冲击力。保留亮点，给出最小可执行修改。遵循音画证据结构；无法辨认不等于无音轨，不用用户描述代替观察。"}]}});
    receipt.sourceGeneration=source.generation;
    await save("plan",{source:{uri,generation:source.generation},media,requestedSamplingFps:12,maxOutputTokens:16000});
    receipt.countTokenReceipt=await deps.count(request.contents);
    const current=await deps.inspect(uri);
    if(current.generation!==source.generation) throw new Error("影片版本已变化；未提交模型，请重新选择影片");
    receipt.status="generation_started";receipt.generationAttempted=true;await save("receipt",receipt);
    const response=await deps.post(request);
    await save("raw",{model:MODEL,target,response});
    receipt.httpStatus=response.status;
    if(response.status<200||response.status>=300) throw new Error(`Vertex影片审阅返回${response.status}，未重试、未切换文字模型`);
    const envelope=JSON.parse(response.text);receipt.usageMetadata=envelope.usageMetadata??null;receipt.reportedModelVersion=envelope.modelVersion??null;
    const details=envelope.usageMetadata?.promptTokensDetails;
    receipt.providerReportedAudioInputTokens=Array.isArray(details)?details.filter((d:{modality:string})=>d.modality==="AUDIO").reduce((n:number,d:{tokenCount:number})=>n+Number(d.tokenCount||0),0):null;
    receipt.status="response_received";await save("receipt",receipt);
    if(envelope.modelVersion&&!envelope.modelVersion.startsWith(MODEL)) throw new Error("审片返回模型不符；原始结果已保留");
    const candidate=envelope.candidates?.[0];if(candidate?.finishReason!=="STOP") throw new Error("审片回答未完整结束；原始结果已保留，不自动重投");
    const analysis:Analysis=JSON.parse(candidate.content.parts.filter((p:{thought?:boolean;text?:string})=>!p.thought&&typeof p.text==="string").map((p:{text:string})=>p.text).join(""));
    const validation=validateAnalysis(analysis,media);
    await save("analysis",{analysis,validation});
    // Existing UI projection only; the complete observer evidence remains saved above.
    const report=advisorFilmReviewSchema.parse({kind:"film_review_v1",summary:analysis.summaryZh,findings:analysis.findings.map(f=>({atSec:f.atSec,endSec:f.atSec,category:f.modality==="audio"?"声音":"场景",observation:`${f.issueZh}：${f.evidenceZh}`,suggestion:f.suggestionZh,confidence:f.status==="observed"?"明确":"需人工核对"})),limitations:`请求12fps，实际采样率未获供应商确认。音画区间覆盖仅是结构校验，不代表感知准确。${validation.warnings.join("；")} AUDIO tokens：${receipt.providerReportedAudioInputTokens??"未回报"}。`,observerEvidence:{analysis,validation,sourceGeneration:source.generation,audioTokens:receipt.providerReportedAudioInputTokens}});
    await save("report",{model:MODEL,target,report});receipt.status="completed";await save("receipt",receipt);
    const answer=JSON.stringify(report);
    return JSON.stringify({answer,imageIntent:false,creationRelated:false,suggestedImagePrompt:"",guideMessage:""});
  } catch(error) {receipt.status="failed";receipt.error=error instanceof Error?error.message:"审片失败";receipt.noAutomaticRetry=true;await save("receipt",receipt);throw error;}
}

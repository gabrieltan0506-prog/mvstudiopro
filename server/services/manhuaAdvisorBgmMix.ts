import { createHash, randomUUID } from "node:crypto";
import { inspectGcsObjectBounded, uploadBufferToGcs } from "./gcs";
import { resolvePostProdInputSources } from "./postProdMediaSource";
import { buildGeminiApiClient } from "./gemini35FlashRuntime";
import { ADVISOR_BGM_MIX_INSTRUCTIONS, parseAdvisorBgmMixPlan, type AdvisorBgmMixTarget } from "../../shared/manhuaAdvisorBgmMix";
import type { Message } from "../_core/llm";

export const MANHUA_BGM_ADVISOR_MODEL = "gemini-3.8-flash";
async function readMedia(gcsUri: string, maxBytes: number) {
  if (!gcsUri.startsWith("gs://")) throw new Error("顾问音画分析需要已登记的长期素材，不能降级为仅文字分析");
  const chunks: Buffer[]=[];
  await inspectGcsObjectBounded({gcsUri,maxBytes,timeoutMs:30_000,onChunk:chunk=>chunks.push(Buffer.from(chunk))});
  return Buffer.concat(chunks);
}
export async function generateGeminiBgmAnalysis(input: Parameters<ReturnType<typeof buildGeminiApiClient>["models"]["generateContent"]>[0]) {
  const client = buildGeminiApiClient();
  const contents = input.contents as Array<{role:string;parts:Array<{text?:string;inlineData?:{mimeType:string;data:string};fileData?:{mimeType:string;fileUri:string}}>}>;
  const inlineBytes = contents.flatMap(content=>content.parts).reduce((sum,part)=>sum+(part.inlineData ? Buffer.byteLength(part.inlineData.data,"base64") : 0),0);
  const uploadedNames:string[]=[];
  try {
    // 大于行内请求容量时仍发送完整素材，使用Google文件接口，不抽帧或删音频。
    if (inlineBytes > 18*1024*1024) for (const content of contents) for (const part of content.parts) {
      if (!part.inlineData) continue;
      const {mimeType,data}=part.inlineData;
      const bytes=Buffer.from(data,"base64");
      let file=await client.files.upload({file:new Blob([new Uint8Array(bytes)],{type:mimeType}),config:{mimeType}});
      if (!file.name) throw new Error("Gemini素材上传无回执");
      uploadedNames.push(file.name);
      for (let attempt=0;file.state==="PROCESSING" && attempt<30;attempt++) {
        await new Promise(resolve=>setTimeout(resolve,1000));
        file=await client.files.get({name:file.name!});
      }
      if (file.state!=="ACTIVE" || !file.uri) throw new Error("Gemini音画素材未就绪，未降级分析");
      part.fileData={mimeType,fileUri:file.uri}; delete part.inlineData;
    }
    return await client.models.generateContent(input);
  } finally {
    for (const name of uploadedNames) {
      try {await client.files.delete({name});} catch {console.warn("[manhuaBgmAdvisor] 临时分析素材清理未确认");}
    }
  }
}
/** 复用顾问原事务与计费；只分析本人实际视频+BGM，不混音，不回落FlashX或纯文字。 */
export async function askManhuaBgmMix(userId: number, target: AdvisorBgmMixTarget, messages: Message[], deps={
  resolve:resolvePostProdInputSources, read:readMedia, generate:generateGeminiBgmAnalysis, save:uploadBufferToGcs,
}) {
  const input = await deps.resolve({userId:String(userId),input:{action:"bgm_mount",params:{videoUri:target.videoUri,bgmUri:target.bgmUri}}});
  if (input.action !== "bgm_mount") throw new Error("配乐来源契约不一致");
  const [video,audio]=await Promise.all([deps.read(input.params.videoUri,64*1024*1024),deps.read(input.params.bgmUri,16*1024*1024)]);
  if (video.length<12 || video.toString("ascii",4,8)!=="ftyp" || audio.length<12) throw new Error("音画素材为空或格式无效，未发起顾问分析");
  const mimeType = audio.toString("ascii",0,4)==="RIFF" && audio.toString("ascii",8,12)==="WAVE" ? "audio/wav"
    : audio.toString("ascii",0,3)==="ID3" || (audio[0]===0xff && (audio[1]&0xe0)===0xe0) ? "audio/mpeg"
    : audio.toString("ascii",4,8)==="ftyp" ? "audio/mp4" : undefined;
  if (!mimeType) throw new Error("已采用配乐文件格式无法识别，未发送给顾问");
  const response=await deps.generate({model:MANHUA_BGM_ADVISOR_MODEL,
    contents:[{role:"user",parts:[
      {text:JSON.stringify({project:messages,target})},
      {inlineData:{mimeType:"video/mp4",data:video.toString("base64")}},
      {inlineData:{mimeType,data:audio.toString("base64")}},
    ]}],config:{systemInstruction:ADVISOR_BGM_MIX_INSTRUCTIONS,responseMimeType:"application/json",maxOutputTokens:8192,httpOptions:{timeout:180_000}}});
  const evidencePrefix = `manhua-bgm-advisor/${userId}/${randomUUID()}`;
  const saveEvidence = async (name: string, value: unknown) => {
    const buffer = Buffer.from(JSON.stringify(value));
    return deps.save({objectName:`${evidencePrefix}/${name}.json`,buffer,contentType:"application/json"});
  };
  // 原始响应先永久落档，解析失败也保留；仅清理Google临时媒体，不清理证据。
  const rawUri = await saveEvidence("raw", response);
  if (!response.text?.trim()) throw new Error("Gemini配乐分析返回为空，未回落其他模型");
  const shell = JSON.parse(response.text);
  const plan = parseAdvisorBgmMixPlan(typeof shell.answer === "string" ? shell.answer : JSON.stringify(shell.answer), target);
  await saveEvidence("parsed", {model:MANHUA_BGM_ADVISOR_MODEL,sourceKey:target.sourceKey,rawUri,rawSha256:createHash("sha256").update(JSON.stringify(response)).digest("hex"),plan});
  return response.text;
}

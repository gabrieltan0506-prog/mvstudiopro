import { randomUUID } from "node:crypto";
import { inspectGcsObjectBounded, signGsUriV4ReadUrl, uploadBufferToGcsIfAbsent } from "./gcs";
import { geminiAudioJsonWithFallback } from "../gemini-audio";
import { resolveGeminiModel, type GeminiModelEnv } from "../../shared/geminiModelConfig";
import { resolvePostProdInputSources } from "./postProdMediaSource";
import { buildGeminiApiClient } from "./gemini35FlashRuntime";
import { ADVISOR_BGM_MIX_INSTRUCTIONS, parseAdvisorBgmMixPlan, type AdvisorBgmMixTarget } from "../../shared/manhuaAdvisorBgmMix";
import type { Message } from "../_core/llm";

/** 1110 不写死：MANHUA_ADVISOR_BGM_MODEL → GEMINI_DEFAULT_MODEL → gemini-3.8-flash（每次调用现读 env）。 */
export function resolveManhuaAdvisorBgmModel(env?: GeminiModelEnv): string {
  return resolveGeminiModel("manhuaAdvisorBgm", env);
}
/** 只流式核对大小、文件头与 SHA-256，不把媒体读进内存、不转 base64。 */
async function inspectMedia(gcsUri: string, maxBytes: number) {
  if (!gcsUri.startsWith("gs://")) throw new Error("顾问音画分析需要已登记的长期素材，不能降级为仅文字分析");
  return inspectGcsObjectBounded({gcsUri,maxBytes,headerBytes:16,timeoutMs:30_000});
}
/**
 * 旧直连密钥 + 内联 base64 / Files API 的多模态调用。1110 起配乐顾问已不用（改走两跳）；
 * 仅 codeMotionTiming 仍引用，待其改造后删除。
 */
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
/**
 * 复用顾问原事务与计费；只分析本人实际视频+BGM，不混音，不回落FlashX或纯文字。
 * 1110 通道合规：geminiAudioJsonWithFallback 两跳（Vertex 读 gs:// → EvoLink 读 V4 签名 https），
 * 成片与 BGM 同一请求送入；不直连 Gemini 密钥、不内联 base64、不传 Files API。超时/断线/HTTP 错/空回/写坏换下一跳；
 * 每跳 request/raw/decoded/parsed/rejected 与最终解析方案分别永久存档（只增不覆盖），证据只记 gs://。
 */
export async function askManhuaBgmMix(userId: number, target: AdvisorBgmMixTarget, messages: Message[], deps={
  resolve:resolvePostProdInputSources, inspect:inspectMedia, listen:geminiAudioJsonWithFallback,
  sign:(gsUri:string)=>signGsUriV4ReadUrl(gsUri,3600), upload:uploadBufferToGcsIfAbsent, uuid:():string=>randomUUID(),
}) {
  const input = await deps.resolve({userId:String(userId),input:{action:"bgm_mount",params:{videoUri:target.videoUri,bgmUri:target.bgmUri}}});
  if (input.action !== "bgm_mount") throw new Error("配乐来源契约不一致");
  const {videoUri,bgmUri}=input.params;
  const [video,audio]=await Promise.all([deps.inspect(videoUri,64*1024*1024),deps.inspect(bgmUri,16*1024*1024)]);
  const vh=video.header, ah=audio.header;
  if (vh.length<12 || vh.toString("ascii",4,8)!=="ftyp" || ah.length<12) throw new Error("音画素材为空或格式无效，未发起顾问分析");
  const mimeType = ah.toString("ascii",0,4)==="RIFF" && ah.toString("ascii",8,12)==="WAVE" ? "audio/wav"
    : ah.toString("ascii",0,3)==="ID3" || (ah[0]===0xff && (ah[1]&0xe0)===0xe0) ? "audio/mpeg"
    : ah.toString("ascii",4,8)==="ftyp" ? "audio/mp4" : undefined;
  if (!mimeType) throw new Error("已采用配乐文件格式无法识别，未发送给顾问");
  const model = resolveManhuaAdvisorBgmModel();
  const prefix = `manhua-bgm-advisor/${userId}/${deps.uuid()}`;
  const save = async (name: string, value: unknown) => {
    const saved = await deps.upload({objectName:`${prefix}/${name}.json`,buffer:Buffer.from(JSON.stringify(value)),contentType:"application/json"});
    if (!saved.created) throw new Error("配乐顾问证据已存在，未覆盖原记录");
    return saved;
  };
  await save("request",{model,sourceKey:target.sourceKey,video:{gsUri:videoUri,sha256:video.sha256,bytes:video.byteLength},bgm:{gsUri:bgmUri,sha256:audio.sha256,bytes:audio.byteLength,mimeType}});
  const result = await deps.listen({
    media:{vertexFileUri:videoUri,evolinkFileUri:()=>deps.sign(videoUri)},
    mimeType:"video/mp4",
    extraMedia:[{mimeType,vertexFileUri:bgmUri,evolinkFileUri:()=>deps.sign(bgmUri)}],
    model,
    systemInstruction:ADVISOR_BGM_MIX_INSTRUCTIONS,
    prompt:JSON.stringify({project:messages,target}),
    schemaName:"bgm_mix_answer",
    maxOutputTokens:8192,
    timeoutMs:180_000,
    // 写坏（非对象外壳、方案不合契约/旧版本/越窗）即抛，交下一跳。
    validate:decoded=>{
      const shell=decoded as Record<string,unknown>;
      if (!shell || typeof shell!=="object" || Array.isArray(shell)) throw new Error("配乐分析外壳不是 JSON 对象");
      const plan=parseAdvisorBgmMixPlan(typeof shell.answer==="string"?shell.answer:JSON.stringify(shell.answer),target);
      return {shell,plan};
    },
    save,
  });
  await save("bgm-mix-parsed",{channel:result.channel,model:result.model,failuresZh:result.failuresZh,sourceKey:target.sourceKey,plan:result.value.plan});
  return JSON.stringify(result.value.shell);
}

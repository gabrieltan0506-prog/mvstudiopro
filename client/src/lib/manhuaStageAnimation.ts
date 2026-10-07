import {previsAnimationFramesSchema,type PrevisStageAnimation} from '@shared/manhuaPrevisAnimation';
import {manhuaPrevisMediaUrl} from './manhuaPrevisMediaUrl';
/** Only owned native task endpoints, then verify both complete bytes against the saved receipt. */
export async function loadPrevisStageAnimation(take:PrevisStageAnimation,signal:AbortSignal) {
  if (!/^prv_[a-f0-9]{48}$/.test(take.jobId) || take.glbUrl!==`/api/manhua-previs-media/${take.jobId}/animation`
    || take.framesUrl!==`/api/manhua-previs-media/${take.jobId}/animation-frames`) throw new Error('动画任务身份不匹配');
  const load=async(url:string,max:number,digest:string)=>{
    const response=await fetch(manhuaPrevisMediaUrl(url),{credentials:'include',signal});
    if(!response.ok)throw new Error('动画读取失败，请查询原任务，勿重新生成');
    if(Number(response.headers.get('content-length'))>max)throw new Error('动画文件超过预览限额');
    if(!response.body)throw new Error('动画文件为空');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new Error('动画文件超过预览限额');chunks.push(value);} }
    finally {await reader.cancel().catch(()=>{});}
    const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',result))).map(n=>n.toString(16).padStart(2,'0')).join('');
    if(hash!==digest)throw new Error('动画摘要不匹配，请保留原任务核对');
    return result;
  };
  const [glb,frames]=await Promise.all([load(take.glbUrl,64*1024*1024,take.sha256),load(take.framesUrl,16*1024*1024,take.framesSha256)]);
  return {glb:glb.buffer,frames:previsAnimationFramesSchema.parse(JSON.parse(new TextDecoder().decode(frames)))};
}

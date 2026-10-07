import { previsAnimationFramesSchema } from '../../shared/manhuaPrevisAnimation';
import type { ManhuaPrevisSpec } from '../../shared/manhuaPrevis';
/** The entire observation array is persisted before this gate; never truncate or repair it. */
export function validatePrevisAnimation(raw: unknown, glb: Buffer, spec: ManhuaPrevisSpec) {
  const result=previsAnimationFramesSchema.parse(raw);
  const [width,height]=spec.aspect==='9:16'?[540,960]:[960,540];
  if (result.width!==width || result.height!==height || result.frames.length!==spec.durationSec*24
    || result.frames.some((row,i)=>row.frame!==i+1 || Math.abs(row.timeSec-i/24)>1e-8
      || Math.abs(Math.hypot(...row.camera.quaternionXYZW)-1)>1e-4)) throw new Error('场景动画逐帧相机证据不完整');
  if (glb.length<20 || glb.length>64*1024*1024 || glb.toString('ascii',0,4)!=='glTF'
    || glb.readUInt32LE(4)!==2 || glb.readUInt32LE(8)!==glb.length
    || glb.readUInt32LE(16)!==0x4e4f534a) throw new Error('场景动画GLB不完整');
  const jsonLength=glb.readUInt32LE(12);
  if (jsonLength>glb.length-20) throw new Error('场景动画GLB结构无效');
  const data=JSON.parse(glb.toString('utf8',20,20+jsonLength));
  if (!Array.isArray(data.animations) || !data.animations.length || !Array.isArray(data.nodes)) throw new Error('场景动画缺少真实动作轨迹');
  const ids=new Set<string>(data.nodes.map((node:any)=>node.extras?.previsObjectId).filter((id:unknown)=>typeof id==='string'));
  if (!ids.size || result.frames.some(row=>row.visibleObjectIds.some(id=>!ids.has(id)))) throw new Error('场景动画网格与可见证据不对应');
  return result;
}

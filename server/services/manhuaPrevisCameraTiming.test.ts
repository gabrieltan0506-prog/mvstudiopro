import {describe,it,expect} from "vitest";
import {createManhuaPrevisStudio,manhuaPrevisSpecSchema,manhuaPrevisStudioSchema} from "../../shared/manhuaPrevis";
import {previsCameraProgress} from "../../shared/manhuaPrevisCameraTiming";
import {validateCameraTimingReport} from "./manhuaPrevisCameraReport";
import {execFileSync} from "node:child_process";

describe("独立运镜与变焦卡点",()=>{
  const fixture=()=>{const s=createManhuaPrevisStudio(4);s.spec.cameras=[{startSec:0,endSec:4,position:[0,-8,1],target:[0,0,1],endPosition:[0,-6,1],lens:28,endLens:55,motionWindow:{startSec:1,endSec:2},lensWindow:{startSec:2.5,endSec:2.75}}];return s;};
  it("草稿和提交保留独立秒窗，拒绝越界、单帧和无对应运动",()=>{
    const s=fixture();expect(manhuaPrevisSpecSchema.safeParse(s.spec).success).toBe(true);
    expect(manhuaPrevisStudioSchema.parse(JSON.parse(JSON.stringify(s))).spec.cameras[0].lensWindow).toEqual({startSec:2.5,endSec:2.75});
    for(const window of [{startSec:2.5,endSec:4.5},{startSec:2,endSec:2+1/24},{startSec:2.01,endSec:3}]){const bad=structuredClone(s.spec);bad.cameras[0].lensWindow=window;expect(manhuaPrevisSpecSchema.safeParse(bad).success).toBe(false);}
    delete s.spec.cameras[0].endLens;expect(manhuaPrevisSpecSchema.safeParse(s.spec).success).toBe(false);
  });
  it("移动先停住，再用6帧短促变焦；Python与提交侧按同一帧界计算",()=>{
    const c=fixture().spec.cameras[0];
    expect(previsCameraProgress(c,24,c.motionWindow)).toBe(0);expect(previsCameraProgress(c,48,c.motionWindow)).toBe(1);
    expect(previsCameraProgress(c,60,c.lensWindow)).toBe(0);expect(previsCameraProgress(c,66,c.lensWindow)).toBe(1);
    const python=JSON.parse(execFileSync("python3",["-c","import sys,json;sys.path.insert(0,'server/scripts');from previs_camera_timing import camera_progress;s=json.loads(sys.argv[1]);print(json.dumps([[camera_progress(s,f),camera_progress(s,f,'lensWindow')] for f in range(1,97)]))",JSON.stringify(c)],{encoding:"utf8"}));
    expect(python).toEqual(Array.from({length:96},(_,i)=>[previsCameraProgress(c,i+1,c.motionWindow),previsCameraProgress(c,i+1,c.lensWindow)]));
  });
  it("真实回执必须体现停顿；旧整镜慢变焦不能冒充短促变焦",()=>{
    const spec=fixture().spec,c=spec.cameras[0];
    const rows=Array.from({length:96},(_,i)=>({frame:i+1,shotIndex:0,position:[0,-8+2*previsCameraProgress(c,i+1,c.motionWindow),1] as [number,number,number],forward:[0,1,0] as [number,number,number],lens:28+27*previsCameraProgress(c,i+1,c.lensWindow)}));
    expect(()=>validateCameraTimingReport(rows,spec)).not.toThrow();
    expect(()=>validateCameraTimingReport(undefined,spec)).toThrow("回执缺失");
    const legacy=rows.map(r=>({...r,lens:28+27*previsCameraProgress(c,r.frame)}));expect(()=>validateCameraTimingReport(legacy,spec)).toThrow("未遵守卡点");
    rows[80].position[1]+=.1;expect(()=>validateCameraTimingReport(rows,spec)).toThrow("未遵守卡点");
  });
});

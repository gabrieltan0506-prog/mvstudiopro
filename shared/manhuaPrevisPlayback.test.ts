import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createManhuaPrevisStudio,manhuaPrevisSpecSchema,manhuaPrevisStudioSchema,formatPrevisMotionGuide} from './manhuaPrevis';
import {previsFocusTimeMap,previsPlaybackDuration,previsPlaybackFilter,previsPresentationGuideSpec} from './manhuaPrevisPlayback';
import {manhuaPresentationToSourceSec} from './manhuaActionPlanTiming';

describe('白模同一时间表实际编码与恢复',()=>{
  it('慢看保持总时长，历史恢复保留映射，采用指引使用呈现秒位',()=>{
    const studio=createManhuaPrevisStudio(10);
    studio.spec.timeMap=previsFocusTimeMap(10,2,4,.5)!;
    studio.spec.actors[0].actions=[{kind:'guard',startSec:2,endSec:4}];
    expect(manhuaPrevisSpecSchema.safeParse(studio.spec).success).toBe(true);
    expect(manhuaPrevisStudioSchema.parse(JSON.parse(JSON.stringify(studio))).spec.timeMap).toEqual(studio.spec.timeMap);
    expect(previsPlaybackDuration(studio.spec)).toBe(10);
    expect(previsPresentationGuideSpec(studio.spec).actors[0].actions[0]).toMatchObject({startSec:1.5,endSec:5.5});
    expect(formatPrevisMotionGuide(studio.spec)).toContain('1.5—5.5秒抬臂保护');
    expect(formatPrevisMotionGuide(studio.spec)).toContain('不重复变速');
  });
  it('拒绝时间缺口、源时长错配、超过30秒和分层错位',()=>{
    const spec=createManhuaPrevisStudio(10).spec;
    const timeMap=previsFocusTimeMap(10,2,4,.5)!;
    for(const patch of [
      {timeMap:{...timeMap,spans:timeMap.spans.slice(1)}},
      {timeMap:{...timeMap,sourceDurationSec:8}},
      {timeMap:{sourceDurationSec:10,spans:[{sourceStartSec:0,sourceEndSec:10,rate:.1}]}},
      {timeMap,exportLayers:true},
    ]) expect(manhuaPrevisSpecSchema.safeParse({...spec,...patch}).success).toBe(false);
    expect(previsFocusTimeMap(10,1,9,.25)).toBeNull();
  });
  it('真实ffmpeg输出48帧且重点区间确实慢下来',()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'previs-retime-'));
    try{
      const spec={durationSec:2,timeMap:previsFocusTimeMap(2,.4,.8,.5)!};
      // 每帧不同灰度，解码后可反查实际源帧，避免只验证字符串或时长。
      const raw=Buffer.concat(Array.from({length:48},(_,i)=>Buffer.alloc(16*16*3,20+i*3)));
      const source=path.join(dir,'source.rgb'),video=path.join(dir,'preview.mp4');writeFileSync(source,raw);
      const encoded=spawnSync('ffmpeg',['-v','error','-f','rawvideo','-pixel_format','rgb24','-video_size','16x16','-framerate','24','-i',source,'-vf',previsPlaybackFilter(spec)!,'-c:v','libx264rgb','-crf','0',video],{timeout:15000});
      expect(encoded.status,encoded.stderr.toString()).toBe(0);
      const decoded=spawnSync('ffmpeg',['-v','error','-i',video,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{timeout:15000});
      expect(decoded.status,decoded.stderr.toString()).toBe(0);
      expect(decoded.stdout.length).toBe(48*16*16*3);
      for(const frame of [0,6,12,18,24,30,40,47]){
        const actual=(decoded.stdout[frame*16*16*3]-20)/3;
        const expected=Math.min(47,manhuaPresentationToSourceSec(spec.timeMap,frame/24)*24);
        expect(Math.abs(actual-expected),`呈现帧${frame}对应源帧${actual}，期望${expected}`).toBeLessThanOrEqual(1.5);
      }
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('高速尾部保留时间戳精度，移除AVTB会越过半个呈现帧误差',()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'previs-fast-tail-'));
    try {
      const spec={durationSec:2,timeMap:{sourceDurationSec:2,spans:[
        {sourceStartSec:0,sourceEndSec:1,rate:.5},
        {sourceStartSec:1,sourceEndSec:2,rate:8},
      ]}};
      const source=path.join(dir,'source.rgb');
      writeFileSync(source,Buffer.concat(Array.from({length:48},(_,i)=>Buffer.alloc(16*16*3,20+i*3))));
      const filter=previsPlaybackFilter(spec)!;
      const sourceAtBoundary=(name:string,vf:string)=>{
        const video=path.join(dir,`${name}.mp4`);
        const encoded=spawnSync('ffmpeg',['-v','error','-f','rawvideo','-pixel_format','rgb24','-video_size','16x16','-framerate','24','-i',source,'-vf',vf,'-an','-c:v','libx264rgb','-crf','0',video],{timeout:15000});
        expect(encoded.status,encoded.stderr.toString()).toBe(0);
        const decoded=spawnSync('ffmpeg',['-v','error','-i',video,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{timeout:15000});
        expect(decoded.status,decoded.stderr.toString()).toBe(0);
        expect(decoded.stdout.length).toBe(51*16*16*3);
        return (decoded.stdout[48*16*16*3]-20)/3;
      };
      const expected=manhuaPresentationToSourceSec(spec.timeMap,48/24)*24;
      // 8倍快放时，24fps最近采样允许半输出帧，即4个源帧；无损灰度无需编码容差。
      expect(Math.abs(sourceAtBoundary('current',filter)-expected)).toBeLessThanOrEqual(4);
      // 对同一真实编码输入撤销修复，证明旧实现确实超限，而非只查滤镜字符串。
      expect(Math.abs(sourceAtBoundary('without-avtb',filter.replace('settb=AVTB,',''))-expected)).toBeGreaterThan(4);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });

});

import {describe,expect,it} from 'vitest';
import {createManhuaPrevisStudio,manhuaPrevisDraftSchema,manhuaPrevisSpecSchema,previsRenderCostUnits} from './manhuaPrevis';
import {buildManhuaCloudDraftPayload,parseManhuaCloudDraftPayload} from './manhuaCloudDraft';
import {defaultCanvasBlock,normalizeCanvasBlock} from '../client/src/lib/canvasTypes';
import {cloudDraftBlocksToCanvas,slimBlocksForLocalPersist,trySaveLocalCanvas} from '../client/src/lib/manhuaCloudDraftSync';

function advanced() {
  const studio=createManhuaPrevisStudio(4);
  const human=studio.spec.actors[0];
  human.assetRef='person-test';human.actions=[];
  human.riggedModel={sourceJobId:'m3d_test',forwardAxis:'+X',targetHeight:1.8,
    boneMap:{pelvis:'Hips',spine:'Spine'},performance:{
      controller:{eyeBones:{left:'EyeL',right:'EyeR'},expressions:{calm:{Smile:.2},tense:{Frown:.7},surprised:{Open:.8}}},
      cues:[{startSec:0,endSec:4,gazeTarget:[1,2,1],headYawDeg:10,headPitchDeg:5,breathAmplitude:.01,breathHz:.2,expression:'calm',intensity:.5}],
    }};
  studio.spec.actors.push({...structuredClone(human),id:'horse-test',assetRef:'horse-test',nameZh:'四足测试',shape:'horse',riggedModel:undefined,
    creature:{preset:'four_tail_black_wings',transformStartSec:.5,transformEndSec:3.5}});
  studio.spec.scriptSource={compilerVersion:1,shots:[{index:7,durationSec:4,actionZh:'测试人物静立，四足显形。'}],unmappedShotIndices:[7]};
  studio.specHistory=[{spec:structuredClone(studio.spec),createdAt:'2026-09-13T00:00:00Z',reasonZh:'确认前原稿'}];
  return studio;
}
describe('高级白模持久化及严格提交',()=>{
  it('高级合法spec接受，canvas本机规范化不剥字段',()=>{
    const studio=advanced();expect(manhuaPrevisSpecSchema.safeParse(studio.spec).success).toBe(true);
    const block=normalizeCanvasBlock({...defaultCanvasBlock('video',0,0),id:'clip-test',previsStudio:studio});
    expect(block.previsStudio).toEqual(studio);
  });
  it('云导出到JSON再导入闭合形态、模型、表演、原稿和撤销快照',()=>{
    const studio=advanced();
    const block={...defaultCanvasBlock('video',0,0),id:'clip-test',previsStudio:studio};
    const payload=buildManhuaCloudDraftPayload({writerSession:{},blocks:[block],edges:[]});
    const restored=parseManhuaCloudDraftPayload(JSON.stringify(payload));
    expect(restored?.canvas.blocks[0].previsStudio).toEqual(JSON.parse(JSON.stringify(studio)));
    const normalized=cloudDraftBlocksToCanvas(restored!.canvas.blocks)[0];
    expect(normalized.previsStudio?.spec.actors[0].riggedModel?.performance).toEqual(studio.spec.actors[0].riggedModel?.performance);
    expect(normalized.previsStudio?.specHistory?.[0].spec.scriptSource).toEqual(studio.spec.scriptSource);
  });
  it('本机瘦身与配额降级仍完整保存高级配置和撤销快照',()=>{
    const studio=advanced();const block={...defaultCanvasBlock('video',0,0),id:'clip-test',previsStudio:studio};
    expect(slimBlocksForLocalPersist([block])[0].previsStudio).toEqual(studio);
    let attempts=0;let saved='';
    expect(trySaveLocalCanvas([block],[],{setItem(_key,value){if(attempts++===0)throw new Error('QuotaExceededError');saved=value;}})).toBe(true);
    expect(attempts).toBe(2);
    expect(JSON.parse(saved).blocks[0].previsStudio).toEqual(JSON.parse(JSON.stringify(studio)));
  });
  it('pending和成功history里的高级spec也保留，不只保当前编辑对象',()=>{
    const studio=advanced();
    const requestId='00000000-0000-4000-8000-000000000001';
    studio.pending={requestId,scopeId:studio.scopeId,clipId:'clip-test',spec:structuredClone(studio.spec)};
    studio.history=[{jobId:'job-test',requestId,gcsUri:'gs://test/video.mp4',url:'https://test.invalid/video.mp4',durationSec:4,createdAt:'2026-09-13T00:00:00Z',spec:structuredClone(studio.spec)}];
    const payload=buildManhuaCloudDraftPayload({writerSession:{},blocks:[{...defaultCanvasBlock('video',0,0),id:'clip-test',previsStudio:studio}],edges:[]});
    const restored=parseManhuaCloudDraftPayload(JSON.stringify(payload))!.canvas.blocks[0].previsStudio!;
    expect(restored.pending?.spec.actors[0].riggedModel).toEqual(studio.pending.spec.actors[0].riggedModel);
    expect(restored.history[0].spec.actors[1].creature).toEqual(studio.spec.actors[1].creature);
  });
  it('creature结束等片长拒绝，最后实际帧可接受',()=>{
    const spec=advanced().spec;spec.actors[1].creature!.transformEndSec=4;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
    spec.actors[1].creature!.transformEndSec=95/24;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(true);
  });
  it('riggedModel不能放四足或取消资产绑定',()=>{
    const spec=advanced().spec;spec.actors[0].shape='horse';
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
    spec.actors[0].shape='human';delete spec.actors[0].assetRef;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  });
  it.each(['overlap','too-short','past-end'] as const)('表演区间%s拒绝',mode=>{
    const spec=advanced().spec;const cues=spec.actors[0].riggedModel!.performance!.cues;
    if(mode==='overlap')cues.push({...cues[0],startSec:1});
    if(mode==='too-short')cues[0].endSec=.25;
    if(mode==='past-end')cues[0].endSec=5;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  });
  it('客户端不可借model配置传本地文件或任意下载URL',()=>{
    const spec=advanced().spec;
    Object.assign(spec.actors[0].riggedModel!,{localPath:'/tmp/private.glb',url:'https://test.invalid/model.glb'});
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
    expect(manhuaPrevisDraftSchema.safeParse(spec).success).toBe(false);
  });
  it('编辑中的显形结束空值仍可存草稿，提交严格拒绝',()=>{
    const spec=advanced().spec;spec.actors[1].creature!.transformEndSec=0;
    expect(manhuaPrevisDraftSchema.safeParse(spec).success).toBe(true);
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  });
  it('编辑中的模型高度空值仍可存草稿，提交严格拒绝',()=>{
    const spec=advanced().spec;spec.actors[0].riggedModel!.targetHeight=0;
    expect(manhuaPrevisDraftSchema.safeParse(spec).success).toBe(true);
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  });
  it('记录现行旧预算按人数计，不证明模型或尾翼额外成本已验收',()=>{
    const spec=advanced().spec;
    expect(previsRenderCostUnits(spec)).toBe(4*24*2);
    const plain=structuredClone(spec);for(const a of plain.actors){delete a.riggedModel;delete a.creature;}
    expect(previsRenderCostUnits(plain)).toBe(previsRenderCostUnits(spec));
  });
});

import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createManhuaPrevisStudio} from '../../shared/manhuaPrevis';
import {preparePrevisModels,resolvePrevisModels,PREVIS_MODEL_MAX_BYTES,type PrevisModelDeps} from './manhuaPrevisModels';
import {writeFile} from 'node:fs/promises';
vi.mock('node:fs/promises',()=>({writeFile:vi.fn().mockResolvedValue(undefined)}));
vi.mock('./manhua3dTask',()=>({getCompletedManhua3dSource:vi.fn(()=>{throw new Error('禁止真实来源调用');})}));
vi.mock('./gcs',()=>({inspectGcsObjectBounded:vi.fn(()=>{throw new Error('禁止真实云调用');})}));

function glb() {
  const raw=Buffer.from('{"asset":{"version":"2.0"}}');
  const json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,0x20)]);
  const b=Buffer.alloc(20+json.length);b.write('glTF');b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);
  b.writeUInt32LE(json.length,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);return b;
}
function fixture(buffer=glb()) {
  const spec=createManhuaPrevisStudio(4).spec;
  Object.assign(spec.actors[0],{assetRef:'asset-test',riggedModel:{sourceJobId:'m3d_test',forwardAxis:'+X',targetHeight:1.8}});
  const source={taskId:'m3d_test',assetRef:'asset-test',gcsUri:'gs://test-only/model.glb',bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')};
  const d:PrevisModelDeps={source:vi.fn(async()=>({...source})),inspect:vi.fn(async input=>{
    input.onChunk?.(buffer.subarray(0,12));input.onChunk?.(buffer.subarray(12));
    return {bucket:'test-only',objectName:'model.glb',byteLength:buffer.length,sha256:source.sha256,header:buffer.subarray(0,12)};
  })};
  return {spec,source,d};
}
afterEach(()=>vi.clearAllMocks());
describe('模型来源解析与本机生产隔离',()=>{
  it('零模型完全惰性，旧白模不会调用来源或云对象',async()=>{
    const {d}=fixture();const spec=createManhuaPrevisStudio(4).spec;
    expect(await preparePrevisModels(spec,7,'/test-output',new AbortController().signal,d)).toEqual([]);
    expect(d.source).not.toHaveBeenCalled();expect(d.inspect).not.toHaveBeenCalled();expect(writeFile).not.toHaveBeenCalled();
  });
  it('仅按本人和同资产解析，验真后文件名不取actorId',async()=>{
    const {spec,d,source}=fixture();spec.actors[0].id='../../outside';
    const before=JSON.stringify(spec);
    const result=await preparePrevisModels(spec,7,'/test-output',new AbortController().signal,d);
    expect(d.source).toHaveBeenCalledWith('m3d_test',7,'asset-test');
    expect(result[0]).toMatchObject({localPath:'/test-output/actor-model-0.glb',sha256:source.sha256});
    expect(writeFile).toHaveBeenCalledWith('/test-output/actor-model-0.glb',glb(),expect.objectContaining({flag:'wx'}));
    expect(JSON.stringify(spec)).toBe(before);
  });
  it.each([{taskId:'m3d_other'},{assetRef:'other'},{bytes:19},{bytes:PREVIS_MODEL_MAX_BYTES+1},{bytes:1.5},{sha256:'not-sha'}])('拒绝不闭合来源 %j',async change=>{
    const {spec,d,source}=fixture();vi.mocked(d.source).mockResolvedValue({...source,...change});
    await expect(resolvePrevisModels(spec,7,d)).rejects.toThrow();expect(d.inspect).not.toHaveBeenCalled();
  });
  it('三份64MB元数据在下载前拒绝128MB总量超限',async()=>{
    const {spec,d,source}=fixture();spec.actors=[0,1,2].map(i=>({...spec.actors[0],id:'actor-'+i}));
    vi.mocked(d.source).mockResolvedValue({...source,bytes:PREVIS_MODEL_MAX_BYTES});
    await expect(preparePrevisModels(spec,7,'/test-output',new AbortController().signal,d)).rejects.toThrow(/128MB/);
    expect(d.inspect).not.toHaveBeenCalled();
  });
  it('没有assetRef在来源调用前拒绝',async()=>{
    const {spec,d}=fixture();delete spec.actors[0].assetRef;
    await expect(resolvePrevisModels(spec,7,d)).rejects.toThrow();expect(d.source).not.toHaveBeenCalled();
  });
  it('被篡改SHA即使远端回执一致也按实际下载字节拒绝',async()=>{
    const {spec,d,source}=fixture();source.sha256='a'.repeat(64);
    await expect(preparePrevisModels(spec,7,'/test-output',new AbortController().signal,d)).rejects.toThrow(/变化|不完整/);
    expect(writeFile).not.toHaveBeenCalled();
  });
  it('SHA正确但非GLB内容仍拒绝写入',async()=>{
    const {spec,d}=fixture(Buffer.from('这是假的模型文件，绝不能当成GLB'));
    await expect(preparePrevisModels(spec,7,'/test-output',new AbortController().signal,d)).rejects.toThrow(/glb/i);
    expect(writeFile).not.toHaveBeenCalled();
  });
  it('短读和云端回执SHA失配均拒绝写文件',async()=>{
    const {spec,d,source}=fixture();
    vi.mocked(d.inspect).mockImplementation(async input=>{input.onChunk?.(glb().subarray(0,20));return {bucket:'test-only',objectName:'model.glb',byteLength:source.bytes,sha256:source.sha256,header:glb().subarray(0,12)};});
    await expect(preparePrevisModels(spec,7,'/test-output',new AbortController().signal,d)).rejects.toThrow(/变化|不完整/);
    vi.mocked(d.inspect).mockImplementation(async input=>{input.onChunk?.(glb());return {bucket:'test-only',objectName:'model.glb',byteLength:source.bytes,sha256:'f'.repeat(64),header:glb().subarray(0,12)};});
    await expect(preparePrevisModels(spec,7,'/test-output',new AbortController().signal,d)).rejects.toThrow(/变化|不完整/);
    expect(writeFile).not.toHaveBeenCalled();
  });
  it('下载返回前取消不能继续写文件',async()=>{
    const {spec,d,source}=fixture();const abort=new AbortController();
    vi.mocked(d.inspect).mockImplementation(async input=>{input.onChunk?.(glb());abort.abort();return {bucket:'test-only',objectName:'model.glb',byteLength:source.bytes,sha256:source.sha256,header:glb().subarray(0,12)};});
    await expect(preparePrevisModels(spec,7,'/test-output',abort.signal,d)).rejects.toThrow();
    expect(writeFile).not.toHaveBeenCalled();
  });
  it('调用前取消不开始下载',async()=>{
    const {spec,d}=fixture();const abort=new AbortController();abort.abort();
    await expect(preparePrevisModels(spec,7,'/test-output',abort.signal,d)).rejects.toThrow();expect(d.inspect).not.toHaveBeenCalled();
  });
});

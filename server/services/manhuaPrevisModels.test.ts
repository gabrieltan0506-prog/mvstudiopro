import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createManhuaPrevisStudio} from '../../shared/manhuaPrevis';
import {preparePrevisModels,resolvePrevisModels,PREVIS_MODEL_MAX_BYTES,type PrevisModelDeps} from './manhuaPrevisModels';
import {writeFile} from 'node:fs/promises';
vi.mock('node:fs/promises',()=>({writeFile:vi.fn().mockResolvedValue(undefined)}));
vi.mock('./manhua3dTask',()=>({getCompletedManhua3dSource:vi.fn(()=>{throw new Error('禁止真实来源调用');}),Manhua3dSourceRejectedError:class extends Error{}}));
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
  const source={vertices:1000,taskId:'m3d_test',assetRef:'asset-test',gcsUri:'gs://test-only/model.glb',bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')};
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
    expect(d.source).toHaveBeenCalledWith('m3d_test',7,'asset-test',{prefer:'previs'});
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
  it('0917：模型挂在A-pose候选图时按sourceAssetRef核回执，身份仍是assetRef',async()=>{
    const {spec,d,source}=fixture();spec.actors[0].riggedModel!.sourceAssetRef='asset-apose';
    vi.mocked(d.source).mockResolvedValue({...source,assetRef:'asset-apose'});
    expect(await resolvePrevisModels(spec,7,d)).toHaveLength(1);
    expect(d.source).toHaveBeenCalledWith('m3d_test',7,'asset-apose',{prefer:'previs'});
  });
  it('0917：带sourceAssetRef但回执挂在别的ref仍拒绝',async()=>{
    const {spec,d,source}=fixture();spec.actors[0].riggedModel!.sourceAssetRef='asset-apose';
    vi.mocked(d.source).mockResolvedValue({...source});
    await expect(resolvePrevisModels(spec,7,d)).rejects.toThrow(/来源/);
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

describe('投影预算在入队前核对',()=>{
  it('代理单人横屏10秒通过，竖屏三次投影拒绝',async()=>{
    const {spec,d,source}=fixture();spec.durationSec=10;
    vi.mocked(d.source).mockResolvedValue({...source,vertices:44394});
    await expect(resolvePrevisModels(spec,7,d)).resolves.toHaveLength(1);
    spec.aspect='9:16';
    await expect(resolvePrevisModels(spec,7,d)).rejects.toThrow('1200万');
  });
  it('累计多个带骨角色，不按单人分别放行',async()=>{
    const {spec,d,source}=fixture();spec.durationSec=10;
    spec.actors.push({...spec.actors[0],id:'second'});
    vi.mocked(d.source).mockResolvedValue({...source,vertices:44394});
    await expect(resolvePrevisModels(spec,7,d)).rejects.toThrow('1200万');
  });
  it('四尾黑翼288顶点计入同一预算',async()=>{
    const {spec,d,source}=fixture();spec.durationSec=10;
    spec.actors.push({...spec.actors[0],id:'horse',shape:'horse',riggedModel:undefined,
      creature:{preset:'four_tail_black_wings',transformStartSec:0,transformEndSec:1}});
    vi.mocked(d.source).mockResolvedValue({...source,vertices:49900});
    await expect(resolvePrevisModels(spec,7,d)).rejects.toThrow('1200万');
  });
  it('旧回执读取真实网格数，23万顶点10秒拒绝',async()=>{
    const raw=Buffer.from(JSON.stringify({asset:{version:'2.0'},nodes:[{mesh:0,skin:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],accessors:[{count:230370}]}));
    const json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]);
    const buffer=Buffer.alloc(20+json.length);buffer.write('glTF');buffer.writeUInt32LE(2,4);buffer.writeUInt32LE(buffer.length,8);buffer.writeUInt32LE(json.length,12);buffer.writeUInt32LE(0x4e4f534a,16);json.copy(buffer,20);
    const {spec,d,source}=fixture(buffer);spec.durationSec=10;
    vi.mocked(d.source).mockResolvedValue({...source,vertices:undefined});
    await expect(resolvePrevisModels(spec,7,d)).rejects.toThrow('1200万');
    expect(d.inspect).toHaveBeenCalledTimes(1);
    spec.durationSec=2;
    await expect(resolvePrevisModels(spec,7,d)).resolves.toHaveLength(1);
  });
});

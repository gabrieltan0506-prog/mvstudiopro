import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getCompletedManhua3dSource,resetManhua3dTaskDependenciesForTests,setManhua3dTaskDependenciesForTests} from './manhua3dTask';

let dir='';
const forbidden={submit:vi.fn(),poll:vi.fn(),downloadGlb:vi.fn(),uploadGlb:vi.fn(),inspectUploadedGlb:vi.fn(),rewriteUploadedGlb:vi.fn(),signGlb:vi.fn()};
const record=()=>({taskId:'m3d_test',userId:7,assetRef:'asset-test',status:'succeeded',glbGcsUri:'gs://test-bucket/saved/model.glb',glbSha256:'a'.repeat(64),glbBytes:48,
  sourceImageUrl:'https://test.invalid/old-image.png',glbUrl:'https://test.invalid/old-preview.glb',glbUrlExpiresAt:'2000-01-01T00:00:00Z'});
async function save(change:Record<string,unknown>={}){await fs.writeFile(path.join(dir,'m3d_test.json'),JSON.stringify({...record(),...change}));}
beforeEach(async()=>{
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'previs-source-test-'));
  vi.stubEnv('MANHUA_3D_TASK_DIR',dir);
  setManhua3dTaskDependenciesForTests({...forbidden,getBucketName:()=> 'test-bucket'});
});
afterEach(async()=>{
  resetManhua3dTaskDependenciesForTests();vi.unstubAllEnvs();vi.clearAllMocks();
  await fs.rm(dir,{recursive:true,force:true});
});
describe('本人已完成3D来源只读消费',()=>{
  it('正确来源返回最小可信字段，不刷新旧预览URL或推进任务',async()=>{
    await save();const before=await fs.readFile(path.join(dir,'m3d_test.json'),'utf8');
    expect(await getCompletedManhua3dSource('m3d_test',7,'asset-test')).toEqual({taskId:'m3d_test',assetRef:'asset-test',gcsUri:record().glbGcsUri,sha256:'a'.repeat(64),bytes:48});
    expect(await fs.readFile(path.join(dir,'m3d_test.json'),'utf8')).toBe(before);
    for(const f of Object.values(forbidden))expect(f).not.toHaveBeenCalled();
  });
  it.each(['queued','running','failed','reconcile_manual'])('%s状态拒绝且不推进轮询',async status=>{
    await save({status});await expect(getCompletedManhua3dSource('m3d_test',7,'asset-test')).rejects.toThrow();
    for(const f of Object.values(forbidden))expect(f).not.toHaveBeenCalled();
  });
  it.each([{userId:8},{assetRef:'other'},{taskId:'m3d_other'},{glbSha256:'bad'},{glbBytes:19},{glbBytes:20.1},{glbGcsUri:'https://test.invalid/model.glb'},{glbGcsUri:'gs://other-bucket/model.glb'},{glbGcsUri:'gs://test-bucket.evil/model.glb'}])('拒绝失配回执 %j',async change=>{
    await save(change);await expect(getCompletedManhua3dSource('m3d_test',7,'asset-test')).rejects.toThrow();
  });
  it.each(['../../m3d_test','m3d_test/../../outside','https://test.invalid/model.glb','/tmp/file'])('调用者不能传任意路径 %s',async taskId=>{
    await save();await expect(getCompletedManhua3dSource(taskId,7,'asset-test')).rejects.toThrow(/身份无效/);
  });
  it.each([0,-1,1.2,Number.NaN])('非法用户ID %s拒绝',async userId=>{
    await save();await expect(getCompletedManhua3dSource('m3d_test',userId,'asset-test')).rejects.toThrow();
  });
  it('缺失或损坏JSON明确失败，不改旧资产预览',async()=>{
    await expect(getCompletedManhua3dSource('m3d_test',7,'asset-test')).rejects.toThrow();
    await fs.writeFile(path.join(dir,'m3d_test.json'),'{broken');
    await expect(getCompletedManhua3dSource('m3d_test',7,'asset-test')).rejects.toThrow();
    expect(await fs.readFile(path.join(dir,'m3d_test.json'),'utf8')).toBe('{broken');
    for(const f of Object.values(forbidden))expect(f).not.toHaveBeenCalled();
  });
});

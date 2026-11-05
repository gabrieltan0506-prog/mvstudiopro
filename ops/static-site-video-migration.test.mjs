import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateStaticVideos, sha256 } from './static-site-video-migration.mjs';

const bytes = Buffer.from('test-video-bytes');
const asset = { path: '/home-assets/test.mp4', bytes: bytes.length, sha256: sha256(bytes), contentType: 'video/mp4', objectName: `site-static-videos/sha256/${sha256(bytes)}/test.mp4` };
const plan = { schemaVersion: 1, sourceCommit: 'a'.repeat(40), bucket: 'test-bucket', assets: [asset] };
function fixture() {
  let meta = null; let creates = 0; const events = [];
  const deps = {
    readSource: async () => bytes, stat: async () => meta,
    create: async (a, b, guards) => { assert.deepEqual(guards, { ifGenerationMatch: 0, temporaryHold: true }); creates++; meta = { size: b.length, generation: '123', contentType: a.contentType, temporaryHold: true, metadata: { sha256: a.sha256 } }; },
    digest: async () => ({ bytes: bytes.length, sha256: sha256(bytes) }), record: async r => events.push(r),
  };
  return { deps, events, creates: () => creates, set: value => { meta = value; } };
}
test('复制验读与重入：只创建一次，源不删除，已有对象仍验读', async () => {
  const f = fixture(); const a = await migrateStaticVideos(plan, f.deps, true);
  assert.equal(a.complete, true); assert.equal(a.sourceDeleted, false); assert.equal(a.assets[0].generation, '123');
  let reads = 0; f.deps.digest = async () => { reads++; return { bytes: bytes.length, sha256: sha256(bytes) }; };
  await migrateStaticVideos(plan, f.deps, true); assert.equal(f.creates(), 1); assert.equal(reads, 1);
});
test('只读模式不创建，也不生成可排除构建的完整清单', async () => {
  const f = fixture(); const r = await migrateStaticVideos(plan, f.deps);
  assert.equal(f.creates(), 0); assert.equal(r.complete, false); assert.deepEqual(r.assets, []);
});
test('空数据、源变动、穿越路径在创建前拒绝', async () => {
  for (const changed of [{ ...asset, bytes: 0 }, { ...asset, path: '/home-assets/../secret.mp4' }]) {
    const f = fixture(); await assert.rejects(migrateStaticVideos({ ...plan, assets: [changed] }, f.deps, true)); assert.equal(f.creates(), 0);
  }
  const f = fixture(); f.deps.readSource = async () => Buffer.alloc(bytes.length);
  await assert.rejects(migrateStaticVideos(plan, f.deps, true), /source_changed/); assert.equal(f.creates(), 0);
});
test('同名目标缺hold或摘要不符时拒绝，不覆盖', async () => {
  for (const bad of [{ temporaryHold: false }, { metadata: { sha256: 'bad' } }]) {
    const f = fixture(); f.set({ generation: '123', size: bytes.length, contentType: 'video/mp4', temporaryHold: true, metadata: { sha256: asset.sha256 }, ...bad });
    await assert.rejects(migrateStaticVideos(plan, f.deps, true), /destination_conflict/); assert.equal(f.creates(), 0);
  }
});
test('目标正文损坏或最终版本漂移不能标为完成', async () => {
  const f = fixture(); f.deps.digest = async () => ({ bytes: bytes.length, sha256: 'bad' });
  await assert.rejects(migrateStaticVideos(plan, f.deps, true), /destination_corrupt/);
  const g = fixture(); g.deps.digest = async () => { g.set(null); return { bytes: bytes.length, sha256: asset.sha256 }; };
  await assert.rejects(migrateStaticVideos(plan, g.deps, true), /destination_changed/);
});

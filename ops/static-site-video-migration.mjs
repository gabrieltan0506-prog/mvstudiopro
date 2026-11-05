import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function validatePlan(plan) {
  if (plan.schemaVersion !== 1 || !/^[a-z0-9-]+$/.test(plan.bucket) || !/^[a-f0-9]{40}$/.test(plan.sourceCommit)
    || !Array.isArray(plan.assets) || !plan.assets.length) throw Error('invalid_plan');
  const paths = new Set();
  let total = 0;
  for (const a of plan.assets) {
    if (!/^\/(home-assets|blog-assets)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.mp4$/.test(a.path)
      || a.path.includes('..') || paths.has(a.path) || !/^[a-f0-9]{64}$/.test(a.sha256)
      || !Number.isSafeInteger(a.bytes) || a.bytes <= 0 || a.bytes > 64 * 1024 ** 2
      || a.contentType !== 'video/mp4'
      || a.objectName !== `site-static-videos/sha256/${a.sha256}/${a.path.split('/').at(-1)}`) throw Error('invalid_asset');
    paths.add(a.path); total += a.bytes;
  }
  if (total > 512 * 1024 ** 2) throw Error('batch_too_large');
  return total;
}

/** 只条件创建副本；已有对象必须全量验读，不删除或覆盖任何源和目标。 */
export async function migrateStaticVideos(plan, deps, copy = false) {
  validatePlan(plan);
  const assets = [];
  for (const asset of plan.assets) {
    const source = await deps.readSource(asset);
    if (source.length !== asset.bytes || sha256(source) !== asset.sha256) throw Error('source_changed');
    await deps.record({ event: 'source_verified', path: asset.path, sha256: asset.sha256, bytes: asset.bytes });
    if (!copy) continue;
    let meta = await deps.stat(asset);
    if (!meta) {
      await deps.record({ event: 'create_intent', objectName: asset.objectName, sha256: asset.sha256 });
      await deps.create(asset, source, { ifGenerationMatch: 0, temporaryHold: true });
      meta = await deps.stat(asset);
    }
    if (!meta || meta.temporaryHold !== true || !/^\d+$/.test(meta.generation)
      || Number(meta.size) !== asset.bytes || meta.contentType !== asset.contentType
      || meta.metadata?.sha256 !== asset.sha256) throw Error('destination_conflict');
    const digest = await deps.digest(asset, meta.generation);
    if (digest.bytes !== asset.bytes || digest.sha256 !== asset.sha256) throw Error('destination_corrupt');
    const final = await deps.stat(asset);
    if (final?.generation !== meta.generation || final?.temporaryHold !== true) throw Error('destination_changed');
    const verified = { ...asset, generation: meta.generation, temporaryHold: true, verifiedAt: new Date().toISOString() };
    await deps.record({ event: 'copy_verified', ...verified });
    assets.push(verified);
  }
  return { ...plan, assets, complete: copy && assets.length === plan.assets.length, sourceDeleted: false };
}

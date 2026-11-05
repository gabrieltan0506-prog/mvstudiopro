// Build a deletion proposal only after an isolated restore of the exact published
// revision. This does not delete source data or authorize deletion.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { restoreGrowthArchive, parseGrowthArchiveManifest } from '../shared/growthArchiveRestore.mjs';
import { createGrowthPrivateAssetFetch } from '../shared/growthPrivateAssetFetch.mjs';
import { privateGrowthBackupTarget, runBackupGh } from './growth-backup-target.mjs';
const sha = raw => createHash('sha256').update(raw).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const dirPattern = /^\d{4}-\d{2}-\d{2}(?:-\d{2})?$/;
const tagPattern = /^growth-(?:cold-store|archive)-[A-Za-z0-9._-]+$/;
const canonical = files => JSON.stringify([...files].sort((a,b) => a.path.localeCompare(b.path,'en')));
export const cleanupEvidenceSha256 = receipt => sha(JSON.stringify(receipt));

/** Fly 内原生 metadata 读取；不依赖未安装的 gh，不输出或传回凭证。 */
export async function cleanupMetadataTransport(repository, tags, {env=process.env,fetchImpl=fetch,signal}={}) {
  const configured=env.GROWTH_BACKUP_REPOSITORY || 'gabrieltan0506-prog/mvstudiopro-growth-data';
  if (!env.FLY_APP_NAME || repository !== configured
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw Error('cleanup_fly_repository_required');
  const token=env.GROWTH_BACKUP_GITHUB_TOKEN;
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw Error('cleanup_fly_token_required');
  const read=async suffix=>{
    const response=await fetchImpl(`https://api.github.com/repos/${repository}${suffix}`,{
      method:'GET',redirect:'error',signal:AbortSignal.any([...(signal ? [signal] : []),AbortSignal.timeout(30_000)]),
      headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
    });
    if(!response.ok)throw Error(`cleanup_metadata_http_${response.status}`);
    return response.json();
  };
  const info=await read('');
  if(info.private!==true || info.full_name?.toLowerCase()!==repository.toLowerCase())throw Error('cleanup_private_repository_required');
  const releases=[],inventories=new Map();
  for(const tag of new Set(tags)) {
    if(!tagPattern.test(tag))throw Error('cleanup_release_tag_invalid');
    const release=await read(`/releases/tags/${encodeURIComponent(tag)}`);
    if(release.tag_name!==tag || !Number.isSafeInteger(release.id) || release.id<=0)throw Error('cleanup_release_identity_invalid');
    releases.push({tag_name:tag,id:release.id});
    const rows=[];
    for(let page=1;page<=100;page++) {
      const part=await read(`/releases/${release.id}/assets?per_page=100&page=${page}`);
      if(!Array.isArray(part))throw Error('cleanup_asset_metadata_invalid');
      rows.push(...part);
      if(part.length<100)break;
      if(page===100)throw Error('cleanup_asset_metadata_limit');
    }
    inventories.set(`repos/${repository}/releases/${release.id}/assets?per_page=100`,JSON.stringify([rows]));
  }
  return args=>{
    if(args[0]==='repo' && args[1]==='view' && args[2]===repository)
      return JSON.stringify({nameWithOwner:info.full_name,isPrivate:true});
    if(args[0]!=='api' || args.includes('-X') || args.includes('--method'))throw Error('cleanup_metadata_read_only');
    const endpoint=args.at(-1);
    if(endpoint===`repos/${repository}/releases?per_page=100`)return JSON.stringify([releases]);
    if(!inventories.has(endpoint))throw Error('cleanup_metadata_scope_invalid');
    return inventories.get(endpoint);
  };
}
export async function verifyCleanupEvidenceOnFly(receipt, dependencies) {
  const gh=await cleanupMetadataTransport(receipt.repository,(receipt.backup?.assets || []).map(a=>a.releaseTag),dependencies);
  return verifyCleanupEvidence(receipt,gh);
}

// Read API metadata only: no asset bytes, redirects or credentials in reports.
export function verifyCleanupEvidence(receipt, rawGh = runBackupGh) {
  if (receipt?.schemaVersion !== 1 || receipt.evidenceKind !== 'remote-restore'
      || !Array.isArray(receipt.files) || !receipt.files.length
      || !Array.isArray(receipt.backup?.assets) || !receipt.backup.assets.length
      || !Array.isArray(receipt.backup?.restores) || !receipt.backup.restores.length)
    throw Error('cleanup_evidence_incomplete');
  const target = privateGrowthBackupTarget(rawGh, { repository: receipt.repository });
  const releases = JSON.parse(target.gh(['api','--paginate','--slurp',`repos/${target.repository}/releases?per_page=100`])).flat();
  const byTag = new Map();
  const seen = new Set();
  for (const asset of receipt.backup.assets) {
    if (!tagPattern.test(asset.releaseTag) || !/^[A-Za-z0-9._-]+$/.test(asset.name)
        || !hash(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0)
      throw Error('cleanup_asset_invalid');
    const key = `${asset.releaseTag}/${asset.name}`;
    if (seen.has(key)) throw Error('cleanup_asset_duplicate');
    seen.add(key);
    if (!byTag.has(asset.releaseTag)) {
      const rows = releases.filter(r => r.tag_name === asset.releaseTag);
      if (rows.length !== 1 || !Number.isSafeInteger(rows[0].id)) throw Error('cleanup_release_missing');
      byTag.set(asset.releaseTag, JSON.parse(target.gh(['api','--paginate','--slurp',`repos/${target.repository}/releases/${rows[0].id}/assets?per_page=100`])).flat());
    }
    const rows = byTag.get(asset.releaseTag).filter(r => r.name === asset.name);
    if (rows.length !== 1 || rows[0].state !== 'uploaded' || rows[0].size !== asset.bytes
        || rows[0].digest !== `sha256:${asset.sha256}`) throw Error(`cleanup_remote_asset_changed:${asset.name}`);
  }
  const restored = [], dirs = new Set();
  for (const proof of receipt.backup.restores) {
    if (!dirPattern.test(proof.dir) || dirs.has(proof.dir) || !hash(proof.manifestSha256)
        || !hash(proof.archiveSha256) || !Array.isArray(proof.inventory)) throw Error('cleanup_restore_invalid');
    dirs.add(proof.dir);
    const manifest = parseGrowthArchiveManifest(proof.manifest, proof.dir);
    // Exact bytes of the fetched manifest are retained as base64, not reserialized.
    const raw = Buffer.from(proof.manifestBase64 || '', 'base64');
    if (sha(raw) !== proof.manifestSha256 || JSON.stringify(JSON.parse(raw)) !== JSON.stringify(proof.manifest)
        || manifest.archive.sha256 !== proof.archiveSha256
        || canonical(proof.inventory) !== canonical(manifest.inventory || [])) throw Error('cleanup_restore_manifest_mismatch');
    const expectedAssets = [{ name:`archive-${proof.dir}.manifest.json`, bytes:raw.length, sha256:proof.manifestSha256 },
      ...manifest.parts.map(p => ({name:p.assetName,bytes:p.bytes,sha256:p.sha256}))];
    for (const asset of expectedAssets) {
      if (!receipt.backup.assets.some(a => a.releaseTag === proof.releaseTag && a.name === asset.name
          && a.bytes === asset.bytes && a.sha256 === asset.sha256)) throw Error('cleanup_restore_assets_incomplete');
    }
    for (const f of proof.inventory) if (/^bilibili-[^/]+\.json\.gz$/.test(f.path))
      restored.push({path:`archive/${proof.dir}/${f.path}`,bytes:f.bytes,sha256:f.sha256});
  }
  const wanted = new Map(restored.map(f => [f.path, f]));
  if (new Set(receipt.files.map(f => f.path)).size !== receipt.files.length
      || receipt.files.some(f => JSON.stringify(wanted.get(f.path)) !== JSON.stringify(f)))
    throw Error('cleanup_files_not_restored');
  return {verified:true,receiptSha256:cleanupEvidenceSha256(receipt),files:receipt.files};
}

export async function buildCleanupReceipt({ root, cacheRoot, allowRemoteDownload = false,
    gh, fetchAsset, signal, now = Date.now() }) {
  signal?.throwIfAborted();
  if (!allowRemoteDownload) throw Error('cleanup_remote_restore_requires_download_authorization');
  const batch = JSON.parse(await fs.readFile(path.join(root,'offload-manifest.json'),'utf8'));
  const publication = JSON.parse(await fs.readFile(path.join(root,'publication-result.json'),'utf8'));
  if (batch.schemaVersion !== 3 || publication.batchId !== batch.batchId || !batch.archives?.length)
    throw Error('cleanup_publication_incomplete');
  if (!gh) gh=await cleanupMetadataTransport(
    process.env.GROWTH_BACKUP_REPOSITORY || 'gabrieltan0506-prog/mvstudiopro-growth-data',
    batch.archives.map(entry=>entry.releaseTag),{signal});
  const target = privateGrowthBackupTarget(gh);
  const privateFetch = createGrowthPrivateAssetFetch({repository:target.repository,token:process.env.GROWTH_BACKUP_GITHUB_TOKEN || process.env.GH_TOKEN});
  const readAsset = fetchAsset || ((tag,name) => privateFetch(`https://github.com/${target.repository}/releases/download/${tag}/${name}`,
    {signal:AbortSignal.any([...(signal ? [signal] : []),AbortSignal.timeout(180_000)])}));
  // New child, never reuse another verifier's cache or a preexisting success marker.
  await fs.mkdir(cacheRoot,{recursive:true});
  const owned = await fs.mkdtemp(path.join(cacheRoot,'cleanup-proof-'));
  const assets = [], restores = [], files = [];
  for (const entry of batch.archives) {
    signal?.throwIfAborted();
    const {dir,releaseTag} = entry;
    if (!dirPattern.test(dir) || !tagPattern.test(releaseTag)
        || ![...(publication.uploaded || []), ...(publication.reused || [])].some(p => p.dir === dir && p.releaseTag === releaseTag))
      throw Error('cleanup_revision_not_published');
    const name = `archive-${dir}.manifest.json`;
    const expectedRaw = await fs.readFile(path.join(root,'assets',name));
    const manifest = parseGrowthArchiveManifest(JSON.parse(expectedRaw),dir);
    if (!manifest.inventory?.length || manifest.sourceFingerprint !== entry.sourceFingerprint)
      throw Error('cleanup_manifest_inventory_required');
    if (!manifest.inventory.some(f => /^bilibili-[^/]+\.json\.gz$/.test(f.path))) continue;
    let fetchedManifest;
    const restoredDir = await restoreGrowthArchive({dir,cacheRoot:owned,fetchAsset:async(assetName) => {
      // Pin to the batch's immutable revision, never resolve a mutable latest pointer.
      if (assetName.endsWith('.latest.json')) return new Response(null,{status:404});
      const response = await readAsset(releaseTag,assetName);
      if (assetName === name && response?.ok) {
        fetchedManifest = Buffer.from(await response.arrayBuffer());
        if (!fetchedManifest.equals(expectedRaw)) throw Error('cleanup_remote_manifest_mismatch');
        return new Response(fetchedManifest);
      }
      return response;
    }});
    if (!restoredDir || !fetchedManifest) throw Error('cleanup_restore_incomplete');
    const proof = JSON.parse(await fs.readFile(path.join(path.dirname(restoredDir),'restore-receipt.json'),'utf8'));
    if (proof.manifestHash !== sha(expectedRaw) || proof.archiveSha !== manifest.archive.sha256
        || canonical(proof.inventory) !== canonical(manifest.inventory)) throw Error('cleanup_restore_receipt_mismatch');
    assets.push({releaseTag,name,bytes:expectedRaw.length,sha256:sha(expectedRaw)},
      ...manifest.parts.map(p=>({releaseTag,name:p.assetName,bytes:p.bytes,sha256:p.sha256})));
    restores.push({dir,releaseTag,manifestSha256:sha(expectedRaw),archiveSha256:manifest.archive.sha256,
      manifestBase64:expectedRaw.toString('base64'),manifest,inventory:proof.inventory});
    for (const f of proof.inventory) if (/^bilibili-[^/]+\.json\.gz$/.test(f.path))
      files.push({path:`archive/${dir}/${f.path}`,bytes:f.bytes,sha256:f.sha256});
  }
  const receipt = {schemaVersion:1,evidenceKind:'remote-restore',repository:target.repository,
    createdAt:new Date(now).toISOString(),files:files.sort((a,b)=>a.path.localeCompare(b.path,'en')),
    backup:{batchId:batch.batchId,assets,restores}};
  verifyCleanupEvidence(receipt,gh);
  signal?.throwIfAborted();
  await fs.writeFile(path.join(owned,'cleanup-receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
  return {receipt,receiptSha256:cleanupEvidenceSha256(receipt),evidenceDirectory:owned,
    sourceDeletionAuthorized:false,logicalBytes:files.reduce((n,f)=>n+f.bytes,0)};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [root,cacheRoot,authorization,...extra] = process.argv.slice(2);
    if (!root || !cacheRoot || authorization !== '--allow-remote-download' || extra.length)
      throw Error('Usage: node scripts/growth-archive-cleanup.mjs BATCH_ROOT EMPTY_CACHE_PARENT --allow-remote-download');
    console.log(JSON.stringify(await buildCleanupReceipt({root,cacheRoot,allowRemoteDownload:true}),null,2));
  } catch(error) { console.error(error.message); process.exitCode=1; }
}

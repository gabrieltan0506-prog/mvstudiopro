import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { migrateStaticVideos } from './static-site-video-migration.mjs';

// 生产凭证只在Fly进程内读取，拒绝本机运行，不接受密钥或任意源URL参数。
if (process.env.FLY_APP_NAME !== 'mvstudiopro' || !process.env.FLY_MACHINE_ID) throw Error('fly_only');
const args = process.argv.slice(2);
const copy = args.includes('--copy');
const value = key => args[args.indexOf(key) + 1];
if (!args.includes('--plan') || !args.includes('--evidence')) throw Error('plan_and_evidence_required');
const plan = JSON.parse(await fs.readFile(value('--plan'), 'utf8'));
const evidence = path.resolve(value('--evidence'));
await fs.mkdir(evidence, { recursive: true });
const require = createRequire('/app/package.json');
const { Storage } = require('@google-cloud/storage');
const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '{}');
const storage = new Storage({ projectId: credentials.project_id, credentials, retryOptions: { autoRetry: false } });
const bucket = storage.bucket(plan.bucket);
const allowedBucket = process.env.GCS_BUCKET_NAME || process.env.GROWTH_CAMP_GCS_BUCKET || process.env.VERTEX_GCS_BUCKET || process.env.GOOGLE_CLOUD_STORAGE_BUCKET;
if (plan.bucket !== allowedBucket) throw Error('bucket_mismatch');
const journal = path.join(evidence, `events-${Date.now()}.jsonl`);
const record = async data => {
  const h = await fs.open(journal, 'a', 0o600);
  try { await h.writeFile(JSON.stringify({ at: new Date().toISOString(), ...data }) + '\n'); await h.sync(); } finally { await h.close(); }
};
try {
  const result = await migrateStaticVideos(plan, {
    readSource: async asset => {
      const file = path.join('/app/client/public', asset.path);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.bytes) throw Error('source_file_mismatch');
      return fs.readFile(file);
    },
    stat: async asset => {
      try { const [m] = await bucket.file(asset.objectName).getMetadata(); return m; }
      catch (e) { if (e.code === 404) return null; throw Error('object_stat_failed'); }
    },
    create: async (asset, bytes) => bucket.file(asset.objectName).save(bytes, {
      resumable: false, validation: 'crc32c', timeout: 120000,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: asset.contentType, temporaryHold: true,
        cacheControl: 'public, max-age=3600', metadata: { sha256: asset.sha256, originalPath: asset.path, sourceCommit: plan.sourceCommit } },
    }),
    digest: async (asset, generation) => {
      const stream = bucket.file(asset.objectName, { generation }).createReadStream({ validation: 'crc32c', decompress: false });
      const timer = setTimeout(() => stream.destroy(Error('read_timeout')), 120000);
      const hash = createHash('sha256'); let bytes = 0;
      try { for await (const chunk of stream) { bytes += chunk.length; if (bytes > asset.bytes) { stream.destroy(); throw Error('object_too_large'); } hash.update(chunk); } }
      finally { clearTimeout(timer); }
      return { bytes, sha256: hash.digest('hex') };
    }, record,
  }, copy);
  await fs.writeFile(path.join(evidence, 'catalog.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  await record({ event: 'finished', complete: result.complete, count: result.assets.length });
  console.log(JSON.stringify({ complete: result.complete, count: result.assets.length, journal, catalog: path.join(evidence, 'catalog.json') }));
} catch (e) {
  // SDK原异常可能带签名/凭证上下文，不序列化原对象或请求头。
  await record({ event: 'failed', code: /^[a-z_]+$/.test(e.message) ? e.message : 'migration_failed', status: Number(e.code) || undefined });
  console.error('迁移未完成，请检查脱敏审计；未删除源文件。'); process.exitCode = 1;
}

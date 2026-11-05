import fs from 'node:fs/promises';
import path from 'node:path';
import retiredReceipt from '../shared/staticSiteVideoRetired.json';
import { createHash } from 'node:crypto';
import type { Plugin, ResolvedConfig } from 'vite';
import { staticVideoReceipt, staticVideoOrigin, staticVideoEndpoint, type StaticSiteVideo } from '../shared/staticSiteVideos';

export async function verifyVideoOrigin(asset: StaticSiteVideo, origin = staticVideoOrigin) {
  const response = await fetch(origin + staticVideoEndpoint(asset), { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (response.status !== 200 || Number(response.headers.get('content-length')) !== asset.bytes
    || response.headers.get('x-static-video-sha256') !== asset.sha256
    || response.headers.get('x-static-video-generation') !== asset.generation
    || response.headers.get('content-type')?.split(';')[0] !== 'video/mp4'
    || response.headers.get('accept-ranges') !== 'bytes') throw Error(`视频回源未就绪，保留旧部署：${asset.path}`);
}

type VideoFile = Pick<StaticSiteVideo, 'path' | 'bytes' | 'sha256'>;

/** 新增或改名的视频必须先更新保留/退役清单，不能悄悄重新占用部署空间。 */
export async function assertVideoInventory(outputDir: string, planned: VideoFile[]) {
  const expected = new Set(planned.map(a => a.path));
  if (expected.size !== planned.length) throw Error('视频清单路径重复');
  const found = new Set<string>();
  async function walk(dir: string) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await walk(file);
      else if (/\.(mp4|webm|mov|m4v|avi)$/i.test(item.name)) found.add('/' + path.relative(outputDir, file).split(path.sep).join('/'));
    }
  }
  await walk(outputDir);
  if (found.size !== expected.size || Array.from(found).some(p => !expected.has(p))) throw Error('视频构建清单不匹配，请核对新增或缺失视频');
}

/** 所有源文件、构建副本和远端入口通过后，才删除输出目录里的精确副本。 */
export async function excludeVerifiedVideoCopies<T extends VideoFile>(sourceDir: string, outputDir: string, assets: T[], verify: (asset: T) => Promise<void>) {
  const source = await fs.realpath(sourceDir), output = await fs.realpath(outputDir);
  if (source === output || source.startsWith(output + path.sep) || output.startsWith(source + path.sep)) throw Error('视频源目录与构建目录必须隔离');
  const files: string[] = [];
  for (const asset of assets) {
    if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(mp4|webm|mov|m4v|avi)$/.test(asset.path)
      || asset.path.includes('..') || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) throw Error('无效视频文件身份');
    for (const root of [source, output]) {
      const file = path.resolve(root, '.' + asset.path);
      const real = await fs.realpath(file);
      const stat = await fs.lstat(file);
      if (!real.startsWith(root + path.sep) || stat.isSymbolicLink() || !stat.isFile() || stat.size !== asset.bytes
        || createHash('sha256').update(await fs.readFile(file)).digest('hex') !== asset.sha256) throw Error(`视频内容变动，请重新迁移：${asset.path}`);
      if (root === output) files.push(file);
    }
  }
  for (let i = 0; i < assets.length; i += 4) await Promise.all(assets.slice(i, i + 4).map(verify));
  for (const file of files) await fs.unlink(file);
  return { count: files.length, bytes: assets.reduce((sum, a) => sum + a.bytes, 0) };
}

export function staticSiteVideoOffload(): Plugin {
  let config: ResolvedConfig;
  const enabled = process.env.VERCEL === '1' || process.env.STATIC_SITE_VIDEO_OFFLOAD === '1';
  return {
    name: 'verified-static-site-video-offload', apply: 'build',
    configResolved(value) { config = value; },
    async closeBundle() {
      const outputDir = path.resolve(config.root, config.build.outDir);
      const all = [...staticVideoReceipt.assets, ...retiredReceipt.assets];
      await assertVideoInventory(outputDir, all);
      if (!enabled) {
        const result = await excludeVerifiedVideoCopies(config.publicDir, outputDir, retiredReceipt.assets, async () => {});
        console.info(`[static-video-retired] ${result.count}条，构建减少${result.bytes}bytes；原文件保留`);
        return;
      }
      const vercel = JSON.parse(await fs.readFile(path.resolve(config.root, '..', 'vercel.json'), 'utf8'));
      for (const asset of staticVideoReceipt.assets) {
        const rule = vercel.rewrites.find((r: { source: string }) => r.source === asset.path);
        if (rule?.destination !== staticVideoOrigin + staticVideoEndpoint(asset)) throw Error(`视频原网址缺少精确路由：${asset.path}`);
      }
      // 隔离验收仅允许回环地址；Vercel构建始终检查真实Fly入口，不能绕过上线次序门禁。
      let origin = staticVideoOrigin;
      if (process.env.VERCEL !== '1' && process.env.STATIC_SITE_VIDEO_TEST_ORIGIN) {
        const test = new URL(process.env.STATIC_SITE_VIDEO_TEST_ORIGIN);
        if (test.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(test.hostname) || test.pathname !== '/' || test.search || test.username || test.password) throw Error('invalid_isolated_origin');
        origin = test.origin;
      }
      const result = await excludeVerifiedVideoCopies(config.publicDir, path.resolve(config.root, config.build.outDir), all, async a => {
        const kept = staticVideoReceipt.assets.find(k => k.path === a.path);
        if (kept) await verifyVideoOrigin(kept, origin);
      });
      console.info(`[static-video-offload] ${result.count}条，构建减少${result.bytes}bytes；原文件保留`);
    },
  };
}

import fs from 'node:fs/promises';
import path from 'node:path';
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

/** 所有源文件、构建副本和远端入口通过后，才删除输出目录里的精确副本。 */
export async function excludeVerifiedVideoCopies(sourceDir: string, outputDir: string, assets: StaticSiteVideo[], verify: (asset: StaticSiteVideo) => Promise<void>) {
  const source = await fs.realpath(sourceDir), output = await fs.realpath(outputDir);
  if (source === output || source.startsWith(output + path.sep) || output.startsWith(source + path.sep)) throw Error('视频源目录与构建目录必须隔离');
  const files: string[] = [];
  for (const asset of assets) {
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
      if (!enabled) return;
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
      const result = await excludeVerifiedVideoCopies(config.publicDir, path.resolve(config.root, config.build.outDir), staticVideoReceipt.assets, a => verifyVideoOrigin(a, origin));
      console.info(`[static-video-offload] ${result.count}条，构建减少${result.bytes}bytes；原文件保留`);
    },
  };
}

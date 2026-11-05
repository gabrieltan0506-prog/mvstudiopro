import fs from 'node:fs/promises';
import path from 'node:path';
import retiredReceipt from '../shared/staticSiteVideoRetired.json';
import { createHash } from 'node:crypto';
import type { Plugin, ResolvedConfig } from 'vite';
import { staticVideoReceipt, staticVideoOrigin, staticVideoEndpoint, type StaticSiteVideo } from '../shared/staticSiteVideos';

export async function verifyVideoOrigin(asset: StaticSiteVideo, origin = staticVideoOrigin, signal?: AbortSignal) {
  const response = await fetch(origin + staticVideoEndpoint(asset), { method: 'HEAD', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
  if (response.status !== 200 || Number(response.headers.get('content-length')) !== asset.bytes
    || response.headers.get('x-static-video-sha256') !== asset.sha256
    || response.headers.get('x-static-video-generation') !== asset.generation
    || response.headers.get('content-type')?.split(';')[0] !== 'video/mp4'
    || response.headers.get('accept-ranges') !== 'bytes') throw Error(`视频回源未就绪，保留旧部署：${asset.path}`);
}


// 为并行发布的后端留出窗口；外层GitHub检查必须覆盖此窗口和前端构建时间。
export const VIDEO_READINESS_TIMEOUT_MS = 30 * 60_000;
export async function waitForVideoOrigins(assets: StaticSiteVideo[], origin = staticVideoOrigin, {
  timeoutMs = VIDEO_READINESS_TIMEOUT_MS,
  intervalMs = 10_000,
  check = verifyVideoOrigin,
  log = (message: string) => console.info(message),
}: { timeoutMs?: number; intervalMs?: number; check?: typeof verifyVideoOrigin; log?: (message: string) => void } = {}) {
  if (!assets.length || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) throw Error('无效视频等待参数');
  const controller = new AbortController();
  let pending = assets.map(a => a.path);
  let pause: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Error(`视频回源等待超时，保留旧部署：${pending.join('、')}`));
    }, timeoutMs);
  });
  try {
    while (true) {
      // 每轮重验全部素材，不能拼凑不同时刻的成功结果放行。
      const results = await Promise.race([
        Promise.allSettled(assets.map(a => check(a, origin, controller.signal))), expired,
      ]);
      pending = assets.filter((_, i) => results[i].status === 'rejected').map(a => a.path);
      if (!pending.length) return;
      log(`[static-video-offload] 等待后端媒体入口：${pending.join('、')}`);
      await Promise.race([new Promise<void>(resolve => { pause = setTimeout(resolve, intervalMs); }), expired]);
    }
  } finally {
    clearTimeout(timer!); clearTimeout(pause); controller.abort();
  }
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
      // 源与输出全部验真后只启动一个共享等待窗口，30分钟不是每片各等一次。
      let readiness: Promise<void> | undefined;
      const result = await excludeVerifiedVideoCopies(config.publicDir, path.resolve(config.root, config.build.outDir), all,
        () => readiness ??= waitForVideoOrigins(staticVideoReceipt.assets, origin));
      console.info(`[static-video-offload] ${result.count}条，构建减少${result.bytes}bytes；原文件保留`);
    },
  };
}

import type { Express, RequestHandler } from 'express';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { staticVideoReceipt, type StaticSiteVideo } from '../../shared/staticSiteVideos';
import { signGcsObjectPathV4ReadUrl } from '../services/gcs';

type OpenVideo = (asset: StaticSiteVideo, method: 'GET' | 'HEAD', headers: Headers, signal: AbortSignal) => Promise<Response>;
const openVideo: OpenVideo = (asset, method, headers, signal) => fetch(
  signGcsObjectPathV4ReadUrl(staticVideoReceipt.bucket, asset.objectName, 3600, { method, generation: asset.generation }),
  { method, headers, signal, redirect: 'error' },
);

export function createStaticSiteVideoHandler(open: OpenVideo = openVideo): RequestHandler {
  const assets = new Map(staticVideoReceipt.assets.map(a => [a.sha256, a]));
  return async (req, res) => {
    const asset = assets.get(String(req.params.sha256));
    if (!asset) { res.status(404).end(); return; }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag, X-Static-Video-Sha256');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, If-Range, If-None-Match, If-Modified-Since');
      res.status(204).end(); return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD, OPTIONS'); res.status(405).end(); return; }
    const range = req.get('Range');
    if (range && (!/^bytes=(?:\d+-\d*|-\d+)$/.test(range) || range.length > 80)) {
      res.setHeader('Content-Range', `bytes */${asset.bytes}`); res.status(416).end(); return;
    }
    const headers = new Headers({ 'Accept-Encoding': 'identity' });
    for (const name of ['Range', 'If-Range', 'If-None-Match', 'If-Modified-Since']) {
      const value = req.get(name); if (value && value.length <= 512) headers.set(name, value);
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const resetTimeout = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), 120_000); timer.unref(); };
    const abort = () => controller.abort();
    req.once('aborted', abort); res.once('close', abort); resetTimeout();
    try {
      const upstream = await open(asset, req.method, headers, controller.signal);
      if (![200, 206, 304, 416].includes(upstream.status)) { await upstream.body?.cancel(); throw Error('media_unavailable'); }
      const contentRange = upstream.headers.get('content-range');
      const length = Number(upstream.headers.get('content-length'));
      if ((upstream.status === 200 && length !== asset.bytes)
        || (upstream.status === 206 && (!contentRange?.endsWith(`/${asset.bytes}`) || !Number.isSafeInteger(length) || length <= 0 || length > asset.bytes))
        || ([200, 206].includes(upstream.status) && upstream.headers.get('content-type')?.split(';')[0] !== 'video/mp4')) {
        await upstream.body?.cancel(); throw Error('media_metadata_mismatch');
      }
      res.status(upstream.status);
      for (const name of ['content-type', 'content-length', 'content-range', 'etag', 'last-modified', 'accept-ranges']) {
        const value = upstream.headers.get(name); if (value) res.setHeader(name, value);
      }
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('X-Static-Video-Sha256', asset.sha256);
      res.setHeader('X-Static-Video-Generation', asset.generation);
      res.setHeader('Cache-Control', upstream.status === 416 ? 'no-store' : 'public, max-age=3600');
      if (req.method === 'HEAD' || upstream.status === 304 || upstream.status === 416) {
        await upstream.body?.cancel();
        if (upstream.status === 416) res.removeHeader('Content-Length');
        res.end(); return;
      }
      if (!upstream.body) throw Error('media_empty');
      let received = 0;
      const guard = new Transform({
        transform(chunk, _encoding, done) {
          resetTimeout(); received += chunk.length;
          done(received > length ? Error('media_oversize') : null, chunk);
        },
        flush(done) { done(received !== length ? Error('media_truncated') : null); },
      });
      await pipeline(Readable.fromWeb(upstream.body as never), guard, res, { signal: controller.signal });
    } catch {
      // 不回传签名网址、凭证或上游异常正文；失败不进入登录/SPA fallback。
      controller.abort();
      if (!res.headersSent && !res.destroyed) {
        for (const name of ['Content-Length', 'Content-Range', 'ETag', 'Last-Modified', 'X-Static-Video-Sha256', 'X-Static-Video-Generation']) res.removeHeader(name);
        res.setHeader('Cache-Control', 'no-store'); res.status(502).end();
      } else if (!res.destroyed) res.destroy();
    } finally {
      clearTimeout(timer!); req.off('aborted', abort); res.off('close', abort);
    }
  };
}

export function registerStaticSiteVideos(app: Express) {
  app.all('/api/static-site-video/:sha256', createStaticSiteVideoHandler());
}

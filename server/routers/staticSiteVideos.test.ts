import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createStaticSiteVideoHandler } from './staticSiteVideos';
import { staticVideoReceipt } from '../../shared/staticSiteVideos';

const asset = staticVideoReceipt.assets[0];
const servers: Server[] = [];
async function serve(open: Parameters<typeof createStaticSiteVideoHandler>[0]) {
  const app = express(); app.all('/api/static-site-video/:sha256', createStaticSiteVideoHandler(open));
  const server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  servers.push(server); const address = server.address() as { port: number };
  return `http://127.0.0.1:${address.port}/api/static-site-video/${asset.sha256}`;
}
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise<void>(r => { s.closeAllConnections(); s.close(() => r()); }))); });
const mediaHeaders = { 'content-type': 'video/mp4', 'content-length': String(asset.bytes), 'etag': '"fixed"' };

describe('公开固定视频的HTTP契约', () => {
  it('HEAD和OPTIONS无正文，保持原尺寸与CORS；未知对象和写操作不访问上游', async () => {
    const open = vi.fn<NonNullable<Parameters<typeof createStaticSiteVideoHandler>[0]>>(async () => new Response(null, { headers: mediaHeaders }));
    const url = await serve(open);
    const head = await fetch(url, { method: 'HEAD' });
    expect(head.status).toBe(200); expect(head.headers.get('content-length')).toBe(String(asset.bytes));
    expect(head.headers.get('x-static-video-sha256')).toBe(asset.sha256); expect(await head.text()).toBe('');
    const options = await fetch(url, { method: 'OPTIONS' }); expect(options.status).toBe(204);
    expect(options.headers.get('access-control-allow-origin')).toBe('*');
    expect((await fetch(url, { method: 'POST' })).status).toBe(405);
    expect((await fetch(url.replace(asset.sha256, 'unknown'))).status).toBe(404);
    expect(open).toHaveBeenCalledTimes(1); expect(open.mock.calls[0][1]).toBe('HEAD');
  });
  it('Range和条件请求透传，206内容与长度保持', async () => {
    const open = vi.fn<NonNullable<Parameters<typeof createStaticSiteVideoHandler>[0]>>(async () => new Response('abcd', { status: 206, headers: { ...mediaHeaders, 'content-length': '4', 'content-range': `bytes 10-13/${asset.bytes}` } }));
    const url = await serve(open); const response = await fetch(url, { headers: { Range: 'bytes=10-13', 'If-Range': '"fixed"' } });
    expect(response.status).toBe(206); expect(await response.text()).toBe('abcd');
    expect(response.headers.get('content-range')).toBe(`bytes 10-13/${asset.bytes}`);
    const headers = open.mock.calls[0][2]; expect(headers.get('range')).toBe('bytes=10-13'); expect(headers.get('if-range')).toBe('"fixed"');
  });
  it('错误Range、上游416和304不返回错误正文，不吞成SPA', async () => {
    const open = vi.fn(async () => new Response('range error', { status: 416, headers: { 'content-range': `bytes */${asset.bytes}`, 'content-length': '11' } }));
    const url = await serve(open);
    expect((await fetch(url, { headers: { Range: 'bytes=1-2,4-6' } })).status).toBe(416); expect(open).not.toHaveBeenCalled();
    const bad = await fetch(url, { headers: { Range: `bytes=${asset.bytes + 1}-` } }); expect(bad.status).toBe(416); expect(await bad.text()).toBe('');
    open.mockImplementation(async () => new Response(null, { status: 304, headers: { etag: '"fixed"' } }));
    expect((await fetch(url, { headers: { 'If-None-Match': '"fixed"' } })).status).toBe(304);
  });
  it('上游错误或尺寸不符失败关闭，不泄露签名和异常正文', async () => {
    const open = vi.fn(async () => new Response('secret upstream url', { status: 403 })); const url = await serve(open);
    let r = await fetch(url); expect(r.status).toBe(502); expect(await r.text()).toBe('');
    open.mockImplementation(async () => new Response('bad', { headers: { ...mediaHeaders, 'content-length': '3' } }));
    r = await fetch(url); expect(r.status).toBe(502); expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('客户端中断会取消上游读取', async () => {
    let signal: AbortSignal | undefined;
    const url = await serve(async (_a, _m, _h, s) => {
      signal = s;
      return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4)); } }), { headers: mediaHeaders });
    });
    const response = await fetch(url); await response.body!.cancel();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });
});

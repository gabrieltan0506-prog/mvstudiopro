import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('puppeteer', () => ({ default: { launch: vi.fn() } }));
vi.mock('node:fs/promises', () => ({ default: { mkdtemp: vi.fn(async () => '/dev/shm/test-only'), chmod: vi.fn(async () => {}), rm: vi.fn(async () => {}) } }));
vi.mock('node:os', () => ({ default: { freemem: () => 2 * 1024 ** 3 } }));
import puppeteer from 'puppeteer';
import { readDouyinDetailFromOfficialPage } from './manhuaDouyinBrowserRead';
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); vi.mocked(puppeteer.launch).mockReset(); });

describe('官方网页有限重试', () => {
  const id = '7693257165578013992';
  function setup() {
    vi.stubEnv('FLY_APP_NAME', 'mvstudiopro');
    vi.stubEnv('FLY_MACHINE_ID', 'test-machine');
    vi.stubEnv('TEST_PRODUCTION_TOKEN', 'test-key');
    vi.useFakeTimers();
  }
  it('首次失败后重试四次，全部失败返回空，不无限重启', async () => {
    setup();
    vi.mocked(puppeteer.launch).mockRejectedValue(new Error('test-only failure'));
    const result = readDouyinDetailFromOfficialPage(id, 'test-cookie=1');
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBeNull();
    expect(puppeteer.launch).toHaveBeenCalledTimes(5);
    expect(vi.mocked(puppeteer.launch).mock.calls[0][0]?.env).not.toHaveProperty('TEST_PRODUCTION_TOKEN');
  });
  it('第四次重试成功后返回原详情并关闭浏览器，并发调用不另起浏览器', async () => {
    setup();
    const payload = { status_code: 0, aweme_detail: { aweme_id: id,
      entertainment_video_paid_way: { paid_type: 1 },
      video: { play_addr: { url_list: ['https://v3-dy-o.zjcdn.com/test.mp4'] } } } };
    const close = vi.fn(async () => {});
    const page = { setUserAgent: vi.fn(async () => {}), setCookie: vi.fn(async () => {}),
      goto: vi.fn(async () => null), waitForResponse: vi.fn(async (predicate: (r: unknown) => Promise<boolean>) => {
        await predicate({ ok: () => true, url: () => `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${id}`, json: async () => payload });
      }) };
    vi.mocked(puppeteer.launch).mockRejectedValueOnce(new Error('test failure'))
      .mockRejectedValueOnce(new Error('test failure')).mockRejectedValueOnce(new Error('test failure'))
      .mockRejectedValueOnce(new Error('test failure'))
      .mockResolvedValue({ newPage: async () => page, close, process: () => ({ kill: vi.fn() }) } as never);
    const result = readDouyinDetailFromOfficialPage(id, 'test-cookie=1');
    await expect(readDouyinDetailFromOfficialPage(id, 'test-cookie=1')).resolves.toBeNull();
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual(payload);
    expect(puppeteer.launch).toHaveBeenCalledTimes(5);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

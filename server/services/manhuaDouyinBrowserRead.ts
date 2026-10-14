/** 单条详情被 Argus 拒绝时，由官方网页产生正常请求；凭证和签名仅留在 Fly。 */
import os from 'node:os';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { parseDouyinAwemeDetailResponse } from '../../shared/manhuaLearnDouyinWebApi.js';

let active = false;

export function isTargetDouyinDetailResponse(url: string, id: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://www.douyin.com' &&
      parsed.pathname === '/aweme/v1/web/aweme/detail/' && parsed.searchParams.get('aweme_id') === id;
  } catch { return false; }
}

export function isUsableDouyinBrowserDetail(payload: unknown, id: string): boolean {
  const raw = payload as { aweme_detail?: { aweme_id?: unknown } } | null;
  if (String(raw?.aweme_detail?.aweme_id ?? '') !== id) return false;
  const parsed = parseDouyinAwemeDetailResponse(payload);
  return Boolean(parsed && (parsed.playbackUrl || parsed.playbackUrls?.length));
}

export async function readDouyinDetailFromOfficialPage(id: string, cookie: string): Promise<unknown | null> {
  // 不排无限队列，不将浏览器 fallback 扩到本机或其它应用。
  if (process.env.FLY_APP_NAME !== 'mvstudiopro' || !process.env.FLY_MACHINE_ID ||
      !/^\d{5,30}$/.test(id) || !cookie || active || os.freemem() < 1024 ** 3) return null;
  active = true;
  const deadline = Date.now() + 100_000;
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (os.freemem() < 1024 ** 3 || Date.now() >= deadline) return null;
      const result = await readOfficialPageAttempt(id, cookie,
        Math.min(deadline, Date.now() + 19_000));
      if (result) return result;
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 750));
    }
    return null;
  } finally { active = false; }
}

/** 首次加四次重试共用总预算，每次关闭独立浏览器，既有会话不写回。 */
async function readOfficialPageAttempt(id: string, cookie: string, deadline: number): Promise<unknown | null> {
  let root: string | undefined;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    root = await fs.mkdtemp('/dev/shm/douyin-detail-');
    await fs.chmod(root, 0o700);
    browser = await puppeteer.launch({ headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      userDataDir: `${root}/profile`, timeout: Math.max(1, Math.min(20_000, deadline - Date.now())), protocolTimeout: 15_000,
      env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, LANG: 'C.UTF-8' },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
        '--disable-breakpad', '--disable-crash-reporter', '--disk-cache-size=0'],
    });
    const child = browser.process();
    deadlineTimer = setTimeout(() => child?.kill('SIGKILL'), Math.max(1, deadline - Date.now()));
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    const cookies = cookie.split(';').flatMap(pair => {
      const at = pair.indexOf('=');
      if (at < 1) return [];
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      return /^[A-Za-z0-9_-]+$/.test(name) && value && !/[\r\n;]/.test(value)
        ? [{ name, value, domain: '.douyin.com', path: '/', secure: true }] : [];
    });
    await page.setCookie(...cookies);
    let payload: unknown | null = null;
    // 必须先监听再导航；拒绝推荐视频、空详情及非官方响应。
    const response = page.waitForResponse(async r => {
      if (!r.ok() || !isTargetDouyinDetailResponse(r.url(), id)) return false;
      try {
        const candidate: unknown = await r.json();
        if (!isUsableDouyinBrowserDetail(candidate, id)) return false;
        payload = candidate;
        return true;
      } catch { return false; }
    }, { timeout: Math.max(1, deadline - Date.now()) }).catch(() => null);
    void page.goto(`https://www.douyin.com/video/${id}`, {
      waitUntil: 'domcontentloaded', timeout: Math.max(1, deadline - Date.now()),
    }).catch(() => null);
    await response;
    return payload;
  } catch {
    // Puppeteer 异常可能包含签名 URL，不向日志/调用方传递原异常。
    return null;
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (browser) {
      const child = browser.process();
      const kill = setTimeout(() => child?.kill('SIGKILL'), 3000);
      try { await browser.close(); } catch { child?.kill('SIGKILL'); }
      finally { clearTimeout(kill); }
    }
    if (root) await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * IndexNow 推送：发新文章后主动通知 Bing（以及共用 IndexNow 的 Yandex、Seznam 等），
 * 不用等爬虫下次自己来读 robots.txt。
 *
 * 用法（**必须在部署完成之后跑**，否则推过去的是 404，会扣信任分）：
 *   pnpm blog:ping           只推 lastmod 是今天的页面
 *   pnpm blog:ping --all     推 sitemap 里全部页面
 *   pnpm blog:ping --dry     只打印要推什么，不发请求
 *
 * key 文件必须在线：https://www.mvstudiopro.com/<key>.txt，内容就是 key 本身。
 */
const KEY = "99251eca1df94540950743fd7f9c1b82";
const HOST = "www.mvstudiopro.com";
const SITE = `https://${HOST}`;
const KEY_LOCATION = `${SITE}/${KEY}.txt`;
const SITEMAP_URL = `${SITE}/sitemap.xml`;
const INDEXNOW_URL = "https://api.indexnow.org/indexnow";

const args = new Set(process.argv.slice(2));
const pushAll = args.has("--all");
const dryRun = args.has("--dry");

type SitemapEntry = { loc: string; lastmod: string };

function parseSitemap(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = m[1].match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim() || "";
    const lastmod = m[1].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]?.trim() || "";
    if (loc) out.push({ loc, lastmod });
  }
  return out;
}

function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 推之前逐条确认线上真的 200。推 404 比不推更糟。 */
async function keepLiveOnly(urls: string[]): Promise<{ live: string[]; dead: string[] }> {
  const live: string[] = [];
  const dead: string[] = [];
  for (const u of urls) {
    try {
      const res = await fetch(u, { method: "HEAD", redirect: "follow" });
      if (res.ok) live.push(u);
      else dead.push(`${u} → HTTP ${res.status}`);
    } catch (err) {
      dead.push(`${u} → ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { live, dead };
}

async function main() {
  const keyRes = await fetch(KEY_LOCATION);
  const keyBody = (await keyRes.text()).trim();
  if (!keyRes.ok || keyBody !== KEY) {
    throw new Error(
      `key 文件校验失败（${KEY_LOCATION} → HTTP ${keyRes.status}，内容「${keyBody.slice(0, 40)}」）。` +
        `先确认它已随部署上线，再来推送。`,
    );
  }
  console.log(`[indexnow] key 文件校验通过`);

  const xml = await fetch(SITEMAP_URL).then((r) => r.text());
  const entries = parseSitemap(xml);
  if (!entries.length) throw new Error(`sitemap 解析不到任何 url：${SITEMAP_URL}`);

  const today = todayLocal();
  const picked = pushAll ? entries : entries.filter((e) => e.lastmod === today);
  if (!picked.length) {
    console.log(`[indexnow] 今天（${today}）没有更新的页面，无需推送。要全推用 --all`);
    return;
  }

  const { live, dead } = await keepLiveOnly(picked.map((e) => e.loc));
  for (const d of dead) console.warn(`[indexnow] 跳过未上线：${d}`);
  if (!live.length) {
    throw new Error("挑出来的页面一个都不是 200，八成是还没部署完，先等部署再跑");
  }

  console.log(`[indexnow] 待推 ${live.length} 条：`);
  for (const u of live) console.log(`  ${u}`);
  if (dryRun) {
    console.log("[indexnow] --dry，未实际发送");
    return;
  }

  const res = await fetch(INDEXNOW_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: live }),
  });
  const body = await res.text();
  // IndexNow 成功是 200 或 202（202 表示已收下、key 还在异步校验）
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`IndexNow 返回 HTTP ${res.status}：${body.slice(0, 300)}`);
  }
  console.log(`[indexnow] 已提交 ${live.length} 条，HTTP ${res.status}`);
}

main().catch((err) => {
  console.error(`[indexnow] 失败：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

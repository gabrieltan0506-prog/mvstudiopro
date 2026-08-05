/**
 * 把 content/blog/*.md 编译成 client/public/blog/ 下的**静态 HTML**，并同步 sitemap。
 *
 * 为什么不走 SPA 路由：做博客的目的就是让 AI 检索爬虫（GPTBot、ClaudeBot、
 * PerplexityBot）读到内容，而这些爬虫基本不执行 JavaScript。如果文章靠前端路由渲染，
 * 爬虫抓到的仍是空 div，等于白做——本站首页此前就是这样，368KB 里只有 29 个可见字。
 * 静态页 100% 能抓，还不用往前端 bundle 里塞 markdown 渲染器。
 *
 * 每篇文章带 Article + BreadcrumbList 结构化数据：AI 生成答案时优先引用有标注的内容。
 *
 * 用法：**本地** `pnpm blog:build`，产物（client/public/blog/ 与 sitemap）随代码提交。
 *
 * 不要再挂进 vercel.json 的 buildCommand：挂上去之后 Vercel 每一次前台构建都失败，
 * www 卡在 2026-08-05 22:34 的旧版长达六小时（`/blog` 与 `/llms.txt` 404、
 * 导航还是旧名、大文档 GCS 直传也没生效）。加一篇文章就本地跑一次、连产物一起提交。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { marked } from "marked";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "content", "blog");
const OUT = path.join(ROOT, "client", "public", "blog");
const SITEMAP = path.join(ROOT, "client", "public", "sitemap.xml");
const SITE = "https://www.mvstudiopro.com";

type Post = {
  slug: string;
  title: string;
  description: string;
  date: string;
  keywords: string;
  html: string;
  readMinutes: number;
  /** 分享卡片图：取正文第一张图，没有就退回站点图标 */
  cover: string;
};

/** 解析 front matter：只认 `key: value`，够用且不引入 yaml 依赖 */
function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of raw.slice(3, end).split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: raw.slice(end + 4).trimStart() };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #0f1115; color: #e6e6ea;
    font: 16px/1.85 -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  }
  .wrap { max-width: 760px; margin: 0 auto; padding: 40px 22px 96px; }
  nav.top { font-size: 13px; color: #8b8b96; margin-bottom: 32px; }
  nav.top a { color: #7fd1ff; text-decoration: none; }
  nav.top a:hover { text-decoration: underline; }
  h1 { font-size: 30px; line-height: 1.35; margin: 0 0 12px; letter-spacing: -.01em; }
  h2 { font-size: 21px; margin: 44px 0 14px; padding-top: 8px; border-top: 1px solid #23262e; }
  h3 { font-size: 17px; margin: 28px 0 10px; }
  .meta { font-size: 13px; color: #8b8b96; margin-bottom: 36px; }
  p { margin: 0 0 18px; }
  ul, ol { margin: 0 0 18px; padding-left: 24px; }
  li { margin: 6px 0; }
  strong { color: #fff; }
  a { color: #7fd1ff; }
  blockquote {
    margin: 0 0 22px; padding: 12px 18px; border-left: 3px solid #7fd1ff;
    background: #161922; color: #b9b9c4; font-size: 15px;
  }
  blockquote p { margin: 0; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 24px; font-size: 14.5px; }
  th, td { padding: 9px 12px; border-bottom: 1px solid #23262e; text-align: left; }
  th { color: #fff; background: #161922; font-weight: 600; }
  code {
    background: #1b1f28; padding: 2px 6px; border-radius: 4px;
    font: 13.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  pre {
    background: #161922; padding: 16px 18px; border-radius: 8px; overflow-x: auto;
    margin: 0 0 22px; border: 1px solid #23262e;
  }
  pre code { background: none; padding: 0; }
  hr { border: 0; border-top: 1px solid #23262e; margin: 40px 0; }
  em { color: #a9a9b6; }

  /* 图片与视频：不加 max-width 的话，一张成片截图就能把版面撑破 */
  img, video { max-width: 100%; height: auto; display: block;
               border-radius: 8px; border: 1px solid #23262e; margin: 0 0 8px; }
  figure { margin: 24px 0; }
  figure img, figure video { margin-bottom: 8px; }
  figcaption { font-size: 13px; color: #8b8b96; text-align: center; }
  /* B 站 / YouTube 等外链视频：按 16:9 自适应，手机上也不会溢出 */
  .video-embed { position: relative; padding-bottom: 56.25%; height: 0;
                 margin: 24px 0; border-radius: 8px; overflow: hidden;
                 border: 1px solid #23262e; }
  .video-embed iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  footer { margin-top: 64px; padding-top: 24px; border-top: 1px solid #23262e;
           font-size: 13px; color: #8b8b96; }
  footer a { margin-right: 16px; }
  .cards { display: grid; gap: 14px; margin: 28px 0 0; }
  .card { display: block; padding: 18px 20px; background: #161922; border: 1px solid #23262e;
          border-radius: 10px; text-decoration: none; color: inherit; }
  .card:hover { border-color: #7fd1ff55; background: #1a1e28; }
  .card h2 { margin: 0 0 8px; font-size: 18px; border: 0; padding: 0; color: #fff; }
  .card p { margin: 0; font-size: 14px; color: #a9a9b6; }
  .card .meta { margin: 10px 0 0; font-size: 12px; }
`;

function layout(opts: {
  title: string;
  description: string;
  canonical: string;
  jsonLd: unknown;
  keywords?: string;
  body: string;
  cover?: string;
}): string {
  const cover = opts.cover || `${SITE}/pwa-icon-512.png`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeHtml(opts.description)}">
${opts.keywords ? `<meta name="keywords" content="${escapeHtml(opts.keywords)}">` : ""}
<link rel="canonical" href="${opts.canonical}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="MV Studio Pro">
<meta property="og:locale" content="zh_CN">
<meta property="og:url" content="${opts.canonical}">
<meta property="og:title" content="${escapeHtml(opts.title)}">
<meta property="og:description" content="${escapeHtml(opts.description)}">
<meta property="og:image" content="${cover}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(opts.title)}">
<meta name="twitter:description" content="${escapeHtml(opts.description)}">
<meta name="twitter:image" content="${cover}">
<link rel="icon" type="image/svg+xml" href="/pwa-icon.svg">
<style>${CSS}</style>
<script type="application/ld+json">
${JSON.stringify(opts.jsonLd, null, 2)}
</script>
</head>
<body>
<div class="wrap">
${opts.body}
<footer>
  <a href="/">MV Studio Pro 首页</a>
  <a href="/blog/">全部文章</a>
  <a href="/pricing">定价</a>
</footer>
</div>
</body>
</html>
`;
}

async function main(): Promise<void> {
  let files: string[];
  try {
    files = (await fs.readdir(SRC)).filter((f) => f.endsWith(".md"));
  } catch {
    console.log("[blog] 没有 content/blog 目录，跳过");
    return;
  }
  if (!files.length) {
    console.log("[blog] 没有文章，跳过");
    return;
  }

  await fs.mkdir(OUT, { recursive: true });
  const posts: Post[] = [];

  for (const file of files) {
    const raw = await fs.readFile(path.join(SRC, file), "utf-8");
    const { meta, body } = parseFrontMatter(raw);
    const slug = file.replace(/\.md$/, "");
    const title = meta.title || body.match(/^#\s+(.+)$/m)?.[1] || slug;
    // 正文首个非标题非引用段落兜底当摘要
    const description =
      meta.description ||
      body
        .split("\n")
        .find((l) => l.trim() && !/^[#>|\-*]/.test(l.trim()))
        ?.slice(0, 150) ||
      "";
    const html = await marked.parse(body.replace(/^#\s+.+$/m, "").trimStart());
    // 中文按字数估阅读时长，每分钟约 400 字
    const plain = body.replace(/[#>*`|\-]/g, "");
    // 分享卡片图取正文第一张图。默认那个 PWA 图标做封面很难看，
    // 而社交平台的点击率极依赖这张图。front matter 里写 cover 可覆盖。
    const firstImg = body.match(/!\[[^\]]*\]\(([^)\s]+)/)?.[1];
    const coverRaw = meta.cover || firstImg || "";
    const cover = coverRaw
      ? coverRaw.startsWith("http")
        ? coverRaw
        : `${SITE}${coverRaw.startsWith("/") ? "" : "/"}${coverRaw}`
      : "";
    posts.push({
      slug,
      title,
      description,
      date: meta.date || new Date().toISOString().slice(0, 10),
      keywords: meta.keywords || "",
      html,
      readMinutes: Math.max(1, Math.round(plain.length / 400)),
      cover,
    });
  }

  posts.sort((a, b) => b.date.localeCompare(a.date));

  // ── 文章页 ──
  for (const p of posts) {
    const url = `${SITE}/blog/${p.slug}`;
    const jsonLd = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Article",
          headline: p.title,
          description: p.description,
          datePublished: p.date,
          dateModified: p.date,
          inLanguage: "zh-CN",
          mainEntityOfPage: { "@type": "WebPage", "@id": url },
          author: { "@type": "Organization", name: "MV Studio Pro", url: SITE },
          publisher: {
            "@type": "Organization",
            name: "MV Studio Pro",
            url: SITE,
            logo: { "@type": "ImageObject", url: `${SITE}/pwa-icon-512.png` },
          },
          ...(p.keywords ? { keywords: p.keywords } : {}),
          ...(p.cover ? { image: p.cover } : {}),
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "首页", item: `${SITE}/` },
            { "@type": "ListItem", position: 2, name: "文章", item: `${SITE}/blog/` },
            { "@type": "ListItem", position: 3, name: p.title, item: url },
          ],
        },
      ],
    };

    const body = `<nav class="top"><a href="/">首页</a> › <a href="/blog/">文章</a></nav>
<article>
<h1>${escapeHtml(p.title)}</h1>
<p class="meta">${p.date} · 约 ${p.readMinutes} 分钟</p>
${p.html}
</article>`;

    const page = layout({
      title: `${p.title} · MV Studio Pro`,
      description: p.description,
      canonical: url,
      jsonLd,
      keywords: p.keywords,
      body,
      cover: p.cover,
    });
    await fs.writeFile(path.join(OUT, `${p.slug}.html`), page, "utf-8");
    /**
     * 同一篇再写一份目录索引。
     *
     * 对外链接（sitemap / llms.txt / 列表页）用的是不带扩展名的 `/blog/<slug>`，
     * 而 vercel.json 末尾那条 SPA 兜底重写会把它当前端路由吃掉——上线后点进文章
     * 拿到的是 378KB 的应用外壳，爬虫更是什么都读不到。除了给 blog 加重写规则，
     * 这份 `<slug>/index.html` 让静态文件本身就能命中：文件系统在重写之前匹配，
     * 规则万一失效也不会退回空壳。
     */
    await fs.mkdir(path.join(OUT, p.slug), { recursive: true });
    await fs.writeFile(path.join(OUT, p.slug, "index.html"), page, "utf-8");
  }

  // ── 列表页 ──
  const listJsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "MV Studio Pro 技术与实测",
    url: `${SITE}/blog/`,
    inLanguage: "zh-CN",
    blogPost: posts.map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      description: p.description,
      datePublished: p.date,
      url: `${SITE}/blog/${p.slug}`,
    })),
  };

  const cards = posts
    .map(
      (p) => `  <a class="card" href="/blog/${p.slug}">
    <h2>${escapeHtml(p.title)}</h2>
    <p>${escapeHtml(p.description)}</p>
    <p class="meta">${p.date} · 约 ${p.readMinutes} 分钟</p>
  </a>`,
    )
    .join("\n");

  await fs.writeFile(
    path.join(OUT, "index.html"),
    layout({
      title: "技术与实测 · MV Studio Pro",
      description:
        "AI 视频与图文创作的一手实测数据：模型真实单价、内容生产成本拆解、供应商链路排查。数字来自真实调用账单，不是官网标价。",
      canonical: `${SITE}/blog/`,
      jsonLd: listJsonLd,
      body: `<nav class="top"><a href="/">首页</a> › 文章</nav>
<h1>技术与实测</h1>
<p class="meta">AI 视频与图文创作的一手数据。所有数字来自真实调用后的账单，不是官网标价。</p>
<div class="cards">
${cards}
</div>`,
    }),
    "utf-8",
  );

  // ── 同步 sitemap：重写 blog 段，保留其余 ──
  let xml = await fs.readFile(SITEMAP, "utf-8");
  // 注意匹配整段注释：起始注释后面还跟着「由 … 生成」，写死 `<!-- blog:start -->`
  // 会一次都匹配不上，于是每跑一次就往 sitemap 里再追加一个 blog 段（已重复四遍）。
  xml = xml.replace(/\n\s*<!-- blog:start[\s\S]*?<!-- blog:end -->/g, "");
  const entries = [
    `  <url>\n    <loc>${SITE}/blog/</loc>\n    <lastmod>${posts[0].date}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`,
    ...posts.map(
      (p) =>
        `  <url>\n    <loc>${SITE}/blog/${p.slug}</loc>\n    <lastmod>${p.date}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`,
    ),
  ].join("\n");
  xml = xml.replace(
    "</urlset>",
    `\n  <!-- blog:start 由 scripts/build-blog.mts 生成，勿手改 -->\n${entries}\n  <!-- blog:end -->\n\n</urlset>`,
  );
  await fs.writeFile(SITEMAP, xml, "utf-8");

  console.log(`[blog] 生成 ${posts.length} 篇 + 列表页，已同步 sitemap`);
  for (const p of posts) console.log(`        /blog/${p.slug}  ${p.title}`);
}

main().catch((e) => {
  // 不要 exit(1)：这个脚本挂在 vercel.json 的 buildCommand 最前面，
  // 一旦非零退出会把整个前台构建带崩。博客生成失败最多是少几页静态文章，
  // 不该连累首页与应用上线。
  console.error("[blog] 生成失败，跳过（不阻断构建）：", e);
});

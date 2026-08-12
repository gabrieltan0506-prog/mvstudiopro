# blog-geo · 博文与 GEO 收录管线

## 发布链（顺序硬）
1. `content/blog/*.md`，frontmatter：title/description/keywords/date/cover。
2. `pnpm blog:build` —— 自动产 Article/FAQPage/Breadcrumb JSON-LD（FAQ 取自 `## 常见问题` 小节）、RSS、sitemap。
3. 部署 → 真实浏览器验证页面 200（curl 被 WAF 拦，无效）。
4. `pnpm blog:publish --no-build` 触发 IndexNow —— **注意 UTC 日期 bug：北京时间 08:00 前跑会打昨天的日期**。
5. Google 不吃 IndexNow，需 Search Console 手动提交。

## 铁律
- **静态资源文件名一律 ASCII**——中文文件名线上必 404（5 张图全灭实锤，同批 ASCII 视频全活）。
- 防下载三件套：`nodownload` + `oncontextmenu` 拦截 + `draggable=false`。
- 成本口径只写区间不写绝对价、不露供应商/通道名（前台零技术泄漏）。
- 素材缺口如实写「下期补上」，不当场烧钱硬补（work-rules 19.5）。
- 文章媒体必须是真管线产物——流程性声称（如「图生视频」）须有 API 回执级证据（P0-6 教训）。

## 现有资产
- 首页每日轮播：`HomeBlogShowcase` 6 篇池按日轮换，/blog 是静态页要用 `<a>` 整页跳转（非 SPA 路由）。
- PK 素材包 `~/Downloads/2026Aug12/pk-kimi-vs-qwen/`（文章 md、双引擎 JSON、README 含发布管线与数据出处、全部媒体原件）。

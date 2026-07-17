/**
 * HB V6 · 网站式 HTML PPT（三风格）
 * 原版 Marvis html-ppt-maker 未开源；按 PDF + website-ppt-style-skill-refs 重建。
 * 输出：单文件 16:9 横向翻页 HTML。
 */

export type HtmlPptStyleId = "dark_research" | "pitch_orange" | "figma_timeline";

export type HtmlPptPage = {
  title: string;
  subtitle?: string;
  bullets?: string[];
  /** 大数字 / KPI */
  kpi?: string;
  note?: string;
};

export type HtmlPptDeckInput = {
  title: string;
  styleId: HtmlPptStyleId;
  purposeZh?: string;
  pages: HtmlPptPage[];
};

export const HTML_PPT_STYLES: Record<
  HtmlPptStyleId,
  { labelZh: string; blurbZh: string; whenZh: string }
> = {
  dark_research: {
    labelZh: "暗黑数据研究报告",
    blurbZh: "深色底 + 高对比数字 + 图表感信息层",
    whenZh: "AI/资本/行业趋势/数据洞察",
  },
  pitch_orange: {
    labelZh: "黑橙路演官网",
    blurbZh: "黑底橙强调 + 路演叙事节奏",
    whenZh: "创业路演/产品介绍/商业计划",
  },
  figma_timeline: {
    labelZh: "蓝白 Figma 信息图时间线",
    blurbZh: "浅底蓝强调 + 时间线/计划板",
    whenZh: "产品计划/项目管理/路线图/复盘",
  },
};

export const HTML_PPT_QUALITY_CHECKLIST_ZH = `【网站式 PPT·质量检查】
1. 每页固定 16:9，横向翻页，不是长页面滚动博客。
2. 符合选定风格（暗黑数据 / 黑橙路演 / 蓝白 Figma），勿退化成普通白卡片网页。
3. 每页一个主判断：大标题 + 关键数字或一张主图/主列表。
4. 有页码；键盘 ←→ / 空格可翻页；动效克制（入场 fade/slide）。
5. 导出为单文件 HTML 即可本地打开使用。` as const;

const STYLE_CSS: Record<HtmlPptStyleId, string> = {
  dark_research: `
:root{--bg:#0b0f14;--card:#121821;--text:#e8eef7;--muted:#8b9bb0;--accent:#5eead4;--line:#243041}
body{background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,"PingFang SC","Noto Sans SC",sans-serif}
.slide{background:linear-gradient(160deg,#0b0f14 0%,#121821 55%,#0d1520 100%)}
.kpi{color:var(--accent);font-weight:800;font-size:clamp(2.4rem,6vw,4.5rem);letter-spacing:-.03em}
.accent{color:var(--accent)}
.bar{height:3px;background:linear-gradient(90deg,var(--accent),transparent)}
`,
  pitch_orange: `
:root{--bg:#0a0a0a;--card:#141414;--text:#fff7ed;--muted:#c4b5a5;--accent:#f97316;--line:#2a2118}
body{background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,"PingFang SC","Noto Sans SC",sans-serif}
.slide{background:radial-gradient(1200px 600px at 80% -10%,rgba(249,115,22,.18),transparent 55%),#0a0a0a}
.kpi{color:var(--accent);font-weight:900;font-size:clamp(2.4rem,6vw,4.5rem)}
.accent{color:var(--accent)}
.bar{height:4px;background:linear-gradient(90deg,var(--accent),#fb923c,transparent)}
`,
  figma_timeline: `
:root{--bg:#f4f7fb;--card:#ffffff;--text:#0f172a;--muted:#64748b;--accent:#2563eb;--line:#dbe3ef}
body{background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,"PingFang SC","Noto Sans SC",sans-serif}
.slide{background:linear-gradient(180deg,#fff 0%,#f4f7fb 100%);border:1px solid var(--line)}
.kpi{color:var(--accent);font-weight:800;font-size:clamp(2.2rem,5.5vw,4rem)}
.accent{color:var(--accent)}
.bar{height:3px;background:linear-gradient(90deg,var(--accent),#93c5fd)}
.timeline{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}
.tl{flex:1;min-width:140px;border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:#fff}
.tl b{display:block;color:var(--accent);font-size:12px;margin-bottom:6px}
`,
};

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function recommendHtmlPptStyle(purposeZh: string): HtmlPptStyleId {
  const t = String(purposeZh || "");
  if (/路演|融资|商业计划|pitch|创业/.test(t)) return "pitch_orange";
  if (/计划|复盘|路线|项目管理|时间线|Figma|季度/.test(t)) return "figma_timeline";
  return "dark_research";
}

/** 按风格给中段页骨架（清单确认前可编辑） */
function midPagesForStyle(styleId: HtmlPptStyleId): HtmlPptPage[] {
  if (styleId === "pitch_orange") {
    return [
      { title: "问题与机会", kpi: "WHY", bullets: ["痛点够疼", "时机窗口", "为什么是现在"] },
      { title: "解决方案", kpi: "HOW", bullets: ["产品一句话", "核心功能", "差异化抓手"] },
      { title: "市场与增长", kpi: "TAM", bullets: ["目标客群", "获客路径", "北极星指标"] },
      { title: "商业模式", bullets: ["收费方式", "单位经济", "扩张杠杆"] },
      { title: "竞争壁垒", bullets: ["护城河", "不可复制点", "风险与应对"] },
      { title: "里程碑", bullets: ["90 天目标", "关键招聘", "融资用途"] },
    ];
  }
  if (styleId === "figma_timeline") {
    return [
      { title: "目标与成功标准", kpi: "OKR", bullets: ["本季目标", "可验收指标", "非目标边界"] },
      { title: "现状与缺口", bullets: ["已完成", "阻塞点", "依赖方"] },
      { title: "路线图总览", bullets: ["Now", "Next", "Later"] },
      { title: "里程碑时间线", bullets: ["W1–W2 对齐", "W3–W4 试点", "W5+ 扩张"] },
      { title: "分工与节奏", bullets: ["Owner", "协作接口", "评审节点"] },
      { title: "风险与复盘点", bullets: ["执行风险", "范围蔓延", "复盘清单"] },
    ];
  }
  return [
    { title: "核心洞察", kpi: "3×", bullets: ["现状断层", "用户真需求", "可验证信号"] },
    { title: "关键数据", kpi: "72%", bullets: ["样本口径清晰", "趋势方向明确", "风险可解释"] },
    { title: "结构拆解", bullets: ["驱动因素", "对比基准", "异常点"] },
    { title: "方案路径", bullets: ["阶段 A：验证", "阶段 B：放大", "阶段 C：系统化"] },
    { title: "竞争与壁垒", bullets: ["差异化抓手", "护城河", "不可复制点"] },
    { title: "风险与对策", bullets: ["执行风险", "数据风险", "组织风险"] },
  ];
}

/** 默认页面清单（先出清单，确认后再生成 HTML） */
export function buildDefaultHtmlPptPages(
  title: string,
  pageCount: number,
  purposeZh?: string,
  styleId: HtmlPptStyleId = "dark_research",
): HtmlPptPage[] {
  const n = Math.max(3, Math.min(16, Math.floor(pageCount || 6)));
  const topic = String(title || "主题").trim().slice(0, 80);
  const purpose = String(purposeZh || "汇报").trim().slice(0, 40);
  const styleLabel = HTML_PPT_STYLES[styleId]?.labelZh || "网站式 PPT";
  const pages: HtmlPptPage[] = [
    { title: topic, subtitle: `${purpose} · ${styleLabel}`, kpi: "01", note: "封面：一句话主判断" },
    { title: "目录与叙事线", bullets: ["问题与机会", "关键洞察", "方案与路径", "数据与证明", "下一步"] },
  ];
  const mids = midPagesForStyle(styleId);
  for (let i = 0; pages.length < n - 1 && i < mids.length; i++) pages.push(mids[i]!);
  while (pages.length < n - 1) {
    pages.push({
      title: `展开 ${pages.length}`,
      bullets: ["要点一", "要点二", "要点三"],
    });
  }
  pages.push({
    title: "下一步与 CTA",
    subtitle: "确认清单后即可导出 HTML 演示",
    bullets: ["确认风格与页序", "补关键数字与案例", "导出单文件 HTML 投屏"],
    kpi: "GO",
  });
  return pages.slice(0, n);
}

/** 规范化用户编辑后的清单 */
export function normalizeHtmlPptPages(pages: HtmlPptPage[]): HtmlPptPage[] {
  return (pages || [])
    .map((p) => ({
      title: String(p?.title || "").trim().slice(0, 80),
      subtitle: p?.subtitle ? String(p.subtitle).trim().slice(0, 120) : undefined,
      kpi: p?.kpi ? String(p.kpi).trim().slice(0, 16) : undefined,
      note: p?.note ? String(p.note).trim().slice(0, 160) : undefined,
      bullets: Array.isArray(p?.bullets)
        ? p.bullets.map((b) => String(b || "").trim()).filter(Boolean).slice(0, 8)
        : undefined,
    }))
    .filter((p) => p.title)
    .slice(0, 16);
}

export function buildHtmlPptDocument(input: HtmlPptDeckInput): string {
  const styleId = input.styleId in HTML_PPT_STYLES ? input.styleId : "dark_research";
  const styleMeta = HTML_PPT_STYLES[styleId];
  const pages = (input.pages || []).filter((p) => p && p.title);
  const safePages = pages.length
    ? pages
    : buildDefaultHtmlPptPages(input.title, 6, input.purposeZh, styleId);
  const title = escapeHtml(input.title || "Website PPT");
  const slidesHtml = safePages
    .map((p, i) => {
      const bullets = (p.bullets || [])
        .map((b) => `<li>${escapeHtml(b)}</li>`)
        .join("");
      const timeline =
        styleId === "figma_timeline" && (p.bullets || []).length
          ? `<div class="timeline">${(p.bullets || [])
              .map((b, j) => `<div class="tl"><b>STEP ${j + 1}</b>${escapeHtml(b)}</div>`)
              .join("")}</div>`
          : bullets
            ? `<ul>${bullets}</ul>`
            : "";
      return `<section class="slide" data-i="${i}">
  <div class="bar"></div>
  <div class="meta"><span class="accent">${escapeHtml(styleMeta.labelZh)}</span><span>${i + 1} / ${safePages.length}</span></div>
  ${p.kpi ? `<div class="kpi">${escapeHtml(p.kpi)}</div>` : ""}
  <h1>${escapeHtml(p.title)}</h1>
  ${p.subtitle ? `<p class="sub">${escapeHtml(p.subtitle)}</p>` : ""}
  ${timeline}
  ${p.note ? `<p class="note">${escapeHtml(p.note)}</p>` : ""}
</section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden}
${STYLE_CSS[styleId]}
.deck{height:100%;width:100%;display:flex;transition:transform .45s cubic-bezier(.22,1,.36,1)}
.slide{min-width:100vw;height:100vh;padding:clamp(28px,5vw,64px);display:flex;flex-direction:column;justify-content:center;position:relative}
.meta{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:18px}
h1{font-size:clamp(1.8rem,4.5vw,3.2rem);line-height:1.15;margin:8px 0 12px;letter-spacing:-.02em;max-width:18ch}
.sub{color:var(--muted);font-size:clamp(1rem,2vw,1.25rem);margin:0 0 18px;max-width:46ch}
ul{margin:10px 0 0;padding-left:1.1em;font-size:clamp(1rem,1.8vw,1.25rem);line-height:1.55;color:var(--text)}
li{margin:8px 0}
.note{margin-top:22px;color:var(--muted);font-size:14px}
.hint{position:fixed;right:16px;bottom:14px;z-index:5;font-size:12px;color:var(--muted);background:rgba(0,0,0,.25);padding:6px 10px;border-radius:999px;backdrop-filter:blur(8px)}
.slide{animation:in .5s ease both}
@keyframes in{from{opacity:.35;transform:translateY(10px)}to{opacity:1;transform:none}}
</style>
</head>
<body>
<div class="deck" id="deck">
${slidesHtml}
</div>
<div class="hint">← → / 空格翻页 · ${escapeHtml(styleMeta.labelZh)}</div>
<script>
(function(){
  var deck=document.getElementById('deck');
  var n=deck.children.length; var i=0;
  function go(x){ i=Math.max(0,Math.min(n-1,x)); deck.style.transform='translateX('+(-i*100)+'vw)'; }
  window.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key===' ' ||e.key==='PageDown'){e.preventDefault();go(i+1)}
    if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();go(i-1)}
    if(e.key==='Home'){e.preventDefault();go(0)}
    if(e.key==='End'){e.preventDefault();go(n-1)}
  });
  var sx=0;
  window.addEventListener('touchstart',function(e){sx=e.changedTouches[0].clientX},{passive:true});
  window.addEventListener('touchend',function(e){var dx=e.changedTouches[0].clientX-sx; if(Math.abs(dx)>40) go(i+(dx<0?1:-1));},{passive:true});
})();
</script>
</body>
</html>`;
}

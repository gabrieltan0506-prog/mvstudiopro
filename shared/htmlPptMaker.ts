/**
 * 动效 PPT 生成演示（原 website-html-ppt / Marvis html-ppt-maker 站内重建）
 * 模板 = 仓内 CSS+版式预设（可代码扩容）；不吃 .pptx / 幻灯片图片包。
 * 输出：单文件 16:9 横向翻页 HTML。
 */

export type HtmlPptStyleId =
  | "dark_research"
  | "pitch_orange"
  | "figma_timeline"
  | "emerald_boardroom"
  | "noir_gold"
  | "rose_editorial"
  | "slate_consulting"
  | "ivory_academic"
  | "ocean_brief";

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

export type HtmlPptStyleMeta = {
  labelZh: string;
  blurbZh: string;
  whenZh: string;
  /** 选用前预览用色板（与 Downloads/template/*/style.json 对齐） */
  palette: { bg: string; text: string; muted: string; accent: string; card: string };
  /** 站内预览图（client/public） */
  previewUrl: string;
};

export const HTML_PPT_STYLES: Record<HtmlPptStyleId, HtmlPptStyleMeta> = {
  dark_research: {
    labelZh: "暗黑数据研究报告",
    blurbZh: "深色底 + 高对比数字 + 图表感信息层",
    whenZh: "AI/资本/行业趋势/数据洞察",
    palette: { bg: "#0b0f14", text: "#e8eef7", muted: "#8b9bb0", accent: "#5eead4", card: "#121821" },
    previewUrl: "/html-ppt-templates/dark_research/preview.jpg",
  },
  pitch_orange: {
    labelZh: "黑橙路演官网",
    blurbZh: "黑底橙强调 + 路演叙事节奏",
    whenZh: "创业路演/产品介绍/商业计划",
    palette: { bg: "#0a0a0a", text: "#fff7ed", muted: "#c4b5a5", accent: "#f97316", card: "#141414" },
    previewUrl: "/html-ppt-templates/pitch_orange/preview.jpg",
  },
  figma_timeline: {
    labelZh: "蓝白 Figma 信息图时间线",
    blurbZh: "浅底蓝强调 + 时间线/计划板",
    whenZh: "产品计划/项目管理/路线图/复盘",
    palette: { bg: "#f4f7fb", text: "#0f172a", muted: "#64748b", accent: "#2563eb", card: "#ffffff" },
    previewUrl: "/html-ppt-templates/figma_timeline/preview.jpg",
  },
  emerald_boardroom: {
    labelZh: "青绿董事会",
    blurbZh: "深青底 + 薄荷绿强调，稳重汇报",
    whenZh: "董事会/经营复盘/战略对齐",
    palette: { bg: "#06241f", text: "#ecfdf5", muted: "#99b8ae", accent: "#34d399", card: "#0c332c" },
    previewUrl: "/html-ppt-templates/emerald_boardroom/preview.jpg",
  },
  noir_gold: {
    labelZh: "黑金晚宴",
    blurbZh: "纯黑 + 金属金点缀，高端发布",
    whenZh: "品牌发布/高端峰会/年会致辞",
    palette: { bg: "#050505", text: "#faf6eb", muted: "#a89b7c", accent: "#d4af37", card: "#121212" },
    previewUrl: "/html-ppt-templates/noir_gold/preview.jpg",
  },
  rose_editorial: {
    labelZh: "玫瑰杂志",
    blurbZh: "浅粉灰底 + 玫红标题，编辑感",
    whenZh: "内容品牌/女性向/生活方式提案",
    palette: { bg: "#faf5f6", text: "#3f1d2e", muted: "#8b6b7a", accent: "#be123c", card: "#ffffff" },
    previewUrl: "/html-ppt-templates/rose_editorial/preview.jpg",
  },
  slate_consulting: {
    labelZh: "石板咨询",
    blurbZh: "冷灰蓝咨询风，条理清晰",
    whenZh: "咨询方案/客户提案/诊断报告",
    palette: { bg: "#e8eef4", text: "#0f172a", muted: "#64748b", accent: "#0e7490", card: "#ffffff" },
    previewUrl: "/html-ppt-templates/slate_consulting/preview.jpg",
  },
  ivory_academic: {
    labelZh: "象牙学术",
    blurbZh: "暖象牙纸感 + 墨绿强调",
    whenZh: "学术汇报/培训课件/知识分享",
    palette: { bg: "#f7f1e6", text: "#1c1917", muted: "#78716c", accent: "#14532d", card: "#fffdf8" },
    previewUrl: "/html-ppt-templates/ivory_academic/preview.jpg",
  },
  ocean_brief: {
    labelZh: "海风简报",
    blurbZh: "浅蓝渐变 + 海军蓝标题，清爽短会",
    whenZh: "周报/站会/进度简报",
    palette: { bg: "#e0f2fe", text: "#0c4a6e", muted: "#0369a1", accent: "#0284c7", card: "#ffffff" },
    previewUrl: "/html-ppt-templates/ocean_brief/preview.jpg",
  },
};

export const HTML_PPT_QUALITY_CHECKLIST_ZH = `【动效 PPT·质量检查】
1. 每页固定 16:9，横向翻页，不是长页面滚动博客。
2. 符合选定风格预设，勿退化成普通白卡片网页。
3. 每页一个主判断：大标题 + 关键数字或一张主列表。
4. 有页码；键盘 ←→ / 空格可翻页；入场动效克制（fade/slide）。
5. 导出为单文件 HTML 即可本地打开投屏。` as const;

/** 说明：模板扩容方式（给产品/协作用） */
export const HTML_PPT_TEMPLATE_EXTEND_HINT_ZH = `模板扩容：当前在 shared/htmlPptMaker.ts 用 CSS+版式预设自生成即可，无需上传 .pptx。
若以后要「外来模板」，优先支持：① 风格 JSON（色板+字阶+封面句式）；② 可选封面/底图 JPG/PNG；暂不解析任意 Office PPTX。`;

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
  emerald_boardroom: `
:root{--bg:#06241f;--card:#0c332c;--text:#ecfdf5;--muted:#99b8ae;--accent:#34d399;--line:#14532d}
body{background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,"PingFang SC","Noto Sans SC",sans-serif}
.slide{background:linear-gradient(145deg,#041c18 0%,#0a2f28 50%,#063028 100%)}
.kpi{color:var(--accent);font-weight:800;font-size:clamp(2.3rem,5.8vw,4.2rem)}
.accent{color:var(--accent)}
.bar{height:3px;background:linear-gradient(90deg,var(--accent),transparent)}
`,
  noir_gold: `
:root{--bg:#050505;--card:#121212;--text:#faf6eb;--muted:#a89b7c;--accent:#d4af37;--line:#2a2416}
body{background:var(--bg);color:var(--text);font-family:ui-serif,Georgia,"Noto Serif SC",serif}
.slide{background:radial-gradient(900px 500px at 10% 0%,rgba(212,175,55,.12),transparent 50%),#050505}
.kpi{color:var(--accent);font-weight:700;font-size:clamp(2.3rem,5.5vw,4rem);letter-spacing:.04em}
.accent{color:var(--accent)}
.bar{height:2px;background:linear-gradient(90deg,var(--accent),transparent)}
`,
  rose_editorial: `
:root{--bg:#faf5f6;--card:#fff;--text:#3f1d2e;--muted:#8b6b7a;--accent:#be123c;--line:#f0d5de}
body{background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,"PingFang SC","Noto Sans SC",sans-serif}
.slide{background:linear-gradient(180deg,#fff 0%,#faf5f6 100%);border:1px solid var(--line)}
.kpi{color:var(--accent);font-weight:800;font-size:clamp(2.2rem,5.2vw,3.8rem)}
.accent{color:var(--accent)}
.bar{height:3px;background:linear-gradient(90deg,var(--accent),#fda4af)}
`,
  slate_consulting: `
:root{--bg:#e8eef4;--card:#fff;--text:#0f172a;--muted:#64748b;--accent:#0e7490;--line:#cbd5e1}
body{background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,"PingFang SC","Noto Sans SC",sans-serif}
.slide{background:#fff;border-left:6px solid var(--accent);box-shadow:0 12px 40px rgba(15,23,42,.06)}
.kpi{color:var(--accent);font-weight:800;font-size:clamp(2.2rem,5vw,3.6rem)}
.accent{color:var(--accent)}
.bar{height:3px;background:var(--accent);width:72px;margin-bottom:8px}
`,
  ivory_academic: `
:root{--bg:#f7f1e6;--card:#fffdf8;--text:#1c1917;--muted:#78716c;--accent:#14532d;--line:#e7e0d2}
body{background:var(--bg);color:var(--text);font-family:ui-serif,Georgia,"Noto Serif SC",serif}
.slide{background:linear-gradient(180deg,#fffdf8,#f7f1e6);border:1px solid var(--line)}
.kpi{color:var(--accent);font-weight:700;font-size:clamp(2.1rem,5vw,3.4rem)}
.accent{color:var(--accent)}
.bar{height:2px;background:var(--accent);opacity:.7}
`,
  ocean_brief: `
:root{--bg:#e0f2fe;--card:#fff;--text:#0c4a6e;--muted:#0369a1;--accent:#0284c7;--line:#bae6fd}
body{background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,"PingFang SC","Noto Sans SC",sans-serif}
.slide{background:linear-gradient(135deg,#f0f9ff 0%,#e0f2fe 45%,#dbeafe 100%)}
.kpi{color:var(--accent);font-weight:800;font-size:clamp(2.2rem,5.2vw,3.8rem)}
.accent{color:var(--accent)}
.bar{height:4px;border-radius:99px;background:linear-gradient(90deg,var(--accent),#7dd3fc)}
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
  if (/董事|经营|战略对齐|高管/.test(t)) return "emerald_boardroom";
  if (/品牌发布|年会|峰会|高端|晚宴/.test(t)) return "noir_gold";
  if (/生活方式|杂志|女性|内容品牌|美妆/.test(t)) return "rose_editorial";
  if (/咨询|客户提案|诊断|方案书/.test(t)) return "slate_consulting";
  if (/学术|培训|课件|知识分享|讲座/.test(t)) return "ivory_academic";
  if (/周报|站会|简报|进度|standup/.test(t)) return "ocean_brief";
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
  if (styleId === "emerald_boardroom") {
    return [
      { title: "经营结论", kpi: "1页", bullets: ["本季结论", "同比/环比", "董事会需拍板项"] },
      { title: "财务与效率", kpi: "ROI", bullets: ["收入结构", "毛利与费用", "现金流"] },
      { title: "增长引擎", bullets: ["主引擎", "副引擎", "停投项"] },
      { title: "组织与执行", bullets: ["关键岗位", "节奏机制", "风险Owner"] },
      { title: "决策请求", bullets: ["批准事项", "资源诉求", "时间表"] },
    ];
  }
  if (styleId === "noir_gold") {
    return [
      { title: "品牌主张", kpi: "ONE", bullets: ["一句话定位", "情绪关键词", "视觉锚点"] },
      { title: "叙事高潮", bullets: ["冲突", "转折", "兑现承诺"] },
      { title: "体验与仪式", bullets: ["到场动线", "舞台节点", "社交传播点"] },
      { title: "合作与邀约", bullets: ["合作席位", "权益包", "下一步"] },
    ];
  }
  if (styleId === "rose_editorial") {
    return [
      { title: "封面判断", kpi: "封面", bullets: ["读者痛点", "态度句", "本期钩子"] },
      { title: "人物与场景", bullets: ["主人公", "生活场景", "冲突细节"] },
      { title: "方法论清单", bullets: ["步骤 1", "步骤 2", "步骤 3"] },
      { title: "案例切片", bullets: ["前后对比", "可复制动作", "避坑"] },
      { title: "行动号召", bullets: ["评论话题", "收藏理由", "下一期预告"] },
    ];
  }
  if (styleId === "slate_consulting") {
    return [
      { title: "诊断摘要", kpi: "FIND", bullets: ["现状", "根因假设", "优先缺口"] },
      { title: "框架与路径", bullets: ["阶段 1", "阶段 2", "阶段 3"] },
      { title: "工作包与交付", bullets: ["交付物", "验收标准", "协作界面"] },
      { title: "投入与回报", kpi: "ROI", bullets: ["人天", "费用", "预期收益"] },
      { title: "风险与治理", bullets: ["风险清单", "缓解动作", "治理节奏"] },
    ];
  }
  if (styleId === "ivory_academic") {
    return [
      { title: "问题陈述", bullets: ["研究问题", "为何重要", "边界"] },
      { title: "方法与材料", bullets: ["方法", "样本/材料", "局限"] },
      { title: "关键发现", kpi: "FIND", bullets: ["发现 1", "发现 2", "发现 3"] },
      { title: "讨论与意义", bullets: ["理论含义", "实践含义", "开放问题"] },
      { title: "结论与作业", bullets: ["结论", "课后任务", "延伸阅读"] },
    ];
  }
  if (styleId === "ocean_brief") {
    return [
      { title: "本周结论", kpi: "DONE", bullets: ["完成项", "指标变化", "阻塞"] },
      { title: "进行中", bullets: ["Owner", "截止日期", "风险"] },
      { title: "下周计划", bullets: ["优先 1", "优先 2", "需协调"] },
      { title: "需要拍板", bullets: ["决策项", "选项", "截止"] },
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
  const styleLabel = HTML_PPT_STYLES[styleId]?.labelZh || "动效 PPT";
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
  const title = escapeHtml(input.title || "动效PPT");
  const useTimeline = styleId === "figma_timeline";
  const slidesHtml = safePages
    .map((p, i) => {
      const bullets = (p.bullets || [])
        .map((b) => `<li>${escapeHtml(b)}</li>`)
        .join("");
      const timeline =
        useTimeline && (p.bullets || []).length
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
.deck{height:100%;width:100%;display:flex;transition:transform .55s cubic-bezier(.22,1,.36,1)}
.slide{min-width:100vw;height:100vh;padding:clamp(28px,5vw,64px);display:flex;flex-direction:column;justify-content:center;position:relative}
.meta{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:18px}
h1{font-size:clamp(1.8rem,4.5vw,3.2rem);line-height:1.15;margin:8px 0 12px;letter-spacing:-.02em;max-width:18ch}
.sub{color:var(--muted);font-size:clamp(1rem,2vw,1.25rem);margin:0 0 18px;max-width:46ch}
ul{margin:10px 0 0;padding-left:1.1em;font-size:clamp(1rem,1.8vw,1.25rem);line-height:1.55;color:var(--text)}
li{margin:8px 0}
.note{margin-top:22px;color:var(--muted);font-size:14px}
.hint{position:fixed;right:16px;bottom:14px;z-index:5;font-size:12px;color:var(--muted);background:rgba(0,0,0,.25);padding:6px 10px;border-radius:999px;backdrop-filter:blur(8px)}
.slide .kpi,.slide h1,.slide .sub,.slide ul,.slide .timeline,.slide .note{animation:rise .55s cubic-bezier(.22,1,.36,1) both}
.slide .kpi{animation-delay:.04s}
.slide h1{animation-delay:.1s}
.slide .sub{animation-delay:.16s}
.slide ul,.slide .timeline{animation-delay:.22s}
.slide .note{animation-delay:.28s}
@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
</style>
</head>
<body>
<div class="deck" id="deck">
${slidesHtml}
</div>
<div class="hint">← → / 空格翻页 · ${escapeHtml(styleMeta.labelZh)} · 动效PPT</div>
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

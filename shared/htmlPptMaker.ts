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

/** 页面可视化类型：导出 HTML 内嵌 SVG/CSS 真图表（非纯文字入场） */
export type HtmlPptVizKind =
  | "cover"
  | "ring"
  | "bars"
  | "columns"
  | "steps"
  | "cards"
  | "line"
  /** 左右对照：series 前半 vs 后半，适合年份/区域/模式对比 */
  | "compare"
  | "table"
  | "scene_cards"
  | "sentiment"
  | "hub";

export const HTML_PPT_VIZ_KINDS: readonly HtmlPptVizKind[] = [
  "cover",
  "ring",
  "bars",
  "columns",
  "steps",
  "cards",
  "line",
  "compare",
  "table",
  "scene_cards",
  "sentiment",
  "hub",
] as const;

const HTML_PPT_VIZ_OK = new Set<HtmlPptVizKind>(HTML_PPT_VIZ_KINDS);

export type HtmlPptTheme = { id: string; title: string };

/** series 允许绝对量级（亿元、万部、倍速）；条形宽度按页内 max 归一 */
function clampSeriesValue(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(1_000_000, n);
}

function seriesBarPct(value: number, max: number): number {
  return Math.max(2, Math.round((value / Math.max(1, max)) * 100));
}

function formatSeriesDisplay(value: number): string {
  if (value >= 1000) return String(Math.round(value));
  if (value >= 100) return String(Math.round(value));
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

export type HtmlPptPage = {
  title: string;
  subtitle?: string;
  bullets?: string[];
  /** 大数字 / KPI */
  kpi?: string;
  note?: string;
  /** 可选显式指定图表；不填则按 KPI/要点自动推断 */
  viz?: HtmlPptVizKind;
  /** 条形/柱状数据；不填则从要点或演示种子生成 */
  series?: Array<{ label: string; value: number }>;
  /** 挂靠的大纲主题 id */
  themeId?: string;
  themeTitle?: string;
  /** 需高亮闪烁的短句（与 bullets 对齐或独立） */
  highlight?: string[];
  /** 可选插图 HTTPS URL（封面/关键页） */
  imageUrl?: string;
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
  /** 选用前预览用色板（与 Downloads template 下各风格 style.json 对齐） */
  palette: { bg: string; text: string; muted: string; accent: string; card: string };
  /** 站内预览图（client/public） */
  previewUrl: string;
  /** 导出 HTML 叠底图（client/public；单文件用绝对路径，本地打开时相对站点根） */
  bgUrl: string;
};

function stylePublicUrls(id: HtmlPptStyleId) {
  return {
    previewUrl: `/html-ppt-templates/${id}/preview.jpg`,
    bgUrl: `/html-ppt-templates/${id}/bg.png`,
  };
}

export const HTML_PPT_STYLES: Record<HtmlPptStyleId, HtmlPptStyleMeta> = {
  dark_research: {
    labelZh: "暗黑数据研究报告",
    blurbZh: "深色底 + 高对比数字 + 图表感信息层",
    whenZh: "AI/资本/行业趋势/数据洞察",
    palette: { bg: "#0b0f14", text: "#e8eef7", muted: "#8b9bb0", accent: "#5eead4", card: "#121821" },
    ...stylePublicUrls("dark_research"),
  },
  pitch_orange: {
    labelZh: "黑橙路演官网",
    blurbZh: "黑底橙强调 + 路演叙事节奏",
    whenZh: "创业路演/产品介绍/商业计划",
    palette: { bg: "#0a0a0a", text: "#fff7ed", muted: "#c4b5a5", accent: "#f97316", card: "#141414" },
    ...stylePublicUrls("pitch_orange"),
  },
  figma_timeline: {
    labelZh: "蓝白 Figma 信息图时间线",
    blurbZh: "浅底蓝强调 + 时间线/计划板",
    whenZh: "产品计划/项目管理/路线图/复盘",
    palette: { bg: "#f4f7fb", text: "#0f172a", muted: "#64748b", accent: "#2563eb", card: "#ffffff" },
    ...stylePublicUrls("figma_timeline"),
  },
  emerald_boardroom: {
    labelZh: "青绿董事会",
    blurbZh: "深青底 + 薄荷绿强调，稳重汇报",
    whenZh: "董事会/经营复盘/战略对齐",
    palette: { bg: "#06241f", text: "#ecfdf5", muted: "#99b8ae", accent: "#34d399", card: "#0c332c" },
    ...stylePublicUrls("emerald_boardroom"),
  },
  noir_gold: {
    labelZh: "黑金晚宴",
    blurbZh: "纯黑 + 金属金点缀，高端发布",
    whenZh: "品牌发布/高端峰会/年会致辞",
    palette: { bg: "#050505", text: "#faf6eb", muted: "#a89b7c", accent: "#d4af37", card: "#121212" },
    ...stylePublicUrls("noir_gold"),
  },
  rose_editorial: {
    labelZh: "玫瑰杂志",
    blurbZh: "浅粉灰底 + 玫红标题，编辑感",
    whenZh: "内容品牌/女性向/生活方式提案",
    palette: { bg: "#faf5f6", text: "#3f1d2e", muted: "#8b6b7a", accent: "#be123c", card: "#ffffff" },
    ...stylePublicUrls("rose_editorial"),
  },
  slate_consulting: {
    labelZh: "石板咨询",
    blurbZh: "冷灰蓝咨询风，条理清晰",
    whenZh: "咨询方案/客户提案/诊断报告",
    palette: { bg: "#e8eef4", text: "#0f172a", muted: "#64748b", accent: "#0e7490", card: "#ffffff" },
    ...stylePublicUrls("slate_consulting"),
  },
  ivory_academic: {
    labelZh: "象牙学术",
    blurbZh: "暖象牙纸感 + 墨绿强调",
    whenZh: "学术汇报/培训课件/知识分享",
    palette: { bg: "#f7f1e6", text: "#1c1917", muted: "#78716c", accent: "#14532d", card: "#fffdf8" },
    ...stylePublicUrls("ivory_academic"),
  },
  ocean_brief: {
    labelZh: "海风简报",
    blurbZh: "浅蓝渐变 + 海军蓝标题，清爽短会",
    whenZh: "周报/站会/进度简报",
    palette: { bg: "#e0f2fe", text: "#0c4a6e", muted: "#0369a1", accent: "#0284c7", card: "#ffffff" },
    ...stylePublicUrls("ocean_brief"),
  },
};

export const HTML_PPT_QUALITY_CHECKLIST_ZH = `【动效 PPT·质量检查】
1. 每页固定 16:9，横向翻页，不是长页面滚动博客。
2. 符合选定风格预设，勿退化成普通白卡片网页。
3. 每页一个主判断 + 至少一种可视化（环形/条形/柱状/步骤轨/指标卡），动效按「构建步」分批揭示，禁止进页一次播完全部。
4. 有页码；空格/点击/↓ = 下一步动效；←→ = 翻页（与动效分离）。
5. 导出为单文件 HTML（图表 SVG 内嵌）即可投屏。` as const;

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
      {
        title: "问题与机会",
        kpi: "WHY",
        viz: "bars",
        bullets: ["痛点够疼", "时机窗口", "为什么是现在"],
        series: [
          { label: "痛点强度", value: 91 },
          { label: "时机窗口", value: 76 },
          { label: "紧迫度", value: 84 },
        ],
      },
      {
        title: "解决方案",
        kpi: "HOW",
        viz: "steps",
        bullets: ["产品一句话", "核心功能", "差异化抓手"],
      },
      {
        title: "市场与增长",
        kpi: "TAM",
        viz: "columns",
        bullets: ["目标客群", "获客路径", "北极星指标"],
        series: [
          { label: "TAM", value: 92 },
          { label: "SAM", value: 68 },
          { label: "SOM", value: 41 },
          { label: "增长", value: 77 },
        ],
      },
      {
        title: "商业模式",
        viz: "cards",
        bullets: ["收费方式", "单位经济", "扩张杠杆"],
        series: [
          { label: "毛利", value: 72 },
          { label: "复购", value: 58 },
          { label: "杠杆", value: 65 },
        ],
      },
      {
        title: "竞争壁垒",
        viz: "bars",
        bullets: ["护城河", "不可复制点", "风险与应对"],
        series: [
          { label: "护城河", value: 80 },
          { label: "不可复制", value: 66 },
          { label: "风险", value: 44 },
        ],
      },
      {
        title: "里程碑",
        viz: "steps",
        bullets: ["90 天目标", "关键招聘", "融资用途"],
      },
    ];
  }
  if (styleId === "figma_timeline") {
    return [
      {
        title: "目标与成功标准",
        kpi: "OKR",
        viz: "ring",
        bullets: ["本季目标", "可验收指标", "非目标边界"],
        series: [
          { label: "目标完成", value: 68 },
          { label: "指标达标", value: 74 },
          { label: "边界清晰", value: 90 },
        ],
      },
      {
        title: "现状与缺口",
        viz: "bars",
        bullets: ["已完成", "阻塞点", "依赖方"],
        series: [
          { label: "已完成", value: 55 },
          { label: "阻塞", value: 32 },
          { label: "依赖", value: 48 },
        ],
      },
      { title: "路线图总览", viz: "steps", bullets: ["Now", "Next", "Later"] },
      {
        title: "里程碑时间线",
        viz: "steps",
        bullets: ["W1–W2 对齐", "W3–W4 试点", "W5+ 扩张"],
      },
      {
        title: "分工与节奏",
        viz: "cards",
        bullets: ["Owner", "协作接口", "评审节点"],
      },
      {
        title: "风险与复盘点",
        viz: "bars",
        bullets: ["执行风险", "范围蔓延", "复盘清单"],
        series: [
          { label: "执行", value: 40 },
          { label: "范围", value: 55 },
          { label: "复盘", value: 70 },
        ],
      },
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
    {
      title: "核心洞察",
      kpi: "3×",
      viz: "cards",
      bullets: ["现状断层", "用户真需求", "可验证信号"],
      series: [
        { label: "断层", value: 86 },
        { label: "需求", value: 72 },
        { label: "信号", value: 64 },
      ],
    },
    {
      title: "关键数据",
      kpi: "72%",
      viz: "ring",
      bullets: ["样本口径清晰", "趋势方向明确", "风险可解释"],
      series: [
        { label: "样本覆盖", value: 72 },
        { label: "趋势置信", value: 81 },
        { label: "风险可控", value: 58 },
      ],
    },
    {
      title: "热度走势",
      viz: "line",
      bullets: ["周初蓄力", "中段拉升", "周末回落仍高于均值"],
      series: [
        { label: "D1", value: 42 },
        { label: "D2", value: 55 },
        { label: "D3", value: 68 },
        { label: "D4", value: 81 },
        { label: "D5", value: 74 },
        { label: "D6", value: 88 },
        { label: "D7", value: 79 },
      ],
    },
    {
      title: "结构拆解",
      viz: "columns",
      bullets: ["驱动因素", "对比基准", "异常点"],
      series: [
        { label: "驱动", value: 78 },
        { label: "基准", value: 55 },
        { label: "异常", value: 34 },
        { label: "机会", value: 69 },
      ],
    },
    {
      title: "方案路径",
      viz: "steps",
      bullets: ["阶段 A：验证", "阶段 B：放大", "阶段 C：系统化"],
      series: [
        { label: "验证", value: 40 },
        { label: "放大", value: 70 },
        { label: "系统化", value: 95 },
      ],
    },
    {
      title: "竞争与壁垒",
      viz: "bars",
      bullets: ["差异化抓手", "护城河", "不可复制点"],
      series: [
        { label: "差异化", value: 88 },
        { label: "护城河", value: 74 },
        { label: "不可复制", value: 61 },
      ],
    },
    {
      title: "风险与对策",
      viz: "bars",
      bullets: ["执行风险", "数据风险", "组织风险"],
      series: [
        { label: "执行", value: 45 },
        { label: "数据", value: 38 },
        { label: "组织", value: 52 },
      ],
    },
  ];
}

/** 默认页面清单（先出清单，确认后再生成 HTML） */
export function buildDefaultHtmlPptPages(
  title: string,
  pageCount: number,
  purposeZh?: string,
  styleId: HtmlPptStyleId = "dark_research",
): HtmlPptPage[] {
  const n = Math.max(10, Math.min(16, Math.floor(pageCount || 10)));
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
      subtitle: p?.subtitle ? String(p.subtitle).trim().slice(0, 160) : undefined,
      kpi: p?.kpi ? String(p.kpi).trim().slice(0, 24) : undefined,
      note: p?.note ? String(p.note).trim().slice(0, 220) : undefined,
      bullets: Array.isArray(p?.bullets)
        ? p.bullets.map((b) => String(b || "").trim()).filter(Boolean).slice(0, 8)
        : undefined,
      viz: p?.viz && HTML_PPT_VIZ_OK.has(p.viz) ? p.viz : undefined,
      series: Array.isArray(p?.series)
        ? p.series
            .map((s) => ({
              label: String(s?.label || "").trim().slice(0, 28),
              value: clampSeriesValue(s?.value),
            }))
            .filter((s) => s.label)
            .slice(0, 8)
        : undefined,
      themeId: p?.themeId ? String(p.themeId).trim().slice(0, 40) : undefined,
      themeTitle: p?.themeTitle ? String(p.themeTitle).trim().slice(0, 40) : undefined,
      highlight: Array.isArray(p?.highlight)
        ? p.highlight.map((h) => String(h || "").trim()).filter(Boolean).slice(0, 6)
        : undefined,
      imageUrl:
        typeof p?.imageUrl === "string" && /^https?:\/\//i.test(p.imageUrl.trim())
          ? p.imageUrl.trim().slice(0, 2048)
          : undefined,
    }))
    .filter((p) => p.title)
    .slice(0, 16);
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h || 1;
}

function parseKpiPercent(kpi?: string): number | null {
  const m = String(kpi || "").match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  return Math.max(0, Math.min(100, Number(m[1])));
}

function seriesFromPage(page: HtmlPptPage, index: number): Array<{ label: string; value: number }> {
  if (page.series?.length) {
    return page.series.map((s) => ({
      label: String(s.label || "").slice(0, 28),
      value: clampSeriesValue(s.value),
    }));
  }
  const bullets = (page.bullets || []).filter(Boolean).slice(0, 6);
  const pct = parseKpiPercent(page.kpi);
  if (bullets.length) {
    const seed = hashSeed(page.title + String(index));
    return bullets.map((b, i) => {
      const pctMatch = b.match(/(\d+(?:\.\d+)?)\s*%/);
      const absMatch = b.match(/(\d+(?:\.\d+)?)\s*(亿|万|倍)?/);
      const value = pctMatch
        ? Math.max(0, Math.min(100, Number(pctMatch[1])))
        : absMatch
          ? clampSeriesValue(Number(absMatch[1]) * (absMatch[2] === "亿" ? 1 : absMatch[2] === "万" ? 1 : 1))
          : 35 + ((seed >> (i * 3)) % 55);
      return { label: b.replace(/\s*\d+(?:\.\d+)?\s*%?/g, "").trim().slice(0, 18) || `项${i + 1}`, value };
    });
  }
  if (pct != null) {
    return [
      { label: "主指标", value: pct },
      { label: "对照", value: Math.max(12, Math.min(96, pct - 14)) },
      { label: "目标", value: Math.max(pct, Math.min(98, pct + 10)) },
    ];
  }
  const seed = hashSeed(page.title + String(index));
  return ["A", "B", "C", "D"].map((lab, i) => ({
    label: lab,
    value: 28 + ((seed >> (i * 4)) % 60),
  }));
}

export function inferHtmlPptViz(page: HtmlPptPage, index: number, total: number): HtmlPptVizKind {
  if (page.viz) return page.viz;
  if (index === 0) return "cover";
  if (index === 1 && /目录|叙事|议程|大纲/.test(page.title)) return "steps";
  if (index === total - 1) return "steps";
  if (/情绪|爆发|酝酿|下降|冷热/.test(page.title)) return "sentiment";
  if (/枢纽|生态|板块|模块/.test(page.title)) return "hub";
  if (/场景|业务块|信息块/.test(page.title)) return "scene_cards";
  if (/表格|对照表|清单表/.test(page.title)) return "table";
  if (parseKpiPercent(page.kpi) != null || /%|数据|指标|ROI|完成/.test(`${page.title}${page.kpi || ""}`)) {
    return "ring";
  }
  if (/路径|阶段|里程碑|路线|时间线|步骤|Now|Next|大纲/.test(page.title)) return "steps";
  if (/对照|对比|VS|vs|前后|国内外|付费.*免费/.test(page.title)) return "compare";
  if (/结构|拆解|市场|TAM|占比/.test(page.title)) return "columns";
  if (/趋势|走势|波动|增长曲线|热度|预测|未来规模/.test(page.title)) return "line";
  if ((page.bullets || []).length >= 3 && (page.series?.length || /风险|竞争|壁垒|缺口/.test(page.title))) {
    return "bars";
  }
  if ((page.bullets || []).length > 0 && (page.bullets || []).length <= 4) return "cards";
  return "bars";
}

/** 图表多色高亮序列（对标趋势报表：青/紫/绿/橙/品红/黄，避免单色单调） */
export const HTML_PPT_CHART_COLORS = [
  { c: "#22d3ee", g: "rgba(34,211,238,.55)" }, // cyan
  { c: "#a78bfa", g: "rgba(167,139,250,.55)" }, // violet
  { c: "#a3e635", g: "rgba(163,230,53,.5)" }, // lime
  { c: "#fb923c", g: "rgba(251,146,60,.55)" }, // orange
  { c: "#f472b6", g: "rgba(244,114,182,.55)" }, // pink
  { c: "#facc15", g: "rgba(250,204,21,.5)" }, // yellow
  { c: "#38bdf8", g: "rgba(56,189,248,.55)" }, // sky
  { c: "#c084fc", g: "rgba(192,132,252,.55)" }, // purple
] as const;

function chartTone(i: number) {
  return HTML_PPT_CHART_COLORS[i % HTML_PPT_CHART_COLORS.length]!;
}

function toneStyle(i: number, extra = ""): string {
  const t = chartTone(i);
  return `--i:${i};--c:${t.c};--g:${t.g}${extra ? `;${extra}` : ""}`;
}

const SCENE_CARD_EMOJI = ["📊", "🎯", "⚡", "🔍", "📈", "🧩"] as const;
const SENTIMENT_BUCKETS = [
  { key: "爆发", emoji: "🔥", cls: "sent-up" },
  { key: "酝酿", emoji: "🌱", cls: "sent-mid" },
  { key: "下降", emoji: "📉", cls: "sent-down" },
] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 将 bullets 中与 highlight 匹配的短语包成闪烁 span */
export function renderBulletsWithHighlights(bullet: string, highlights: string[] | undefined): string {
  const text = String(bullet || "");
  const phrases = (highlights || []).map((h) => String(h || "").trim()).filter(Boolean);
  if (!phrases.length) return escapeHtml(text);
  let out = escapeHtml(text);
  for (const phrase of phrases) {
    if (!phrase || !text.includes(phrase)) continue;
    const re = new RegExp(escapeRegExp(phrase), "g");
    out = out.replace(re, `<span class="hl-flash highlight-flash">${escapeHtml(phrase)}</span>`);
  }
  return out;
}

function renderHighlightOnlyList(highlights: string[], buildStart: number): string {
  const items = highlights
    .slice(0, 3)
    .map(
      (h, i) =>
        `<li class="anim talk-point hl-only" data-build="${buildStart + i + 1}"><span class="hl-flash highlight-flash">${escapeHtml(h)}</span></li>`,
    )
    .join("");
  return `<ul class="talk-bullets hl-list">${items}</ul>`;
}

function renderVizHtml(kind: HtmlPptVizKind, page: HtmlPptPage, index: number): string {
  const series = seriesFromPage(page, index);
  const pct = parseKpiPercent(page.kpi) ?? series[0]?.value ?? 64;
  const r = 54;
  const circ = 2 * Math.PI * r;
  const dash = ((Math.max(0, Math.min(100, pct)) / 100) * circ).toFixed(1);
  const t0 = chartTone(0);
  const t1 = chartTone(1);
  const t3 = chartTone(3);

  if (kind === "cover") {
    return `<div class="viz viz-cover chart-in" data-build="1" style="--c:${t0.c};--g:${t0.g}">
  <svg class="ring-svg" viewBox="0 0 140 140" aria-hidden="true">
    <circle class="ring-track" cx="70" cy="70" r="${r}"/>
    <circle class="ring-value" cx="70" cy="70" r="${r}" stroke-dasharray="${dash} ${circ.toFixed(1)}"/>
  </svg>
  <div class="cover-kpi">${escapeHtml(page.kpi || "GO")}</div>
</div>`;
  }

  if (kind === "ring") {
    const sideMax = Math.max(1, ...series.slice(0, 5).map((s) => s.value));
    const side = series
      .slice(0, 5)
      .map(
        (s, i) =>
          `<div class="metric-row chart-in" data-build="${i + 2}" style="${toneStyle(i, `--v:${seriesBarPct(s.value, sideMax)}`)}"><em class="rank">${i + 1}</em><span>${escapeHtml(s.label)}</span><b class="countup" data-to="${Math.round(s.value)}">0</b><i></i></div>`,
      )
      .join("");
    const kpiText = page.kpi || `${Math.round(pct)}%`;
    const kpiNum = parseKpiPercent(page.kpi) ?? Math.round(pct);
    return `<div class="viz viz-split">
  <div class="viz-ring chart-in" data-build="1" style="--c:${t0.c};--g:${t0.g}">
    <svg class="ring-svg" viewBox="0 0 140 140" aria-hidden="true">
      <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${t0.c}"/><stop offset="55%" stop-color="${t1.c}"/><stop offset="100%" stop-color="${t3.c}"/></linearGradient></defs>
      <circle class="ring-track" cx="70" cy="70" r="${r}"/>
      <circle class="ring-value ring-grad" cx="70" cy="70" r="${r}" stroke-dasharray="${dash} ${circ.toFixed(1)}"/>
    </svg>
    <div class="ring-label"><strong class="countup" data-to="${kpiNum}" data-suffix="%">${escapeHtml(kpiText)}</strong><span>主指标</span></div>
  </div>
  <div class="viz-side">${side}</div>
</div>`;
  }

  if (kind === "columns") {
    const max = Math.max(1, ...series.map((s) => s.value));
    const cols = series
      .slice(0, 6)
      .map(
        (s, i) =>
          `<div class="col chart-in" data-build="${i + 1}" style="${toneStyle(i, `--h:${Math.round((s.value / max) * 100)}`)}"><div class="col-bar"></div><span>${escapeHtml(s.label)}</span><b class="countup" data-to="${Math.round(s.value)}">0</b></div>`,
      )
      .join("");
    return `<div class="viz viz-cols">${cols}</div>`;
  }

  if (kind === "steps") {
    const items = (page.bullets?.length ? page.bullets : series.map((s) => s.label)).slice(0, 6);
    const steps = items
      .map(
        (lab, i) =>
          `<div class="step chart-in" data-build="${i + 1}" style="${toneStyle(i)}"><div class="step-dot">${i + 1}</div><div class="step-body">${escapeHtml(lab)}</div></div>`,
      )
      .join("");
    return `<div class="viz viz-steps">${steps}</div>`;
  }

  if (kind === "cards") {
    const cardMax = Math.max(1, ...series.slice(0, 4).map((s) => s.value));
    const cards = series
      .slice(0, 4)
      .map(
        (s, i) =>
          `<div class="card chart-in" data-build="${i + 1}" style="${toneStyle(i, `--v:${seriesBarPct(s.value, cardMax)}`)}"><div class="card-top"></div><b class="countup" data-to="${Math.round(s.value)}">0</b><span>${escapeHtml(s.label)}</span><i></i></div>`,
      )
      .join("");
    return `<div class="viz viz-cards">${cards}</div>`;
  }

  if (kind === "line") {
    const pts = series.slice(0, 8);
    const w = 560;
    const h = 180;
    const pad = 16;
    const max = Math.max(1, ...pts.map((s) => s.value));
    const coords = pts.map((s, i) => {
      const x = pad + (i * (w - pad * 2)) / Math.max(1, pts.length - 1);
      const y = h - pad - (s.value / max) * (h - pad * 2);
      return { x, y, s };
    });
    const poly = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const dots = coords
      .map(
        (p, i) =>
          `<g class="line-pt chart-in" data-build="${i + 2}" style="${toneStyle(i)}"><circle class="line-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5"/><text class="line-val" x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}">${Math.round(p.s.value)}</text></g>`,
      )
      .join("");
    const labs = pts
      .map((s, i) => `<span class="line-lab chart-in" data-build="${i + 2}" style="${toneStyle(i)}">${escapeHtml(s.label)}</span>`)
      .join("");
    return `<div class="viz viz-line">
  <svg class="line-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="${t0.c}"/><stop offset="50%" stop-color="${t1.c}"/><stop offset="100%" stop-color="${t3.c}"/></linearGradient></defs>
    <polyline class="line-path chart-in" data-build="1" points="${poly}" fill="none" stroke="url(#lg)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
  </svg>
  <div class="line-labs">${labs}</div>
</div>`;
  }

  if (kind === "compare") {
    const items = series.slice(0, 8);
    const mid = Math.max(1, Math.ceil(items.length / 2));
    const left = items.slice(0, mid);
    const right = items.slice(mid);
    const max = Math.max(1, ...items.map((s) => s.value));
    const renderSide = (rows: typeof items, offset: number, head: string) => {
      const body = rows
        .map(
          (s, i) =>
            `<div class="hbar chart-in" data-build="${offset + i + 1}" style="${toneStyle(offset + i, `--v:${seriesBarPct(s.value, max)}`)}"><em class="rank">${i + 1}</em><div class="hbar-lab">${escapeHtml(s.label)}</div><div class="hbar-track"><div class="hbar-fill"><span class="shimmer"></span></div></div><div class="hbar-val countup" data-to="${Math.round(s.value)}">0</div></div>`,
        )
        .join("");
      return `<div class="compare-side"><div class="compare-h chart-in" data-build="${offset}">${escapeHtml(head)}</div>${body}</div>`;
    };
    const leftHead = page.bullets?.[0]?.slice(0, 16) || "对照 A";
    const rightHead = page.bullets?.[1]?.slice(0, 16) || "对照 B";
    return `<div class="viz viz-compare">${renderSide(left, 1, leftHead)}${renderSide(right, 2 + left.length, rightHead)}</div>`;
  }

  if (kind === "table") {
    const bullets = (page.bullets || []).slice(0, 6);
    const rows = series.slice(0, 8).map((s, i) => {
      const note = bullets[i] || "";
      return `<tr class="tbl-row chart-in" data-build="${i + 1}" style="${toneStyle(i)}"><td class="tbl-rank">${i + 1}</td><td class="tbl-lab">${escapeHtml(s.label)}</td><td class="tbl-val countup" data-to="${Math.round(s.value)}" data-display="${formatSeriesDisplay(s.value)}">0</td>${note ? `<td class="tbl-note">${escapeHtml(note)}</td>` : ""}</tr>`;
    });
    const hasNote = bullets.some(Boolean);
    const head = hasNote
      ? `<thead><tr><th>#</th><th>维度</th><th>数值</th><th>说明</th></tr></thead>`
      : `<thead><tr><th>#</th><th>维度</th><th>数值</th></tr></thead>`;
    return `<div class="viz viz-table"><table class="data-table">${head}<tbody>${rows.join("")}</tbody></table></div>`;
  }

  if (kind === "scene_cards") {
    const items = series.slice(0, 6);
    const cards = items
      .map(
        (s, i) =>
          `<div class="scene-card chart-in" data-build="${i + 1}" style="${toneStyle(i)}"><div class="scene-icon" aria-hidden="true">${SCENE_CARD_EMOJI[i % SCENE_CARD_EMOJI.length]}</div><div class="scene-lab">${escapeHtml(s.label)}</div><div class="scene-val countup" data-to="${Math.round(s.value)}" data-display="${formatSeriesDisplay(s.value)}">0</div></div>`,
      )
      .join("");
    return `<div class="viz viz-scene-cards">${cards}</div>`;
  }

  if (kind === "sentiment") {
    const bullets = (page.bullets || []).slice(0, 3);
    const vals = SENTIMENT_BUCKETS.map((b, i) => {
      const fromSeries = series.find((s) => s.label.includes(b.key));
      const fromBullet = bullets[i]?.match(/(\d+(?:\.\d+)?)/);
      const value = fromSeries?.value ?? (fromBullet ? Number(fromBullet[1]) : series[i]?.value ?? 33 + i * 12);
      const caption = bullets[i] || fromSeries?.label || b.key;
      return { ...b, value: Math.round(value), caption };
    });
    const faces = vals
      .map(
        (v, i) =>
          `<div class="sent-face chart-in ${v.cls}" data-build="${i + 1}" style="${toneStyle(i, `--v:${Math.max(8, Math.min(100, v.value))}`)}"><div class="sent-emoji">${v.emoji}</div><div class="sent-key">${escapeHtml(v.key)}</div><div class="sent-val countup" data-to="${v.value}">0</div><div class="sent-cap">${escapeHtml(v.caption.slice(0, 24))}</div></div>`,
      )
      .join("");
    return `<div class="viz viz-sentiment">${faces}</div>`;
  }

  if (kind === "hub") {
    const mods = series.slice(0, 8);
    const hubLabel = escapeHtml(page.kpi || page.title.slice(0, 12) || "枢纽");
    const spokes = mods
      .map(
        (s, i) =>
          `<div class="hub-spoke chart-in" data-build="${i + 1}" style="${toneStyle(i, `--a:${Math.round((i / Math.max(1, mods.length)) * 360)}`)}"><div class="hub-node"><span class="hub-dot"></span><b>${escapeHtml(s.label)}</b><em class="countup" data-to="${Math.round(s.value)}">0</em></div></div>`,
      )
      .join("");
    return `<div class="viz viz-hub"><div class="hub-core chart-in" data-build="0"><div class="hub-ring"></div><strong>${hubLabel}</strong></div><div class="hub-spokes">${spokes}</div></div>`;
  }

  // bars：按页内 max 归一宽度，数字显示绝对量级（亿/万/占比皆可）
  const barMax = Math.max(1, ...series.slice(0, 8).map((s) => s.value));
  const bars = series
    .slice(0, 8)
    .map(
      (s, i) =>
        `<div class="hbar chart-in" data-build="${i + 1}" style="${toneStyle(i, `--v:${seriesBarPct(s.value, barMax)}`)}"><em class="rank">${i + 1}</em><div class="hbar-lab">${escapeHtml(s.label)}</div><div class="hbar-track"><div class="hbar-fill"><span class="shimmer"></span></div></div><div class="hbar-val countup" data-to="${Math.round(s.value)}" data-display="${formatSeriesDisplay(s.value)}">0</div></div>`,
    )
    .join("");
  return `<div class="viz viz-bars">${bars}</div>`;
}

export function buildHtmlPptDocument(input: HtmlPptDeckInput): string {
  const styleId = input.styleId in HTML_PPT_STYLES ? input.styleId : "dark_research";
  const styleMeta = HTML_PPT_STYLES[styleId];
  const pages = (input.pages || []).filter((p) => p && p.title);
  const safePages = pages.length
    ? pages
    : buildDefaultHtmlPptPages(input.title, 6, input.purposeZh, styleId);
  const title = escapeHtml(input.title || "动效PPT");
  const bgUrl = escapeHtml(styleMeta.bgUrl || `/html-ppt-templates/${styleId}/bg.png`);
  const slidesHtml = safePages
    .map((p, i) => {
      const kind = inferHtmlPptViz(p, i, safePages.length);
      const viz = renderVizHtml(kind, p, i);
      // steps/cover 的 bullets 已进主可视化；其余图表页把 bullets 挂在图表动效之后，供口播分步
      const bulletsInViz = kind === "steps" || kind === "cover";
      const seriesLen = (p.series || seriesFromPage(p, i)).length;
      const bulletLen = (p.bullets || []).length;
      const seriesBuildCount =
        kind === "compare"
          ? Math.min(8, seriesLen) + 2
          : kind === "ring"
            ? 1 + Math.min(5, seriesLen || bulletLen)
            : kind === "hub"
              ? 1 + Math.min(8, seriesLen)
              : kind === "table"
                ? Math.min(8, seriesLen)
                : kind === "scene_cards"
                  ? Math.min(6, seriesLen)
                  : kind === "sentiment"
                    ? 3
                    : Math.min(8, seriesLen);
      const talkBullets = bulletsInViz ? [] : (p.bullets || []).slice(0, 4);
      const highlights = (p.highlight || []).filter(Boolean);
      const bulletItems = talkBullets
        .map(
          (b, bi) =>
            `<li class="anim talk-point" data-build="${Math.max(1, seriesBuildCount) + bi + 1}">${renderBulletsWithHighlights(b, highlights)}</li>`,
        )
        .join("");
      const bulletList = bulletItems ? `<ul class="talk-bullets">${bulletItems}</ul>` : "";
      const highlightOnly =
        !bulletList && highlights.length
          ? renderHighlightOnlyList(highlights, Math.max(1, seriesBuildCount))
          : "";
      const noteBuild =
        kind === "cover"
          ? 2
          : Math.max(1, seriesBuildCount) + talkBullets.length + (highlightOnly ? highlights.length : 0) + 1;
      const hasImage = Boolean(p.imageUrl);
      const imagePanel = hasImage
        ? `<aside class="slide-image anim" data-build="0"><img src="${escapeHtml(p.imageUrl!)}" alt="" loading="lazy" decoding="async"/></aside>`
        : "";
      const bodyClass = hasImage ? " slide-has-image" : "";
      return `<section class="slide${i === 0 ? " is-active" : ""}${bodyClass}" data-i="${i}" data-viz="${kind}">
  <div class="slide-bg" aria-hidden="true"></div>
  <div class="fx-orb o1" aria-hidden="true"></div>
  <div class="fx-orb o2" aria-hidden="true"></div>
  <div class="slide-inner">
  <div class="slide-body">
  <div class="accent-line anim" data-build="0"></div>
  <div class="meta anim" data-build="0"><span class="accent">${escapeHtml(styleMeta.labelZh)}</span><span>${i + 1} / ${safePages.length}</span></div>
  ${kind === "cover" && p.kpi ? "" : p.kpi && kind !== "ring" ? `<div class="kpi anim" data-build="0">${escapeHtml(p.kpi)}</div>` : ""}
  <h1 class="anim" data-build="0">${escapeHtml(p.title)}</h1>
  ${p.subtitle ? `<p class="sub anim" data-build="0">${escapeHtml(p.subtitle)}</p>` : ""}
  ${viz}
  ${bulletList}
  ${highlightOnly}
  ${p.note ? `<p class="note anim" data-build="${Math.max(1, noteBuild)}">${escapeHtml(p.note)}</p>` : ""}
  </div>
  ${imagePanel}
  </div>
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
html,body{margin:0;height:100%;overflow:hidden;cursor:default;background:var(--bg,#0b0f14);color:var(--text,#e8eef7)}
${STYLE_CSS[styleId]}
.deck{height:100%;width:100%;display:flex;transition:transform .72s cubic-bezier(.22,1,.36,1)}
.slide{min-width:100vw;height:100vh;padding:clamp(24px,4.5vw,56px) clamp(24px,4.5vw,56px) 88px;display:flex;flex-direction:column;justify-content:center;position:relative;overflow:hidden}
.slide-bg{position:absolute;inset:0;z-index:0;pointer-events:none;background-image:url('${bgUrl}');background-size:cover;background-position:center;opacity:.38;mix-blend-mode:soft-light}
.fx-orb{position:absolute;z-index:0;pointer-events:none;border-radius:50%;filter:blur(40px);opacity:0}
.fx-orb.o1{width:280px;height:280px;left:-40px;top:10%;background:rgba(34,211,238,.22)}
.fx-orb.o2{width:240px;height:240px;right:-30px;bottom:8%;background:rgba(251,146,60,.18)}
.slide.is-active .fx-orb{animation:orbPulse 2.8s ease-in-out both}
.slide.is-active .fx-orb.o2{animation-delay:.35s}
.slide-inner{position:relative;z-index:1;display:flex;flex-direction:column;justify-content:center;min-height:72%;max-width:1100px;width:100%}
.slide-inner:has(.slide-image){max-width:1180px}
.slide-body{flex:1;min-width:0}
.slide-has-image .slide-inner{flex-direction:row;align-items:center;gap:clamp(16px,3vw,32px)}
.slide-image{flex:0 0 min(38%,320px);max-width:42%;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.12);box-shadow:0 12px 40px rgba(0,0,0,.35);background:rgba(15,23,42,.35)}
.slide-image img{display:block;width:100%;height:auto;max-height:min(52vh,420px);object-fit:cover}
@media (max-width:900px){.slide-has-image .slide-inner{flex-direction:column}.slide-image{flex:0 0 auto;max-width:100%;width:100%}}
.hl-flash,.highlight-flash{display:inline;padding:0 4px;border-radius:6px;background:linear-gradient(90deg,rgba(250,204,21,.25),rgba(251,146,60,.22));box-shadow:0 0 0 1px rgba(250,204,21,.35);animation:hlFlash 2.4s ease-in-out infinite}
.fx-show .hl-flash,.fx-show .highlight-flash{animation:hlFlash 2.4s ease-in-out infinite}
@keyframes hlFlash{0%,100%{opacity:1;box-shadow:0 0 0 1px rgba(250,204,21,.35),0 0 8px rgba(250,204,21,.15)}50%{opacity:1;box-shadow:0 0 0 1px rgba(251,146,60,.55),0 0 18px rgba(250,204,21,.45)}}
.accent-line{height:3px;width:120px;background:linear-gradient(90deg,#22d3ee,#a78bfa,#a3e635,#fb923c);margin-bottom:10px;box-shadow:0 0 12px rgba(34,211,238,.35);transform-origin:left center}
.meta{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:14px}
h1{font-size:clamp(1.7rem,4.2vw,3rem);line-height:1.15;margin:6px 0 10px;letter-spacing:-.02em;max-width:22ch}
.sub{color:var(--muted);font-size:clamp(.95rem,1.8vw,1.2rem);margin:0 0 14px;max-width:48ch}
ul{margin:10px 0 0;padding-left:1.1em;font-size:clamp(1rem,1.8vw,1.2rem);line-height:1.55}
ul.talk-bullets{margin-top:14px;font-size:clamp(0.92rem,1.5vw,1.08rem);opacity:0.92}
li{margin:7px 0}
.note{margin-top:16px;color:var(--muted);font-size:13px}
.kpi{color:#facc15;font-weight:800;font-size:clamp(2rem,5vw,3.6rem);letter-spacing:-.03em;text-shadow:0 0 18px rgba(250,204,21,.35)}
.controls{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:14px;background:rgba(0,0,0,.42);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.08);box-shadow:0 8px 28px rgba(0,0,0,.35)}
.controls button{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#e8eef7;font-size:12px;padding:8px 12px;border-radius:10px;cursor:pointer;white-space:nowrap}
.controls button:hover{background:rgba(255,255,255,.12)}
.controls button.primary{background:linear-gradient(90deg,rgba(34,211,238,.35),rgba(167,139,250,.35));border-color:rgba(34,211,238,.45)}
.controls .hud{font-size:11px;color:var(--muted,#8b9bb0);min-width:118px;text-align:center;padding:0 4px}
.controls .done-flash{color:#facc15}
.viz{margin-top:18px}
.rank{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:800;font-style:normal;color:#0b1020;background:var(--c);box-shadow:0 0 10px var(--g);opacity:0;transform:scale(.4)}
.chart-in.fx-show .rank,.hbar.fx-show .rank,.metric-row.fx-show .rank{animation:rankPop .7s cubic-bezier(.34,1.56,.64,1) both}
.chart-in,.anim{opacity:0}
.line-path.chart-in{opacity:1;transform:none}
.anim:not(.accent-line){transform:translateY(14px)}
.chart-in:not(.line-path){transform:translateX(-18px)}
.anim.fx-show:not(.accent-line){animation:rise .75s cubic-bezier(.22,1,.36,1) both}
.accent-line.fx-show{animation:barGrow 1s cubic-bezier(.22,1,.36,1) both}
.chart-in.fx-show:not(.line-path){animation:chartIn .8s cubic-bezier(.22,1,.36,1) both}
.viz-split{display:grid;grid-template-columns:minmax(140px,220px) 1fr;gap:28px;align-items:center}
.viz-ring{position:relative;width:min(220px,42vw);aspect-ratio:1;filter:drop-shadow(0 0 16px var(--g))}
.ring-svg{width:100%;height:100%;transform:rotate(-90deg)}
.ring-track{fill:none;stroke:rgba(148,163,184,.22);stroke-width:12}
.ring-value{fill:none;stroke:var(--c,#22d3ee);stroke-width:12;stroke-linecap:round}
.ring-value.ring-grad{stroke:url(#rg)}
.viz-ring:not(.fx-show) .ring-value,.viz-cover:not(.fx-show) .ring-value{stroke-dasharray:0 999 !important}
.viz-ring.fx-show .ring-value,.viz-cover.fx-show .ring-value{animation:ringDraw 1.45s cubic-bezier(.22,1,.36,1) both}
.ring-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ring-label strong{font-size:clamp(1.6rem,3.5vw,2.4rem);color:#f8fafc;line-height:1;text-shadow:0 0 20px var(--g,#22d3ee)}
.ring-label span{font-size:12px;color:var(--muted);margin-top:4px}
.metric-row{display:grid;grid-template-columns:28px 1fr auto;gap:6px 10px;margin:10px 0;align-items:center}
.metric-row span{color:var(--text);font-size:14px}
.metric-row b{color:var(--c);font-size:14px;text-shadow:0 0 10px var(--g)}
.metric-row i{grid-column:1/-1;display:block;height:8px;border-radius:99px;background:rgba(148,163,184,.18);position:relative;overflow:hidden}
.metric-row i::after{content:"";position:absolute;inset:0 auto 0 0;width:0;background:linear-gradient(90deg,var(--c),#fff);border-radius:99px;box-shadow:0 0 12px var(--g)}
.metric-row.fx-show i::after{animation:fillX 1.15s cubic-bezier(.22,1,.36,1) both}
.viz-compare{display:grid;grid-template-columns:1fr 1fr;gap:22px;max-width:920px;align-items:start}
.compare-side{display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:16px;background:rgba(15,23,42,.4);border:1px solid rgba(148,163,184,.16)}
.compare-h{font-size:12px;font-weight:800;letter-spacing:.04em;color:var(--c,#22d3ee);text-transform:none;margin-bottom:2px}
.viz-bars{display:flex;flex-direction:column;gap:11px;max-width:720px}
.hbar{display:grid;grid-template-columns:28px minmax(72px,130px) 1fr 44px;gap:10px;align-items:center}
.hbar-lab{font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hbar-track{height:14px;border-radius:99px;background:rgba(148,163,184,.16);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.04)}
.hbar-fill{position:relative;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--c),color-mix(in srgb,var(--c) 55%,#fff));box-shadow:0 0 14px var(--g);overflow:hidden}
.hbar-fill .shimmer{position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);transform:translateX(-120%)}
.hbar.fx-show .hbar-fill{animation:fillBar 1.25s cubic-bezier(.22,1,.36,1) both;width:calc(var(--v)*1%)}
.hbar.fx-show .hbar-fill .shimmer{animation:shimmer 1.4s ease-in-out both;animation-delay:.2s}
.hbar-val{font-size:13px;color:var(--c);font-weight:800;text-align:right;text-shadow:0 0 10px var(--g)}
.viz-cols{display:flex;align-items:flex-end;gap:14px;height:200px;max-width:720px;padding-top:8px}
.col{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end}
.col-bar{width:100%;max-width:56px;height:0;border-radius:10px 10px 4px 4px;background:linear-gradient(180deg,var(--c),color-mix(in srgb,var(--c) 35%,#0b1020));box-shadow:0 0 16px var(--g)}
.col.fx-show .col-bar{animation:colBounce 1.25s cubic-bezier(.34,1.4,.64,1) both;height:calc(var(--h)*1%)}
.col span{font-size:12px;color:var(--muted)}
.col b{font-size:13px;color:var(--c);font-weight:800;text-shadow:0 0 8px var(--g)}
.viz-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:14px;margin-top:8px}
.step{background:rgba(15,23,42,.45);border:1px solid color-mix(in srgb,var(--c) 45%,transparent);border-radius:14px;padding:14px 12px;min-height:110px;box-shadow:0 0 0 1px rgba(255,255,255,.03),0 0 18px color-mix(in srgb,var(--g) 35%,transparent)}
.step-dot{width:28px;height:28px;border-radius:50%;background:var(--c);color:#0b1020;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;margin-bottom:10px;box-shadow:0 0 12px var(--g)}
.step-body{font-size:14px;line-height:1.4;color:var(--text)}
.viz-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;max-width:820px}
.card{border-radius:16px;padding:0 14px 16px;background:rgba(15,23,42,.55);border:1px solid color-mix(in srgb,var(--c) 40%,transparent);position:relative;overflow:hidden;box-shadow:0 0 20px color-mix(in srgb,var(--g) 28%,transparent)}
.card-top{height:5px;margin:0 -14px 12px;background:linear-gradient(90deg,var(--c),color-mix(in srgb,var(--c) 40%,#fff));box-shadow:0 0 12px var(--g)}
.card b{display:block;font-size:clamp(1.6rem,3vw,2.2rem);color:var(--c);line-height:1;text-shadow:0 0 14px var(--g)}
.card span{display:block;margin-top:6px;font-size:13px;color:var(--muted)}
.card i{display:block;margin-top:12px;height:6px;border-radius:99px;background:rgba(148,163,184,.2);position:relative;overflow:hidden}
.card i::after{content:"";position:absolute;inset:0 auto 0 0;width:0;background:var(--c);box-shadow:0 0 10px var(--g)}
.card.fx-show i::after{animation:fillX 1.15s cubic-bezier(.22,1,.36,1) both;width:calc(var(--v)*1%)}
.viz-line{max-width:720px}
.line-svg{width:100%;height:190px;display:block;overflow:visible}
.line-path{fill:none;stroke-dasharray:1200;stroke-dashoffset:1200;filter:drop-shadow(0 0 8px rgba(34,211,238,.45));opacity:1}
.line-path.fx-show{animation:lineDraw 1.5s cubic-bezier(.22,1,.36,1) forwards}
.line-dot{fill:var(--c);opacity:0;filter:drop-shadow(0 0 6px var(--g))}
.line-pt.fx-show .line-dot{animation:dotPop .55s cubic-bezier(.34,1.56,.64,1) both}
.line-val{fill:var(--c);font-size:11px;font-weight:700;text-anchor:middle;opacity:0}
.line-pt.fx-show .line-val{animation:fadeIn .55s ease both}
.line-labs{display:flex;justify-content:space-between;gap:6px;margin-top:8px}
.line-lab{font-size:11px;color:var(--c);text-shadow:0 0 8px var(--g)}
.viz-cover{position:relative;width:min(180px,36vw);margin-top:8px;filter:drop-shadow(0 0 16px var(--g))}
.cover-kpi{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:clamp(1.4rem,3vw,2rem);font-weight:800;color:#f8fafc;text-shadow:0 0 16px var(--g)}
.viz-table{max-width:820px;overflow:auto}
.data-table{width:100%;border-collapse:separate;border-spacing:0 8px;font-size:13px}
.data-table th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);text-align:left;padding:0 10px 4px}
.tbl-row{background:rgba(15,23,42,.45);box-shadow:0 0 0 1px rgba(148,163,184,.14)}
.tbl-row td{padding:10px 12px;vertical-align:middle}
.tbl-row td:first-child{border-radius:10px 0 0 10px}
.tbl-row td:last-child{border-radius:0 10px 10px 0}
.tbl-rank{font-weight:800;color:var(--c);width:36px}
.tbl-lab{color:var(--text);font-weight:600}
.tbl-val{color:var(--c);font-weight:800;text-align:right;white-space:nowrap;text-shadow:0 0 10px var(--g)}
.tbl-note{color:var(--muted);font-size:12px;max-width:220px}
.viz-scene-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;max-width:860px}
.scene-card{border-radius:16px;padding:14px 12px 16px;background:rgba(15,23,42,.5);border:1px solid color-mix(in srgb,var(--c) 38%,transparent);box-shadow:0 0 18px color-mix(in srgb,var(--g) 24%,transparent);min-height:118px}
.scene-icon{font-size:clamp(1.4rem,2.5vw,1.8rem);margin-bottom:8px;filter:drop-shadow(0 0 8px var(--g))}
.scene-lab{font-size:13px;color:var(--text);line-height:1.35;margin-bottom:6px}
.scene-val{font-size:clamp(1.3rem,2.4vw,1.8rem);font-weight:800;color:var(--c);text-shadow:0 0 12px var(--g)}
.viz-sentiment{display:grid;grid-template-columns:repeat(3,minmax(100px,1fr));gap:14px;max-width:720px}
.sent-face{border-radius:18px;padding:16px 12px;text-align:center;background:rgba(15,23,42,.48);border:1px solid color-mix(in srgb,var(--c) 42%,transparent);position:relative;overflow:hidden}
.sent-face::after{content:"";position:absolute;inset:auto 0 0 0;height:4px;background:var(--c);width:calc(var(--v)*1%);box-shadow:0 0 12px var(--g)}
.sent-emoji{font-size:clamp(2rem,4vw,2.6rem);line-height:1;margin-bottom:6px}
.sent-key{font-size:12px;font-weight:800;color:var(--c);letter-spacing:.08em;margin-bottom:4px}
.sent-val{font-size:clamp(1.4rem,2.8vw,2rem);font-weight:800;color:#f8fafc;text-shadow:0 0 14px var(--g)}
.sent-cap{margin-top:6px;font-size:11px;color:var(--muted);line-height:1.35}
.viz-hub{position:relative;min-height:240px;max-width:820px;display:grid;place-items:center;padding:12px 0}
.hub-core{position:relative;z-index:2;width:min(140px,28vw);aspect-ratio:1;border-radius:50%;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;background:radial-gradient(circle at 35% 30%,color-mix(in srgb,var(--accent,#22d3ee) 35%,#0b1020),rgba(15,23,42,.85));border:2px solid var(--accent,#22d3ee);box-shadow:0 0 28px rgba(34,211,238,.35)}
.hub-ring{position:absolute;inset:-8px;border-radius:50%;border:1px dashed rgba(148,163,184,.35);animation:hubSpin 18s linear infinite}
.hub-core strong{font-size:clamp(.85rem,1.6vw,1rem);line-height:1.25;color:var(--text);font-weight:800}
.hub-spokes{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.hub-spoke{position:absolute;width:100%;height:100%;transform:rotate(calc(var(--a)*1deg))}
.hub-node{position:absolute;top:50%;left:50%;transform:rotate(calc(var(--a)*-1deg)) translate(calc(min(34vw,180px)),-50%);display:flex;flex-direction:column;align-items:center;gap:4px;min-width:88px;max-width:120px;padding:8px 10px;border-radius:12px;background:rgba(15,23,42,.72);border:1px solid color-mix(in srgb,var(--c) 45%,transparent);box-shadow:0 0 14px color-mix(in srgb,var(--g) 30%,transparent);pointer-events:auto}
.hub-dot{width:10px;height:10px;border-radius:50%;background:var(--c);box-shadow:0 0 10px var(--g)}
.hub-node b{font-size:11px;color:var(--text);text-align:center;line-height:1.3}
.hub-node em{font-style:normal;font-size:12px;font-weight:800;color:var(--c)}
@keyframes hubSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes chartIn{from{opacity:0;transform:translateX(-18px)}to{opacity:1;transform:none}}
@keyframes barGrow{from{transform:scaleX(.2);opacity:.4}to{transform:none;opacity:1}}
@keyframes fillX{from{width:0}to{width:calc(var(--v)*1%)}}
@keyframes fillBar{from{width:0}to{width:calc(var(--v)*1%)}}
@keyframes colBounce{0%{height:0}70%{height:calc(var(--h)*1.06%)}100%{height:calc(var(--h)*1%)}}
@keyframes ringDraw{from{stroke-dasharray:0 999}}
@keyframes lineDraw{to{stroke-dashoffset:0}}
@keyframes shimmer{from{transform:translateX(-120%)}to{transform:translateX(120%)}}
@keyframes rankPop{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes dotPop{from{opacity:0;r:0}to{opacity:1}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes orbPulse{0%{opacity:0;transform:scale(.85)}40%{opacity:.9}100%{opacity:.55;transform:scale(1.05)}}
@media (max-width:720px){.viz-split,.viz-compare,.viz-sentiment{grid-template-columns:1fr}.hbar{grid-template-columns:24px 64px 1fr 36px}.viz-cols{height:160px}.viz-hub{min-height:320px}.hub-node{transform:rotate(calc(var(--a)*-1deg)) translate(120px,-50%)}.controls{left:8px;right:8px;transform:none;flex-wrap:wrap;justify-content:center}}
</style>
</head>
<body>
<div class="deck" id="deck">
${slidesHtml}
</div>
<div class="controls" id="controls">
  <button type="button" id="btnPrevPage" title="上一页 (←)">上一页 ←</button>
  <button type="button" class="primary" id="btnNextBuild" title="下一步动效 (空格 / 点击 / ↓)">下一步动效</button>
  <button type="button" id="btnNextPage" title="下一页 (→)">下一页 →</button>
  <div class="hud" id="hud">页 1/${safePages.length} · 动效 0/0</div>
</div>
<script>
(function(){
  var deck=document.getElementById('deck');
  var slides=deck ? Array.prototype.slice.call(deck.children) : [];
  var n=slides.length; var i=0; var step=0; var maxStep=0;
  var hud=document.getElementById('hud');
  function countUpIn(root){
    var nodes=root.querySelectorAll ? root.querySelectorAll('.countup[data-to]') : [];
    if(root.classList && root.classList.contains('countup') && root.getAttribute('data-to')){
      nodes= [root];
    }
    Array.prototype.forEach.call(nodes,function(node){
      if(node.getAttribute('data-counted')==='1') return;
      node.setAttribute('data-counted','1');
      var to=Number(node.getAttribute('data-to')||0);
      var suffix=node.getAttribute('data-suffix')||'';
      var start=performance.now();
      var dur=1200;
      function tick(now){
        var t=Math.min(1,(now-start)/dur);
        var eased=1-Math.pow(1-t,3);
        node.textContent=Math.round(to*eased)+suffix;
        if(t<1) requestAnimationFrame(tick);
      }
      node.textContent='0'+suffix;
      requestAnimationFrame(tick);
    });
  }
  function maxBuildOf(slide){
    var m=0;
    Array.prototype.forEach.call(slide.querySelectorAll('[data-build]'),function(node){
      var b=Number(node.getAttribute('data-build')||0);
      if(b>m) m=b;
    });
    return m;
  }
  function applyBuild(slide, upTo){
    Array.prototype.forEach.call(slide.querySelectorAll('[data-build]'),function(node){
      var b=Number(node.getAttribute('data-build')||0);
      if(b<=upTo){
        if(!node.classList.contains('fx-show')){
          node.classList.add('fx-show');
          countUpIn(node);
        }
      } else {
        node.classList.remove('fx-show');
        Array.prototype.forEach.call(node.querySelectorAll('.countup[data-to]'),function(c){
          c.removeAttribute('data-counted');
          var suffix=c.getAttribute('data-suffix')||'';
          c.textContent='0'+suffix;
        });
        if(node.classList.contains('countup')){
          node.removeAttribute('data-counted');
          node.textContent='0'+(node.getAttribute('data-suffix')||'');
        }
      }
    });
  }
  function updateHud(flashDone){
    if(!hud) return;
    hud.textContent='页 '+(i+1)+'/'+n+' · 动效 '+step+'/'+maxStep+(flashDone?' · 本页动效已完，按 → 翻页':'');
    hud.className='hud'+(flashDone?' done-flash':'');
  }
  function playEnter(idx){
    for(var k=0;k<n;k++){
      slides[k].classList.remove('is-active');
      Array.prototype.forEach.call(slides[k].querySelectorAll('.fx-show'),function(node){node.classList.remove('fx-show')});
      Array.prototype.forEach.call(slides[k].querySelectorAll('.countup[data-to]'),function(c){
        c.removeAttribute('data-counted');
        c.textContent='0'+(c.getAttribute('data-suffix')||'');
      });
    }
    var el=slides[idx]; if(!el) return;
    void el.offsetWidth;
    el.classList.add('is-active');
    maxStep=maxBuildOf(el);
    step=0;
    applyBuild(el, 0);
    updateHud(false);
  }
  function go(x){
    var next=Math.max(0,Math.min(n-1,x));
    i=next;
    deck.style.transform='translateX('+(-i*100)+'vw)';
    playEnter(i);
  }
  function nextBuild(){
    if(step>=maxStep){ updateHud(true); return false; }
    step+=1;
    applyBuild(slides[i], step);
    updateHud(step>=maxStep);
    return true;
  }
  function prevBuild(){
    if(step<=0) return false;
    step-=1;
    applyBuild(slides[i], step);
    updateHud(false);
    return true;
  }
  playEnter(0);
  function onKey(e){
    if(e.key==='ArrowRight'||e.key==='PageDown'){e.preventDefault();go(i+1);return}
    if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();go(i-1);return}
    if(e.key===' ' ||e.key==='Enter'||e.key==='ArrowDown'){e.preventDefault();nextBuild();return}
    if(e.key==='ArrowUp'){e.preventDefault();prevBuild();return}
    if(e.key==='Home'){e.preventDefault();go(0)}
    if(e.key==='End'){e.preventDefault();go(n-1)}
  }
  window.addEventListener('keydown',onKey);
  window.addEventListener('click',function(e){
    if(e.target && e.target.closest && e.target.closest('#controls')) return;
    nextBuild();
  });
  var btnPrev=document.getElementById('btnPrevPage');
  var btnNext=document.getElementById('btnNextPage');
  var btnBuild=document.getElementById('btnNextBuild');
  if(btnPrev) btnPrev.addEventListener('click',function(e){e.stopPropagation();go(i-1)});
  if(btnNext) btnNext.addEventListener('click',function(e){e.stopPropagation();go(i+1)});
  if(btnBuild) btnBuild.addEventListener('click',function(e){e.stopPropagation();nextBuild()});
  var sx=0;
  window.addEventListener('touchstart',function(e){sx=e.changedTouches[0].clientX},{passive:true});
  window.addEventListener('touchend',function(e){
    var dx=e.changedTouches[0].clientX-sx;
    if(Math.abs(dx)>56){ go(i+(dx<0?1:-1)); }
    else { nextBuild(); }
  },{passive:true});
})();
</script>
</body>
</html>`;
}

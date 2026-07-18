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
export type HtmlPptVizKind = "cover" | "ring" | "bars" | "columns" | "steps" | "cards";

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
3. 每页一个主判断 + 至少一种可视化（环形/条形/柱状/步骤轨/指标卡），翻页时图表动效重播。
4. 有页码；键盘 ←→ / 空格 / 点击可翻页。
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
  const vizOk = new Set<HtmlPptVizKind>(["cover", "ring", "bars", "columns", "steps", "cards"]);
  return (pages || [])
    .map((p) => ({
      title: String(p?.title || "").trim().slice(0, 80),
      subtitle: p?.subtitle ? String(p.subtitle).trim().slice(0, 120) : undefined,
      kpi: p?.kpi ? String(p.kpi).trim().slice(0, 16) : undefined,
      note: p?.note ? String(p.note).trim().slice(0, 160) : undefined,
      bullets: Array.isArray(p?.bullets)
        ? p.bullets.map((b) => String(b || "").trim()).filter(Boolean).slice(0, 8)
        : undefined,
      viz: p?.viz && vizOk.has(p.viz) ? p.viz : undefined,
      series: Array.isArray(p?.series)
        ? p.series
            .map((s) => ({
              label: String(s?.label || "").trim().slice(0, 24),
              value: Math.max(0, Math.min(100, Number(s?.value) || 0)),
            }))
            .filter((s) => s.label)
            .slice(0, 8)
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
      label: String(s.label || "").slice(0, 24),
      value: Math.max(0, Math.min(100, Number(s.value) || 0)),
    }));
  }
  const bullets = (page.bullets || []).filter(Boolean).slice(0, 6);
  const pct = parseKpiPercent(page.kpi);
  if (bullets.length) {
    const seed = hashSeed(page.title + String(index));
    return bullets.map((b, i) => {
      const num = b.match(/(\d+(?:\.\d+)?)\s*%/);
      const value = num
        ? Math.max(0, Math.min(100, Number(num[1])))
        : 35 + ((seed >> (i * 3)) % 55);
      return { label: b.replace(/\s*\d+(?:\.\d+)?\s*%/g, "").trim().slice(0, 16) || `项${i + 1}`, value };
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
  if (index === 1 && /目录|叙事|议程/.test(page.title)) return "steps";
  if (index === total - 1) return "steps";
  if (parseKpiPercent(page.kpi) != null || /%|数据|指标|ROI|完成/.test(`${page.title}${page.kpi || ""}`)) {
    return "ring";
  }
  if (/路径|阶段|里程碑|路线|时间线|步骤|Now|Next/.test(page.title)) return "steps";
  if (/结构|拆解|市场|TAM|对比/.test(page.title)) return "columns";
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
    return `<div class="viz viz-cover anim d2" style="--c:${t0.c};--g:${t0.g}">
  <svg class="ring-svg" viewBox="0 0 140 140" aria-hidden="true">
    <circle class="ring-track" cx="70" cy="70" r="${r}"/>
    <circle class="ring-value" cx="70" cy="70" r="${r}" stroke-dasharray="${dash} ${circ.toFixed(1)}"/>
  </svg>
  <div class="cover-kpi">${escapeHtml(page.kpi || "GO")}</div>
</div>`;
  }

  if (kind === "ring") {
    const side = series
      .slice(0, 5)
      .map(
        (s, i) =>
          `<div class="metric-row anim d3" style="${toneStyle(i, `--v:${s.value}`)}"><em class="rank">${i + 1}</em><span>${escapeHtml(s.label)}</span><b>${Math.round(s.value)}</b><i></i></div>`,
      )
      .join("");
    return `<div class="viz viz-split">
  <div class="viz-ring anim d2" style="--c:${t0.c};--g:${t0.g}">
    <svg class="ring-svg" viewBox="0 0 140 140" aria-hidden="true">
      <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${t0.c}"/><stop offset="55%" stop-color="${t1.c}"/><stop offset="100%" stop-color="${t3.c}"/></linearGradient></defs>
      <circle class="ring-track" cx="70" cy="70" r="${r}"/>
      <circle class="ring-value ring-grad" cx="70" cy="70" r="${r}" stroke-dasharray="${dash} ${circ.toFixed(1)}"/>
    </svg>
    <div class="ring-label"><strong>${escapeHtml(page.kpi || `${Math.round(pct)}%`)}</strong><span>主指标</span></div>
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
          `<div class="col anim d3" style="${toneStyle(i, `--h:${Math.round((s.value / max) * 100)}`)}"><div class="col-bar"></div><span>${escapeHtml(s.label)}</span><b>${Math.round(s.value)}</b></div>`,
      )
      .join("");
    return `<div class="viz viz-cols">${cols}</div>`;
  }

  if (kind === "steps") {
    const items = (page.bullets?.length ? page.bullets : series.map((s) => s.label)).slice(0, 6);
    const steps = items
      .map(
        (lab, i) =>
          `<div class="step anim d3" style="${toneStyle(i)}"><div class="step-dot">${i + 1}</div><div class="step-body">${escapeHtml(lab)}</div></div>`,
      )
      .join("");
    return `<div class="viz viz-steps">${steps}</div>`;
  }

  if (kind === "cards") {
    const cards = series
      .slice(0, 4)
      .map(
        (s, i) =>
          `<div class="card anim d3" style="${toneStyle(i, `--v:${s.value}`)}"><div class="card-top"></div><b>${Math.round(s.value)}</b><span>${escapeHtml(s.label)}</span><i></i></div>`,
      )
      .join("");
    return `<div class="viz viz-cards">${cards}</div>`;
  }

  // bars：每条不同高亮色 + 排名圆点（对标热搜条）
  const bars = series
    .slice(0, 8)
    .map(
      (s, i) =>
        `<div class="hbar anim d3" style="${toneStyle(i, `--v:${s.value}`)}"><em class="rank">${i + 1}</em><div class="hbar-lab">${escapeHtml(s.label)}</div><div class="hbar-track"><div class="hbar-fill"></div></div><div class="hbar-val">${Math.round(s.value)}</div></div>`,
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
      const bulletList =
        kind === "steps" || kind === "cards" || kind === "bars" || kind === "columns" || kind === "ring"
          ? ""
          : (p.bullets || []).length
            ? `<ul class="anim d3">${(p.bullets || []).map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
            : "";
      return `<section class="slide${i === 0 ? " is-active" : ""}" data-i="${i}" data-viz="${kind}">
  <div class="slide-bg" aria-hidden="true"></div>
  <div class="slide-inner">
  <div class="accent-line"></div>
  <div class="meta anim d0"><span class="accent">${escapeHtml(styleMeta.labelZh)}</span><span>${i + 1} / ${safePages.length}</span></div>
  ${kind === "cover" && p.kpi ? "" : p.kpi && kind !== "ring" ? `<div class="kpi anim d1">${escapeHtml(p.kpi)}</div>` : ""}
  <h1 class="anim d1">${escapeHtml(p.title)}</h1>
  ${p.subtitle ? `<p class="sub anim d2">${escapeHtml(p.subtitle)}</p>` : ""}
  ${viz}
  ${bulletList}
  ${p.note ? `<p class="note anim d4">${escapeHtml(p.note)}</p>` : ""}
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
html,body{margin:0;height:100%;overflow:hidden;cursor:pointer}
${STYLE_CSS[styleId]}
.deck{height:100%;width:100%;display:flex;transition:transform .62s cubic-bezier(.22,1,.36,1)}
.slide{min-width:100vw;height:100vh;padding:clamp(24px,4.5vw,56px);display:flex;flex-direction:column;justify-content:center;position:relative;overflow:hidden}
.slide-bg{position:absolute;inset:0;z-index:0;pointer-events:none;background-image:url('${bgUrl}');background-size:cover;background-position:center;opacity:.38;mix-blend-mode:soft-light}
.slide-inner{position:relative;z-index:1;display:flex;flex-direction:column;justify-content:center;min-height:72%;max-width:1100px;width:100%}
.accent-line{height:3px;width:120px;background:linear-gradient(90deg,#22d3ee,#a78bfa,#a3e635,#fb923c);margin-bottom:10px;box-shadow:0 0 12px rgba(34,211,238,.35)}
.meta{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:14px}
h1{font-size:clamp(1.7rem,4.2vw,3rem);line-height:1.15;margin:6px 0 10px;letter-spacing:-.02em;max-width:20ch}
.sub{color:var(--muted);font-size:clamp(.95rem,1.8vw,1.2rem);margin:0 0 14px;max-width:46ch}
ul{margin:10px 0 0;padding-left:1.1em;font-size:clamp(1rem,1.8vw,1.2rem);line-height:1.55}
li{margin:7px 0}
.note{margin-top:16px;color:var(--muted);font-size:13px}
.kpi{color:#facc15;font-weight:800;font-size:clamp(2rem,5vw,3.6rem);letter-spacing:-.03em;text-shadow:0 0 18px rgba(250,204,21,.35)}
.hint{position:fixed;right:16px;bottom:14px;z-index:5;font-size:12px;color:var(--muted);background:rgba(0,0,0,.28);padding:6px 10px;border-radius:999px;backdrop-filter:blur(8px)}
.viz{margin-top:18px}
.rank{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:800;font-style:normal;color:#0b1020;background:var(--c);box-shadow:0 0 10px var(--g)}
.viz-split{display:grid;grid-template-columns:minmax(140px,220px) 1fr;gap:28px;align-items:center}
.viz-ring{position:relative;width:min(220px,42vw);aspect-ratio:1;filter:drop-shadow(0 0 16px var(--g))}
.ring-svg{width:100%;height:100%;transform:rotate(-90deg)}
.ring-track{fill:none;stroke:rgba(148,163,184,.22);stroke-width:12}
.ring-value{fill:none;stroke:var(--c,#22d3ee);stroke-width:12;stroke-linecap:round}
.ring-value.ring-grad{stroke:url(#rg)}
.slide:not(.is-active) .ring-value{stroke-dasharray:0 999 !important}
.slide.is-active .ring-value{animation:ringDraw 1s cubic-bezier(.22,1,.36,1) both}
.ring-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ring-label strong{font-size:clamp(1.6rem,3.5vw,2.4rem);color:#f8fafc;line-height:1;text-shadow:0 0 20px var(--g,#22d3ee)}
.ring-label span{font-size:12px;color:var(--muted);margin-top:4px}
.metric-row{display:grid;grid-template-columns:28px 1fr auto;gap:6px 10px;margin:10px 0;align-items:center}
.metric-row span{color:var(--text);font-size:14px}
.metric-row b{color:var(--c);font-size:14px;text-shadow:0 0 10px var(--g)}
.metric-row i{grid-column:1/-1;display:block;height:8px;border-radius:99px;background:rgba(148,163,184,.18);position:relative;overflow:hidden}
.metric-row i::after{content:"";position:absolute;inset:0 auto 0 0;width:0;background:linear-gradient(90deg,var(--c),#fff);border-radius:99px;box-shadow:0 0 12px var(--g)}
.slide.is-active .metric-row i::after{animation:fillX .85s cubic-bezier(.22,1,.36,1) both;animation-delay:calc(.12s + var(--i)*.08s)}
.viz-bars{display:flex;flex-direction:column;gap:11px;max-width:720px}
.hbar{display:grid;grid-template-columns:28px minmax(72px,130px) 1fr 44px;gap:10px;align-items:center}
.hbar-lab{font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hbar-track{height:14px;border-radius:99px;background:rgba(148,163,184,.16);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.04)}
.hbar-fill{height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--c),color-mix(in srgb,var(--c) 55%,#fff));box-shadow:0 0 14px var(--g)}
.slide.is-active .hbar-fill{animation:fillBar .9s cubic-bezier(.22,1,.36,1) both;animation-delay:calc(.1s + var(--i)*.07s);width:calc(var(--v)*1%)}
.hbar-val{font-size:13px;color:var(--c);font-weight:800;text-align:right;text-shadow:0 0 10px var(--g)}
.viz-cols{display:flex;align-items:flex-end;gap:14px;height:200px;max-width:720px;padding-top:8px}
.col{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end}
.col-bar{width:100%;max-width:56px;height:0;border-radius:10px 10px 4px 4px;background:linear-gradient(180deg,var(--c),color-mix(in srgb,var(--c) 35%,#0b1020));box-shadow:0 0 16px var(--g)}
.slide.is-active .col-bar{animation:colUp .85s cubic-bezier(.22,1,.36,1) both;animation-delay:calc(.1s + var(--i)*.08s);height:calc(var(--h)*1%)}
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
.slide.is-active .card i::after{animation:fillX .8s cubic-bezier(.22,1,.36,1) both;animation-delay:calc(.12s + var(--i)*.08s);width:calc(var(--v)*1%)}
.viz-cover{position:relative;width:min(180px,36vw);margin-top:8px;filter:drop-shadow(0 0 16px var(--g))}
.cover-kpi{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:clamp(1.4rem,3vw,2rem);font-weight:800;color:#f8fafc;text-shadow:0 0 16px var(--g)}
.slide .anim{opacity:0;transform:translateY(18px)}
.slide.is-active .anim{animation:rise .55s cubic-bezier(.22,1,.36,1) both}
.slide.is-active .anim.d0{animation-delay:.02s}
.slide.is-active .anim.d1{animation-delay:.08s}
.slide.is-active .anim.d2{animation-delay:.14s}
.slide.is-active .anim.d3{animation-delay:calc(.18s + var(--i,0)*.07s)}
.slide.is-active .anim.d4{animation-delay:.36s}
.slide.is-active .accent-line{animation:barGrow .7s cubic-bezier(.22,1,.36,1) both}
@keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@keyframes barGrow{from{transform:scaleX(.2);transform-origin:left center;opacity:.4}to{transform:none;opacity:1}}
@keyframes fillX{from{width:0}to{width:calc(var(--v)*1%)}}
@keyframes fillBar{from{width:0}to{width:calc(var(--v)*1%)}}
@keyframes colUp{from{height:0}to{height:calc(var(--h)*1%)}}
@keyframes ringDraw{from{stroke-dasharray:0 999}}
@media (max-width:720px){.viz-split{grid-template-columns:1fr}.hbar{grid-template-columns:24px 64px 1fr 36px}.viz-cols{height:160px}}
</style>
</head>
<body>
<div class="deck" id="deck">
${slidesHtml}
</div>
<div class="hint">← → / 空格 / 点击翻页 · ${escapeHtml(styleMeta.labelZh)} · 动效PPT（图表）</div>
<script>
(function(){
  var deck=document.getElementById('deck');
  var slides=deck ? deck.children : [];
  var n=slides.length; var i=0;
  function playEnter(idx){
    for(var k=0;k<n;k++){ slides[k].classList.remove('is-active'); }
    var el=slides[idx]; if(!el) return;
    void el.offsetWidth;
    el.classList.add('is-active');
  }
  function go(x){
    var next=Math.max(0,Math.min(n-1,x));
    i=next;
    deck.style.transform='translateX('+(-i*100)+'vw)';
    playEnter(i);
  }
  playEnter(0);
  window.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key===' ' ||e.key==='PageDown'){e.preventDefault();go(i+1)}
    if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();go(i-1)}
    if(e.key==='Home'){e.preventDefault();go(0)}
    if(e.key==='End'){e.preventDefault();go(n-1)}
  });
  window.addEventListener('click',function(e){
    if(e.target && e.target.closest && e.target.closest('.hint')) return;
    var mid=window.innerWidth/2;
    go(e.clientX>=mid ? i+1 : i-1);
  });
  var sx=0;
  window.addEventListener('touchstart',function(e){sx=e.changedTouches[0].clientX},{passive:true});
  window.addEventListener('touchend',function(e){var dx=e.changedTouches[0].clientX-sx; if(Math.abs(dx)>40) go(i+(dx<0?1:-1));},{passive:true});
})();
</script>
</body>
</html>`;
}

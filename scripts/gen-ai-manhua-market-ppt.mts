/**
 * 本地生成「AI漫剧市场现状与前景」动效 PPT（含图表数据 + 分步动效）。
 * 数据口径：DataEye 2025 漫剧报告 / 钛媒体转述 / 广电与平台公开治理信息（演示用，非投资建议）。
 *
 *   pnpm exec tsx scripts/gen-ai-manhua-market-ppt.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildHtmlPptDocument, type HtmlPptPage } from "../shared/htmlPptMaker";

const pages: HtmlPptPage[] = [
  {
    title: "AI漫剧的市场现状与前景",
    subtitle: "从沙雕表情包到仿真人 AIGC：百亿赛道如何重估内容工业",
    kpi: "168亿",
    viz: "cover",
    note: "口径：DataEye 预估 2025 漫剧整体市场；含付费/免费/APP 与社媒分发。演示数据仅供讲解。",
  },
  {
    title: "今天要讲清的五件事",
    subtitle: "规模 → 结构 → 增速 → 入局路径 → 合规边界",
    viz: "steps",
    bullets: [
      "市场规模与 2026 预测",
      "品类供给占比与流量结构",
      "发展时间线与爆发拐点",
      "新手快速入局与常见坑",
      "国内平台 / 出海与政策",
    ],
  },
  {
    title: "当前市场规模：2025≈168亿",
    subtitle: "抖音端原生漫剧上线破 6 万部；全年播放量超 700 亿次量级",
    kpi: "168亿",
    viz: "cards",
    series: [
      { label: "2025市场规模(亿)", value: 168 },
      { label: "抖音端上线(万部)", value: 6 },
      { label: "用户规模约(亿人)", value: 1.2 },
      { label: "播放量量级(百亿)", value: 7 },
    ],
    note: "2025 前供给不足千部；2025 为爆发元年。用户约 1.2 亿≈微短剧用户约 1/3（DataEye）。",
  },
  {
    title: "2026 预测：243.6 亿，+45%",
    subtitle: "免费/付免混合兴起，用户有望翻倍至约 2.8 亿",
    kpi: "45%",
    viz: "line",
    series: [
      { label: "2023前", value: 8 },
      { label: "2024试探", value: 28 },
      { label: "2025爆发", value: 168 },
      { label: "2026E", value: 244 },
    ],
    note: "曲线为讲解示意：2023–24 为量级锚点，2025–26E 对齐 DataEye 公开预估。",
  },
  {
    title: "品类供给占比：基本盘 vs 高潜",
    subtitle: "沙雕/解说/2D3D 撑基本盘；AIGC 仿真人供给仅 6.1% 但增速最猛",
    viz: "bars",
    series: [
      { label: "表情包/沙雕", value: 44 },
      { label: "解说/小说漫", value: 26 },
      { label: "2D/3D漫剧", value: 22 },
      { label: "AIGC/仿真人", value: 6 },
      { label: "游戏编辑器", value: 2 },
    ],
    note: "占比取整便于投屏：44.44% / 25.89% / 21.81% / 6.1% / 1.76%（供给结构）。",
  },
  {
    title: "流量侧：AIGC 播放量全年×181",
    subtitle: "漫剧在短剧播放占比：6月约5% → 12月约35%",
    kpi: "35%",
    viz: "ring",
    series: [
      { label: "沙雕播放增长(倍)", value: 14 },
      { label: "AIGC播放增长(倍)", value: 100 },
      { label: "12月漫剧占短剧%", value: 35 },
      { label: "男用户占比约%", value: 90 },
    ],
    note: "AIGC 增速公开表述为约 181 倍；环图主指标取 12 月渗透。受众偏 24–30 岁男性，与传统短剧错位。",
  },
  {
    title: "发展历史：四年四阶",
    subtitle: "二次元引流 → 端原生试探 → 爆发量产 → 合规精品化",
    viz: "steps",
    bullets: [
      "≤2023：占比低，多版权二次创作/引流",
      "2024：抖音/快手端原生试探，沙雕+小说漫",
      "2025：爆发元年，6万部级供给与百亿市场",
      "2026：免费模式+备案审核，转向工业与合规",
    ],
    note: "区域集聚：广东/浙江（广州、深圳、杭州）产业链更成熟。",
  },
  {
    title: "新手如何快速入局",
    subtitle: "先跑通「题材验证→单集闭环→平台分发→复投」",
    viz: "steps",
    bullets: [
      "选强设定题材：逆袭/玄幻/脑洞（漫剧更吃设定）",
      "用 AI 流水线压成本：人设库+分镜+批量出片",
      "先做 1 条可完播样片，再扩集数与矩阵号",
      "对齐平台创作建议与备案路径再放量",
      "付费/免费模式分开测 ROI，避免一把梭",
    ],
  },
  {
    title: "有哪些坑（先避雷）",
    subtitle: "流量红利在，但粗制滥造与合规雷会直接清场",
    viz: "bars",
    series: [
      { label: "未备案强下线", value: 95 },
      { label: "低俗擦边被拒", value: 88 },
      { label: "AI换脸侵权", value: 90 },
      { label: "付费ROI下滑", value: 72 },
      { label: "同质化杀价", value: 80 },
    ],
    note: "风险分为「合规红线」与「经营陷阱」；条高=讲解权重，非精确概率。",
  },
  {
    title: "国内平台格局",
    subtitle: "抖音端原生领军；红果快速崛起；投流头部效应显著",
    viz: "columns",
    series: [
      { label: "抖音原生", value: 70 },
      { label: "其他社媒", value: 18 },
      { label: "免费APP", value: 12 },
    ],
    note: "播放结构示意：抖音端原生约占整体近 70%。投流侧番茄等头部占比高，中腰部靠垂直题材差异化。",
  },
  {
    title: "国内 vs 出海：能力对照",
    subtitle: "series 前半=国内权重，后半=出海权重（讲解用相对分）",
    viz: "compare",
    bullets: ["国内主战场", "出海增量"],
    series: [
      { label: "供给与分发", value: 92 },
      { label: "付费/广告变现", value: 78 },
      { label: "备案合规压力", value: 95 },
      { label: "本地化与字幕", value: 88 },
      { label: "版权肖像风险", value: 90 },
      { label: "付费转化难度", value: 72 },
    ],
    note: "对照分用于路演讲解，非精确份额。出海常见 ReelShort/DramaBox + TikTok/YT 测素材。",
  },
  {
    title: "海外平台与出海要点",
    subtitle: "海外是增量，但国内合规仍是底座",
    viz: "cards",
    series: [
      { label: "短剧出海热度", value: 82 },
      { label: "本地化字幕/配音", value: 76 },
      { label: "版权与肖像合规", value: 94 },
      { label: "付费转化难度", value: 68 },
    ],
    note: "常见路径：ReelShort/DramaBox 等短剧出海渠道 + YouTube/TikTok 测素材；核心剧仍建议按国内备案标准生产。",
  },
  {
    title: "政策与平台规则（2026）",
    subtitle: "动画微短剧（含 AIGC）纳入备案与分级审核",
    viz: "steps",
    bullets: [
      "广电：不良动画微短剧专项治理，AIGC 重点审核",
      "2026-04-01：未备案存量面临强制下线",
      "重点/普通类走省级报审；其他类平台自审备案",
      "红果+抖音：4/7 起提升立意与风险分级审核",
      "AI 换脸/声纹克隆/魔改：艺人维权与平台下架并行",
    ],
    note: "公开信息综合：广电治理时间表 + 红果《动画微短剧（漫剧）内容创作建议》。以官方最新文为准。",
  },
  {
    title: "结论：红利未尽，门槛已至",
    subtitle: "抓住 AIGC 效率，用合规与人设资产换长期复利",
    viz: "steps",
    bullets: [
      "短线：沙雕/小说漫仍有流量，适合验证模型",
      "中线：2D/3D 与仿真人更吃精品与工业化",
      "关键：备案+平台创作建议=入场券",
      "组织：人设库/分镜库/复盘体系 > 单次爆款",
    ],
    note: "数据截至公开研报与 2026 年政策报道；讲解时标注来源与不确定性。",
  },
];

const html = buildHtmlPptDocument({
  title: "AI漫剧的市场现状与前景",
  styleId: "dark_research",
  purposeZh: "行业分享/路演讲解：市场结构、入局路径与合规边界",
  pages,
});

const outDir = join(homedir(), "Downloads", "2026Jul18", "html-ppt-online-test");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "ai-manhua-market-stepped.html");
writeFileSync(outPath, html, "utf8");
console.log(`wrote ${outPath}`);
console.log(`pages=${pages.length} bytes=${html.length}`);

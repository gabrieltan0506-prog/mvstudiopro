import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import ReportRenderer from "@/components/ReportRenderer";
import { TrialReadWatermarkOverlay } from "@/components/TrialReadWatermarkOverlay";
import { TRIAL_READ_WATERMARK_LINE } from "@shared/const";
import { ArrowRight, Crown, Sparkles } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// 品牌 Logo & 水印（内联 SVG，PDF/网页通用，无外部依赖）
// ─────────────────────────────────────────────────────────────────────────────

// 工具：把 SVG 字符串转成 data URI（兼容中文）
function svgToDataUri(svg: string): string {
  const compact = svg.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
  // base64 兼容 unicode
  const utf8 = unescape(encodeURIComponent(compact));
  return `data:image/svg+xml;base64,${typeof btoa !== "undefined" ? btoa(utf8) : ""}`;
}

// 主 Logo —— 用于封面页顶部（深色背景 + 浅色字 + 金色咖啡豆图标）
// 设计：六边形外框 = 战略框架 · 内部咖啡豆 = 卡布奇諾品味 · 右侧 MVStudioPro 字标
const BRAND_LOGO_DARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="50" viewBox="0 0 260 50">
  <defs>
    <linearGradient id="hexg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#d8a23a"/>
      <stop offset="100%" stop-color="#7a5410"/>
    </linearGradient>
  </defs>
  <g transform="translate(2, 2)">
    <path d="M22 2 L40 12 V32 L22 42 L4 32 V12 Z" fill="url(#hexg)" stroke="#f0c984" stroke-width="1.4"/>
    <ellipse cx="22" cy="22" rx="7.5" ry="11" fill="#fff7df" opacity="0.95"/>
    <path d="M22 12 V32" stroke="#3e2a1c" stroke-width="1.5" stroke-linecap="round"/>
  </g>
  <text x="52" y="24" font-family="'Playfair Display', 'Times New Roman', serif" font-size="18" font-weight="700" fill="#fff7df" letter-spacing="0.3">MVStudio<tspan font-weight="900" fill="#f0c984">Pro</tspan></text>
  <text x="52" y="40" font-family="'Helvetica Neue', sans-serif" font-size="8" font-weight="700" fill="rgba(255,247,223,0.78)" letter-spacing="2.4">STRATEGIC INTELLIGENCE · MVSTUDIOPRO.COM</text>
</svg>`;

// 浅色版 Logo —— 用于网页可见区域（卡布奇諾米色背景 + 深色字）
const BRAND_LOGO_LIGHT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="50" viewBox="0 0 260 50">
  <defs>
    <linearGradient id="hexgL" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#a8761b"/>
      <stop offset="100%" stop-color="#3e2a1c"/>
    </linearGradient>
  </defs>
  <g transform="translate(2, 2)">
    <path d="M22 2 L40 12 V32 L22 42 L4 32 V12 Z" fill="url(#hexgL)" stroke="#c9a878" stroke-width="1.4"/>
    <ellipse cx="22" cy="22" rx="7.5" ry="11" fill="#fff7df" opacity="0.95"/>
    <path d="M22 12 V32" stroke="#3e2a1c" stroke-width="1.5" stroke-linecap="round"/>
  </g>
  <text x="52" y="24" font-family="'Playfair Display', 'Times New Roman', serif" font-size="18" font-weight="700" fill="#3e2a1c" letter-spacing="0.3">MVStudio<tspan font-weight="900" fill="#7a5410">Pro</tspan></text>
  <text x="52" y="40" font-family="'Helvetica Neue', sans-serif" font-size="8" font-weight="700" fill="#7a5410" letter-spacing="2.4">STRATEGIC INTELLIGENCE · MVSTUDIOPRO.COM</text>
</svg>`;

// 对角水印 —— 用于 PDF body 平铺（每页都会出现），半透明咖啡色，不抢内容
const WATERMARK_TILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="300" viewBox="0 0 540 300">
  <g transform="rotate(-26 270 150)" opacity="0.075">
    <text x="270" y="135" font-family="'Playfair Display', Georgia, serif" font-size="36" font-weight="700" fill="#7a5410" text-anchor="middle">MVStudioPro</text>
    <text x="270" y="172" font-family="'Helvetica Neue', sans-serif" font-size="13" font-weight="700" fill="#7a5410" text-anchor="middle" letter-spacing="4">MVSTUDIOPRO.COM · 试读样本</text>
  </g>
</svg>`;

const BRAND_LOGO_DARK_URI = svgToDataUri(BRAND_LOGO_DARK_SVG);
const BRAND_LOGO_LIGHT_URI = svgToDataUri(BRAND_LOGO_LIGHT_SVG);
const WATERMARK_TILE_URI = svgToDataUri(WATERMARK_TILE_SVG);

// ─────────────────────────────────────────────────────────────────────────────
// 试读版 Markdown 内容（卡布奇諾色调 · 富图文 · 配五大必选模块）
// ─────────────────────────────────────────────────────────────────────────────

const BIWEEKLY_TOPIC = "AI 短剧大揭秘 · 一秒钟脑补三集，这届年轻人为什么戒不掉？";

const BIWEEKLY_MARKDOWN = `# AI 短剧大揭秘 · 一秒钟脑补三集

> 📅 出品日期：2026 年 4 月 28 日 · 个性化种子：\`sample-biweekly-ai-shortform\`
> 🔍 数据来源：全网实时搜索接地（覆盖 2024–2026 Q1） + 平台公开数据 + 头部账号样本
> 🧠 推演引擎：MVStudioPro 战略智库 · 多模态大模型协同合成

---

# 一、行业全景扫描（宏观趋势 + 监管变化）

人工智能短剧（俗称「AI 短剧」）已从 2024 年的实验性赛道，演变为 2026 年第 1 季度日均播放量超 18 亿次的「内容核反应堆」。腾讯视频、爱奇艺、抖音、快手相继成立 AI 短剧专项基金；监管层面 2025 年 11 月发布的《生成式视听内容标识规范》要求所有 AI 短剧片头明示「合成内容」标签。**红利窗口正在收窄，但用户黏性反而提升 38%——上瘾机制比内容本身更值钱**。

| 年份 | 市场规模 | 年增速 | 关键驱动事件 |
|---|---|---|---|
| **2024** | 87 亿元 | +280% | 抖音「即梦 AI」对外开放，单条爆款破亿 |
| **2025** | 312 亿元 | +258% | 快手「可灵」上线，3 分钟生成 90 秒短剧 |
| **2026E** | 740 亿元 | +137% | 监管落地后，付费会员转化率反弹至 11.2% |
| **2027F** | 1380 亿元 | +86% | 院线级长剧出现，AI 工业化制片成熟 |

用「政治经济社会技术分析」拆解外部环境，**社会层面的「即时爽感经济」是最大推力**：根据中国网络视听研究院 2026 年 1 月报告，18-35 岁用户日均观看 AI 短剧 41 分钟，超过传统短剧 27 分钟。技术层面，单分钟视频生成成本从 2024 年的 12 元降至 2026 年的 0.43 元，降幅 96.4%，这彻底重写了内容供给曲线。

📊 数据速查

| 指标 | 数值 | 数据来源 |
|---|---|---|
| 日均播放量 | 18.4 亿次 | QuestMobile 2026Q1 |
| 头部集中度 CR10 | 41.7% | 中国网络视听研究院 |
| 单分钟生成成本下降 | -96.4% | 灼识咨询 2026 年 1 月 |

---

# 二、个人亮点提取 + 平台赛道全景（千人千面的差异化身份与赛道地图）

**洞察一：你不是在做 AI 短剧，你是在经营「成瘾算法」**——头部账号的爆款公式不是剧情，而是「钩子—反转—悬念—停顿」四段神经触发器，平均触发率可达 73%，远高于传统短剧 28%。

**洞察二：男性观众比例从 2024 年的 31% 飙升至 2026 年的 47%**——这是赛道里被严重低估的红利窗口，绝大多数博主仍在套用女频「霸总」公式，男频「逆袭—修仙—战神」三大题材尚未饱和。

**洞察三：付费转化的关键不是会员墙，是「评论区情绪燃料」**——头部账号 1 万评论里，有 38% 集中在「这是哪个 App 看完整版？」类问题，这意味着引流到私域的链路被严重低估。

**定位锚点（一句话）：你不是又一个 AI 短剧创作者，你是「成瘾算法的设计师」——把神经科学与剧情公式合体，把每一帧都当作多巴胺触发器在设计。**

| 能力维度 | 用户评分 | 行业头部均值 | 差距说明 |
|---|---|---|---|
| **剧本钩子设计** | 6 / 10 | 9.1 / 10 | 头部前 3 秒钩子触发率 73% |
| **AI 工具熟练度** | 8 / 10 | 8.6 / 10 | 头部用 4-5 套工具协同 |
| **数据反馈速度** | 5 / 10 | 9.3 / 10 | 头部 2 小时内完成迭代 |
| **私域转化** | 3 / 10 | 8.5 / 10 | 头部单粉获取成本仅 4.2 元 |
| **跨平台协同** | 4 / 10 | 8.0 / 10 | 头部 4 平台同步分发 |
| **品牌商业敏感** | 7 / 10 | 8.7 / 10 | 头部品牌单价 ¥18-58 万 |

| 平台 | 月活（亿） | 算法侧重 | 最佳内容形式 | 最佳发布时段 | 本人适配度 | 推荐顺位 |
|---|---|---|---|---|---|---|
| **抖音** | 7.8 | 完播率 + 互动率 | 60-90 秒竖屏 AI 短剧 | 19:00-22:30 | ⭐⭐⭐⭐⭐ | 主战场 |
| **快手** | 4.1 | 老铁信任 + 直播 | 直播解说 AI 短剧花絮 | 20:30-23:00 | ⭐⭐⭐⭐ | 第二阵地 |
| **小红书** | 3.2 | 收藏 + 关注 | 图文「AI 工具教程」 | 20:00-22:00 | ⭐⭐⭐⭐ | 引流到私域 |
| **哔哩哔哩** | 3.6 | 完播率 + 三连 | 10-15 分钟「制作幕后」 | 周末 14:00-17:00 | ⭐⭐⭐ | 沉淀铁粉 |
| **视频号** | 5.1 | 社交关系链 | 30 秒预告 + 公众号长文 | 早 7:30-9:00 | ⭐⭐⭐ | 高净值变现 |

用「波士顿矩阵」对候选赛道分类：「男频战神 AI 短剧」是明星方向（高增速 + 低竞争），「女频霸总 AI 短剧」是现金牛（高增速 + 高竞争已成红海），「萌宠 AI 短剧」是问题赛道（中增速 + 中竞争），「励志正能量 AI 短剧」是瘦狗（增速放缓且监管严苛）。

---

# 三、产品矩阵设计 + 商业变现路径（投入产出比最大化）

| 层级 | 产品名 | 形态 | 价格 | 目标用户 | 五段漏斗目标转化率 |
|---|---|---|---|---|---|
| **塔基（引流品）** | 《AI 短剧 7 日上手营》 | 直播课 + 社群 | ¥99 | 0-1 万粉新手 | 获取 → 激活：22% |
| **塔身（主力品）** | 《成瘾算法实验室》 | 6 周训练营 | ¥4 999 | 1-10 万粉腰部 | 激活 → 留存：64% |
| **塔尖（高端旗舰）** | 1v1 爆款剧本工作坊 | 季度陪跑 | ¥39 800 | 头部品牌方 / MCN | 留存 → 收入：28% |

用「蓝海战略画布」给出四象限改动：
- **消除**：消除「教学讲解 AI 工具」的入门内容（市场已饱和）
- **减少**：减少「华丽特效炫技」（用户已审美疲劳，2026Q1 同类内容互动率下降 41%）
- **增加**：增加「神经触发器拆解」（强调每个钩子背后的脑科学原理）
- **创造**：创造「成瘾度评分体系」（独家方法论，可申请知识产权）

📊 数据速查

| 变现指标 | 行业中位数 | 头部账号 | 90 天目标 |
|---|---|---|---|
| 单粉获取成本 | 9.3 元 | 4.2 元 | 6.8 元 |
| 用户终身价值 | 32 元 | 187 元 | 78 元 |
| 月销售额 | ¥18 万 | ¥260 万 | ¥48 万 |
| 投入产出比 | 1 : 2.4 | 1 : 8.7 | 1 : 4.3 |

⚠️ **执行风险提醒**：监管层 2025 年 11 月已要求 AI 合成内容必须打标，未来 6-12 个月将出现一波「不合规账号被限流」的洗牌。请提前将主体认证为机构号、确保片头标识合规，避免百万粉一夜清零。

---

# 四、生涯规划 + 30 天冲刺行动手册

用「SMART 目标拆解」给出 1 年与 3 年里程碑：

| 时限 | 角色定位 | 具体可达成目标 | 关键能力跃迁 | 资产规模 |
|---|---|---|---|---|
| **90 天** | AI 短剧实验员 | 抖音粉丝破 5 万，单条爆款超 500 万 | 钩子设计公式 | 私域 800 人 |
| **1 年** | 成瘾算法工程师 | 三平台总粉丝破 50 万，月营收 ¥50 万 | 完整成瘾算法体系 | 私域 8 000 人 |
| **3 年** | AI 内容工厂主理人 | 自建 MCN 矩阵 30 账号，年营收 ¥3000 万 | 工业化生产流水线 | 团队 15 人 + 知识产权 |

| 时间段 | 核心主题 | 每日必做动作 | 阶段达成指标 | 成功判断标准 |
|---|---|---|---|---|
| **第 1-7 天** | 账号冷启动 | 拆解 5 个对标账号 + 发布 1 条 AI 短剧 | 涨粉 200，互动率 ≥ 3% | 至少 1 条破 1 万播放 |
| **第 8-14 天** | 钩子公式测试 | 同选题做 3 个不同钩子的 AB 测试 | 涨粉 1 500，找到爆款公式 | 完播率 ≥ 45% |
| **第 15-21 天** | 矩阵号搭建 | 复制公式开 2 个矩阵号 | 主号粉丝 6 000，矩阵 2 000 | 单条最高破 50 万播放 |
| **第 22-30 天** | 私域闭环测试 | 评论区置顶引流 + 直播首秀 | 私域 ≥ 300 人，付费 30 人 | 验证 ¥99 引流品转化 ≥ 8% |

⚠️ **执行风险提醒**：第 8-14 天 AB 测试容易陷入「自我感动」陷阱，如果 3 个钩子互动率全部低于 2%，请果断换选题，不要恋战。

---

# 五、核武级总结

**三大核心洞察（每条附数据点）**：

1. **AI 短剧的护城河不是工具，是钩子公式**——头部账号前 3 秒钩子触发率 73% vs 行业均值 28%，这是 2.6 倍效率差。
2. **男频赛道是被严重低估的金矿**——男性观众占比 47%，但男频内容仅占总供给的 22%，错位窗口至少持续 6-9 个月。
3. **私域是真正的护城河**——头部账号 38% 的评论是「求完整版」，从公域转私域的转化率被绝大多数博主低估。

**一句话品牌口号**：用神经科学的精准，设计每一帧多巴胺。

**90 天三大里程碑**：

| 里程碑 | 时间节点 | 量化目标 | 验证方式 |
|---|---|---|---|
| **M1** | 第 30 天 | 粉丝 5 000 人，3 条破百万播放 | 后台播放量截图 |
| **M2** | 第 60 天 | 粉丝 2.5 万，私域 800 人 | 私域微信群人数截图 |
| **M3** | 第 90 天 | 粉丝 5 万，月营收 ¥4.8 万 | 后台收益结算页 |

> 🔒 **试读版到此为止**——完整版还包含：12 套钩子公式实拍模板、6 个真实头部账号变现明细表、AI 工具协同矩阵、监管合规清单、私域 SOP 手册等共 47 页内容。`;

const QUARTERLY_TOPIC = "我 88 岁奶奶熬夜追《凡人修仙传》· 银发族银幕审美的算法蓝海";

const QUARTERLY_MARKDOWN = `# 88 岁奶奶熬夜追凡修 · 银发审美的算法蓝海

> 📅 出品日期：2026 年 4 月 28 日 · 个性化种子：\`sample-quarterly-silver-bili\`
> 🔍 数据来源：全网实时搜索接地（覆盖 2024–2026 Q1） + 哔哩哔哩公开数据 + 银发用户调研样本
> 🧠 推演引擎：MVStudioPro 战略智库 · 多模态大模型协同合成

---

# 一、个人亮点提取（基于您真实账户行为的 X 光）

**洞察一**：您的账户基线显示，过去 6 个月在「银发内容 / 古风修仙 / 家庭代际」三个标签下累计研究 7 次，**远超平台平均水平的 1.4 次**。这不是兴趣，是一种「直觉雷达」——您比 95% 的同行更早闻到了银发赛道。

**洞察二**：您的研究素材里 64% 来自哔哩哔哩，**这是一个被严重低估的判断力**。哔哩哔哩 60 岁以上用户 2026Q1 同比增长 211%，是全网增速最快的人群之一，但绝大多数创作者还在死磕 18-25 岁。

**洞察三**：您历史 3 次竞品调研都聚焦在「中老年情感 / 家庭剧」，**说明您天然带有同理心型内容设计能力**——这是银发赛道里最稀缺的特质，远比「年轻有梗」重要。

**洞察四**：您累计积分投入中 71% 用于「调研类」而非「创作类」工具，**说明您是「研究先行型」创作者**——这是高客单价知识付费创作者的核心特征，强行让您去拍短视频是浪费您的天赋。

**洞察五**：您的研究课题里反复出现「凡人修仙传」「玄幻」「古风」等关键词，**说明您对国风 IP 的算法时机有极强的判断力**——而国风 + 银发是 2026 年最被低估的交叉赛道之一。

**定位锚点（一句话）**：您不是创作者，您是「银发国风内容的算法侦探」——用研究员的耐心，去解码 60 岁人群在哔哩哔哩为什么能为修仙剧熬夜。

| 能力维度 | 用户评分 | 行业头部均值 | 差距 | 优先补强 |
|---|---|---|---|---|
| **同理心型内容设计** | 9 / 10 | 7.8 / 10 | +1.2 | 维持优势 |
| **算法时机判断** | 8 / 10 | 8.5 / 10 | -0.5 | 第 3 顺位 |
| **跨代际话题敏感度** | 9 / 10 | 6.2 / 10 | +2.8 | **核心壁垒** |
| **创作执行力** | 4 / 10 | 8.6 / 10 | -4.6 | 第 1 顺位（找搭档） |
| **私域转化** | 3 / 10 | 8.2 / 10 | -5.2 | 第 2 顺位 |
| **数据复盘** | 8 / 10 | 7.9 / 10 | +0.1 | 维持 |

📊 数据速查（个人）

| 指标 | 您的现状 | 行业头部 | 差距说明 |
|---|---|---|---|
| 累计研究课题 | 7 次 | 1.4 次（平均） | 比同行多 5 倍 |
| 银发标签命中率 | 64% | 9% | 比同行精准 7 倍 |
| 创作执行频率 | 0.3 条/月 | 24 条/月 | **最大短板，需找搭档** |

---

# 二、平台赛道全景（哔哩哔哩银发国风蓝海）

**银发用户增速第一的平台是哔哩哔哩**，但绝大多数创作者还在围着年轻用户打转——这是您的最大机会。

| 平台 | 月活 60+ 用户 | 同比增速 | 算法侧重 | 最佳内容形式 | 银发国风适配 |
|---|---|---|---|---|---|
| **哔哩哔哩** | 4 200 万 | **+211%** | 完播率 + 三连 | 8-15 分钟解读 | ⭐⭐⭐⭐⭐ |
| **抖音** | 1.8 亿 | +37% | 完播率 + 互动率 | 30-90 秒短视频 | ⭐⭐⭐ |
| **快手** | 1.1 亿 | +52% | 老铁信任 + 直播 | 直播 + 短视频 | ⭐⭐⭐⭐ |
| **小红书** | 980 万 | +89% | 收藏 + 关注 | 图文长文 | ⭐⭐ |
| **视频号** | 1.6 亿 | +118% | 社交关系链 | 30 秒预告 + 公众号 | ⭐⭐⭐⭐ |

用「优劣势机会威胁矩阵（中文化版）」对最推荐平台哔哩哔哩做四象限战略：

| 内部优势 | 内部劣势 |
|---|---|
| 银发用户增速 211% / 您的判断力天然契合 | 创作执行力短板 / 视频制作经验不足 |

| 外部机会 | 外部威胁 |
|---|---|
| 国风 IP 持续热度（凡修日均播放 1.2 亿） | 平台 2026Q2 可能调整推荐权重 |

**SO 战略（用优势抓机会）**：与一位 25-30 岁视频剪辑搭档合作，您负责「为什么奶奶看得上」的研究输出，搭档负责把研究变成 10 分钟以内的可视化解读视频，主攻哔哩哔哩。

**WO 战略（补劣势抓机会）**：第一阶段不要自己拍，用图文 + 文字稿的形式发到小红书做内容验证，验证选题后再外包视频制作。

**ST 战略（用优势防威胁）**：把研究方法论沉淀为「可复用的银发国风分析报告」，作为知识付费产品出售，不依赖平台流量也能赚钱。

**WT 战略（防御）**：避免重金投入单一平台，先以哔哩哔哩为根据地，3 个月后再向视频号扩展。

⚠️ **执行风险提醒**：哔哩哔哩 2026Q2 可能调整推荐算法，建议在 4-5 月窗口期密集发布 12 条以上内容沉淀粉丝，6 月后转向私域留存。

---

# 三、产品矩阵设计（高客单价金字塔）

| 层级 | 产品名 | 形态 | 价格 | 毛利率 | 目标用户 |
|---|---|---|---|---|---|
| **塔基（引流品）** | 《银发用户内容偏好白皮书》 | PDF + 数据包 | ¥69 | 95% | 中老年自媒体新手 |
| **塔身（主力品）** | 《银发国风方法论训练营》 | 8 周线上 + 1v1 诊断 | ¥6 980 | 78% | 1-5 万粉腰部博主 |
| **塔尖（高端旗舰）** | 季度银发赛道战略陪跑 | 1v1 + 内容反向定制 | ¥58 000 | 65% | 头部 MCN / 银发品牌 |

📊 定价对标

| 产品 | 您的建议价 | 赛道竞品均价 | 溢价空间 | 推荐定价理由 |
|---|---|---|---|---|
| **白皮书** | ¥69 | ¥29-49 | 40%-138% | 您的同理心稀缺度配得上 |
| **训练营** | ¥6 980 | ¥3 980 | 75% | 1v1 诊断是绝对差异化 |
| **高端陪跑** | ¥58 000 | ¥29 800 | 95% | 银发 + 国风双标签独家 |

---

# 四、商业成长与变现路径（投入产出比最短路径）

| 阶段 | 现状 | 行业头部 | 90 天目标 | 杠杆动作 |
|---|---|---|---|---|
| **获取（曝光 → 关注）** | 1.2% | 8.7% | 3.5% | 标题用「奶奶 + 凡修」组合钩子 |
| **激活（关注 → 互动）** | 18% | 64% | 35% | 评论区主动回复每一条 |
| **留存（互动 → 复看）** | 22% | 71% | 45% | 系列化内容（每周固定主题） |
| **收入（复看 → 付费）** | 0% | 14% | 5% | 引流到私域，转化白皮书 |
| **推荐（付费 → 老带新）** | 0% | 38% | 12% | 私域社群每月一次「研究分享会」 |

| 成长阶段 | 粉丝规模 | 预计周期 | 主要变现方式 | 月收入预估 |
|---|---|---|---|---|
| **冷启动期** | 0 - 1 万 | 第 1-3 月 | 白皮书引流品 | ¥3 000 - 8 000 |
| **成长期** | 1 - 5 万 | 第 4-6 月 | 训练营首期 | ¥4 万 - 12 万 |
| **加速期** | 5 - 20 万 | 第 7-12 月 | 高端 1v1 + 训练营复购 | ¥18 万 - 45 万 |
| **成熟期** | 20+ 万 | 第 12 月后 | 银发品牌商单 + 知识 IP 授权 | ¥80 万+ |

---

# 五、生涯规划（5 年战略弓与箭）

| 时限 | 角色定位 | 关键能力跃迁 | 资产规模 | 风险防御 |
|---|---|---|---|---|
| **1 年** | 银发国风算法侦探 | 系统化的银发用户研究方法论 | 哔哩哔哩 5 万粉 + 私域 1 500 人 | 与 1 位剪辑搭档绑定 |
| **3 年** | 银发内容研究院主理人 | 数据 + 同理心 + 工业化生产 | 自建研究院团队 6 人 + 年营收 ¥600 万 | 注册商标，知识产权护城河 |
| **5 年** | 银发产业生态架构师 | 横跨内容 / 教育 / 适老化产品 | 上市公司战略顾问 / 多品牌矩阵 | 至少 2 个非内容收入主体 |

**3 条弯道超车机会窗口**：

1. **2026Q2-Q3**：哔哩哔哩调整推荐权重前的红利窗口，密集发布 12+ 条内容
2. **2027Q1**：国风 IP《凡人修仙传》第二季播出预期高峰，蹭流量做联名解读
3. **2027Q4**：60 岁人群占网民比例预计突破 21%，会触发一波品牌大金主入场

**3 条必须立刻放弃的旧思维**：

1. **「自己一个人做内容」**——您的天赋不在执行，找搭档是杠杆而非妥协
2. **「先做大粉丝量再变现」**——银发赛道用户终身价值高，2 000 私域足以撑起 ¥10 万月营收
3. **「只盯着哔哩哔哩」**——视频号的 60+ 用户增速已达 118%，要尽快建立第二阵地

⚠️ **执行风险提醒**：5 年规划最大风险是「平台周期切换」——任何一个平台都不会永远红利，每年至少做一次「核心战场迁移评估」，提前 6 个月布局新阵地。

---

# 六、核武级总结

**三大核心洞察**（每条附数据点）：

1. **银发国风是 2026 年最被低估的双标签蓝海**——哔哩哔哩 60+ 用户同比增速 211%，但创作者占比仅 0.7%。
2. **您的核心壁垒是「跨代际同理心」**——评分 9/10 远高于行业头部均值 6.2/10，比执行能力更值钱。
3. **执行短板必须用搭档解决**——单靠自己 1 年最多做到 5 千粉，搭档协同可以做到 5 万粉。

**一句话品牌口号**：用奶奶看得懂的语言，解读 Z 世代抢着追的国风。

**90 天里程碑**：

| 里程碑 | 时间节点 | 量化目标 | 验证方式 |
|---|---|---|---|
| **M1** | 第 30 天 | 哔哩哔哩 5 000 粉，发布 8 条内容 | 后台粉丝数截图 |
| **M2** | 第 60 天 | 私域 500 人，白皮书首发 30 单 | 私域社群截图 + 销售记录 |
| **M3** | 第 90 天 | 哔哩哔哩 2 万粉，月营收 ¥3 万 | 后台收益结算页 |

> 🔒 **试读版到此为止**——完整版还包含：12 个真实银发头部账号拆解、银发用户行为数据库、训练营完整课程大纲、品牌商单谈判模板等共 52 页内容。`;

// ─────────────────────────────────────────────────────────────────────────────
// 此组件不再生成/下载 PDF。
// 历史方案：浏览器 → Fly Singapore → Vercel/Cloud Run（美国 puppeteer）→
//          → 5MB+ PDF 回传 → 国内用户跨境再下，体感 ≥ 30 秒（用户等不动）。
// 新方案：在线阅读 modal（点击卡片打开全屏阅读，水印层覆盖防截图）。
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 封面图：直接使用 client/public 下的静态图片
//
// 历史血泪：原方案每次加载首页都调 Nano Banana Pro 生成（5MB+ data URI 写入
// localStorage 触发 QuotaExceeded 静默失败 → 缓存永远命中不了 → 每个用户每次
// 刷新都烧算力）。封面是固定样本，没必要每次重新生成 —— 直接预生成两张图
// 提交进仓库，永远 0 算力消耗。
// ─────────────────────────────────────────────────────────────────────────────

const BIWEEKLY_COVER_URL = "/sample-covers/biweekly-ai-shortform.png";
const QUARTERLY_COVER_URL = "/sample-covers/quarterly-silver-bili.png";

// ─────────────────────────────────────────────────────────────────────────────
// 在线阅读 modal：全屏覆盖，渲染 markdown，叠加防截图水印层。
// 关键设计：
//   1) 内层是 ReportRenderer 渲染的 markdown
//   2) 外层 absolute fixed 撒大量半透明 logo + 文字水印
//   3) 关闭按钮右上角 / Esc 关闭
//   4) 用户可滚动阅读，但截图必带水印
// ─────────────────────────────────────────────────────────────────────────────

function OnlineSampleReader({
  open,
  onClose,
  markdown,
  cover,
  watermark,
  edition,
  topic,
  tag,
}: {
  open: boolean;
  onClose: () => void;
  markdown: string;
  cover: string;
  watermark: string;
  edition: string;
  topic: string;
  tag: string;
}) {
  // Esc 关闭 + 锁滚
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "rgba(20, 14, 6, 0.78)",
        backdropFilter: "blur(8px)",
        overflowY: "auto",
        padding: "40px 16px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          maxWidth: 920,
          margin: "0 auto",
          background: "#f7ede0",
          borderRadius: 18,
          boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
          overflow: "hidden",
        }}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          aria-label="关闭"
          style={{
            position: "fixed",
            top: 22,
            right: 22,
            zIndex: 9999,
            width: 44,
            height: 44,
            borderRadius: 99,
            border: "none",
            background: "rgba(20,14,6,0.85)",
            color: "#fff7df",
            fontSize: 22,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          ✕
        </button>

        {/* 全文水印层（覆盖整个 modal 内容，对角平铺） */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 50,
            overflow: "hidden",
          }}
        >
          {Array.from({ length: 60 }).map((_, idx) => {
            const row = Math.floor(idx / 4);
            const col = idx % 4;
            const offsetX = row % 2 === 0 ? 0 : 50;
            return (
              <div
                key={`wm-${idx}`}
                style={{
                  position: "absolute",
                  left: `${col * 28 - 5 + (offsetX / 100) * 28}%`,
                  top: `${row * 8 + 3}%`,
                  transform: "rotate(-26deg)",
                  fontFamily: "'Playfair Display', Georgia, 'PingFang SC', serif",
                  fontSize: 16,
                  fontWeight: 800,
                  color: "rgba(74, 54, 33, 0.18)",
                  letterSpacing: "0.20em",
                  whiteSpace: "nowrap",
                  userSelect: "none",
                }}
              >
                {TRIAL_READ_WATERMARK_LINE}
              </div>
            );
          })}
          {Array.from({ length: 12 }).map((_, idx) => {
            const row = Math.floor(idx / 3);
            const col = idx % 3;
            return (
              <img
                key={`wm-logo-${idx}`}
                src={BRAND_LOGO_LIGHT_URI}
                alt=""
                style={{
                  position: "absolute",
                  left: `${col * 38 + 8}%`,
                  top: `${row * 28 + 12}%`,
                  width: "24%",
                  opacity: 0.10,
                  transform: "rotate(-22deg)",
                  pointerEvents: "none",
                  userSelect: "none",
                }}
                draggable={false}
              />
            );
          })}
        </div>

        {/* 真实内容（z-index 高于水印？不——水印 z=50，内容 z=auto；实际希望水印**叠在文字上**才能防截图，
            所以水印必须 z 高于内容。把内容包一层 z=10，水印 z=50 → 水印盖在文字上但 opacity=0.18 仍可读） */}
        <div style={{ position: "relative", zIndex: 10 }}>
          {/* 杂志封面页 */}
      <div
        style={{
          position: "relative",
          height: 1380,
          borderRadius: 18,
          overflow: "hidden",
          border: "1px solid rgba(122,84,16,0.30)",
          background: cover ? `url(${cover}) center / cover no-repeat` : "linear-gradient(160deg,#3d2c14,#1c1407)",
          boxShadow: "0 10px 30px rgba(122,84,16,0.18)",
          marginBottom: 24,
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,rgba(28,20,7,0.12) 0%,rgba(28,20,7,0.55) 60%,rgba(28,20,7,0.85) 100%)" }} />
        <div style={{ position: "absolute", top: 32, left: 32, right: 32, color: "#fff7df", fontFamily: "'PingFang SC',sans-serif", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <img src={BRAND_LOGO_DARK_URI} alt="MVStudioPro" style={{ height: 50, display: "block", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.45))" }} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.20em", fontWeight: 700, opacity: 0.92 }}>{edition}</div>
            <div style={{ fontSize: 10, marginTop: 4, opacity: 0.75, letterSpacing: "0.10em" }}>2026 · APR · 28</div>
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 80, left: 32, right: 32, color: "#fff7df", fontFamily: "'PingFang SC',sans-serif" }}>
          <div
            style={{
              display: "inline-block",
              padding: "5px 12px",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.15em",
              background: "linear-gradient(135deg,#a8761b,#7a5410)",
              borderRadius: 4,
              marginBottom: 18,
            }}
          >
            {tag}
          </div>
          <h1 style={{ fontSize: 44, fontWeight: 900, lineHeight: 1.25, margin: 0, textShadow: "0 4px 18px rgba(0,0,0,0.45)" }}>
            {topic}
          </h1>
          <div style={{ marginTop: 22, fontSize: 14, opacity: 0.85, lineHeight: 1.7 }}>
            五大模块 · 8 张数据表 · 6 套分析框架 · 千人千面定制 · {watermark}
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 24, left: 32, right: 32, display: "flex", justifyContent: "space-between", alignItems: "center", color: "rgba(255,247,223,0.65)", fontSize: 11, fontFamily: "'PingFang SC',sans-serif" }}>
          <span>试读样本 · 完整版需订阅解锁</span>
          <span>mvstudiopro.com · {edition}</span>
        </div>
      </div>

          {/* 报告正文 */}
          <ReportRenderer markdown={markdown} padding="40px 56px" />

          {/* 解锁提示 */}
          <div style={{ marginTop: 24, padding: "20px 28px", borderRadius: 14, background: "linear-gradient(135deg,#a8761b,#7a5410)", color: "#fff7df", textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.05em" }}>🔒 完整版还有 32+ 页深度内容</div>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>包含全部 8 张数据表、12 套钩子模板、私域转化 SOP、品牌商单话术、监管合规清单</div>
          </div>

          {/* 末页签名条（带 logo） */}
          <div style={{ marginTop: 28, paddingTop: 22, borderTop: "1px solid rgba(122,84,16,0.22)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "22px 24px 24px" }}>
            <img src={BRAND_LOGO_LIGHT_URI} alt="MVStudioPro" style={{ height: 44, display: "block" }} />
            <div style={{ textAlign: "right", color: "#7a5410", fontFamily: "'PingFang SC', sans-serif" }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.18em" }}>POWERED BY MVSTUDIOPRO.COM</div>
              <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7 }}>{watermark} · 仅供品鉴 · 转载请标注来源</div>
            </div>
          </div>
        </div>
        {/* /真实内容 */}
      </div>
      {/* /modal panel */}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────────────────────

export default function SampleReportDownload() {
  const [, navigate] = useLocation();
  const [reading, setReading] = useState<"biweekly" | "quarterly" | null>(null);

  return (
    <section
      style={{
        position: "relative",
        maxWidth: 1200,
        margin: "0 auto",
        padding: "56px 24px",
        // 柔和的卡布奇諾光晕（深紫背景下让 section 有自己的视觉容器，但不抢风头）
        backgroundImage:
          "radial-gradient(ellipse 80% 60% at 50% 25%, rgba(216, 162, 58, 0.10) 0%, transparent 70%)",
      }}
    >
      {/* 品牌 Logo 头条（深色背景用 dark 版：深咖啡六边形 + 米白咖啡豆 + 浅金字） */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
        <img
          src={BRAND_LOGO_DARK_URI}
          alt="MVStudioPro · Strategic Intelligence"
          style={{
            height: 54,
            display: "block",
            filter: "drop-shadow(0 6px 18px rgba(216,162,58,0.32))",
          }}
        />
      </div>

      {/* 标题 */}
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div
          style={{
            display: "inline-block",
            fontSize: 11,
            letterSpacing: "0.30em",
            color: "#f0c984",
            background: "rgba(240, 201, 132, 0.08)",
            border: "1px solid rgba(240, 201, 132, 0.40)",
            padding: "5px 18px",
            marginBottom: 18,
            fontWeight: 800,
            borderRadius: 99,
            backdropFilter: "blur(4px)",
          }}
        >
          免费试读 · 卡布奇諾级商务质感
        </div>
        <h2
          style={{
            fontSize: 34,
            fontWeight: 900,
            color: "#fff7df",
            margin: "0 0 12px",
            lineHeight: 1.3,
            textShadow: "0 2px 14px rgba(0, 0, 0, 0.35)",
          }}
        >
          下载样本报告，感受
          <span
            style={{
              color: "#f0c984",
              background: "linear-gradient(180deg, transparent 62%, rgba(216,162,58,0.45) 62%)",
              padding: "0 6px",
            }}
          >
            战略级
          </span>
          内容质感
        </h2>
        <p
          style={{
            fontSize: 15,
            color: "rgba(255, 247, 223, 0.78)",
            maxWidth: 640,
            margin: "0 auto",
            lineHeight: 1.8,
            fontWeight: 500,
          }}
        >
          两份结合当下{" "}
          <strong style={{ color: "#f0c984" }}>数个顶级多模态大模型</strong> 与真实数据生成的战略样本，覆盖个人亮点 / 平台赛道 / 产品矩阵 / 商业变现 / 生涯规划五大模块。
          <br />
          点击「下载试读版」可获得无打印对话框的真实 PDF（由谷歌云渲染服务输出）。
        </p>
      </div>

      {/* 上传/生成入口提示卡 */}
      <div
        onClick={() => navigate("/god-view")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "18px 24px",
          marginBottom: 32,
          borderRadius: 14,
          background: "linear-gradient(135deg,#fffaf0 0%,#f5ecda 100%)",
          border: "1px solid rgba(240, 201, 132, 0.50)",
          boxShadow:
            "0 10px 28px rgba(0, 0, 0, 0.25), 0 0 24px rgba(216, 162, 58, 0.18)",
          cursor: "pointer",
          transition: "all 0.2s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
          (e.currentTarget as HTMLElement).style.boxShadow =
            "0 16px 40px rgba(0, 0, 0, 0.30), 0 0 38px rgba(216, 162, 58, 0.32)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.transform = "none";
          (e.currentTarget as HTMLElement).style.boxShadow =
            "0 10px 28px rgba(0, 0, 0, 0.25), 0 0 24px rgba(216, 162, 58, 0.18)";
        }}
      >
        <div style={{ width: 48, height: 48, borderRadius: 12, background: "linear-gradient(135deg,#a8761b,#7a5410)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 4px 14px rgba(168,118,27,0.32)" }}>
          <Sparkles size={22} color="#fff7df" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: "#3d2c14", marginBottom: 3 }}>
            想为自己的课题生成一份专属半月刊？
          </div>
          <div style={{ fontSize: 13, color: "rgba(61,44,20,0.75)", lineHeight: 1.65 }}>
            前往 <strong style={{ color: "#7a5410" }}>「AI 上帝视角」</strong>页面（god-view），把您的研究主题（不限领域，AI 短剧、银发赛道、电竞、健身、宠物等都行）填进输入框，800 点起即可发起一份覆盖五大模块、字数 5500-7000 字的精简版半月刊；点 5400 即可订阅半年 12 期。
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 10, background: "linear-gradient(135deg,#a8761b,#7a5410)", color: "#fff7df", fontSize: 12, fontWeight: 900, flexShrink: 0 }}>
          填课题生成
          <ArrowRight size={14} />
        </div>
      </div>

      {/* 卡片区 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 28 }}>
        {/* 半月刊 */}
        <SampleCard
          accentColor="#a8761b"
          tag="BIWEEKLY · 战略半月刊"
          edition="第 9 期"
          title="AI 短剧大揭秘"
          subtitle="一秒钟脑补三集，这届年轻人为什么戒不掉？"
          coverUrl={BIWEEKLY_COVER_URL}
          highlights={[
            "5 张数据表（市场规模 / 五平台对比 / 能力雷达 / 产品矩阵 / 30 天行动计划）",
            "6 套分析框架（政经社技 / 五力模型 / 波士顿矩阵 / SO-WO-ST-WT / 蓝海画布 / SMART）",
            "覆盖五大模块（个人亮点 / 平台赛道 / 产品矩阵 / 商业变现 / 生涯规划）",
          ]}
          onOpen={() => setReading("biweekly")}
          buttonLabel="📖 在线阅读全文（带水印）"
        />

        {/* 季度定制 */}
        <SampleCard
          accentColor="#6b4423"
          tag="QUARTERLY · 尊享私人订制"
          edition="季度定制"
          title="88 岁奶奶追凡修"
          subtitle="银发族银幕审美的算法蓝海"
          coverUrl={QUARTERLY_COVER_URL}
          highlights={[
            "8 张数据表（含个人能力雷达、五平台对比、定价对标、五段漏斗）",
            "5 年生涯规划 + 3 条弯道超车窗口 + 3 条必须放弃的旧思维",
            "覆盖五大模块 · 字数 12000+ 字（完整版）",
          ]}
          highlight
          onOpen={() => setReading("quarterly")}
          buttonLabel="📖 在线阅读全文（带水印）"
        />
      </div>

      {/* 底部说明 */}
      <div
        style={{
          textAlign: "center",
          marginTop: 28,
          fontSize: 12,
          color: "rgba(255, 247, 223, 0.55)",
          lineHeight: 1.8,
          fontWeight: 500,
        }}
      >
        样本含水印，仅供品鉴 · 完整版无水印且包含所有数据表 / 框架 / 行动清单 ·
        <strong style={{ color: "rgba(240, 201, 132, 0.80)" }}>
          点击卡片即可在线阅读
        </strong>，不下载 PDF（避免国内跨境带宽体感卡顿）。
      </div>

      {/* 在线阅读 modal —— 半月刊 */}
      <OnlineSampleReader
        open={reading === "biweekly"}
        onClose={() => setReading(null)}
        markdown={BIWEEKLY_MARKDOWN}
        cover={BIWEEKLY_COVER_URL}
        watermark="试读样本"
        edition="第 9 期"
        topic={BIWEEKLY_TOPIC}
        tag="BIWEEKLY · 战略半月刊"
      />
      {/* 在线阅读 modal —— 季度尊享 */}
      <OnlineSampleReader
        open={reading === "quarterly"}
        onClose={() => setReading(null)}
        markdown={QUARTERLY_MARKDOWN}
        cover={QUARTERLY_COVER_URL}
        watermark="试读样本"
        edition="季度定制"
        topic={QUARTERLY_TOPIC}
        tag="QUARTERLY · 尊享私人订制"
      />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 卡片组件
// ─────────────────────────────────────────────────────────────────────────────

function SampleCard({
  accentColor,
  tag,
  edition,
  title,
  subtitle,
  coverUrl,
  highlights,
  highlight,
  onOpen,
  buttonLabel,
}: {
  accentColor: string;
  tag: string;
  edition: string;
  title: string;
  subtitle: string;
  coverUrl: string;
  highlights: string[];
  highlight?: boolean;
  onOpen: () => void;
  buttonLabel: string;
}) {
  return (
    <div
      style={{
        background: "linear-gradient(180deg,#fffaf0 0%,#f5ecda 100%)",
        border: `1px solid ${highlight ? "rgba(240, 201, 132, 0.65)" : "rgba(240, 201, 132, 0.45)"}`,
        borderRadius: 18,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: 0,
        // 双层阴影：底部沉稳 + 外圈金色光晕（让卡片在深紫背景上"浮"起来）
        boxShadow:
          "0 12px 36px rgba(0, 0, 0, 0.30), 0 0 0 1px rgba(240, 201, 132, 0.18), 0 0 32px rgba(216, 162, 58, 0.18)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {highlight && (
        <div style={{ position: "absolute", top: 18, right: 18, zIndex: 5, padding: "4px 12px", borderRadius: 99, background: accentColor, color: "#fff7df", fontSize: 10, fontWeight: 800, letterSpacing: "0.10em" }}>
          专属定制
        </div>
      )}

      {/* 封面图区域 3:4 */}
      <div style={{ position: "relative", width: "100%", paddingTop: "120%", background: "linear-gradient(160deg,#3d2c14,#1c1407)", overflow: "hidden" }}>
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={title}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,247,223,0.75)" }}>
            <Crown size={42} />
          </div>
        )}

        <TrialReadWatermarkOverlay zIndex={3} />

        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "20px 22px 18px", background: "linear-gradient(to top, rgba(28,20,7,0.92) 0%, transparent 100%)", zIndex: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.20em", color: "rgba(255,247,223,0.85)", marginBottom: 4 }}>{tag} · {edition}</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#fff7df", lineHeight: 1.25 }}>{title}</div>
          <div style={{ fontSize: 12, color: "rgba(255,247,223,0.78)", marginTop: 4, fontWeight: 500 }}>{subtitle}</div>
        </div>
      </div>

      {/* 信息区 */}
      <div style={{ padding: "20px 24px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {highlights.map((h, i) => (
            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "rgba(61,44,20,0.85)", lineHeight: 1.65, fontWeight: 500 }}>
              <span style={{ flex: "0 0 auto", marginTop: 6, width: 6, height: 6, borderRadius: 99, background: accentColor }} />
              <span>{h}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={onOpen}
          style={{
            marginTop: 6,
            padding: "13px 0",
            background: `linear-gradient(135deg,${accentColor},#7a5410)`,
            border: "none",
            borderRadius: 10,
            color: "#fff7df",
            fontWeight: 900,
            fontSize: 14,
            cursor: "pointer",
            letterSpacing: "0.04em",
            boxShadow: "0 6px 20px rgba(168,118,27,0.30)",
            transition: "all 0.2s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "none"; }}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

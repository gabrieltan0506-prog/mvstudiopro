/**
 * 黑金 PDF 流水线烟雾测试（需本地/容器具备 Chromium + GOOGLE_APPLICATION_CREDENTIALS_JSON）
 * 运行：pnpm pdf:smoke
 */
import { config } from "dotenv";
import { createAndUploadPdf } from "../server/services/pdfGenerator";

config({ path: ".env.local" });

const SAMPLE = `# 东南亚跨境电商 — 抗衰老与心血管保健品战略深潜（黑金 PDF 模板烟雾测试）

> 任务背景：分析 2026 年中国、印尼、印度、马来西亚、泰国市场对「抗衰老 / 心血管保健品」的接受度、竞品定价策略与当地法规壁垒。

## 一、核心结论摘要

| 维度 | 共识判断 | 关键依据类型 |
|------|----------|----------------|
| 市场接受度 | 分化明显，urban/educated cohort 更愿意尝试 | 渠道访谈 + 公开销量结构 |
| 定价策略 | 锚定国际牌 + 本土贴牌双轨 | 头部 SKU 价格带扫描 |
| 法规壁垒 | 各国注册与宣称红线差异最大 | 监管通告 / 注册周期 |

## 二、五国对比（示意表）

| 国家 | 接受度（定性） | 典型价格带（USD） | 法规壁垒（简评） |
|------|----------------|-------------------|------------------|
| 中国 | 高 | 45–120 | 保健食品注册与广告合规 |
| 印尼 | 中高 | 30–80 | BPOM 周期长、标签本地化 |
| 印度 | 分化 | 25–70 | FSSAI + 进口与关税结构 |
| 马来西亚 | 高 | 40–100 | NPRA 与清真可选溢价 |
| 泰国 | 中高 | 35–90 | FDA 分类与宣称限制 |

## 三、战略警示

本稿为 **模板与渲染链路验证**，数据为占位示意，正式报告须由 Deep Research Max 全量检索后替换为可溯源事实。

> **机密** — MV STUDIO PRO 战略情报局 · 禁止外泄
`;

async function main() {
  const id = `smoke-${Date.now()}`;
  const out = await createAndUploadPdf(id, SAMPLE, { signedUrlHours: 72 });
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

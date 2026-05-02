GodView「战略扉页画廊」— 完整源码一次落盘（归档目录）

本目录内容（与线上可运行代码一致，仅作审阅 / 备份 / 搬迁用）：

1. GodViewPage.tsx
   - 来自 client/src/pages/GodViewPage.tsx 的完整 2030 行副本。
   - 功能点：扉页 state、jobDoneQuery.enabled（dispatched|done）、generateChapterPostersMutation、
     strategicChapters useMemo、phase===done 画廊 + ReportRenderer。

2. routers-godview-trpc-FULL-FRAGMENTS.ts
   - server/routers.ts 内两段完整的 tRPC 实现文本：
     mvAnalysis.generateGodViewChapterPosters
     deepResearch.status 的 return 块（含 strategicImagesTrialWatermark）。
   - 非可单文件编译模块；请勿直接 import。

3. upgradecritical.md
   - 与仓库根目录 upgradecritical.md 同步 copy，说明验收与契约。

说明：未执行 tsc / 未触发生图；仅文件落盘。

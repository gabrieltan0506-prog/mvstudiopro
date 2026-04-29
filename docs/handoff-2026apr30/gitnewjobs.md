# Git New Jobs — 已部署到生产的 PR 时间线

**用途**: 让新 agent 一眼看到线上有什么。每次部署后追加一行。
**生产域名**: https://mvstudiopro.fly.dev
**部署平台**: Fly.io 单 machine `mvstudiopro` SIN region

---

## 部署时间线（最新在最上）

### 🟢 2026-04-29 23:30 UTC（= 04-30 07:30 GMT+8）— PR #332 上线

- **deployment**: `01KQDS3K1YN0W9GGC38513CSNR`
- **image**: `sha256:4e51e340a651d3d55e37d8239be2c19401fbf6714752081d257d4f89665a3e18`
- **main HEAD**: `7059e62 docs: 响应式 + PWA + 企业智能体三件交接（共 5 份文档）(#333)`
- **包含 PR**: #332（场景图嵌正文 + HTML 交互导出 + PDF 图表 SSR）+ #333（5 份 docs，无运行时影响）
- **关键新功能**:
  - 场景图必嵌正文章节内（4 级 fallback：精确 regex → LCS 模糊匹配 → 平均分配 → 兜底插第 1 章节），**「附录：可视化场景图集」陷阱彻底删除**
  - 新 tRPC mutation `creations.exportInteractiveHtml`（≤ 10 MB → data URL 直下载，> 10 MB → jszip 自动压 zip），MyReports 卡片 + 阅读模式两处都加了「🌐 下载 HTML（交互版）」按钮（蓝紫渐变）
  - 服务端 ECharts SSR 渲染静态 SVG 注入 PDF（`echartsServerRender.ts`），不依赖 puppeteer 客户端运行时，PDF 图表不再空白
  - HTML 交互版用 `<div class="echart-mount" data-chart-option="...">` 占位 + 内联 echarts.min.js 客户端 setOption（可 hover / 切 legend / 缩放）
  - 三处出图（在线 ReportRenderer / PDF SSR / HTML 客户端）共用 `deriveChartSpecFromTable` 逻辑
  - 5 套 PDF 主题色对齐 ECharts palette（`spring-mint` / `neon-tech` / `sunset-coral` / `ocean-fresh` / `business-bright`）
- **新依赖**: `echarts@^5` + `jszip@^3.10.1`
- **健康验证**:
  - 23:30:30 `Server running on http://localhost:3000/`
  - 23:30:30 `[paidJobLedger] startup reap: 扫描 0，无需退积分（系统正常）`
  - 23:30:31 health check passing
  - HTTP 200 / 0.75s 响应

### 🟢 2026-04-29 22:19 UTC — PR #331 上线

- **image**: `sha256:4cb73f758cc0d48d3a9605c752cac3b329cc86e3408d6757f75fb656fabfc7d3`
- **main HEAD**: `778ff9c fix(pdf): 修复封面后 2 页空白 (#331)`
- **关键修复**:
  - 删除 cover-section 后的多余 `<div class="page-break"></div>`（cover-page 自带 page-break-after，重复导致多 1 页空白）
  - `min-height: 1062px` → `height: 980px` + `max-height: 980px`（精确锁定 cover 单页，不再溢出到第 2 页）
  - 解决 PDF 导出后封面页和正文之间多出 2 页空白的问题

### 🟢 2026-04-29 22:13 UTC — PR #329 + #330 联合上线（首次真上线）

- **image**: `sha256:43225b4046560f8ebfdbc444872a7e8e921bcff93a245992876fcefbaf349755`
- **main HEAD**: `c2f34ff feat: 维护模式闸门 + 主动取消不退积分（防恶意刷算力）(#329)`
- **包含 PR**: #329 + #330（stacked PR，#330 base 是 #329 头分支，#329 合 main 时一并带上 #330 内容）
- **关键新功能**:
  - **双轨制图引擎**: 场景图 / 封面优先 Gemini API key 直连 + GCS 上传拿 https URL；失败 fallback Vercel `/api/google?op=nanoImage`（Vertex 路径）
  - **PDF 模板搬家**: 模板选择器从 GodView 搬到 MyReports（战略作品快照库），下载 PDF 即套用 5 套主题色之一
  - **ReportRenderer pdfStyle 跟随**: 在线阅读不再硬编码焦糖色，跟选择的 pdfStyle 主题保持一致
  - **任务跨页持久化**: 跑任务时跳走再回来仍能看进度（基于 `deepResearch.activeJobs` query）
  - **维护模式闸门**: supervisor 后台一键挡新付费任务（`assertMaintenanceOff()` 散落到所有 launch mutation）
  - **取消不退积分**: 用户主动取消明确「不退还积分」，防恶意烧算力（`PaidJobRefundReason: user_cancelled_no_refund`）
  - **`<figure>` raw HTML 透传修复**: `marked` 改成 `breaks: false, gfm: true` 配置，场景图 `<figure>` 标签不再被字面渲染
  - **失败任务删除按钮**: MyReports 上为 status=failed 的卡片提供软删除入口（`creations.softDelete`）

### 🟢 2026-04-29 19:51 UTC — PR #328 上线

- **image**: `sha256:2bdfd31a59b208c12a774581386098c79a91f2d1121f456b2e89da39845077a3`
- **main HEAD**: `878f120 feat: 取消任务按钮 + 兜底退积分账本 + 封面 fallback + scenes 配图修复 (#328)`
- **关键新功能**:
  - **付费任务账本** (`paidJobLedger.ts`): 持久化跟踪所有运行中的付费任务，支持注册 / 注销 / 心跳 / 幂等退款；fly machine SIGTERM 时 + 启动时都做兜底扫描退积分（`reapStuckPaidJobs`）
  - **取消任务按钮**: GodView + MyReports 都有「✕ 取消任务」（PR #329 后改为「✕ 取消任务（不退还积分）」）
  - **scenes 自动配图**: Deep Research 报告自动按章节注入 ≥ 3 张场景图（`generateSceneIllustrations` + `nano banana 2`）
  - **封面 fallback**: 主路径 `nanoImage` 失败时尝试不同 aspectRatio（"3:4" / "9:16" / "16:9" / "1:1"）

---

## 之前 PR 历史（已部署）

只列重大里程碑，详细见 `git log --oneline origin/main`。

| PR | 主题 | 部署时间 |
|----|------|---------|
| #327 | fix(myreports): 下线不读 pdfStyle 的「下载富图文 PDF」按钮（焦糖色 bug 根因） | 2026-04-29 13:36 |
| #326 | feat: 封面选择改大 Banner + 企业旗舰款 Hero 大卡 | 2026-04-29 11:42 |
| #325 | fix(godview): 删伪 16 步时间轴改用后端真信号 + idle 阶段封面预选入口 | 2026-04-29 11:32 |
| #324 | feat(v3): 4 平台爆款重做 + 报告自动配图 + 抽帧/BGM 改造 + 模板 modal + IP 基因弹窗修复 | 2026-04-29 10:51 |
| #323 | Feat/saas v3 ip gene pkgs | 2026-04-29 |
| #322 | feat(saas-v3): IP 基因弹窗 + Debug 终端 + 产品包 + 防孤儿任务 + GCS 修复 | 2026-04-29 |

---

## 当前 main HEAD（线上已跑）

```
7059e62  docs: 响应式 + PWA + 企业智能体三件交接（共 5 份文档）(#333)  ← docs，运行时无影响
fc574f0  feat: 场景图嵌正文 + HTML 交互导出 + PDF 图表 SSR (#332)
778ff9c  fix(pdf): 修复封面后 2 页空白 (#331)
c2f34ff  feat: 维护模式 + 取消不退积分 (#329) + 模板搬家 + 双轨制图 (#330)
878f120  feat: 取消任务按钮 + 兜底退积分账本 + scenes 配图 (#328)
```

---

## 下一波待启动的工作（new agents）

按 `docs/handoff-2026apr30/` 各 handoff 文档分配：

- **响应式 + PWA 改造**（`jobs.md` 4 阶段）— 5-8 天 / 4 PR — 等新 agent 接手
- **企业专属智能体 AaaS**（`agent-dev.md` 6 PR）— 4-6 天 / 6 PR — 等新 agent 接手

部署节奏建议：每个 agent 各完成 1-2 个 PR 后**统一一次部署**，避免短时间内多次 SIGTERM 重启 fly machine。

---

## 部署速查卡

```bash
# 部署生产
cd /Users/tangenjie/.codex/worktrees/974b/mvstudiopro
flyctl deploy --app mvstudiopro --remote-only

# 看部署历史
flyctl status --app mvstudiopro
flyctl releases --app mvstudiopro

# 实时日志
flyctl logs --app mvstudiopro

# 健康巡检
curl -sI https://mvstudiopro.fly.dev/
```

每次部署完成验证三要素：

1. fly logs 出现 `Server running on http://localhost:3000/`
2. fly logs 出现 `[paidJobLedger] startup reap: 扫描 X，...`（X = 0 时正常；> 0 是兜底退积分，要去 audit log 看为何）
3. `Health check ... is now passing`
4. `curl -I https://mvstudiopro.fly.dev/` HTTP 200

四个都满足才算部署成功。

---

## 维护备注

- **fly UI 看到 deployment 显示 "cancelled"** 不一定是真失败。fly rolling deployment 会先 build 中间 layer image，再用 final manifest image 替换，UI 上中间那条经常显示 cancelled。看 **`flyctl status` 显示的当前 Image** 才是真实正在跑的版本。
- **每次部署 image SHA 必须不同于上次**，否则等于啥都没部署（只是重启了 machine）。
- **部署窗口**: 用户跑付费任务时禁止部署（SIGTERM 中断会触发兜底退积分），影响用户体验。

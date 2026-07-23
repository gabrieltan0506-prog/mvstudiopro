---
name: manhua-viral-hits
description: 爆款漫剧情报分析与节奏模板持续学习：链接拆解、提案卡、批准进审定库、注入 /canvas 编剧室
---

# 漫剧爆款情报 + 节奏模板学习 Skill

## 触发

用户给出：**漫剧/短剧链接**、平台榜单、或说「分析为什么火 / 爆款逻辑 / 对标某部漫剧 / 学这部 / 批准进库」。

| 资料 | 路径 |
|------|------|
| 历史情报笔记 | `docs/2026Jul17/manhua-viral-hits-2026h1.md` |
| 提案实验室 | `docs/manhua-template-lab/` |
| 出厂种子库 | `shared/manhuaViralTemplateBank.ts`（默认 3 张） |
| 动态审定库（产品） | GCS `manhua-template-learn/approved/*.json` ∪ 种子库 |
| 云端提案 | GCS `manhua-template-learn/proposals/*.json` |
| 定时扫描（报道 URL） | `pnpm run manhua:template-scan` |
| 本机学习（回退） | `pnpm run manhua:template-learn` |
| 抽帧规划（纯函数） | `shared/manhuaTemplateLearnFramePlan.ts` |

## 真源分层（必守）

1. **提案层**（可自动写）：GCS `proposals/` 或 lab `docs/.../proposals/`，`status: "proposed"`
2. **审定层**（才能进产品）：GCS `approved/`（人审批准）；种子库仅作出厂默认。**同 id 以 GCS 为准**
3. **禁止**：未获用户明文「批准进库」时把提案当产品可选；**不要**再改 TypeScript 数组硬编码进库

定时扫描脚本**只写提案**，永不自动 approved。

## 爆款底层三逻辑（写作与选题时对照）

1. **产能与试错**：低成本高频出片，同一爽点模板可快速变体；工厂侧用编剧室 → 六段链路批量铺板。
2. **IP / 类型势能**：成熟题材标签降低冷启动；选题优先「类型可识别 + 标题钩子一眼懂」。
3. **前 3 秒情绪**：开篇必须视觉钩子 + 冲突句；之后密铺可视觉化反转/升级。

## 国内 vs 出海（选题时先定市场）

来源摘要：钛媒体 [AI漫剧2026](https://www.tmtpost.com/7890548.html) + DataEye 抖音/红果百强（见 docs）。

| 维度 | 中国制作（抖音/红果） | 出海（DramaBox / ReelShort / DramaWave 等） |
|------|----------------------|-----------------------------------------------|
| 平台口味 | **抖音**：仿真人占比高；**红果**：3D 漫 + 架空玄幻季播更强 | 中企短剧 App；漫剧更好跨文化 |
| 题材重心 | 逆袭：种田/边关古言、仙侠脑洞、系统流、赘婿/打脸 | 狼人/吸血鬼/系统觉醒；忌硬搬国漫 IP |
| 策略 | 先定抖音或红果再选题 | 同一爽点骨架，换文化皮与人设 |

## 链接分析清单（按序写短结论）

对每条用户链接，输出：

1. **钩子**：标题/封面/前 3 秒在卖什么情绪  
2. **题材标签**：3–6 个中文关键词（可供工厂 topic）  
3. **爽点密度**：每 15–30s 是否有可视觉化的反转/升级  
4. **人设**：欲望与压迫来源（一句话）  
5. **场景建议**：边塞/宗门/校园/末日等可命中词  
6. **手法建议**：灯光/运镜/情绪原子（不对齐导演名）  
7. **合规注意（国内）**：备案、AI 标识、版权、低俗擦边  
8. **可复制点 / 不可抄点**：只借结构与节奏，不成稿抄台词/画面/商标  

## 强制产出：TemplateCard 提案

分析完链接或「学这部」后，**必须**再写一张提案卡：

1. 落盘：`docs/manhua-template-lab/proposals/<id>.json`
2. `id`：`tpl_` + 英文蛇形短词（稳定、可复现）
3. `nameZh` / `laneZh` / `hook3sZh` / `beatGrid`（约 180s，每 10–15s 一条）/ `scenePoolHints` / `castShape` / `densityHints` / `sourceRefs`
4. `status` 固定为 `"proposed"`
5. `laneZh` 必须是审定库允许的赛道之一：`爽文逆袭` | `古言种田` | `系统觉醒` | `甜宠` | `悬疑权谋` | `搞笑沙雕` | `游戏竞技`
6. 在 `docs/manhua-template-lab/CHANGELOG.md` 追加一行（日期 | proposed | id | 备注）
7. 字段形状以 `shared/manhuaViralTemplateBank.ts` 的 `ManhuaViralTemplateCard` 为准；可用 `parseManhuaViralTemplateCard` 自检

**成稿字段禁止**：外部剧名、可识别台词、商标、供应商/模型名。出处只放 `sourceRefs`（内部）。

## 批准进库（仅用户明文）

用户说「批准进库」并点名 `id`（或 Platform 点「批准进库」）时：

1. 读 GCS/`proposals/<id>.json`（或 job 返回的完整 card）
2. `parseManhuaViralTemplateCard` 校验
3. 调用 `manhuaViralTemplate.approve`（或 Cursor 代调同一服务）→ 写 GCS `approved/<id>.json`，`status: "approved"`
4. **不要**改 `MANHUA_VIRAL_TEMPLATE_BANK` 源码；编剧室运行时拉合并列表
5. CHANGELOG 可记一行 `approved`（可选）

## 产出格式（贴回用户）

```text
【为何爆】一句话
【题材关键词】a / b / c
【建议场景】关键词
【建议手法】中性手法词
【节奏模板提案】tpl_xxx → docs/manhua-template-lab/proposals/tpl_xxx.json（待批准）
【工厂用法】批准后：编剧室选「节奏模板」→ 扩写注入节拍格；或先把关键词填进题材
【风险】合规或同质化一句
```

## 映射到本仓库工厂

| 外部步骤 | 本仓库 |
|----------|--------|
| 剧本 + 分镜 | `/canvas` 编剧室 → 六段链路 |
| 节奏模板 | `listApprovedManhuaViralTemplates` → 扩写 `viralTemplateId` |
| 静帧 / 成片 | key_art / Seedance（探针规则见仓库 seedance-probe） |
| 题材→场景/手法 | `manhuaSceneAssetLibrary` / `craftShotBank` |

## 定时学习（报道）

- 配置：`docs/manhua-template-lab/sources.json`
- 本地/CI：`pnpm run manhua:template-scan`
- 只追加/更新 `proposals/`，**不**改审定库

## 榜单 / 贴链接学习（多集 · 先看再进库）

**产品真源在代码**（不要只改本 skill）：

| 职责 | 路径 |
|------|------|
| 流水线阶段 / 文案 / 本机回退步骤 | `shared/manhuaTemplateLearnPipeline.ts` |
| 采样批大小 / ≥16 分析门槛 | `shared/manhuaTemplateLearnSeries.ts` |
| 云端执行 | `server/services/manhuaTemplateLearnService.ts` + Job `manhua_template_learn` |
| 进度写回 job.output | `server/jobs/runner.ts`（`learnProgressLog` / `analysisStageLabel`） |
| Platform 面板（开始→阶段→结束） | `client/src/lib/manhuaLearnResultUi.ts` + `PlatformPage` AI 漫剧区 |
| 本机 CLI | `pnpm run manhua:template-learn`（`scripts/manhua-template-learn.ts`） |

数据源：Platform「AI 漫剧」飙升榜（`aiManhuaRising`）或「贴链接学节奏」。

1. **入口**：榜单单行「学节奏」**或**粘贴合集/单集链接 → 云端 Job `manhua_template_learn`
2. **采样**：按剧集顺序每轮采（短链有几集采几集；长合集约 **8–10**）；单集学完**立刻删视频**，只留 digest（GCS `series/<key>/episodes/`）
3. **分析门槛**：同一系列累计 **≥16** 集才出总分析提案（目标约 **20**）；不足也可先看分集结果
4. **网页即时可见**：一点学节奏即展开面板；轮询刷阶段日志；结束展示分集摘要 / 总分析；**看完再决定**是否「批准进库」
5. **回退**：云端失败时面板切「本机学习」步骤并复制命令：  
   `pnpm run manhua:template-learn -- --rising-json <文件> --rank N`
6. **抽帧密度**：前 5s 钩子；约每 10s；高潮窗约每 3s（`manhuaTemplateLearnFramePlan`）
7. 用户明文「批准进库」→ GCS `approved/` → 编剧室合并列表可选

依赖（云端）：Fly 镜像已装 yt-dlp/ffmpeg。本机回退需本机同款工具。搜索页 URL 优先改合集/成片页。

## 硬规则

1. 前台成稿禁止写竞品名、供应商名、模型名、「仿写某某」。  
2. 未核实播放量不要当事实写进产品文案。  
3. 案例分析可追加历史笔记；**新模板骨架进 lab 提案，不再只堆散文名单**。  
4. 不要把外部模拟 TypeScript 流水线拷进 `scripts/` 当可执行产品代码。  
5. 密度门禁仍由 `evaluateWriterPackAssetAndDensity` 把关；模板不能绕过。  
6. 模板的 `scenePoolHints` 不覆盖用户人物/场景表真源（`assetCanon`）。

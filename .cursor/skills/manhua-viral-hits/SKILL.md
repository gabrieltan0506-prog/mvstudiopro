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
| 审定库（产品） | `shared/manhuaViralTemplateBank.ts` |
| 定时扫描（报道 URL） | `pnpm run manhua:template-scan` |
| 榜单/成片学习（B+2） | `pnpm run manhua:template-learn` |
| 抽帧规划（纯函数） | `shared/manhuaTemplateLearnFramePlan.ts` |

## 真源分层（必守）

1. **提案层**（可自动写）：`docs/manhua-template-lab/proposals/<id>.json`，`status: "proposed"`
2. **审定层**（才能进产品）：写入 `MANHUA_VIRAL_TEMPLATE_BANK` 且 `status: "approved"`
3. **禁止**：未获用户明文「批准进库」时，直接改审定库或把提案当成产品可选模板

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

用户说「批准进库」并点名 `id`（或「批准刚才那张」）时：

1. 读对应 `proposals/<id>.json`
2. 用 `parseManhuaViralTemplateCard` 校验
3. 并入 `shared/manhuaViralTemplateBank.ts` 的 `MANHUA_VIRAL_TEMPLATE_BANK`，设 `status: "approved"` 与 `approvedAt`
4. CHANGELOG 记 `approved`
5. 提案文件可保留或标 `rejected`/`approved` 备注；**产品列表只读 bank 里 approved**

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

## 榜单点选学习（B+2 · 抖音优先）

数据源：Platform「AI 漫剧」飙升榜（`aiManhuaRising`，与报表同源）。

1. 用户在 Platform 点「导出学习 JSON」或单行「学节奏」（复制命令）
2. 本机执行：
   - `pnpm run manhua:template-learn -- --rising-json <导出文件> --rank N`
   - 或 `--url <成片页>` / `--title <剧名>` / `--video <本地mp4>`
3. 流水线：yt-dlp 下片 → 语音预扫 → 自适应抽帧 → **Terra 读帧自动填提案**（仍 `proposed`）
4. **抽帧密度**：
   - 前 5 秒钩子帧（1 / 2.5 / 5s）
   - 之后约每 **10** 秒一帧
   - 语音命中高潮词（打脸/反转/绝杀…）或有声加长段 → 该窗内改为约每 **3** 秒一帧
5. 帧与转写落在 `downloads/manhua-template-learn/`（gitignore）；提案进 `proposals/`
6. **读帧（自动）**：Fly `manhuaTemplateFrameScan` · **gpt-5.6-terra** · reasoning=**high** → 填 `nameZh` / `hook3sZh` / `beatGrid` 等（中性结构，禁止外部剧名）
7. 用户明文「批准进库」→ 写入 `MANHUA_VIRAL_TEMPLATE_BANK` → 编剧室可选（落点 2）

依赖：本机 `yt-dlp`、`ffmpeg`/`ffprobe`。

**语音预扫（方案 A，默认）**：
1. `POST /api/google?op=manhuaAudioGetUploadUrl`（Fly）→ GCS 签名 PUT  
2. 本机 PUT mp3 到 GCS  
3. `POST /api/google?op=manhuaAudioClimaxScan` + `{ gcsUri }` → Fly 代下 → **gemini-3.5-flash**  
4. 环境：`MANHUA_LEARN_FLY_ORIGIN`（默认 `https://mvstudiopro.fly.dev`）；`MANHUA_LEARN_VIA_FLY=0` 关闭；`MANHUA_LEARN_LOCAL_GEMINI=1` 才本机直打  

**读帧（默认 · 更强视觉档）**：
1. `POST /api/google?op=manhuaTemplateFrameGetUploadUrl` → 本机 PUT 各 JPG  
2. `POST /api/google?op=manhuaTemplateFrameScan` + `{ frames:[{gcsUri,atSec}] }` → **gpt-5.6-terra / high**  
3. 自动写提案字段，**不**改 `approved`；`MANHUA_LEARN_LOCAL_TERRA=1` 可本机直打  

探针：`curl -sS 'https://mvstudiopro.fly.dev/api/google?op=gemini35FlashPing' -X POST -H 'content-type: application/json' -d '{}'`

搜索页 URL 可能无法直接下片：优先用合集/成片页链接。

## 硬规则

1. 前台成稿禁止写竞品名、供应商名、模型名、「仿写某某」。  
2. 未核实播放量不要当事实写进产品文案。  
3. 案例分析可追加历史笔记；**新模板骨架进 lab 提案，不再只堆散文名单**。  
4. 不要把外部模拟 TypeScript 流水线拷进 `scripts/` 当可执行产品代码。  
5. 密度门禁仍由 `evaluateWriterPackAssetAndDensity` 把关；模板不能绕过。  
6. 模板的 `scenePoolHints` 不覆盖用户人物/场景表真源（`assetCanon`）。

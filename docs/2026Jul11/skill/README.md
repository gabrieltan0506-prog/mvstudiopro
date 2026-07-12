# Platform 可挂载 Skill 目录

本目录存放 `/platform` 内置 Skill 的 Markdown 源文件。更新 Skill 内容时只改这里的 `.md`，勿与同级其他文档混放。

| 文件 | id | 默认 |
|------|-----|------|
| `director-craft.md` | director-craft | 开 |
| `cultural-diversity.md` | cultural-diversity | 开 |
| `lifestyle-diversity.md` | lifestyle-diversity | 开 |
| `hook-solution-cta.md` | hook-solution-cta | 开 |
| `platform-native.md` | platform-native | 开 |
| `review-safe-voice.md` | review-safe-voice | 开 |
| `cover-stop-scroll.md` | cover-stop-scroll | 开 |
| `blue-ocean-natural.md` | blue-ocean-natural | 开 |
| `batch-arc-engagement.md` | batch-arc-engagement | 开 |
| `graphic-note-rhythm.md` | graphic-note-rhythm | 开 |
| `contrast-reversal-climax.md` | contrast-reversal-climax | 开 |
| `crossover-popsci.md` | crossover-popsci | 开 |
| `vivid-anti-boring.md` | vivid-anti-boring | 开 |
| `4season-fmcg-popsci.md` | 4season-fmcg-popsci | 开 |
| `label-debunk-copy.md` | label-debunk-copy | 开 |
| `authority-cite-endorsement.md` | authority-cite-endorsement | 开 |
| `fmcg-popsci-monetize.md` | fmcg-popsci-monetize | 开 |
| `forensic-life-lens.md` | forensic-life-lens | 开 |

**非 md 开关（UI）**：「接受博主/创作者自称」默认关，勾选才放开空壳自称。

用户上传的 Skill 存账号侧（GCS），不写入本目录。生成时由前端勾选 → 后端拼进 Stage2 / 自定义选题 / 分镜图文 Prompt。

### 2026-07-12 畅销品轻科普（改版）
- **`4season-fmcg-popsci`**：四季当季畅销品**叙事弧+运镜**合一（取代 summer-fmcg + food-popsci-lens）
- **`label-debunk-copy`**：何时用/怎么用；**配料看不出**时的替代证据路径
- **`authority-cite-endorsement`**：权威背书白名单（食品 + 睡眠/运动/心理/宣称/儿童视屏等）
- **`fmcg-popsci-monetize`**：打脸科普 → 清单线索 → 顾问/课/沙龙；禁低价带货主变现

### 2026-07-12h（法医视角）
- **`forensic-life-lens`**：死因侧逻辑 → 还怎么活；10 条放松向菜单；禁血腥猎奇与命案复盘

### Skill 自动路由总管（勾选 ≠ 全灌）
生成时**默认 `auto`**：UI 勾选只表示**允许池**；[`shared/platformSkillRouter.ts`](../../shared/platformSkillRouter.ts) 按选题上下文从池中挑子集再注入。

| 组 | id |
|----|-----|
| 核心（池内必选） | hook-solution-cta · review-safe-voice · vivid-anti-boring · cover-stop-scroll · platform-native · cultural-diversity · lifestyle-diversity |
| 赛道 fmcg | 4season + label-debunk + authority + monetize |
| 赛道 forensic | forensic-life-lens + authority |
| 赛道 crossover / contrast | 对应单 Skill |
| 体裁 | graphic → graphic-note-rhythm；video → director-craft |

出图另走短约束，并**强制封面少字硬限**（coverHeadline 8–14 字、≤2 行），减轻 fallback 模型啰嗦。服务端可用 `skillRouteMode: "all"` 恢复全量（暂无 UI 开关）。

### 2026-07-12i（六维不同风格）
Stage2 六条 blueprint **并行各调一次 LLM**；`auto` 模式下由 `planDiverseBlueprintSkillRoutes` **预分配互斥 specialty 赛道**（fmcg / forensic / crossover / contrast），再按维注入对应 Skill 全文。同批 specialty 不重复；赛道不足时其余维走 `default`（核心 + batch-arc）。六维 reasoning 默认 **high**。diagnostics 可见 `skillRouteLanes`。

### 2026-07-12e（b2.pdf 反面：禁读论文式选题）
- 强化 `cultural-diversity` / `lifestyle-diversity` / `vivid-anti-boring`：人设里的唐诗/爵士是**可用容器不是必交作业**；同批典籍主容器 ≤2；禁「读《》领悟 / 哈佛实验室揭秘」；决策智库 Call B 同步生活化配额。

### 2026-07-12g（人物轮换 + MAB 探索可生成）
- `cultural-diversity`：**同人默认 1 条**；禁默认苏轼；三苏/唐宋八大家轮换；已写过勿再写（时事/季节除外）
- 战略升级：「利用」对照不可扩写；「探索」可生成完整文案

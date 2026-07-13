# Platform 可挂载 Skill 目录

本目录存放 `/platform` 内置 Skill 的 Markdown 源文件。更新 Skill 内容时只改这里的 `.md`，勿与同级其他文档混放。

| 文件 | id | 默认 |
|------|-----|------|
| `director-craft.md` | director-craft | 开 |
| `cultural-diversity.md` | cultural-diversity | 开 |
| `lifestyle-diversity.md` | lifestyle-diversity | 开 |
| `hook-solution-cta.md` | hook-solution-cta | 开 |
| `platform-native.md` | platform-native | 开 |
| `review-safe-voice.md` | review-safe-voice（**强监管优化表达**） | 开 |
| `cover-stop-scroll.md` | cover-stop-scroll | 开 |
| `blue-ocean-natural.md` | blue-ocean-natural | 开 |
| `batch-arc-engagement.md` | batch-arc-engagement | 开 |
| `graphic-note-rhythm.md` | graphic-note-rhythm | 开 |
| `xhs-collectible-note.md` | xhs-collectible-note | 开 |
| `contrast-reversal-climax.md` | contrast-reversal-climax | 开 |
| `crossover-popsci.md` | crossover-popsci | 开 |
| `vivid-anti-boring.md` | vivid-anti-boring | 开 |
| `4season-fmcg-popsci.md` | 4season-fmcg-popsci（痛点槽点科普） | 开 |
| `label-debunk-copy.md` | label-debunk-copy | 开 |
| `authority-cite-endorsement.md` | authority-cite-endorsement | 开 |
| `fmcg-popsci-monetize.md` | fmcg-popsci-monetize | 开 |
| `forensic-life-lens.md` | forensic-life-lens | 开 |

**非 md 开关（UI）**：「接受博主/创作者自称」默认关。

### 2026-07-13（选题初选 + 可发图文）
- **流程**：选题生成**默认 6 条**（每条 `skillsUsed` + `conveyGoal`）→ 勾选后扩写正式文案 + `graphicNotePages`。超出 6 条按条另计费（最多 20）。积分：基础 12 + 加量 2/条；扩写 48。
- **图文对标**：生活场馆/季节活动向（如图书馆暑期市集）——地点｜活动、可存清单、真实画面。
- **高赞样本**：`m1.mp4` 图文合集；`m2.mp4` 短视频（≤2分半硬上限）；**`x1/x2/x3` 清单蓝海**（親子旅遊清單搜索 + 出行妙招 + 带娃12神器，藏≥赞）。抽帧见 `~/Downloads/2026Jul13/`。
- **`cover-stop-scroll` / `xhs-collectible-note` / `blue-ocean-natural`**：补清单封面杀伤词、flat lay 证据、结果钉（详 `docs/2026Jul13/x1-x2-x3-highlights.md`）。
- **`xhs-collectible-note`**：高收藏页角色（建议 8–12 页）；合集向 inventory/detail；「在这里我先分享一些」。
- **`vivid-anti-boring`**：补 m2 短视频字幕密度课 + **雪糕公式**（一眼懂→双痛点→会选；禁论文腔）。
- **`review-safe-voice`** 改名：**强监管优化表达**（医学/法律/金融/算命玄学雷区）。
- **`4season-fmcg-popsci`**：改名痛点槽点科普；ice.mp4 再抽帧密度课；权威一句强制落正文；对齐雪糕金牌结构。

### Skill 自动路由总管（勾选 ≠ 全灌）
见 [`shared/platformSkillRouter.ts`](../../shared/platformSkillRouter.ts) 与 [`shared/platformTopicShortlist.ts`](../../shared/platformTopicShortlist.ts) 的 `PLATFORM_SKILL_MASTER_READONLY`。

| 组 | id |
|----|-----|
| 核心 | hook-solution-cta · review-safe-voice · vivid-anti-boring · cover-stop-scroll · platform-native · cultural-diversity · lifestyle-diversity |
| 赛道 fmcg | 4season + label-debunk + authority + monetize |
| 赛道 forensic | forensic-life-lens + authority |
| 赛道 crossover / contrast | 对应单 Skill |
| 图文 | graphic-note-rhythm + xhs-collectible-note |

### 更早变更
见 git 历史与 `~/Downloads/2026Jul13/grokskp2.md`。

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
- **流程**：先生成约 **20 条初选**（每条 `skillsUsed` + `conveyGoal`）→ 用户勾选 **5–6** → 扩写正式文案 + `graphicNotePages`。积分：初选 12 / 扩写 48。
- **Skill Master 只读展示**：页面可见 auto 路由说明（勾选=池）。
- **去重**：`dedupeKey` 硬约束（同人/同母题如王安石、深夜高压最多 1）。
- **评论钩** ≤3 字生活词；禁止整句预约话术。
- **`xhs-collectible-note`**：高收藏页角色（建议 8–12 页）；「在这里我先分享一些」。
- **`review-safe-voice`** 改名：**强监管优化表达**（医学/法律/金融/算命玄学雷区）。
- **`4season-fmcg-popsci`**：改名痛点槽点科普；ice.mp4 再抽帧密度课；权威一句强制落正文。

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

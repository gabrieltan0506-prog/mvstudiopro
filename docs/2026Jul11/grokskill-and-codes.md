# Grok · Skill 与代码整理（2026-07-11）

今日收工纪要。线上下一版验证与回归测试**留待明天**。

## 今日已合并 PR

| PR | 主题 | 状态 |
|----|------|------|
| [#739](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/739) | OhMyGPT 额度耗尽 → 跳过 Terra，回退 EvoLink gpt-5.5 | MERGED |
| [#740](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/740) | 生图提速：短 Skill 提示、封面跳过默认提炼、轮询加快、限重试；封面 `coverHeadline` + 平台母语构图 | MERGED |
| [#741](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/741) | 图文笔记禁拍摄手法语境（防「导演手法卡」）+ 反差·反转·高潮弧 Skill | MERGED |
| [#742](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/742) | 封面有人物须表情/姿势抓人，禁上课正脸 | MERGED |

已删除无用远程分支：`fix/platform-image-gen-speed`（内容已由 #740 / #741 squash 进 main）。

---

## Skill 目录（`docs/2026Jul11/skill/`）

内置 Skill 由 `shared/platformSkills.ts` 的 `PLATFORM_BUILTIN_SKILL_IDS` 注册；出图短约束见 `composePlatformImageSkillHints`。

### 今日新增 / 大改

| 文件 | id | 要点 |
|------|-----|------|
| `contrast-reversal-climax.md` | contrast-reversal-climax | **新增**。身份反差 + 情绪可多次反转；专有词升压（如葡萄糖指标，勿空说「血糖」）；高潮**不限定仰慕**，随文案节奏。参考样本：`~/Downloads/2026Jul11/sk.mp4`（博士服务员）。 |
| `crossover-popsci.md` | crossover-popsci | **由 crossover-organ-popsci 改写扩面**。跨界科普叙事（器官只是一例）；含如何跨界菜单 A–H；样本弧来自 `~/Downloads/2026Jul12/1.mp4` 高密度抽帧。 |
| `cover-stop-scroll.md` | cover-stop-scroll | **大改**。有人物时禁正面上课脸/证件照站姿；须表情或动态抓人（跳跃、失衡、陶醉、错愕、坏笑等）；时装质感可留，停滑优先。 |
| `graphic-note-rhythm.md` | graphic-note-rhythm | 图文格节奏（既有）；与 #741 代码配合，避免短视频分镜规则污染图文。 |

### 其余内置（未大改，仍默认开）

`director-craft` · `cultural-diversity` · `lifestyle-diversity` · `hook-solution-cta` · `platform-native` · `review-safe-voice` · `blue-ocean-natural` · `batch-arc-engagement` · `vivid-anti-boring`

### 2026-07-12 畅销品轻科普（改版 f）

| 文件 | id | 要点 |
|------|-----|------|
| `4season-fmcg-popsci.md` | 4season-fmcg-popsci | 四季畅销品弧+运镜合一（取代 summer / food-lens） |
| `label-debunk-copy.md` | label-debunk-copy | 何时用；标签盲区替代证据 |
| `authority-cite-endorsement.md` | authority-cite-endorsement | 权威背书：食品+睡眠运动心理宣称等 |
| `fmcg-popsci-monetize.md` | fmcg-popsci-monetize | 打脸科普→清单线索→顾问/课/沙龙 |
---

## 代码改动摘要（按主题）

### 1）生图提速与封面语境（#740）

- 出图只注入**短 Skill 提示**，禁止全文 Skill md 灌进分镜/封面链。
- 中文直送封面：默认跳过 `extractChineseVisualBrief`；语境过长才自动提炼。
- EvoLink 轮询与合成重试次数收紧。
- 封面优先吃 `platformVariants.coverHeadline` + 平台母语视觉分支。

**关键路径：** `shared/platformNativeVariants.ts` · `server/services/platformImageChineseStaging.ts` · `server/services/geminiPlatformCompositeTranslation.ts` · `server/services/proxyImageService.ts` · `server/routers.ts` · `client/.../PlatformPage.tsx`

### 2）图文笔记 ≠ 导演手法卡（#741）

**根因：** 图文与短视频共用 `buildPlatformSheetScriptContext`，把灯光/运镜/六栏/逐步执行脚本塞进图文 `scriptContext`；服务端还对八格注入 `executionDetails` / 拍摄技法。

**修复：**

- 客户端：图文只喂选题/钩子/文案/`[封面][图N]` 大纲；`sheetKind: graphic`。
- 服务端：`xiaohongshu_dual_note` **跳过**拍摄手法注入；3×4 节拍优先抽攻略页并过滤口播运镜时间轴。
- Prompt：明确禁止「导演拍摄手法·手法卡」。
- 单测：`server/services/extractGraphicNoteBeatsFor3x4.test.ts`

**关键路径：** `client/src/pages/PlatformPage.tsx` · `server/services/proxyImageService.ts` · `server/services/geminiPlatformCompositeTranslation.ts`

### 2b）图文笔记 ≠ 创作者技术指导（#743 续）

**根因：** 图文 `scriptContext` 仍喂入 `publishingAdvice` / 创作 SOP 步骤；Stage2 图文大纲偶发写成「今晚拍封面/拆八页/录60秒」；3×4 filler 含「本周可拍画面」→ 模型画出技术指导格。第二张 2×4「饭后散步劝父母」才是正确可发笔记。

**修复：**

- `shared/graphicNoteReaderFacing.ts`：识别并剔除元创作指令；图文出图不喂 `publishingAdvice`。
- Stage2：图文 `detailedScript` 强制读者向页结构；Skill `graphic-note-rhythm` 显式禁技术指导格。
- 3×4 节拍抽取 + filler 改为读者向（钩子→痛点→场景/关系/节律→问答→评论CTA）。

**单测：** `server/services/graphicNoteReaderFacing.test.ts` · `extractGraphicNoteBeatsFor3x4.test.ts`

### 3）反差·反转·高潮弧 Skill（#741）

- 从 `sk.mp4` 提炼创作方式（加速录屏难听清口播，以**画面字幕**为准）。
- 硬约束：身份反差 + 至少一次情绪反转；可多次；落点不写死仰慕。
- 中段用可核对专有词（生理/心理/消费模型均可），服务叙事而非百科。

### 4）封面表情姿势抓人（#742）

- Skill + 封面中文直送硬约束 + 时尚大片人物块：压过「挺拔从容冷淡 / 上课正脸」。
- 出图短约束同步（`composePlatformImageSkillHints` → `cover-stop-scroll`）。

**关键路径：** `docs/2026Jul11/skill/cover-stop-scroll.md` · `shared/platformFashionEditorialCharacter.ts` · `shared/platformNativeVariants.ts` · `server/services/geminiPlatformCompositeTranslation.ts`

### 5）文案 Provider 回退（#739）

- OhMyGPT Sol/Terra 额度/鉴权失败 → 跳过 Terra → EvoLink gpt-5.5。
- 错误文案按真实 provider 提示，避免误报「检查 EvoLink API Key」。

---

## 样本与素材（本机 Downloads，未入库）

| 路径 | 用途 |
|------|------|
| `~/Downloads/2026Jul11/sk.mp4` | 反差弧参考（约 115s，1× 录屏；语速仍快，专有名词靠字幕帧） |
| `~/Downloads/2026Jul11/skill.mp4` | 较早一版（含 1.5×/2.0× 加速 UI，口播不可靠） |
| `~/Downloads/2026Jul11/skill/` | 当日平台产出图/PDF 参考包 |

---

## 诚实产品结论（已与用户对齐）

- 文案仍可挂全文 Skill；**出图只吃短约束**。跳过提炼主要影响封面链。
- 图文旧 Stage2 若同时含「拍摄执行脚本」与「`[封面]/[图N]` 大纲」，合并 #741 后**直接再生成图文**即可，不必重跑全文案。
- 反差弧 Skill 是结构公式，不是逐字复刻博士服务员剧本。

---

## 明天建议测试（未做）

1. **图文 3×4 / 八格**：旧 Stage2（含灯光机位 + 详细脚本）再生成 → 应为攻略/避坑格，不是手法卡。
2. **短视频分镜 2×4 / 3×4**：灯光机位与六栏仍在。
3. **/platform Skill UI**：出现「反差·反转·高潮弧」；「封面停滑」默认勾选。
4. **竖版封面**：有人物时非上课正脸；多条封面表情/姿势不完全雷同。
5. **OhMyGPT 额度耗尽路径**（若可复现）：应落到 EvoLink，错误文案不误指 Key。
6. 单元测试：`pnpm exec vitest run server/services/extractGraphicNoteBeatsFor3x4.test.ts`

---

## 未完成 / 可选后续

- Debug 面板「中文直送」文案标注（曾 stash：`wip-debug-panel-chinese-direct`，未合入今日 PR）。
- 反差弧可按更多平台样本再补「正例/反例」而不加长 prompt。
- Stage2 生成端是否减少图文选题里「逐步执行拍摄脚本」的权重（出图侧已滤；文案侧仍可能偏视频执行）。

---

*整理人：Grok（Cursor）· 2026-07-11 晚*

# grokjob-codes · 2026-07-17

> 工作区：`~/.codex/worktrees/974b/mvstudiopro`  
> 镜像：`~/Downloads/2026Jul17/grokjob-codes.md`  
> 口径：改完先 push；整块模块再开/合 PR；线上只认 Fly Deploy success

---

## 1. 今日已合并（main）

| PR | 主题 | 状态 |
|----|------|------|
| [#805](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/805) | 漫剧角色卡主路径（库/三视图/画风） | MERGED |
| [#806](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/806) | 角色卡跟进批（套组/筛选/快捷键/导入导出等） | MERGED |
| [#807](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/807) | HB V1–V7 提示词资产、HTML PPT、Home 动效、Canvas 文档修 | MERGED（`b61ecb5a`，约 2026-07-17 19:16 UTC） |

---

## 2. HB 素材落地（#807 · 已合）

素材源：`~/Downloads/2026Jul17/HB/`（`v1–v7.pdf` + Cover / Product Ad / Short Drama md）。

| 编号 | 内容 | 落地 |
|------|------|------|
| V1 | 百科级信息可视化模板 | `shared/infographicNoteTemplates.ts` + Platform 选择器 |
| V2 | MotionSite 动效 Hero | `HomeHero.tsx` 全幅视频底 + BlurText + liquid-glass |
| V3 | 光标揭层 / 滚动控视频（Spline 暂不做） | `HomeCursorReveal.tsx` · `HomeScrollVideo.tsx` · Skill `home-motion-v3.md` |
| V4 | Image-2 十套一键模板 | `shared/image2PromptTemplates.ts` + Creative 选择器 |
| V5 | 电影抢镜 | `motionPromptBank` `scene_steal` + `shared/sceneStealPromptBank.ts` |
| V6 | 网站式 HTML PPT | `shared/htmlPptMaker.ts` + `PlatformHtmlPptPanel` 三步：设定→可编辑清单→导出 |
| V7 | 去 AI 味写实 | `shared/photorealCharacterPrompt.ts` |
| MD | 即梦 Cover / Product Ad / Short Drama / AI Ads | `docs/2026Jul11/skill/jimeng-*.md` · `ai-feed-ad.md` |

### UI 分类（避免乱堆）

- Skill 池：`core` / `graphic` / `templates` / `video` / `lane` / `custom`（`shared/platformSkillCategories.ts`）
- Platform 工作台 Tab：**文案 | 模板 | 素材**
- 规则：`.cursor/rules/ui-categorize-not-clutter-always.mdc`
- 工作流：`.cursor/rules/git-pr-workflow-always.mdc`（改完先 push，整块再开 PR）

### 关键路径

```
shared/infographicNoteTemplates.ts
shared/image2PromptTemplates.ts
shared/htmlPptMaker.ts
shared/photorealCharacterPrompt.ts
shared/sceneStealPromptBank.ts
shared/hbPromptAssets.test.ts
client/src/components/PlatformHtmlPptPanel.tsx
client/src/components/HomeHero.tsx
client/src/components/HomeCursorReveal.tsx
client/src/components/HomeScrollVideo.tsx
client/src/pages/Home.tsx
client/src/pages/PlatformPage.tsx
```

---

## 3. Canvas 文档整理修（#807 内）

**现象：** `/canvas`「整理文案 / 文本生成」上传 `day3.txt` → `vision_failed`；`/platform` 贴文字正常。

**根因：** `collectVisionImages` 把文档也当图片，走了 `canvasVisionMarkdown`。

**修复：**

1. `isCanvasVisionImageAsset` / `collectDocumentAssets`：仅图片进 vision  
2. `loadCanvasDocumentTexts`：TXT/MD 读正文后走 `optimizeCustomCopy`  
3. `runCanvasBlock` 防御过滤 + 本块文档兜底预读  

**关键路径：**

```
client/src/lib/canvasTypes.ts
client/src/lib/canvasDocumentText.ts
client/src/lib/canvasRunBlock.ts
client/src/components/canvas/FreeformCanvas.tsx
client/src/lib/canvasDramaStudio.ts
```

**验收：** 上传 TXT + GPT 文案模型跑整理/生成，不应再报 `vision_failed`。PDF 暂提示改 TXT/MD 或粘贴。

---

## 4. 漫剧工厂收口（本 PR 分支）

分支：`fix/manhua-scene-mijing-priority`（本文件随此 PR）

### 4.1 闯秘境优先级

- **问题：**「仙门外门弟子闯秘境」被「仙门/外门」压成 `scene_01`，应 `scene_04` 秘境洞府  
- **改法：** 最长命中词优先 + 补「闯秘境」等键  
- **探针：** `pnpm run manhua:genre-probe` PASS  

### 4.2 爆款题材词映射

情报源：`docs/2026Jul17/manhua-viral-hits-2026h1.md` + `.cursor/skills/manhua-viral-hits/SKILL.md`

将边关/罪妻/吞噬/种田/末世/电竞/团宠等同义词写入：

| 层 | 文件 |
|----|------|
| 场景 | `shared/manhuaSceneAssetLibrary.ts` |
| 剧种 | `shared/screenwriterGenreTemplates.ts` |
| 手法 | `shared/craftShotBank.ts` |
| 包装动效 | `shared/motionPromptBank.ts` |

示例命中：

| 题材一句 | 场景 | 手法倾向 |
|----------|------|----------|
| 发配边关罪妻开荒… | scene_10 | 广角史诗 |
| 吞噬进化 | scene_04 | 广角体积光 |
| 渔乡种田 | scene_07 | 暖光发现 |
| 末世废柴 | scene_17 | 广角高反差 |
| 气运三角洲操作… | scene_15 | 追逐感 + RGB 动效 |
| 剑宗团宠小师妹 | scene_01 | 甜感近景 |

### 4.3 线上工厂探针（生产）

`pnpm run manhua:probe` → BASE=`https://www.mvstudiopro.com`  
五段全 PASS：故事 → 角色卡 → 节拍 → 无片反推 → 关键静帧。  
Seedance / Omni edit 仍默认关（需显式 env）。

---

## 5. 排队未开合

| 分支 | 内容 | 说明 |
|------|------|------|
| `feat/seedance-probe-cli` | `pnpm run manhua:seedance-probe` 默认 SKIP | 已叠 main；等本 PR Deploy 绿后再串行开合 |
| Seedance 2.5 | Coming soon 骨架 | 有意未开放全价档 |

---

## 6. 协作约定（今日强化）

1. **改完先 `git push` 功能分支**，不要本地悬空  
2. **攒整块模块再开/合 PR**；两次 `gh pr create` ≥15 分钟  
3. **串行门禁：** 上一 PR MERGED + Fly Deploy **success** 才能合下一张  
4. 设计选择题先问用户（`.cursor/rules/ask-before-design-choices-always.mdc`）  
5. UI/Skill/模板按用途分类，禁止扁平乱堆  

活文档：`ACTIVE_TODO.md`

---

## 7. 建议验收清单

- [ ] Fly Deploy（含 #807）success 后：首页 V3 光标揭层 + 滚动视频  
- [ ] `/platform`：模板 Tab 可见百科可视化 / Image-2 / HTML PPT  
- [ ] `/canvas`：上传 TXT 做「整理文案」「文本生成」不再 `vision_failed`  
- [ ] `/canvas` 工厂：题材「仙门外门弟子闯秘境」→ 秘境洞府；「发配边关…」→ 边塞场景  
- [ ] `pnpm run manhua:genre-probe` 本地全绿  

---

## 8. 一句话

今天把 **HB 提示词资产（#807）**、**Canvas 文档误走 vision 的硬修**、以及 **漫剧工厂题材→场景/手法命中率** 推完；工厂细修与本纪要在 `fix/manhua-scene-mijing-priority` 开 PR，Seedance 探针 CLI 继续排队。

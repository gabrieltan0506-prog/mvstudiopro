---
name: motion-prompt-bank
description: 短视频包装动效库施工手册（Logo/产品/数据/字幕/电影抢镜）。把 shared/motionPromptBank 条目变成可验收动效时使用；前台不泄漏渲染栈名。
---

# 包装动效库 · Agent 施工

## 何时用

- 用户要短视频 **Logo / 产品广告 / 数据动画 / 字幕动效 / 电影抢镜** 包装
- 需要从 `shared/motionPromptBank.ts` 选条目注入包装节点

## 归属：platform，不是 canvas

本库是 **/platform** 侧能力。**不要**在 `/canvas`（漫剧工厂）里引用、挂选择器或下传 id——
画布工厂设置里那个「包装动效」下拉框已按此口径摘除（#985）。
画布的叙事镜头手法走 `craftShotBank`，两者不要互相借用。

## 分类（以 `MotionPromptCategory` 为准）

| `category` | 中文名 | 条数 |
|---|---|---|
| `caption` | 字幕动效 | 12 |
| `logo` | Logo 动画 | 8 |
| `data` | 数据动画 | 7 |
| `product_ad` | 产品广告 | 7 |
| `scene_steal` | 电影抢镜 | 3 |

`scene_steal` 是真人闯入经典名场面并抢位的整段演出（船头张臂、雨夜亲吻、时空门穿越），
属于**成片主体**而非片头片尾包装，选它时不要再叠其他包装条目。

新增分类时同步改本表、`MOTION_PROMPT_CATEGORY_LABEL_ZH` 与 `shared/motionPromptBank.test.ts`。

## 不要做

- 不要把外部仓库全文 prompt 原样上生产
- 不要在用户可见 UI 写渲染栈名、外仓名、创作者网名
- 不要与「拍摄手法库」（灯光运镜情绪）混成一张表

## 工作流

1. 从 `MOTION_PROMPT_BANK` 按 `category` 选 1 条（全片同档少而精）
2. 用 `buildMotionPromptInjectBlock([id])` 注入包装/字幕相关方块
3. 占位符换成用户品牌词 / 文案 / 数据
4. 验收：对照条目 `effectZh`；字幕故障类遵守「Cut never fade / 全片最多一次」

## 自动推荐
- `recommendMotionPromptFromTopic(topic)`：题材关键词 → 1 条包装建议（可选手选覆盖）
- 细项优先于泛词：如「电竞/RGB」先于「片头」；「揭晓/反转句」先于「字幕」
- 未手选时可按题材自动写入；手选后锁定，可「恢复自动推荐」

## 与产品边界

| 库 | 用途 |
|----|------|
| `motionPromptBank` | 后制包装动效 |
| `craftShotBank` | 叙事镜头手法（灯光/运镜/情绪） |
| `CRAFT_TECHNIQUE_PROFILES` | 整卡气质（成稿去名） |
| `manhuaCharacterAssetLibrary` | 男女主外形 |

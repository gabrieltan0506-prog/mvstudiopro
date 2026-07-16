# 编导分镜图：d1 / d2 超高密度抽帧结论（2026-07-16）

源片：`downloads/2026Jul16/d1.mp4`（约 21s）、`d2.mp4`（约 64s）。  
抽帧：4fps → `d1-frames-dense/`（85）、`d2-frames-dense/`（255）；OCR 见 `d1-d2-ocr-dense.md`。

## 产品结论

| 片 | 核心主张 | 落到本产品 |
|---|---|---|
| **d1** | 同一段提示词，**带/不带导演板**成片差异巨大；角色卡 + 大师级运镜/蒙太奇导演板 | 平台合成表改称 **编导分镜图**；脚本与中文直送强制注入导演板层 |
| **d2** | Seedance 2.0：**不建议**只写僵硬传统分镜（易锁死情绪与发挥）；优先 **导演板 + 多参考**；结构含风格/时长/起承转合/关键技法/情绪反转/观众必看点 | 六栏分镜保留，但叠加全局导演板（节奏·情绪弧·表演提要）；为后续图生视频留可迁移光影走位 |

## 导演板字段（成稿只写手法词，禁导演名/片名）

1. 风格气质  
2. 建议时长节拍  
3. 角色表演提要  
4. 整体节奏：起—承—转—合  
5. 1–2 个关键技法（运镜/灯光）  
6. 观众情绪弧 + 每格「观众必须看到」的信息点  

## 代码接线

- `shared/bianDaoStoryboard.ts`：命名常量 + `enrichScriptContextWithBianDaoDirectorBoard`
- `server/routers.ts`：`generatePlatformCompositeSheet` / 封面+合成套装 注入导演板
- `buildCompositeSheetDirectChineseBody`：主体文案改为「编导分镜图」并要求顶栏含节奏/情绪弧
- `composePlatformImageSkillHints`（`director-craft`）：编导分镜出图短约束
- UI / 扣费 / PDF：用户可见「分镜图」→「编导分镜图」（平台合成分镜产品）

---
id: encyclopedic-infographic
name: 百科级信息可视化图文
description: 3:4 百科海报式图文笔记模板（材质工艺/发展史/生态枢纽/对决/传承）；五段元结构 + P.A.M.S.
version: 2026-07-17-hb
defaultEnabled: false
---

# 百科级信息可视化图文 Skill

## 用途
当用户要做**信息密度极高的竖版 3:4 图文/海报笔记**（品牌工艺、发展史、生态图、对决对比）时启用。站内模板库见 `shared/infographicNoteTemplates.ts`。

## 硬约束
1. 输出必须是 **Massive encyclopedic 3:4 infographic poster**，不是普通生活照或说明书截图。
2. 必须包含五段：角色与主题 → 核心视觉主体 → 环境画布 → P.A.M.S. 高密度信息层 → 技术规格渲染。
3. 主体模式三选一写清：Exploded view / Split-screen fusion / Central Hub（发展史用纵向时间轴）。
4. 背景用纹理 + 半透明图纸水印消除廉价感；底部保留 Specs 数据条。
5. 成稿只改主体名词即可复用元结构；禁止堆真实导演片名致敬。

## 可选模板 ID（UI 一键套用）
- `infographic_material_lab` 材质工艺实验室
- `infographic_evolution_timeline` 发展史时间轴
- `infographic_business_ecosystem` 业务生态枢纽
- `infographic_rival_showdown` 终极对决
- `infographic_heritage_craft` 工艺与传承
- `infographic_ancient_artifact` 古代器物

用户选定模板与主体后，用 `fillInfographicTemplatePrompt(templateId, subject)` 生成最终生图提示。

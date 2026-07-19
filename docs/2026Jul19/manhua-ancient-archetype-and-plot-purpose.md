# 古风原型库 + 剧情目的/戏种节奏（2026-07-19）

## 边界

| 层 | 模块 | 说明 |
|----|------|------|
| 都市角色槽 | `shared/manhuaCharacterAssetLibrary.ts` | `char_f_*` / `char_m_*` 等 |
| 古风原型 | `shared/manhuaAncientArchetypeLibrary.ts` | `arch_*` 设计板，7 槽 |
| 分镜目的/节奏 | `shared/manhuaPlotPurposeCameraBank.ts` | 注入编导分镜 / 编剧室可选 |

成稿与用户可见文案**禁止**外仓品牌水印（如「元点Agent」）。

## 古风原型 ID

| id | 展示名 | lane |
|----|--------|------|
| `arch_xianmen_sword_cold` | 清冷仙门剑修 | xianxia |
| `arch_yaolu_physician` | 药庐温润医者 | ancient |
| `arch_rain_jianghu_dao` | 雨夜江湖刀客 | jianghu |
| `arch_red_armor_general` | 赤甲王朝将军 | gongting |
| `arch_phoenix_empress` | 凤曌女帝 | gongting |
| `arch_forest_phoenix_queen` | 森灵凰后 | xianxia |
| `arch_cloud_phoenix_queen` | 云凰女王 | xianxia |

二期扩展位（未开槽）：战国将军、西域术士。

## 示范图

`client/public/manhua-characters/ancient/{id}_sheet.jpg` — 见该目录 README。

## 注入点

- 编导分镜：`enrichScriptContextWithBianDaoDirectorBoard({ plotPurposeId, scenePacingId })`
- 工厂角色卡：`spawnManhuaDramaStudio({ ancientArchetypeIds })` → bible 节点 `【古风原型锚点】`
- 编剧室：`buildManhuaWriterExpandPrompt({ ancientArchetypeIds, plotPurposeId, scenePacingId })`

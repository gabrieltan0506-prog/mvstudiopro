---
id: medical-resource-library
name: 医学多媒体资源库
description: 免登录权威医学站点（MSD大众/专业、MedlinePlus、Cleveland、CardioSmart、Radiopaedia、Innerbody、Zygote）；文案可附动画/图片/症状搜索链
version: 2026-07-13a
defaultEnabled: true
---

# 医学多媒体资源库 Skill

## 用途
医学/急救/解剖/机制科普时，让模型**会搜、会引、会展示**公开多媒体，而不是空讲定义。  
样本气质（`~/Downloads/2026Jul13/mk*.mp4`）：
- **mk**：医学科普「100 个热门话题」大数字选题包（谁写谁火 + 急救清单页）
- **mk1**：硬核网站推荐 —— MSD 大众版 + 3D（BioDigital）讲清发病原理
- **mk2**：医学科普搜索场 —— 八卦讲医学 / 3D 打脸 / 漫画细胞
- **mk3**：漫画科普「肿瘤细胞诞生」—— 好手册黑化，反课堂切片

与 `crossover-popsci` / `vivid-anti-boring` / `authority-cite-endorsement` / `review-safe-voice` 叠用。

## 受众二分（先选对再搜）

| 受众 | 入口 | 何时用 |
|------|------|--------|
| **大众版**（默认成稿） | https://www.msdmanuals.cn/home/resource | 小红书/短视频正文、症状、急救、3D 给公众看 |
| **专业版**（备课） | https://www.msdmanuals.cn/professional/resource | 医护创作者查机制/计算器；**成稿仍改写成大众口径** |

页顶「专业的 | 大众版」可切换。代码侧：`shared/medicalResourceLibrary.ts` 的 `pickMedicalResources` / `buildMedicalResourcePromptBlock`。

## 实测可用站点（2026-07-13 curl 验证）

### 1) MSD 默沙东（优先）
| 能力 | 大众版 URL | 专业版 URL |
|------|------------|------------|
| 资源总览 | `/home/resource` | `/professional/resource` |
| 搜索 | `/home/SearchResults?query=关键词` | `/professional/SearchResults?query=` |
| **3D** | `/home/pages-with-widgets/biodigital`（BioDigital） | `/professional/pages-with-widgets/3d-models` |
| 图片/视频 | `/home/pages-with-widgets/images` · `videos` | 对应 professional 路径 |
| 症状 | `/home/symptoms` | `/professional/symptoms` |
| 急救 | `/home/first-aid` | — |
| 健康话题 | `/home/health-topics` | — |

**死链（禁止写入文案）**
- ❌ `/home/pages-with-widgets/3d-models`（404）
- ❌ 臆造深层文章长路径；必须先搜索再引用实链

**推荐口播句**：  
「打开默沙东大众版搜××，它的 3D 会把××原理转起来看」+ 贴 `SearchResults` 或 `biodigital` 链接。

### 2) MedlinePlus（NIH/NLM）
- 首页：https://medlineplus.gov/
- 健康视频库：https://medlineplus.gov/anatomyvideos.html  
- 医学百科：https://medlineplus.gov/encyclopedia.html  
- 搜索：`https://vsearch.nlm.nih.gov/vivisimo/cgi-bin/query-meta?v%3Aproject=medlineplus&query=关键词`  
- 单条动画例：https://medlineplus.gov/ency/anatomyvideos/000067.htm（心跳）  
- ❌ **https://medlineplus.gov/videosandtutorials.html = 404**（旧文失效）

### 3) Cleveland Clinic
- 总览：https://my.clevelandclinic.org/health  
- 疾病/症状/治疗/人体：`/health/diseases` · `symptoms` · `treatments` · `body`  
- 站内搜：https://my.clevelandclinic.org/search?q=关键词  
- 亮点：机构插画，适合「复杂机制→易懂图文」。

### 4) CardioSmart（ACC）
- 首页：https://www.cardiosmart.org/  
- 素材库：https://www.cardiosmart.org/assets  
- 主题例：`/topics/atrial-fibrillation` · `/topics/coronary-artery-disease` · `/topics/heart-failure`  
- 搜索：https://www.cardiosmart.org/search?q=关键词  
- ❌ 裸链 `/topics` 会跳到搜索页；请用具体 slug 或首页。

### 5) Radiopaedia
- https://radiopaedia.org/  
- 搜索：`https://radiopaedia.org/search?q=关键词&scope=all`  
- 用途：标注 CT/MRI + 示意图；结构异常/读片向。

### 6) Innerbody / Zygote（3D 解剖引擎）
- Innerbody 总览：https://www.innerbody.com/htm/body.html  
- 系统例：`/image/cardov.html`（心血管）· `digeov` · `endoov` · `nervov` · `skelfov` …  
- Zygote Body：https://www.zygotebody.com/（拉杆剥层）

## 文案怎么用（硬规则）

1. **每条医学向成稿至少 1 处**：公开资源名 + 可点 URL（搜索页或多媒体 hub 即可）。  
2. **展示方式**（口播/图文页均可）：「动画讲原理 / 图片对照结构 / 症状页自查入口」三选一为主，勿堆 5 个官网。  
3. **雪糕公式仍适用**：生活场 → 痛点1 → 痛点2 → 会选/会对照资源；禁止定义→分类→注意事项课件。  
4. **包装可学 mk**：大数字选题包、硬核网站种草、漫画拟人；**内容必须落到可打开资源**，不能只有口号。  
5. **审核**：学者向观察；不给观众下诊断、不开处方、不承诺疗效。

## 选题路由提示
命中：医学科普、急救、解剖、3D、默沙东、症状、心血管、影像、器官机制 → 启用本 Skill。  
同批可与 `crossover-popsci`（拟人）或 `xhs-collectible-note`（100 选题清单页）组合。

# 医学资源站实测笔记（2026-07-13）

用 `curl -L -A Chrome -H 'Accept: text/html'` 探测；结果写入 `shared/medicalResourceLibrary.ts`。

## 结论速查

| 站点 | 主入口 | 搜索怎么用 | 注意 |
|------|--------|------------|------|
| MSD 大众 | `/home/resource` 200 | `/home/SearchResults?query=` 200 | 3D = **`/home/pages-with-widgets/biodigital`**；`/3d-models` **404** |
| MSD 专业 | `/professional/resource` 200 | `/professional/SearchResults?query=` 200 | `…/3d-models` 200 但 title 可能误标「临床计算器」，正文含 BioDigital |
| MedlinePlus | `/` 200 | NLM `vsearch…query-meta?…medlineplus&query=` 200 | **`/videosandtutorials.html` 404**；改用 `/anatomyvideos.html` |
| Cleveland | `/health` 200 | `/search?q=` 200 | 子库：diseases/symptoms/treatments/body |
| CardioSmart | `/` 200 | `/search?q=` 200 | **裸 `/topics` → 跳转 `/search`**；用 `/topics/{slug}` 或 `/assets` |
| Radiopaedia | `/` 200 | `/search?q=&scope=all` 200 | 无 Accept 时可能 406 |
| Innerbody | `/htm/body.html` 200 | 系统页 `/image/cardov.html` 等 | `/anatomy/cardiovascular` 404 |
| Zygote Body | `/` 200 | 页内 3D 操作 | 基础免登录 |

## MSD 大众资源页实链（从 HTML 抽出）
- 3D 模型 → `/home/pages-with-widgets/biodigital`
- 图片/视频/信息图/测验 → `pages-with-widgets/images|videos|infographics|quizzes`
- 症状 → `/home/symptoms`；急救 → `/home/first-aid`；健康话题 → `/home/health-topics`

## CardioSmart
- 主题页（例）`/topics/atrial-fibrillation` 含 infographic / video / fact-sheet / decision-aid
- `/assets` 素材总库可用

## 对模型的硬约束
1. 只输出表内已验证 hub/搜索/二级入口；深层文章必须「先搜索再引用」，禁止瞎编 path。  
2. 文案展示动画/图片/症状时，优先贴搜索 URL 或 biodigital/anatomyvideos 等多媒体 hub。

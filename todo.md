# MV Studio Pro - Project TODO

## Phase 1: 后端迁移
- [x] 数据库 Schema 迁移（全部表）
- [x] 数据库迁移 SQL 已执行
- [x] 修复 routers.ts TS 错误
- [x] 修复 db.ts 栏位名对齐

## Phase 2: 前端 MVP
- [x] 深色主题（#101012 背景、#E8825E 主色）
- [x] 顶部导航栏（响应式）
- [x] 首页（Hero + 功能卡片 + 精选MV + 联系表单）
- [x] MV 展厅页面（7支MV在线播放、评论）
- [x] 登录/登出流程

## Phase 3: 测试发布
- [x] 修复所有 TS 错误
- [x] Vitest 测试通过（5 tests）
- [x] 保存 Checkpoint (425e741e)

## Phase 4: 全部功能页面
- [x] MV 智能分析页面
- [x] 虚拟偶像工坊页面
- [x] 歌词生成分镜页面
- [x] 视觉特效引擎页面
- [x] 套餐定价页面
- [x] 团队管理页面
- [x] 管理后台页面
- [x] Credits 仪表板 / 用户 Dashboard
- [x] 路由整合与导航更新
- [x] 文件上传 API
- [x] 测试通过（5/5）
- [ ] 保存最终 Checkpoint
- [ ] 域名配置 www.mvstudiopro.com

## 语言
- [x] 简体中文优先呈现
- [ ] 英文双语支持（后续）

## SEO 修复
- [x] 首页标题长度 30-60 字符
- [x] 首页 meta description 50-160 字符
- [x] 首页关键字设置

## Stripe 支付集成
- [x] 使用 webdev_add_feature 添加 Stripe 基础设施
- [x] 配置 Stripe API 密钥
- [x] 实现套餐订阅支付逻辑（基础版/专业版/企业版）
- [x] 实现 Credits 充值支付
- [x] 构建前端支付页面与订阅流程
- [x] Webhook 处理支付回调
- [x] 测试并保存 checkpoint

## Phase 5: 模块名称更新 & tapnow.ai 风格
- [x] 首页 Hero 区域添加 tapnow.ai 风格动画（粒子背景、渐变光晕、文字渐入）
- [x] 首页 Slogan 更新："让你视频的每一帧，都成为爆款的起点"
- [x] 首页 9 宫格彩色卡片与截图一致
- [x] "MV 分析" → "视频PK评分"（首页、导航栏、MVAnalysis 页面、Dashboard）
- [x] "视觉特效引擎" → "分镜转视频"（首页、导航栏、VFXEngine 页面、Dashboard）
- [x] "歌词生成分镜" → "智能脚本与分镜生成"（Storyboard 页面标题）
- [x] 更新 shared/plans.ts 中的旧名称
- [x] 更新 routers.ts 中的欢迎语提示词
- [x] 下载 YouTube 视频替换展厅（中国用户无法访问 YouTube）
- [ ] 隐藏 Stripe 支付入口（密钥未配置）
- [ ] 英文双语支持
- [ ] PDF 导出分镜脚本
- [ ] 更多示例视频
- [x] 智能脚本与分镜生成页面添加「一键复制」按钮

## Phase 6: 视频PK评分功能完善
- [x] AI 分析维度更新：故事情感、镜头运镜、整体叙事逻辑、视频清晰度 + 综合评分
- [x] 根据评分等级给予不同 Credits 奖励（≥90分 +25，80-89分 +15，<80分 无奖励）
- [x] 验证视频来源（仅 MV Studio 制作的视频可获奖励）
- [x] 视频时长限制 5 分钟以内
- [x] 前端展示奖励等级和新维度
- [x] 首页 Hero 区域视觉优化：光影变化、多色搭配、高级低调（用户反馈太黑）

## Phase 7: Veo 3.1 API 接入
- [x] 存储 GEMINI_API_KEY 环境变量
- [x] 后端实现 Veo 3.1 视频生成 tRPC 接口（text-to-video, image-to-video）
- [x] 前端分镜转视频页面接入 Veo 3.1 真实 API
- [x] 异步轮询机制 + 进度显示
- [x] 验证 API 连接测试

## Phase 8: fal.ai Hunyuan3D 2D转3D 接入
- [x] 查看 fal.ai API 文档获取接入参数
- [x] 获取并存储 FAL_API_KEY 环境变量
- [x] 后端实现 Hunyuan3D 服务模块（Rapid + Pro 两种模式）
- [x] 后端 tRPC 接口（生成3D模型、查询历史）
- [x] 数据库表 idol_3d_generations
- [x] 前端虚拟偶像工坊页面添加 2D转3D Tab
- [x] 测试并保存 checkpoint

## Phase 9: 虚拟偶像工坊完善
- [x] AI 偶像生成三档：免费版 / 2K (Nano Banana Pro) / 4K (Nano Banana Pro)
- [x] 后端 Gemini API 图片生成服务（2K/4K）
- [x] 前端三档选择 UI，标注价格和 Credits
- [x] 2D 转 3D 功能确认完善（Hunyuan3D Rapid/Pro）
- [x] 虚拟偶像 2K/4K 移除美元价格，只保留 Credits 显示

## Phase 10: 视频PK评分 AI 维度更新
- [x] 后端 AI 分析维度更新：故事情感、镜头运镜、叙事逻辑、清晰度 + 综合评分
- [x] 评分奖励 Credits 逻辑（85分/90分/95分不同档位）
- [x] 前端展示新维度雷达图 + 奖励等级
- [x] 验证视频来源（仅 MV Studio 制作的视频可获奖励）

## Phase 11: 视频 Hash 水印验证机制
- [x] 后端 Hash 水印服务（生成签名 + 验证签名）
- [x] 数据库 video_signatures 表存储签名记录
- [x] 分镜转视频生成时嵌入 Hash 到视频元数据
- [x] PK 评分时验证 Hash，决定是否发放 Credits 奖励
- [x] 支持二次创作视频（外来视频在平台编辑后也获得 Hash，可参加奖励）
- [x] 前端 PK 评分页面显示验证结果（平台视频/非平台视频）

## Phase 12: 二次创作影片评论与分享功能
- [x] 数据库表：video_comments（评论）、video_likes（点赞）
- [x] 后端 tRPC 接口：发表评论、获取评论列表、点赞/取消点赞、分享链接生成
- [x] 前端评论区 UI（评论列表、发表评论、点赞互动）
- [x] 前端分享功能（复制链接、社交平台分享按钮）
- [x] 视频详情页整合评论与分享

## Phase 13: 管理员无限权限 + 二次创作页面
- [x] 管理员跳过 Credits 扣费（所有付费功能无限免费使用）
- [x] 二次创作页面（上传外来视频 + 编辑 + 自动注册 remix Hash）
- [x] 路由注册和导航入口
- [x] 评分奖励标准修改：≥90分 +25 Credits，80-89分 +15 Credits，<80分 无奖励

## Phase 14: 二次创作页面 + 价格统一 + 脚本升级 + 视频转存
- [x] 全页面价格检查：移除所有美元价格，统一只显示 Credits（2D转3D、套餐页等）
- [x] 智能脚本分镜生成升级：新增“没灵感，给我三句话，我帮你写”栏位
- [x] 智能脚本接入 Gemini API 生成文案/歌词
- [x] 免费版 1000 字限制，Gemini 付费版 2000 字 + 20 个分镜
- [x] 二次创作页面：上传外来视频 + 编辑 + 自动注册 remix Hash
- [x] 二次创作页面路由注册和导航入口
- [x] YouTube 视频下载转存 S3，更新展厅前端来源

## Phase 15: 智能分镜脚本全面升级
- [x] 后端 storyboard.generate prompt 重写：增加灯光设计、人物表情/动作/神态/互动、摄影机位/镜景/镜头运动、配乐BPM
- [x] 后端 JSON schema 更新：新增 lighting/characterExpression/characterAction/characterInteraction/cameraAngle/cameraMovement/shotType/bpm 等字段
- [x] 免费版（Forge）即包含所有专业维度
- [x] Gemini 增强版 prompt 更细腻：微表情、肢体语言细节、色彩心理学、专业电影术语
- [x] 每个分镜自动生成分镜图（免费版 Forge 图片，Gemini 版更高质量）
- [x] 前端 Storyboard.tsx 重写：展示所有新维度（灯光、表情、动作、机位、BPM 等）
- [x] 前端分镜卡片自动触发图片生成并展示
- [x] 测试通过并保存 checkpoint

## Phase 16: 歌曲上传自动分析（Gemini 测试页面）
- [x] 后端：音频上传接口（复用现有 /api/upload）
- [x] 后端：Gemini 音频分析接口（BPM/情绪/节奏变化/段落结构/乐器编排）
- [x] 后端：分析结果自动生成分镜脚本（含14个专业维度）
- [x] 前端：测试页面 /audio-lab（上传+分析结果展示+分镜预览）
- [x] 路由注册（测试页面，不加入正式导航）
- [x] 测试通过并保存 checkpoint

## Phase 17: 歌曲智能分析页面整合 Suno BGM 生成
- [ ] 调研现有 Suno API 集成情况和可用接口
- [ ] 后端：新增 Suno BGM 生成接口（基于音频分析结果的 BPM/情绪/风格）
- [ ] 后端：支持 V4/V5 引擎选择，不同定价
- [ ] 前端：在 AudioLab 页面添加 BGM 生成区块（Step 4）
- [ ] 前端：支持自定义风格描述或选择固定风格选项
- [ ] 前端：BGM 生成结果预览和下载
- [ ] 测试通过并保存 checkpoint
- [x] 将 AudioLab 音频分析页面加入正式导航栏

## Phase 18: 2D转3D 功能全面重构
- [x] 新建 shared/credits.ts（独立 Credits 定价文件）
- [x] 更新 shared/plans.ts（新增导演包、学生版、Credits加值包等完整定价体系）
- [x] 重写 server/hunyuan3d.ts（Rapid/Pro 双模式 + GLB/OBJ 导出 + PBR + 多视角 + 自定义面数）
- [x] server/routers.ts hunyuan3d 路由更新：新增 estimateCost、status 接口
- [x] 前端 3D Studio 页面（从 RN 转换为 React Web + Tailwind + shadcn/ui）
- [x] 路由注册 /3d-studio 和导航栏入口
- [x] 测试通过并保存 checkpoint


## Phase 19: 修复管理员无限权限 bug
- [x] 检查虚拟偶像生成的 Credits 扣费逻辑（后端确认无误）
- [x] 检查所有付费功能的管理员跳过逻辑是否完整
- [x] 前端新增管理员免费标识显示
- [x] 测试通过并保存 checkpoint

## Phase 19: 虚拟偶像页面重构 + 2K/4K Credits 修复
- [x] 前端管理员显示“免费”标识（替代 Credits 价格）
- [x] 虚拟偶像页面改为上下并排布局（上：2D生成，下：3D转换）
- [x] 移除上传图片功能，生成的图像直接用于 3D 转换
- [x] 测试通过并保存 checkpoint

## Phase 20: 修复虚拟偶像风格不匹配问题
- [x] 检查后端 virtualIdol.generate 的 prompt 风格参数传递
- [x] 修复写实风 prompt：强调 photorealistic photograph、real person、DSLR，明确排除 anime/cartoon/illustration
- [x] 测试通过并保存 checkpoint

## Phase 21: 修复 2K 生成失败 + 3D URL 问题
- [ ] 查看服务器日志定位 2K Gemini 生成失败原因
- [ ] 查看服务器日志定位 3D 生成"图片格式不支持"原因
- [ ] 修复 2K 生成逻辑
- [ ] 修复 3D 图片 URL 传递逻辑
- [ ] 测试通过并保存 checkpoint

## Phase 22: 修复分镜转视频报错 + 3D CORB 问题
- [x] 分镜转视频页面已确认正常
- [ ] 修复 3D 生成 CORB 跨域问题
- [ ] 全面检查所有页面确保无报错
- [ ] 测试通过并保存 checkpoint

## Phase 23: 用户自行修改（GitHub 协作）
- [x] 2K/4K 虚拟偶像生成已修复（用户在 GitHub 更新 Gemini 模型）
- [x] 2D to 3D conversion 已修改（用户在 GitHub 更新）
- [x] 代码已推送到 GitHub
- [x] 3D API Key 已更新
- [x] 新 API Key 已生成並更新
- [x] API Key 再次更新
- [x] URL 參數已更新
- [x] 修復錯誤指令
- [x] 頁面修改已完成
- [x] 頁面再次修改已完成

## Phase 24: 3D 功能全面修復（Trellis 引擎 + ModelViewer）
- [x] 替換 server/fal-3d.ts → Trellis 引擎
- [x] 修改 server/hunyuan3d.ts（ensureAccessibleUrl + API 參數 + 結果解析）
- [x] 新建 ModelViewer 組件（React Web 適配版）
- [x] 更新前端頁面 import ModelViewer
- [x] 更新 routers.ts check3DService 描述
- [ ] 保存 checkpoint 並發布

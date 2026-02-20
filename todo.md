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
- [ ] 下载 YouTube 视频替换展厅（中国用户无法访问 YouTube）
- [ ] 隐藏 Stripe 支付入口（密钥未配置）
- [ ] 英文双语支持
- [ ] PDF 导出分镜脚本
- [ ] 更多示例视频
- [x] 智能脚本与分镜生成页面添加「一键复制」按钮

## Phase 6: 视频PK评分功能完善
- [ ] AI 分析维度更新：故事情感、镜头运镜、整体叙事逻辑、视频清晰度 + 综合评分
- [ ] 根据评分等级给予不同 Credits 奖励（85分/90分/95分不同档位）
- [ ] 验证视频来源（仅 MV Studio 制作的视频可获奖励）
- [ ] 视频时长限制 5 分钟以内
- [ ] 前端展示奖励等级和新维度
- [ ] 首页 Hero 区域视觉优化：光影变化、多色搭配、高级低调

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

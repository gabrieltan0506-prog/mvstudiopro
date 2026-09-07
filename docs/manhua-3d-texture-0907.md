# 3D 查看器贴图验收（部分完成，未发布）

## 改前证据与范围

用户要求持续完成工厂验收，以墨屠变身护住阿菁制作 10 秒试片，并授权使用 Tripo 和 GCS 存档。本增量仅处理已经生成模型的贴图查看，不改生成渠道、API、积分、权限、数据模型或旧媒体。

| 项目 | 证据 |
|---|---|
| 真实入口 | `ManhuaScriptWorkbench` 人物卡查看 3D；另有 `ThreeDStudio` 和 `VirtualIdol` 共用 `ModelViewer` |
| 生产者 | Tripo 任务 `m3d_bf97d8cbb33576e54714a513`，资产 `cust_mtn5ko0y_01qwd` |
| 云端与本地 | 41857616 字节，SHA256 `d50b463a890901627fb8f49b72c1b6ecd1f02424b4a989ddc03cdd0b37202aea` 一致；GCS 长期对象身份已保存 |
| 内容质量 | Blender 实际导入 1 网格、1418779 面，三张 768×768 图片有棕黑纹理与眼罩；GLB 有 3 张内嵌 JPEG，没有骨骼或动画 |
| 实页断点 | 人物卡回填查看按钮成功；查看器加载后呈白模，同一文件的本机渲染有纹理 |
| 转换与消费者 | 随包 GLTFLoader 从 `images[].bufferView` 建立 Blob 和 object URL；iframe CSP 的 `img-src`、`connect-src` 均缺少 `blob:` |
| 计费与恢复 | 预览使用已有 HTTPS GLB；只读媒体，不创建模型、不写旧产物；原任务与 GCS 身份不变 |
| 测试入口 | `modelViewerProps.test.ts` 渲染真实 React 组件并检查 iframe srcDoc；3D 绑定、路由、任务与编辑回归 |

## 本地改动

- `client/src/components/ModelViewer.tsx`：仅对 `img-src` 和 `connect-src` 增加 `blob:`，允许查看器消费内嵌贴图。脚本来源、iframe sandbox、HTTPS 模型入口和属性转义不变。
- `client/src/lib/modelViewerProps.test.ts`：三种 URL prop 均检查实际渲染的文档策略；额外验证用户输入 blob 模型仍被拒绝。

## 双向追链

正向：人物卡 → `model3dPreview.url` → `ModelViewer` → HTTPS URL 规范化与 HTML 属性转义 → iframe srcDoc → 同包 GLTFLoader → GLB bufferView → blob 贴图。

反向：Blender 纹理图 → 本地同哈希 GLB → GCS 模型 → 同一任务与资产 ID。网页白模的素材身份与上述一致；回归从最终 iframe 策略反查三个公共 URL prop 的真实组件输出。

旁路：`VirtualIdol` 从转换响应 `result.glbUrl` 写 `setGlbUrl` 并经 `src` 传入；`ThreeDStudio` 从 `generatedResult.glbUrl` 传入；漫剧人物卡从已保存模型签名地址传入。三者没有因补丁修改提交、计费或保存逻辑。旧无 URL 与非 HTTPS 输入仍不创建 iframe。重复预览、旧模型与续签沿原路径，不重新购买建模。

## 验证回执

- 补丁前：`pnpm exec vitest run client/src/lib/modelViewerProps.test.ts`，3 失败、4 通过，退出 1；三个 prop 均实际缺少 blob 图片许可。
- 补丁后：查看器、3D 绑定与接线、3D schema／路由／任务／供应商、图片编辑和上传接线，共 **9 文件、48 用例通过，退出 0，5.79 秒**。
- 修改前另跑图片编辑／上传 2 文件、7 用例通过，退出 0；仅说明已有逻辑的离线回归，不代表新图片已经生成。
- `pnpm check` 退出 0。无增量构建、最终格式后回归与 diff 审查结果待追加。

## 九层完成状态

| 层 | 状态与证据 |
|---|---|
| 需求与边界 | 已验证：限于既有 GLB 的贴图读取，未更换产品合同 |
| 入口与交互 | 部分完成：实页已到查看器并看见白模；三个公共 prop 的组件回归通过，新版实页未验 |
| 数据生产 | 已验证：同任务 GLB 非空，三张 JPEG、同哈希和 Blender 纹理图可复核 |
| 契约与转换 | 部分完成：真实组件 srcDoc 和 blob 许可已验证；浏览器实际执行补丁仍未验 |
| 服务与副作用 | 部分完成：任务成功、绑定／权限／失败回归通过；真实成本和退款未对账，不新增付费验证 |
| 存储与恢复 | 部分完成：GCS 模型与本地字节一致；历史草稿／ZIP 全量恢复仍有既有断点 |
| 消费与展示 | 部分完成：Blender 可见真实纹理；线上查看器仍是未发布版本，不能宣称修好 |
| 静态与回归 | 部分完成：48 回归及类型通过，构建结果待追加 |
| 真实链路 | 部分完成：常态 GLB 已实跑，修复后的线上浏览器、完全体、关键帧和 10 秒视频未实跑 |

## 限制与后续

没有新增依赖，没有导出任何生产凭证，没有 commit、push、PR、合并或部署。本地截图不是线上修复证据。不能用该静态 GLB 承诺骨骼行走动画；扭曲前腿需要在变身态与动态输入中正确处理。普通备份缺少资产实体、取消导入前写缓存等已定位问题本增量未修。

完全体单张编辑已展示完整预览（黑翼原图、金色独角、四尾、中等质量、16:9、3 积分、保留原图、不自动重试），候选提示词校验 valid；尚未收到该笔确认，未提交。用户同意 GCS 存档，不自动等同于这笔付费确认。

## 08:31 续验回执

- 重新执行查看器与 3D 七文件：41 项通过，退出 0，1.05 秒；图片编辑／上传两文件：7 项通过，退出 0，469 毫秒。
- `pnpm exec tsc --noEmit --incremental false` 退出 0。
- `pnpm exec vite build` 退出 0，3551 模块，14.42 秒；既有大包及混合导入警告保留。
- `git diff --check` 退出 0。Prettier 检查仅 `ModelViewer.tsx` 有格式问题；HEAD 同文件基线也未通过，不扩大为全文件格式化。
- `pnpm build --incremental false` 最终退出 0，无错误输出。上述均为本地验证，不代表线上查看器已经消费补丁或完全体图片已经生成；本轮未做干净依赖安装或 Docker 构建。
- 后续用户明确要求继续生成并允许必要点击；编辑正文已在原画布弹窗填入，但确认前活动窗口变化，保护检查中止，仍未点生成确认。没有新任务回执，接手先核实是否由用户手动提交，不得重烧。

## 11 时后续工：最新状态覆盖旧回执

- 旧完全体编辑后来已提交一次，任务 V23yfonGf28CMFwV 明确失败，未出图、实际扣分为 0，未重试。上文“尚未提交”仅为当时记录。
- 链接续签和横竖误判另由 PR1409 修复，现已合并；Fly Deploy 34079268943 success。正式前台 OmniCanvas-C5TFwawO.js 返回 200，包含新尺寸读取/失败处理逻辑；尚未用新版本重跑付费图片，不能称生成质量通过。
- 本查看器补丁从原工作树无损迁到最新 main d8e7092，独立分支 fix/model-viewer-embedded-texture-0907；只修改查看器 CSP、对应回归及本记录。原工作树改动保留。
- 最新生产只读查询发现学习任务 2kbjqTy50up4e_74 状态 running、action=manhua_template_learn。按用户条件授权，本轮只准备推送/PR，不合并或部署；合并前必须重新读取实际在途状态。
- 用户指定只使用右侧已有漫剧工厂浏览器，不动其他窗口；本轮尚未进行浏览器操作。离线组件策略验证不替代新版真实贴图渲染。

## 13 时最新主线验证

- 8 文件、49 项回归通过，5.72 秒，包含三个公共 URL prop、3D 绑定/路由/任务和图片编辑预检。
- pnpm check --incremental false 与 pnpm build --incremental false 均退出 0。
- pnpm exec vite build：3552 模块，41.65 秒，退出 0；既有大包及混合导入警告保留。
- git diff --check 通过。未跑全仓、干净 Docker 或新版线上贴图，故仍为部分验证。
- 用户允许验证后推送开 PR；仅当合并前重新核实远端没有学习任务时才授权自行合并。本报告不代替该时点检查。

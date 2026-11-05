# 首页和博客视频迁移（2026-11-05）

本 PR 只准备 25 条已验证视频的原网址回源，不合并、不部署。26 条原始文件全部保留；其中 1 条原有坏文件继续沿用原静态路径，不混入播放验收通过的清单。

## 原网址与存储

- 原始文件仍在 `client/public/home-assets` 和 `client/public/blog-assets`，HTML/React 中的原路径不变。
- `shared/staticSiteVideoManifest.json` 固定公开对象、SHA-256、大小、GCS generation、保留标记及媒体解析结果。
- `vercel.json` 精确转发这 25 个原路径到 Fly `/api/static-site-video/:sha256`；不会接受任意桶、对象或上游 URL。
- Fly 在服务端签名并流式读取固定 generation，支持 GET、HEAD、单区间 Range、条件请求、CORS、客户端取消和空闲超时。签名地址与凭证不传给浏览器。
- 现有桶 `mv-studio-pro-vertex-video-temp` 的桶元数据权限为 403，不能断言生命周期为空。副本使用 `temporaryHold=true` 并逐条读回确认；不修改桶级规则。保留标记解除前不能被生命周期删除。不要解除本批对象保留标记。
- 副本只条件创建（`ifGenerationMatch=0`），已有同名对象须完整验读；禁止覆盖/删除源和目标。复制工具只允许在 Fly 内运行，凭证不落本机。

## 发布门禁与回退

Vercel 构建会先核对清单、原文件 SHA-256、构建副本 SHA-256、精确 rewrite，以及真实 Fly 入口的 HEAD/大小/版本/媒体类型。全部通过才从构建输出中排除清单文件；源目录不删除。源内容变动或入口未就绪会使构建失败，旧正式部署继续服务。

本分支 `codex/static-video-offload-1105` 在 `git.deploymentEnabled` 中禁用自动部署，开 PR 不应生成 Preview；Fly 的部署 workflow 只监听 main。本次没有执行合并或部署。

以后获得发布授权时：先按项目门禁部署后端，验证全部固定媒体入口，再发布前端；若前端抢先构建，构建将失败，须在后端就绪后按授权处理，不能绕过检查。回退时原文件和旧部署仍可用，不需从云端重新下载原片。不要在仍使用这些 rewrite 的前端运行期间回滚到没有媒体入口的后端。

`STATIC_SITE_VIDEO_OFFLOAD=1` 可用于隔离构建；`STATIC_SITE_VIDEO_TEST_ORIGIN` 仅允许本机 HTTP 回环地址。`VERCEL=1` 时始终检查真实 Fly 地址，不能由测试变量绕过。

## 验证证据

- 26 条对象复制后完整读回，SHA-256/bytes/generation/hold 均匹配，共 254,100,611 bytes；不删除任何原文件。
- 25 条可播放视频，共 248,071,251 bytes：隔离机真实 GCS 回源 HEAD、首尾 2 个 Range 与原始字节对照、ffprobe 时长/编码/分辨率通过；三大首页视频另做跳转后解码。
- 浏览器隔离验证：首页竖屏视频播放并跳转后继续播放；博客 3840×2160 视频播放、跳转、正常到尾，均无媒体错误。原路径通过本机代理→既有 Fly 隔离机→GCS；不是正式域名上线验收。
- 离线迁移 5 项；媒体协议/构建保护/签名兼容 10 项通过；TypeScript 检查、Vite 构建通过。
- 同一次构建输出 281,157,827 bytes；加回精确排除的 248,071,251 bytes 为 529,229,078 bytes。这个差值是本次构建实测减少量，不能替代 Vercel 当前已存部署的精确容量。
- 构建后重新检查 26 条源文件 SHA-256 全部不变；坏文件仍在输出，其他资源没有被批量排除。
- 原始日志位于本机任务目录 `work/static-video-evidence-1105/`；云端复制审计 `/data/static-site-video-migration/2026-11-05-home-blog/`。仓库不收录凭证、签名 URL 或环境变量。

## 已有坏文件与未验范围

`/blog-assets/pk-kimi-vs-qwen/demo-A-4K-wm.mp4`（6,029,360 bytes，SHA-256 `249dc818e601b2973d994bfafa701e00b90d5fee5251844bba7878c126d24d65`）缺少 MP4 moov 索引。仓库原件、知识库指向的原素材包 protected 文件、同字节云端副本均不可正常解析。保留这些文件，移出发布清单，不用 720p 冒充 4K，也没有重新生成。该原有内容缺陷未修复；后续需找到有效同版 4K 原件或另获内容修复授权。

未做正式域名 CDN rewrite 实测、生产发布/回滚、Safari/移动设备和跨地域性能测试；GCS/Fly/Vercel 仍会产生既有存储与传输消耗，本改动不是带宽费用优化。旧部署不会因新代码自动缩小，历史每日峰值也不会被抹掉。

## 11月3日附近的存储增长调查

2026-11-05 浏览器逐点读取同一条曲线：Nov 3 为 4.70 GB，Nov 4 为 8.93 GB，Nov 5 为 13.17 GB。不是 Nov 3 当天已跳到13.17GB。顶部日期窗使用 America/Los_Angeles，而图表 tooltip 日期存在日界显示差；这里保留图表原文，不混换时区推断。

清理前完整25部署快照中，北京时间11月4日新增3个、11月5日新增13个，共16个成功部署（7 Production、9 Preview）。逐一取得这16个SHA的Git树：每份都有1111个公共源文件、457,208,793 bytes；首页/博客26条视频254,100,611 bytes且Git blob集合完全相同。当前与10月28日主干的首页/博客资源没有差异。

因此，能确认的增长驱动是近期连续部署重复保留同一批大静态资源，而不是这几天新增视频原片。16份公共资源按源树累计约7.32GB；加上JS/CSS等构建产物后，与曲线约8.47GB的上升量级相符。这是来源与量级核对，不是逐部署Vercel精确账单归因；该API未暴露部署输出总bytes，不能用build cache大小替代。API采集写入Fly的数据不等于Vercel部署产物，本次也没有关闭采集。

Vercel按每天项目最大存量累计；删除或新部署瘦身不抹去历史用量。官方口径：https://vercel.com/docs/deployment-storage 。本改动只减少未来应用该构建的新部署体积，不修改旧Production/Preview及alias，也不能承诺当前超额立即消失。

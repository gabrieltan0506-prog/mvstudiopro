# 字幕特效工作流接入 · 2026-10-03

用户要求把字幕特效代碼化接入漫剧工厂。本批在「成片与后期 → 成片字幕」增加无特效、柔和淡入淡出、轻弹入选择，继续通过原烧录任务另存成片。

## 实现与相邻路径

- `PostProdSubtitleCard.tsx` 真实表单生产 `effect`；默认无特效，保留字号16、细黑边、底部居中、确认SRT及原片。
- `PostProdWorkshopCard.tsx` 原 `queuePostProd` 提交口透传并标记任务样式；共用提交锁、项目scope和任务列表，不增加新的提交/收费入口。
- `server/jobs/postProdInput.ts` 可选枚举通过路由及worker的严格校验；旧任务缺字段原样通过。`server/services/postProdMediaSource.ts` 展开params后重解析，归属验证不变。
- `server/services/subtitleEffects.ts` 只在选择特效时将确认SRT编译为ASS。整句淡入/淡出最长160ms，轻弹入由94%到100%、最长180ms；短句按本句窗口缩短，不伪造逐字时间。
- `server/services/postProduction.ts` 仍使用原流式下载、原线程/心跳/终止信号、音轨copy、唯一结果路径和上传流程。新ASS使用画幅比例排版、保留显式换行，并对CJK长句保守断行；超出可排高度明确失败，不截断对白。ASS时间按格式精度取到百分之一秒，单个边界误差不超过5ms。
- 特效显式装载仓库已跟踪的 `assets/fonts/NotoSansCJKsc-Regular.otf`，复制到同任务临时字体目录；Docker构建包含此资源。任务结束正常清理临时字体及媒体；无特效仍沿旧SRT处理。
- `shared/manhuaFinalPostProd.ts` 等相邻成片采用/恢复路径未改。输出仍是独立对象，不覆盖原视频，不改变扣费逻辑，不新增模型调用。

## 来源与选择

- Remotion官方技能目录：https://github.com/remotion-dev/skills
- Remotion字幕动画和描边参考：https://www.remotion.dev/docs/captions/displaying
- ASS原生效果规范：https://aegisub.org/docs/latest/ass_tags/

这次实现使用现有FFmpeg/libass，不引入Remotion运行时或新生产依赖。中文逐字高亮需要另外取得真实逐字时间，未用整句时长平分冒充对齐。强调关键词/花字贴图未在本批提供。

## 验证与发现

- 契约、编译、worker、真实路由、素材归属、相邻成片处理及合成媒体：8个测试文件、93项通过。
- 隔离浏览器表单：1项通过，验证none/fade/pop与8/12/16字号实际进入回调，原片及SRT不变。
- 合成媒体通过真正的 `burnSubtitle` 下载→编译→FFmpeg→上传打桩路径：两种效果均有不同入场像素；字幕窗口前后无字、淡入淡出亮度下降；360×640/30fps、2秒不变，音轨SHA256与原合成音轨相同，长句有安全边距。
- 首轮本机FFmpeg无libass，因此只在本任务外置工具目录安装ffmpeg-static 5.3.0用于测试，没有修改仓库依赖或生产机。首轮方块字截图暴露本机字体发现失效，已改为显式加载仓库CJK字体，重新实际渲染并目视确认中文正常。
- 首次浏览器启动受sandbox限制，使用获批隔离测试浏览器复验通过；初次测试断言版本/TS目标不兼容已修正。未把这些失败计作通过。
- Vite生产构建通过（21.18秒）；有既有大chunk/动态静态混合导入警告。
- `pnpm check --incremental false` 全量类型检查退出0；禁用增量缓存是为了避开共享node_modules缓存的写权限限制。
- 合成片和逐帧统计在当前任务 `backend-work/subtitle-effects-evidence/`，属于开发证据，不是用户正式影片。

## 交付与未验边界

本地功能分支 `feat/subtitle-effects-1003`。尚未推送、新建PR、合并或部署；没有重新烧录用户整集、没有调用生产或付费模型。正式线上入口、正式渲染环境与整集质量尚未验收，不能用本机测试替代。

现有PR #1657已经合并。新发布需按当前授权与仓库顶部规则处理，由用户本人合并。上线需前后端均包含本批，之后从正式字幕表单选样式、核对新任务输入及结果，再交用户确认。回退效果选择「无特效」即可沿旧流程；回退代码及发布仍单独按当时授权操作。

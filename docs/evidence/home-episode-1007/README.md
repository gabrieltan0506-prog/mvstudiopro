# 首页《墨菁傳》第一集替换

用户于2026-10-07明确要求用第一集成片替换首页原Seedance水果示范，并确认影片目录2026Oct03。附件超过执行器32MiB上限；使用同机同名原件 `/Users/tangenjie/Downloads/2026Oct03/墨菁傳第一集.mp4`。

HomeHero第一槽由水果茶改为墨菁傳第一集；战船第二槽不变。沿已有public/home-assets静态交付，封面取原片第5秒，标题在播放器外。保留原controls、声音、metadata预加载、完整画幅object-contain，不裁剪竖片适配横框。

原始4K保留不动。网页副本完整1080x1920/H264、libx264 medium CRF23、AAC直接复制、faststart。106.176009秒、3185帧与原件一致；AAC包SHA完全一致；47,636,778字节。具体输入/输出SHA、ffprobe与moov/mdat顺序见media-validation.json。

验证只核对媒体完整性、音轨、静态引用与当前部署配置已允许public MP4，不以此冒称正式部署后的浏览器验收。仅此资源/文案替换不新增重复业务测试。合并部署后待确认首页首片播放、封面、移动端完整竖片及战船切换。旧水果茶资源仍供原博客使用，未删除。

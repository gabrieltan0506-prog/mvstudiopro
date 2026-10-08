# 第35集来源签名与工作机出口热修

## 改前证据与边界

| 检查项 | 当前证据与本次处理 |
| --- | --- |
| 最终结果 | 来源解析与媒体读取使用同一工作机出口，保留网站机调度及按需启停 |
| 允许范围 | 用户本次明确授权热修、提交、推送、新PR及直接合并；合并仍需实时在途任务/部署检查 |
| 禁止范围 | 不修改截图、模型参数、付费次数、生产数据、凭证或机器规格，不重跑学习、不派代理 |
| 真实入口 | 计划预览/执行计划 → fetchManhua0996EpisodePlayback；实际备料与换源 resolveNodes 同入口 |
| 数据生产者 | 来源站双鉴权 API 返回绑定出口的 t/whip/sign；原来在网站机解析 |
| 转换与存储 | heavy_media 持久队列；备料已占工作机时走原 callback exchange，避免子队列死锁 |
| 最终消费者 | 工作机 ffprobe、ffmpeg、原生切片备料；模型仍沿既有网站机链路 |
| 权限与恢复 | 仅可信来源 URL 入队，Cookie/Authorization 仅由工作机环境读取；每次刷新新身份，原查询保持同一任务ID，不复用旧出口签名 |
| 已知断点 | hiBSdqHbghR3mUQy 三候选403；原地址网站机2858.750066秒，工作机403；工作机自行双鉴权解析后同路径成功2858.750066秒，whip匹配各自出口 |
| 验证计划 | 覆盖网站机不本地取签名、工作机本地双鉴权、备料回调不重复入队、刷新/取消/错误、安全边界；完整后端构建；工作机隔离只读探针 |

## 既有证据

10月7日PR1676的CDN修复在当前2a588774中保留。到PR1687，来源解析、计划、发现与双机执行七个关键文件无差异；PR1686另改工作机DNS包装器。本次不是DNS失败或缺Cookie/Authorization，未证明截图改动导致403。旧成功任务NDuwBOzKWt3A8yUT媒体域ppvod021.zyxsuntech.com使用auth_key，本次ppvod01.kqgfbs.com使用t/whip/sign。

## 技能应用

主代理读取agency-agents-mvstudiopro的codebase-archaeology、code-review、evidence-gate及角色code-reviewer/workflow-architect/secrets-credential-hygiene-engineer，采用入口正反追链、取消恢复、回调死锁和凭证不跨边界检查；未启动代理。

正式完整学习与截图尚未线上验收；只读媒体探测不代表完整学习成功。

## 最终验证与主代理审查

- 2026-10-09 00:30:01+08，原工作机独立源码目录，正式来源函数/执行器/ffprobe实测原链接2858.750066秒；调用序列learn_source→learn_command，5生产文件SHA256与提交文件逐一一致，回执JSON已写GCS（generation见worker-receipt.json）。传输适配在进程内，不冒充完整线上队列/用户学习验收。
- 首组5文件34测试通过（/tmp/learning-affinity-tests.log）；新增首次队列派发和坏JSON回执2测试通过（/tmp/learning-affinity-dispatch-tests.log）。
- pnpm build --incremental false退出0；最终错误脱敏小改后pnpm build --incremental --tsBuildInfoFile /tmp/learning-affinity-final.tsbuildinfo退出0。git diff --check通过。
- 主代理完整diff及双向追链：计划/首次取源/执行探测→统一来源入口→工作机轻量请求→本地双鉴权→原媒体消费者；备料换源沿同一回调槽执行，避免子队列等待父任务。返回回执验证非空及错误，刷新新ID，不回用已持久化旧签名。可信来源限制、凭证只在Fly、取消、原幂等轮询和失败保留未放宽。
- 无模型/截图/视频生成，无数据迁移和依赖变化。截图与整集学习按用户要求留后验；没有宣称正式验收通过。
- 本次用户明确授权创建并直接合并本热修，覆盖旧的仅用户本人合并限制；禁止扩大到PR1685。

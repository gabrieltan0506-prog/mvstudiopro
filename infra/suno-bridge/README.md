# Suno cookie 桥（内部专用）

上游：gcui-art/suno-api，钉在 `a2e6a823`（2026-03-06）。用浏览器 cookie 冒充网页调 `studio-api.prod.suno.com`，
每次生成过一次 hCaptcha（2Captcha 付费解）。**违反 Suno 条款、会封号**：只给内部账号用，不接付费用户。

## 部署（一次）
1. 先核对桥应用是否已存在，不重复创建。凭证仅在 Fly Dashboard 的该应用 Secrets 中填写 `SUNO_COOKIE`、`TWOCAPTCHA_KEY`；不把真实值写入本机终端、环境变量或文件。
2. 部署：cd infra/suno-bridge && fly deploy -a mvstudiopro-suno-bridge
3. 主站 mvstudiopro 加 secret：SUNO_BRIDGE_URL=http://mvstudiopro-suno-bridge.internal:3000
   （可选，网页代号 0910 已对照确认）SUNO_BRIDGE_MODEL_V6_MINI=chirp-goose  SUNO_BRIDGE_MODEL_V6=chirp-hawk  SUNO_BRIDGE_MODEL_V6_WILD=chirp-hawk-wild

## 主站怎么用
配乐间「配乐来源」下拉只对 admin/supervisor 显示，默认 Suno v6（Pro 账号）；服务 `server/services/sunoBridgeMusic.ts`。
桥接口：POST /api/custom_generate {prompt, tags, title, make_instrumental, model, wait_audio:false, negative_tags}
→ 返回两条 clip；GET /api/get?ids=a,b 轮询到 status=complete 取 audio_url。

## 已知限制
- 没有 duration 参数（网页 v2 接口无此字段）；仍整曲生成后按段表裁。
- cookie 会过期，桥 502/401 时换新 cookie 重设 secret。
- 上游钉死提交，Suno 前端一改可能失效；升级必须重新检查契约。构建补丁统一在 `patch-upstream.mjs`，锚点必须各命中一次，否则构建失败。不要直接用不计数的 sed 掩盖上游漂移。


## 0910 实测状态与接手说明
- 已通：部署、cookie（须 `__client` + `__session`）、`/api/get_limit`（Pro 2500 点）。
- 未通：`getCaptcha()`。上游用无头浏览器在 create 页触发 hCaptcha 再截图给 2Captcha；Suno v6 改版后点 Create 一分钟内没有 hCaptcha 图片请求（`No hCaptcha request occurred within 1 minute`），令牌拿不到，生成发不出去。本 Dockerfile 已打三处 v6 补丁（textarea 选择器、"Create song"、拦截 `/api/generate/v2*`），仍差验证码触发这一步。
- 页面事实：sitekey `d65453de-3f1a-4aac-9366-a0f06e52b2ce`（非 enterprise）；生成请求 `/api/generate/v2-web/`；输入框为唯一可见 `textarea`；Create 按钮 `aria-label="Create song"`，空输入时 disabled。
- 接手要改的是上游 `src/lib/SunoApi.ts` 的 `getCaptcha()`（构建时补丁），方向见 `2026Sep10/交接报告-0910.md` 第九节；改完 `fly deploy` 后按 get_limit → custom_generate → get 的顺序验通，再给主站设 `SUNO_BRIDGE_URL`。

## 0910 后续代码收口（尚未部署、未证明真实生成成功）

- 请求监听先于 Create 点击安装，阻止页面的预备请求直接产生额外作品；只接受该页面请求中实际非空的验证令牌。
- 验证等待和点击异常进入同一完成等待；页面加载、等待、点击或回执失败都清理本次创建的浏览器。页面导航沿用已有就绪等待的60秒预算，并在导航前注册就绪监听。
- 不添加直接向验证码服务换令牌的路径，不变更原有验证处理方式。没有真实验证回执时仍失败，不能伪造成功。
- 上游调试日志遮盖令牌；主站错误不再拼接桥响应正文。POST断线、服务端错误、坏回执进入人工对账，不自动重提或按“没有建单”退款。
- 任务中的段落结构不再被纯器乐开关清空；少生成的变体数传到前台，旧记录缺省0。
- 离线测试：`node --test infra/suno-bridge/patch-upstream.test.mjs`。测试使用虚构页面和令牌，没有请求真实生成；必须与真实桥验收分开报告。
- 真实验收仍需获准后部署此补丁版本，再从桥提交一次并按原clip ID收单。桥未证实出片前，不把主站配置存在或账户接口成功当作上线完成。

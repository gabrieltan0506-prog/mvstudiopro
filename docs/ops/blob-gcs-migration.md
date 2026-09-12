# Blob 至 GCS 清点与复制准备工具

状态：部分验证。已新增下述真实 Fly 有限读取诊断；本条不宣称全部对象完成复制或清理，没有源删除授权变更。

## 2026-09-12 · SDK 缓存参数实测修正

主代理在 Fly 服务端实测：`@vercel/blob` 2.3.0 的 `useCache:false` 会附加 `?cache=0`，当前 public Blob 的普通读取、Range读取、If-Match读取均返回400；改为 `useCache:true` 配合 Range 后成功，SDK状态200且响应带Content-Range，ETag与head一致。凭证始终留在Fly，未删除源对象。

因此CLI改为SDK默认缓存行为（显式true），保留If-Match、get响应ETag/大小/路径校验、读前后及复制后head，以及GCS固定generation的SHA/字节验真，不能为避开400而放松源版本一致性。此处记录的成功只是有限读取诊断：true+Range+If-Match的公私对象组合由主代理继续核验，不等于真实全量copy已通过。离线新增公私两种入口的实际SDK调用参数断言，防止回归成cache=0。

此前本地准备快照如下，未验证项需结合后续实测回执判断：
基线：PR1451，提交 `3938ff3a`。只新增 `server/ops/blobGcsMigration.ts`、`blobGcsMigrationCli.ts`、对应测试与本说明，不修改业务渲染器、API、权限、计费、博客或公共存储依赖。

## 改前证据表

| 层         | 依据及决定                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| 结果与范围 | 清点 Blob；显式 copy 后复制并验真；没有删除功能，旧直链继续保留                                                |
| 入口       | 独立 CLI，必须 FLY_APP_NAME 精确等于 mvstudiopro 且 FLY_MACHINE_ID 非空；拒绝令牌参数，只读取选定 Fly 环境变量 |
| 生产者     | 已安装 Blob SDK list/head/get；全部分页、每页先持久化 SDK 原始响应（不是 HTTP 线级抓包）                       |
| 转换       | 目标名是完整源 URL 的 SHA256，防路径规整造成碰撞；内容不转换、不裁剪                                           |
| 权限       | 服务端环境中的 MVSP_READ_WRITE_TOKEN 或 BLOB_READ_WRITE_TOKEN；不输出变量值、不接受明文参数                    |
| 存储       | 复用 GCS ifAbsent、generation stat、有界流式摘要；副本不覆盖已有对象                                           |
| 消费       | 当前只生成审计/复制回执；不接管旧 Blob URL，不宣称旧草稿已经迁移                                               |
| 失败恢复   | 源变动、目标冲突与超限均明确拒收；再次启动重清点、重验证，不能凭 done 标记跳过                                 |
| 验证       | 模拟分页、冲突、三阶段源变动、下游失败、凭证错误脱敏与已有 GCS helpers 专项                                    |

## 仅在 Fly 服务端执行

不得在本机配置或导出生产密钥。脚本文件可由后续经批准的发布流程带到服务器；本次没有执行远端命令。

```sh
pnpm exec tsx server/ops/blobGcsMigrationCli.ts
pnpm exec tsx server/ops/blobGcsMigrationCli.ts --copy
pnpm exec tsx server/ops/blobGcsMigrationCli.ts --store BLOB --access private
```

默认只清点，**清点仍将审计 JSON 写入 Fly /data 和 GCS**，不写媒体副本。
默认读取 `MVSP_READ_WRITE_TOKEN`；`--store BLOB` 改为读取 `BLOB_READ_WRITE_TOKEN`，不会轮试其他令牌。
`--access public|private` 只影响显式 copy 的 SDK get；按实际存储访问类型选择，失败不会降级绕鉴权。

默认串行1，单对象最多64MiB（参数 `--max-object-bytes`，硬上限256MiB），整批媒体预留传输预算1GiB（`--max-transfer-bytes`），逐对象/页停250ms（`--delay-ms`，0–60000）。预算按源读+目标写+目标验读三倍源体积预留，**不是带宽速率限制**；JSON审计、metadata请求及SDK重试流量不包括在该媒体预算内。Buffer上传是现有ifAbsent原语限制，所以没有声称任意体积的视频都能复制；大对象明确`pending_limit`，未来需要有界流式条件上传。

## 证据与续跑

每次运行独立UUID目录 `/data/blob-gcs-migration/<runId>/`；JSON采用exclusive create、文件sync后再GCS条件创建，路径 `blob-migration/evidence/<runId>/...json`；本地附加receipt记录对象名、bytes、SHA256、generation。复制对象放 `blob-migration/objects/<源URL的SHA256>`。旧对象、成功或失败证据均不自动删除。

每个源锁定 list/head/get 的URL、路径、size、uploadedAt、ETag。get发送If-Match并对实际字节数校验，读后与复制验真后再次head；任何变化标失败，已经创建的副本保留而非冒称迁移成功。目标采用ifGenerationMatch=0；已存在则重新校验完整SHA256和字节。验读固定generation，并再次stat确认该generation仍为当前版本。

重启不沿用可能失效的旧cursor；重新全分页，目标存在也必须重新验真。这是完整性优先的续跑，仍消耗下载流量。清点过程不是原子快照：新增/删除源对象可能改变分页集合，应在切断旧写入后再完整复清点对账。本工具既不会冻结写入，也不会删除源对象。

退出码：0表示本轮清点结束且无失败或pending；2表示存在失败或超限pending；1表示入口、分页、存证等致命错误。`inventoryComplete`只表示分页走到末页；不能解读成全部媒体已复制。默认inventory即使退出0也没有复制。

## 双向追链与未验证

正向：CLI→SDK原页双存→源身份复核→ifAbsent→generation验读→源末次复核→对象JSON。
反向：object-result的URL/ETag/bytes/SHA/generation→copy-plan→原页→Blob list；目标名由同URL生成，与完整内容摘要分开。

生产引用审计、正式私有Blob权限、真实GCS网络/超时、对象生命周期、旧草稿/导出兼容和实际切换均未验。任何删除必须另做引用审计；本工具没有delete开关，也没有delete依赖。

# 普通视频参考职责修正与三段试片验收（部分验证）

## 改前证据与边界

| 项目 | 事实与范围 |
| --- | --- |
| 用户结果 | 以常态墨屠、浅色金饰四尾黑翼完全体及阿菁为身份图，按正文执行三段十秒动作，而非静态微动。 |
| 真实断点 | 三段真实出站 prompt 均被 `canvasRunBlock.ts` 额外追加“参考静帧／场景材质／微动演绎”。这与身份图职责冲突，不能据此归因全部画面缺陷。 |
| 允许修改 | 删除普通视频这段无条件自动追加，补真实执行器的离线请求断言。 |
| 不改 | 原 29 镜剧本、角色资产、历史任务及视频、价格、权限、公开接口、模型、提交次数、账本、草稿 schema。 |
| 生产／入口 | `FreeformCanvas.tsx` 单节点 runBlock、`canvasDramaStudio.ts` 批量／续跑共用 `runCanvasBlock`；节点正文与上游文本组成 mergedPrompt。 |
| 转换／消费 | mergedPrompt → 连续性提示 → compileI2VMotionPrompt → stripper → 原引擎请求；首图＋融合图进入 imageUrls，不依赖上传列表。 |
| 存储／失败 | 本次仅临时出站文案变化，不改节点输出和任务记录；原任务 ID、同单轮询和失败路径保持。 |
| 验证 | 四引擎实际 POST、显式首帧、无图与空输入；工厂、编辑、参考图、类型和构建回归。新代码尚未线上实跑。 |

## 双向追链及邻接核查

正向：单节点或批量／续跑入口 → 当前 block.prompt／上游文本 → mergedPrompt → 非 clip 仅按原条件加连续性提示 → 既有编译器 → imageUrls＋prompt 同次 POST → 原任务轮询／回填。删除的是自动文案，不写入或清除任务、输出及草稿字段。

反向：新测试最终 POST 中的“图片只提供人物身份”和完整动作 → motionPrompt → mergedPrompt → 测试中同一真实 block.prompt；图片 URL 与顺序对应原 refImageUrl／editFusionUrls。明确首帧的用户正文保留，旧 outputUrl 未被执行器修改，断言每次只有一条 POST。

clip 原本直接用 mergedPrompt，改后相同；工厂绑定、导演板、尾帧和光学参数未变。视频编辑在此位置之前返回。非 clip 有接力视频时依然追加原连续性提示，提取尾帧与容量限制未变。空输入仍拒绝，编译器独立空正文 fallback 未删除。旧草稿不用迁移；本补丁不触发重跑、扣费或覆盖旧视频。

## 本地验证回执

- `pnpm exec vitest run client/src/lib/canvasRunBlock.*.test.ts client/src/lib/canvasProjectVideoReferences.test.ts client/src/lib/canvasDramaStudio.test.ts shared/manhuaSeedanceLayout.test.ts --maxWorkers=2 --minWorkers=1 --reporter=dot`：10 files passed、182 tests passed，19.92 秒，退出 0。
- 前一轮指定文件运行：6 files passed、153 tests passed，8.82 秒；命令还写了不存在的 `shared/jsonDirectorMiddleware.test.ts`，该文件未运行，不能把它计入验证。
- `pnpm check`：退出 0。
- `pnpm exec vite build`：3560 modules、built in 28.06s，退出 0；保留动态／静态 import 和大 chunk 警告。
- 主代理完整生产 diff 与新测试 review、独立代理只读审查：未发现新增 P0–P2；`git diff --check` 退出 0。
- `pnpm exec tsc --noEmit --incremental false`：退出 0。
- 后续新增普通接力成功请求和普通／clip 对照两项；子代理 15 tests passed，4.29 秒。首轮使用当前 Vitest 不支持的 ExactlyOnceWith 导致两项失败，改为 Times(1)＋CalledWith 后通过，没有削减断言。主代理复跑单文件 15 tests passed，1.91 秒，退出 0。
- 未做本补丁全仓回归和线上新提示词付费实跑。后续追加的对照测试及无增量类型结果另记，不提前列为通过。

## 三段历史真实结果（不是本补丁线上验收）

| 任务 | 出站引用数／字数 | 真实产物与质量 |
| --- | --- | --- |
| cv_mtrvxim9_efc029ee | 2／518 | succeeded；原帧第 7 秒两个阿菁，身份数量不合格。 |
| cv_mtrvy805_70e25e21 | 3／618 | succeeded；第 9 秒浅色金饰黑翼和彩尾保留，但四蹄出框。 |
| cv_mtrvyz6b_d8f90ac1 | 2／635 | succeeded；第 9 秒四蹄着地、黑翼护住阿菁；全时域四尾／接触与声音仍未完整核验。 |

三单均为真实 Seedance Mini r2v、1280×720、24fps、10.08 秒、AAC 32kHz 双声道。管理账号记录 creditsCharged=0，不表示上游免费。原页面仍有六节点，所选图 2／3／2，三单已完成并回填。旧三单仅各提交一次，本次不重投。

Fly 账本只读对账三单均为 canvasVideo／settled、creditsBilled=0，结算 UTC 时间分别为 23:44:40.210、23:45:44.102、23:45:36.931；没有把未知任务提前结算。每单补采证据目录各五份 JSON，raw=566 字节、完整 parsed=697 字节，另含 normalized、任务快照、manifest；哈希已读取核对，JSON 不下载含签名的原文到本机。

原始创建响应未被旧服务保存，无法补造；已在 Fly 按已知供应商 ID 补采终态 raw／完整 parsed／normalized／manifest，明确标注补采时间。自动存证修复与现行 24 小时退款规则存在边界，详见 `manhua-evolink-evidence-boundary-0908.md`，本批不改计费规则。

## 九层完成状态审计

| 层 | 状态／证据 |
| --- | --- |
| 需求边界 | 已验证：删除错误自动追加，其余合同不改。 |
| 入口交互 | 已验证（静态／本地）：所有共用执行器入口；线上新代码未验。 |
| 数据生产 | 已验证：真实旧单非空 prompt 与图片；新测试使用执行器断言身份正文。 |
| 契约转换 | 已验证（本地）：四引擎、显式首帧、空输入、旧字段不变。 |
| 服务副作用 | 部分完成：离线 POST 数量及参数通过；真实普通用户扣退未跑。 |
| 存储恢复 | 部分完成：未改合同，旧三单原页面恢复可见；存证自动化阻塞。 |
| 消费展示 | 部分完成：旧真实视频可取，画面有明确缺陷；新代码尚无真实出片。 |
| 静态回归 | 部分验证：目标测试、类型和构建通过，未重跑全仓。 |
| 真实链路 | 部分完成：旧链三单成功，新代码未做线上实跑，不宣称修好画质。 |

其他残余：非 clip 显式选择运镜配方时，共享编译器仍可能用配方替换正文；HappyHorse 当前共享图配额为一张。本次不改变这两项既有合同，不声称所有路径原样保留正文。未生成新关键帧、TTS、BGM、超分或最终合成；不拿抽帧冒充新生图。

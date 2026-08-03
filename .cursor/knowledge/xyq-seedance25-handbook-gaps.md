# 小云雀 Seedance 2.5 手册对照缺口（2026-08-04）

来源：[小云雀 Seedance 2.5 使用手册](https://bytedance.larkoffice.com/wiki/W5tHwoZIDi12dbk2z3KcFkuUnsf) + 官方 CLI `@pippit-dev/cli` + 公开评测文。

## 「720°」是什么（已核实）

- **不是**该 2.5 手册正文里的运镜菜单名（页内无「720」「环场运镜」字样）。
- 公开评测里的 **「720°全景」** 指短剧 Agent **场景资产**：生成可旋转观看的场景球，转视角再截成新场景图，解决多集同场景一致性——属**场景编辑/取景**，不是单独一条「720 度运镜按钮」。
- 运镜侧对应能力是 **环绕 / soft orbit**（半周→一周）。本仓库已在 `craftShotBank` 补：
  - `cam_09_orbit_half` 环绕半周展空间
  - `cam_10_orbit_full_sphere` 全景环场一周

## 两条真路由（验收硬点 · 禁止空壳）

对齐官方 CLI / nest skill，**不可混充**：

| 路由 | OpenAPI body | 用途 |
|---|---|---|
| **video_part** | `agent_name=pippit_video_part_agent` + `video_part_tool_param` | 新生成、首尾帧（`generate_type=1`）、延长（须 `videos[]`） |
| **video_part mini_tool** | 同上，但 `mini_tool_param.tool_name` = `video_super_resolution` / `erase_video_subtitle` | 提升清晰度 / 擦字幕（官方 CLI） |
| **nest** | 仅 `message` + `asset_ids`（**无** `video_part_tool_param`） | 局部重拍 / 视频复刻 |

代码入口：`server/services/xyqSeedanceVideo.ts` → `runXyqSeedance25Video({ workMode })`  
- `generate` / `extend` → `route: "video_part"`  
- `upscale` / `erase_subtitle` → `route: "video_part"` + mini_tool  
- `reshoot` / `remix` → `route: "nest"`  

验收时抓 `submit_run` body：局部重拍/复刻若仍带 `video_part_tool_param` = **空壳，不合格**；超分须见 `video_super_resolution_tool_param`。

## 手册能力 → 我方状态

| 能力 | 手册 | 我方 | 备注 |
|---|---|---|---|
| 30s 直出 | ✅ | ✅ 4–30s XYQ | 成片·加长 |
| 多模态参考 | 图30/视10/音10 | 图9/视3/音3 | API 白名单上限；音频仅 mp3/wav |
| 秒级时间戳分镜 | ✅ | ✅ 画布「秒级分镜」+ `composeXyqSeedance25Prompt` | 进 prompt，无单独 API 字段 |
| 首尾帧 | ✅ | ✅ 勾选 → 两图顺序 + `generate_type=1` | 仅 workMode=generate |
| 局部重拍 | ✅ 独家 | ✅ nest `message+asset_ids` | **非**改提示词假扮 |
| 视频延长 | ✅ | ✅ video_part + `videos[]` + 延长指令 | 单次 ≤30s；多轮可叠 |
| 视频复刻 | ✅ | ✅ nest remix 工作模式 | 参考视频 + 复刻指令 |
| 提升清晰度 | ✅ CLI | ✅ mini_tool `video_super_resolution` | 画布「提升清晰度」 |
| 擦除字幕 | ✅ CLI | ✅ mini_tool `erase_video_subtitle` | 画布「擦除字幕」 |
| 参考视频/音频 | ✅ | ✅ ≤3 视 / ≤3 音 | 上传 → `pippit_asset_id` |
| 会话链回传 | — | ✅ `threadId` / `webThreadLink` 写回节点 | 超时先查创作历史，勿重打 |
| 白模 / 3D 导演台 | ✅ 独家 | ❌ | 产品级，非本 API |
| 720° 全景场景球 | 短剧 Agent | ❌ | 场景工具，非出片参数 |
| 抖音链接复刻 | ✅ 独家 | ⚠ 可 nest 自然语言带链 | 未做专用控件（防空壳） |
| 绿幕 / 营销模板 | ✅ | ❌ | |
| 千人角色库 | ✅ 独家 | ❌ 自有资产库 | |
| 会员门禁 2.5 | — | ✅ pro/enterprise | |

## 补齐原则

1. **不烧小云雀探针**（见 `xyq-no-probe-burn-always`）。
2. 能用提示词/运镜库/画布参数补的先补；独家产品台不做空壳山寨。
3. 对外文案不泄漏 Seedance / 小云雀商品名（前台零技术泄漏）。
4. 失败/超时以创作历史为准，禁止因本机 `fetch failed` 再打一枪。

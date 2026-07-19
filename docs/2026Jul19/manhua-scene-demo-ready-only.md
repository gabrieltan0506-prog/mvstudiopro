# 场景示范封面：只展示已落盘 + 每日补图口径

## 问题
资产墙场景模板无封面时曾显示「文案库 / 待生成」，像半成品库；每日补图脚本存在但未挂 CI cron，缺口不会自动长满。

## 口径（已落地）
1. **UI**：仅展示 `client/public/manhua-scenes|manhua-props/*.jpg` 已有文件；`getManhuaDemoAssetPublicUrl` 对未就绪返回空。
2. **就绪名单**：`shared/manhuaDemoPublicReady.ts`；生图 `COPY_PUBLIC=1` 后自动 sync，或 `pnpm run manhua:scene-prop-sync-ready`。
3. **每日批次**：`pnpm run manhua:scene-prop-daily` 优先补 `scene_XX` 绑定缺口；需本机可达 Fly 文生接口。
4. **省积分**：默认 `GRID2X2=1`——一次文生 2×2 拼图，本地 Pillow 裁成 4 张（约 4×）；余数不足 4 仍单张；`GRID2X2=0` 可关。
5. **合规**：纯文生空镜，禁剧照/用户上传入库。

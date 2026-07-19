# 漫剧合成长片 + 配乐 · 验收纪要

## 能力

- 成片坞「合成长片（含配乐）」→ `POST /api/jobs?op=manhuaAssembleFinal`
- 同源 `renderWorkflowFinalVideo`（fade + 9:16）+ 自动配乐
- 工作台露出：蓝轨/红轨状态、叙事灯光名称

## 线上手测清单

1. Debug On；确认编剧后工作台有专案设定
2. 静帧标注蓝/红轨 → clip prompt 含「蓝轨/红轨」跟轨句
3. 选叙事灯光 → beats/keyart prompt 含灯光块
4. 各集跑出 clip 后点「合成长片（含配乐）」→ 得长片预览
5. 前台文案无供应商名

## 配乐策略

- 默认一次生成约 4 分钟（够约两集）；上游常一次两首 → 三集一轮够用
- 优先主渠道；失败自动回退备用渠道（前台不展示渠道名）

## 仿真人库

- `char_f_16` 沈红妆 / 顾凤仪：古装红妆凤冠新娘妆造
- **过审口径**：真人剧照仅本地软参考反推妆造/场景/道具；库内 hero/sheet 必须 image-2 **纯文生成**新人脸（`TEXT_ONLY_IDS=char_f_16`），禁止直接入库真人演员脸

## 线上实测（合成）

- 合入前 Fly 探测：`manhuaAssembleFinal` → `unknown_op`（预期，未 Deploy）
- **#869 Fly Deploy success**（2026-07-19）
- API 空 clips → `manhua_assemble_no_clips`（正常）
- **三集合成验收通过**（`fly.dev` 样本片 ×3，勿用 www 路径：会 404）
  - `sceneCount=3` · `episodeIndexes=[1,2,3]` · 配乐主渠道成功
  - `finalVideoUrl`：`https://dfww7dlrjd2729oq.public.blob.vercel-storage.com/renders/1784469580539-rendered-video.mp4`
- 前台：成片坞「合成长片（含配乐）」文案无供应商名；Debug On 可看 `assemble:*` 日志

## 已知边界

- 蓝红线/灯光为生成期注入，服从度取决于成片模型
- 无 clip 的集会 skip，不阻断有 clip 的合成

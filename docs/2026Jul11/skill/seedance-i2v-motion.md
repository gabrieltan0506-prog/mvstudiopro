---
id: seedance-i2v-motion
name: Seedance图生视频微动
description: 有静帧时做减法；公式=运镜+主体微动+氛围；调度/空镜/阶段拆分
version: 2026-07-16c
defaultEnabled: false
---

# Seedance 图生视频微动 Skill

## 用途
**仅 /canvas · Creative**（不进 `/platform` Skill 池与路由）。静帧已经锁死光影与构图时，**禁止**把整段电影感 JSON/长形容词再贴一遍。

样本：`json.mp4` 第四阶段 · [info-2570](https://www.super-i.cn/info-2570.html) · 调度公式见 [info-2917](https://www.super-i.cn/info-2917.html) · 空镜五要素 [info-2881](https://www.super-i.cn/info-2881.html)。  
运行时：`compileI2VMotionPrompt`（`shared/jsonDirectorMiddleware.ts`）。

## 万能微动公式（硬）
`[镜头运动] + [主体微动] + [环境氛围]`

### 镜头运动（择一）
- Slow cinematic zoom out / zoom in  
- Gentle push-in · Slow pan left/right · Locked-off static · Subtle handheld  

### 主体微动（优先微动，拒鬼畜）
- hair in wind · subtle breathing · coat fabric · glancing eyes · tiny hand gesture  
- **少写** Running / Fighting 等大幅动作（易崩）；打斗另按阶段拆 2–3 秒因果链  

### 环境氛围
- dust floating · rain falling · soft haze · neon flicker · sparse snow  

**正确例：** `Slow cinematic zoom out, wind blowing the dust, horse breathing, subtle coat movement.`  
**错误例：** 再堆「赛博朋克、霓虹、8k、电影感大师杰作……」

## 无参考图 / 多镜故事时
可用组合公式（2917）：  
`【摄影参数及画面质感】+【整体情绪】+【角色描述】+【场景描述/调度说明】+【画面内容】`  
仍须**成稿去导演名**；长故事按 clip 拆，下一镜以**已接受成片尾帧**为准续写（勿盲 extend 原 prompt）。

## 空镜（2881）
空镜至少写清：拍摄主体 · 主体状态 · 动态细节 · 光线氛围 · 镜头运动。空镜服务于叙事停顿，不是装饰填充。

## 资产锁定（Seedance 实战）
角色四视图 / 场景图 / 参考视频角色分离：身份、环境、动作、运镜节奏勿混进同一句糊话。  
与 `json-director-middleware` 分工：先 JSON 出稳静帧，再用本 Skill 出视频句。

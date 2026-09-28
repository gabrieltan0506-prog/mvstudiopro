/** 相容入口：运镜实现统一维护在 manhuaCameraDirection.ts。 */
// 类型与值必须分开转出：生产以 tsx 逐文件转译运行，`export { 类型名 } from` 会被当成值保留，
// Node ESM 链接时报「does not provide an export named」导致进程启动即退出（0928 事故）。
export type { ManhuaCameraStyle, ManhuaCameraShotKind, ManhuaChoreographedCamera, ManhuaCameraChoreographyInput, ManhuaCameraTempoParams, ManhuaCameraVarietyIssue } from "./manhuaCameraDirection";
export { MANHUA_CAMERA_MAX_CUTS, CONTACT_LEAD_FRAMES, choreographManhuaCameras, manhuaCameraPromptZh, assessManhuaCameraVariety } from "./manhuaCameraDirection";

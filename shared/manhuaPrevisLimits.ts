/** 与现有渲染预算一致；结构安全界限由最短合法片长推导，不另设固定人数门槛。 */
export const PREVIS_RENDER_UNIT_BUDGET = 2800;
export const PREVIS_BUDGET_FPS = 24;
export const PREVIS_MIN_DURATION_SEC = 2;
export const PREVIS_MAX_ACTORS = Math.floor(PREVIS_RENDER_UNIT_BUDGET / (PREVIS_BUDGET_FPS * PREVIS_MIN_DURATION_SEC));

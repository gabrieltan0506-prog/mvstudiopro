/**
 * Vercel 旧预览部署的筛选逻辑（纯函数，无网络无副作用，便于直接测）。
 *
 * 删除不可逆，所以失败方向必须是「少删」而不是「误删」。三道闸：
 *  ① 白名单极性：只有明确认得出是预览的才可能被删。现网 v6 对预览返回 `target: null`、
 *     对生产返回 `"production"`；万一将来多出别的 target 或字段消失，一律判为认不出 → 不删。
 *  ② 排除项目当前的线上生产部署（调用方负责查出来传进来；查不到就不该调用本函数）。
 *  ③ 年龄：普通预览要超过 keepDays；失败/取消的另有一个更短的保留期，但不是「立刻可删」——
 *     今早刚炸的构建，它的 inspect 页与构建日志正是排查要用的。
 */

/** 只认得出这两种形态才算预览；其余一律不删 */
export function isKnownPreviewDeployment(deployment) {
  if (!deployment || typeof deployment !== "object") return false;
  if (!Object.prototype.hasOwnProperty.call(deployment, "target")) return false;
  const target = deployment.target;
  return target === null || target === undefined || target === "preview";
}

export function isProductionDeployment(deployment) {
  return Boolean(deployment) && deployment.target === "production";
}

/** 保留天数：非有限值回落默认；下限钉 1 天，`KEEP_DAYS=0` 不许把刚建的预览也删掉 */
export function normalizeKeepDays(raw, fallbackDays = 7) {
  // 环境变量设成空串等于没设，不能被 Number("") === 0 吞成「删光」
  if (raw === null || raw === undefined) return fallbackDays;
  if (typeof raw === "string" && raw.trim() === "") return fallbackDays;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallbackDays;
  return Math.max(1, parsed);
}

export function selectPrunableDeployments({
  deployments,
  liveProductionIds = new Set(),
  keepDays = 7,
  failedKeepDays = 1,
  now = Date.now(),
}) {
  const DAY = 86_400_000;
  const live = liveProductionIds instanceof Set ? liveProductionIds : new Set(liveProductionIds || []);
  const list = Array.isArray(deployments) ? deployments : [];
  const targets = list
    .filter(isKnownPreviewDeployment)
    .filter((d) => !isProductionDeployment(d))
    .filter((d) => !live.has(d.uid))
    .filter((d) => {
      const ageMs = now - Number(d.created || 0);
      if (ageMs > keepDays * DAY) return true;
      const broken = d.readyState === "ERROR" || d.readyState === "CANCELED";
      return broken && ageMs > failedKeepDays * DAY;
    })
    .sort((a, b) => Number(a.created || 0) - Number(b.created || 0));

  // 自检：目标集合里混进生产、线上部署或认不出类型的，一律视为闸门失效
  const breach = targets.filter(
    (d) => isProductionDeployment(d) || live.has(d.uid) || !isKnownPreviewDeployment(d),
  );
  const unknown = list.filter((d) => !isProductionDeployment(d) && !isKnownPreviewDeployment(d)).length;
  return { targets, breach, unknown, productionCount: list.filter(isProductionDeployment).length };
}
